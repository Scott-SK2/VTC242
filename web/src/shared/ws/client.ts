import type { ClientEvents, Frame, ServerEvents } from './events';

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
type Handler<K extends keyof ServerEvents> = (data: ServerEvents[K], frame: Frame) => void;

const BACKOFF_MS = [1000, 2000, 4000, 8000];
const PING_MS = 20_000;

/**
 * Le temps réel est servi par la même API : son adresse se déduit de VITE_API_URL
 * (https → wss, http → ws). Plus de seconde variable à tenir à jour : un VITE_WS_URL
 * resté sur un ancien serveur laissait l'application bloquée sur « Reconnexion au serveur… ».
 */
export function wsBaseFrom(apiUrl: string | undefined): string {
  const base = (apiUrl || 'http://localhost:8000').replace(/\/$/, '');
  return `${base.replace(/^http(s?):\/\//, (_m, s: string) => `ws${s}://`)}/ws/`;
}

export const WS_BASE = wsBaseFrom(import.meta.env.VITE_API_URL);

/**
 * Client WebSocket : ping 20 s, reconnexion 1/2/4/8 s, bus d'événements typé.
 * Le token est fourni par une fonction pour suivre le refresh de l'access JWT ;
 * `force` demande un token neuf (le précédent a été refusé par le serveur).
 *
 * Une seule socket « courante » : les événements d'une ancienne socket (dont la
 * fermeture arrive après l'ouverture de la suivante) sont ignorés, sinon chaque
 * changement de session laissait une socket orpheline qui doublait les événements.
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
  /** Numéro de la dernière tentative d'ouverture : une tentative dépassée (fermeture,
   * changement de session pendant l'attente du token) abandonne. */
  private openSeq = 0;
  private forceToken = false;
  private queue: string[] = [];
  status: WsStatus = 'idle';

  constructor(private getToken: (opts: { force: boolean }) => Promise<string | null> | string | null) {}

  connect() {
    this.manualClose = false;
    void this.open();
  }

  /** Nouvelle connexion (changement de session) sans perdre le fait d'avoir déjà été
   * connecté : `ws.open` sera émis avec reconnected=true pour resynchroniser l'écran. */
  restart() {
    const wasOpen = this.wasOpen;
    this.close();
    this.wasOpen = wasOpen;
    this.connect();
  }

  private async open() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    )
      return;
    const seq = ++this.openSeq;
    let token: string | null;
    try {
      token = await this.getToken({ force: this.forceToken });
    } catch {
      token = null;
    }
    if (seq !== this.openSeq || this.manualClose) return;
    this.forceToken = false;
    if (!token) {
      // session absente ou refresh impossible pour l'instant (réseau) : on réessaie
      this.scheduleReconnect();
      return;
    }
    // un autre appel a pu ouvrir une socket pendant l'attente du token
    if (this.socket) return;
    this.setStatus(this.attempt > 0 ? 'reconnecting' : 'connecting');
    let sock: WebSocket;
    try {
      sock = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = sock;
    let opened = false;
    sock.onopen = () => {
      if (sock !== this.socket) return;
      opened = true;
      const reconnected = this.wasOpen;
      this.wasOpen = true;
      this.attempt = 0;
      this.setStatus('open');
      this.startPing();
      for (const msg of this.queue.splice(0)) sock.send(msg);
      this.emit('ws.open', { reconnected });
    };
    sock.onmessage = (ev) => {
      if (sock !== this.socket) return;
      let frame: Frame;
      try {
        frame = JSON.parse(String(ev.data)) as Frame;
      } catch {
        return;
      }
      if (!frame || typeof frame.event !== 'string') return;
      this.emit(frame.event as keyof ServerEvents, frame.data as never, frame);
    };
    sock.onclose = (ev) => {
      if (sock !== this.socket) return; // ancienne socket : déjà remplacée
      this.stopPing();
      this.socket = null;
      // refus d'authentification (token expiré) ou session changée côté serveur (4000 :
      // déconnexion partout, blocage, changement de mode) : en redemander un neuf ; si le
      // refresh est refusé (400/401), la déconnexion normale s'applique
      if (!opened || ev.code === 4000 || ev.code === 4401 || ev.code === 4403) this.forceToken = true;
      this.emit('ws.close', { code: ev.code });
      if (!this.manualClose) this.scheduleReconnect();
      else this.setStatus('closed');
    };
    sock.onerror = () => {
      /* onclose suit toujours */
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.manualClose) return;
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
    this.openSeq += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopPing();
    const sock = this.socket;
    this.socket = null;
    sock?.close(1000, 'client');
    this.attempt = 0;
    this.wasOpen = false;
    this.queue = [];
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
