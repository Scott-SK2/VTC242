import type { ClientEvents, Frame, ServerEvents } from './events';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
type Handler<K extends keyof ServerEvents> = (data: ServerEvents[K], frame: Frame) => void;

const BACKOFF_MS = [1000, 2000, 4000, 8000];
const PING_MS = 20_000;

export const WS_BASE = `${(import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000').replace(/\/$/, '')}/ws/`;

/**
 * Client WebSocket : ping 20 s, reconnexion 1/2/4/8 s, bus d'événements typé.
 * Le token est fourni par une fonction pour suivre le refresh de l'access JWT.
 */
export class WsClient {
  private socket: WebSocket | null = null;
  private handlers = new Map<string, Set<(data: unknown, frame: Frame) => void>>();
  private statusHandlers = new Set<(s: WsStatus) => void>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private wasOpen = false;
  private manualClose = false;
  private queue: string[] = [];
  status: WsStatus = 'idle';

  constructor(private getToken: () => Promise<string | null> | string | null) {}

  connect() {
    this.manualClose = false;
    void this.open();
  }

  private async open() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    )
      return;
    const token = await this.getToken();
    if (!token || this.manualClose) return;
    this.setStatus(this.attempt > 0 ? 'reconnecting' : 'connecting');
    try {
      this.socket = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket.onopen = () => {
      const reconnected = this.wasOpen;
      this.wasOpen = true;
      this.attempt = 0;
      this.setStatus('open');
      this.startPing();
      for (const msg of this.queue.splice(0)) this.socket?.send(msg);
      this.emit('ws.open', { reconnected });
    };
    this.socket.onmessage = (ev) => {
      let frame: Frame;
      try {
        frame = JSON.parse(String(ev.data)) as Frame;
      } catch {
        return;
      }
      if (!frame || typeof frame.event !== 'string') return;
      this.emit(frame.event as keyof ServerEvents, frame.data as never, frame);
    };
    this.socket.onclose = (ev) => {
      this.stopPing();
      this.socket = null;
      this.emit('ws.close', { code: ev.code });
      if (!this.manualClose) this.scheduleReconnect();
      else this.setStatus('closed');
    };
    this.socket.onerror = () => {
      /* onclose suit toujours */
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 8000;
    this.attempt += 1;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, delay);
  }

  close() {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
    this.socket?.close(1000, 'client');
    this.socket = null;
    this.attempt = 0;
    this.wasOpen = false;
    this.setStatus('closed');
  }

  send<K extends keyof ClientEvents>(event: K, data: ClientEvents[K]) {
    const msg = JSON.stringify({ event, ts: Date.now(), data } satisfies Frame);
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(msg);
    else if (event !== 'ping' && this.queue.length < 50) this.queue.push(msg);
  }

  on<K extends keyof ServerEvents>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (data: unknown, frame: Frame) => void);
    return () => set?.delete(handler as (data: unknown, frame: Frame) => void);
  }

  onStatus(handler: (s: WsStatus) => void): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  private emit<K extends keyof ServerEvents>(event: K, data: ServerEvents[K], frame?: Frame) {
    const set = this.handlers.get(event);
    if (!set) return;
    const f = frame ?? { event, ts: Date.now(), data };
    for (const h of set) {
      try {
        h(data, f);
      } catch (e) {
        console.error('ws handler', e);
      }
    }
  }

  private setStatus(s: WsStatus) {
    this.status = s;
    for (const h of this.statusHandlers) h(s);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => this.send('ping', {}), PING_MS);
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
