import { describe, expect, it, vi } from 'vitest';
import { WsClient } from '@/shared/ws/client';

class FakeSocket {
  static instances: FakeSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

describe('WsClient', () => {
  it('se connecte avec le token, envoie des trames {event,ts,data} et distribue les événements', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = new WsClient(() => 'tok');
    const onStatus = vi.fn();
    client.on('ride.status_updated', onStatus);
    client.connect();
    await Promise.resolve();
    const sock = FakeSocket.instances.at(-1) as FakeSocket;
    expect(sock.url).toContain('token=tok');
    sock.open();
    client.send('ride.offer_response', { ride_id: 'r1', accepted: true });
    const frame = JSON.parse(sock.sent[0] ?? '{}');
    expect(frame.event).toBe('ride.offer_response');
    expect(frame.data).toEqual({ ride_id: 'r1', accepted: true });
    expect(typeof frame.ts).toBe('number');
    sock.onmessage?.({
      data: JSON.stringify({ event: 'ride.status_updated', ts: 1, data: { id: 'r1', status: 'accepted' } }),
    });
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), expect.anything());
    client.close();
    vi.unstubAllGlobals();
  });

  it('se reconnecte avec backoff 1/2/4/8 s après une coupure', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.instances = [];
    const client = new WsClient(() => 'tok');
    client.connect();
    await Promise.resolve();
    const first = FakeSocket.instances[0] as FakeSocket;
    first.open();
    first.onclose?.({ code: 1006 });
    expect(client.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(FakeSocket.instances).toHaveLength(2);
    (FakeSocket.instances[1] as FakeSocket).onclose?.({ code: 1006 });
    await vi.advanceTimersByTimeAsync(2001);
    expect(FakeSocket.instances).toHaveLength(3);
    client.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});

describe('adresse du WebSocket', () => {
  it("se déduit de l'adresse de l'API", async () => {
    const { wsBaseFrom } = await import('@/shared/ws/client');
    expect(wsBaseFrom('https://vtc242-api-i8ip.onrender.com')).toBe('wss://vtc242-api-i8ip.onrender.com/ws/');
    expect(wsBaseFrom('https://api.vtc242.cg/')).toBe('wss://api.vtc242.cg/ws/');
    expect(wsBaseFrom('http://localhost:8000')).toBe('ws://localhost:8000/ws/');
    expect(wsBaseFrom(undefined)).toBe('ws://localhost:8000/ws/');
  });
});

class AsyncCloseSocket extends FakeSocket {
  // un vrai navigateur émet `close` plus tard, après l'ouverture de la socket suivante
  override close() {
    this.readyState = 3;
    setTimeout(() => this.onclose?.({ code: 1000 }), 0);
  }
}

describe('WsClient : une seule socket vivante', () => {
  it("ignore la fermeture tardive de l'ancienne socket (pas de socket orpheline)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', AsyncCloseSocket);
    FakeSocket.instances = [];
    const client = new WsClient(() => 'tok');
    const onOpen = vi.fn();
    client.on('ws.open', onOpen);
    client.connect();
    await Promise.resolve();
    (FakeSocket.instances[0] as FakeSocket).open();
    client.restart(); // changement de session
    await Promise.resolve();
    expect(FakeSocket.instances).toHaveLength(2);
    (FakeSocket.instances[1] as FakeSocket).open();
    await vi.advanceTimersByTimeAsync(20_000); // la fermeture de la 1re arrive, puis les backoffs
    expect(FakeSocket.instances).toHaveLength(2);
    expect(client.status).toBe('open');
    // le 2e `ws.open` est signalé comme une reconnexion (resynchronisation des écrans)
    expect(onOpen).toHaveBeenLastCalledWith({ reconnected: true }, expect.anything());
    client.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('redemande un token neuf quand le serveur ferme pour changement de session (4000)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.instances = [];
    const getToken = vi.fn(({ force }: { force: boolean }) => (force ? 'neuf' : 'ancien'));
    const client = new WsClient(getToken);
    client.connect();
    await Promise.resolve();
    const first = FakeSocket.instances[0] as FakeSocket;
    first.open();
    first.onclose?.({ code: 4000 });
    await vi.advanceTimersByTimeAsync(1001);
    expect(FakeSocket.instances).toHaveLength(2);
    expect((FakeSocket.instances[1] as FakeSocket).url).toContain('token=neuf');
    client.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('redemande un token neuf quand le serveur refuse la connexion', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.instances = [];
    const getToken = vi.fn(({ force }: { force: boolean }) => (force ? 'neuf' : 'perime'));
    const client = new WsClient(getToken);
    client.connect();
    await Promise.resolve();
    (FakeSocket.instances[0] as FakeSocket).onclose?.({ code: 4401 });
    await vi.advanceTimersByTimeAsync(1001);
    expect((FakeSocket.instances[1] as FakeSocket).url).toContain('token=neuf');
    client.close();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
