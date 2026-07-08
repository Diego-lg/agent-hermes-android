/**
 * Pure-logic unit tests for HermesClient — no network required.
 * Tests cookie parsing, error handling, and frame dispatch.
 */
import {HermesClient, HermesError} from '../src/api/hermesClient';

function makeMockFetch(
  handler: (url: string) => {
    status: number;
    body: string;
    headers?: Record<string, string>;
  },
): typeof fetch {
  return (async (url: string) => {
    const r = handler(url);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      text: async () => r.body,
      json: async () => JSON.parse(r.body),
      headers: {
        get: (name: string) => {
          if (!r.headers) return null;
          return (r.headers as any)[name] ?? (r.headers as any)[name.toLowerCase()] ?? null;
        },
      },
    } as any;
  }) as any;
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0; // CONNECTING
  sent: string[] = [];
  handlers: Record<string, Array<(e: any) => void>> = {};
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  addEventListener(name: string, fn: (e: any) => void) {
    (this.handlers[name] ??= []).push(fn);
  }
  removeEventListener(name: string, fn: (e: any) => void) {
    if (!this.handlers[name]) return;
    this.handlers[name] = this.handlers[name].filter(h => h !== fn);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3; // CLOSED
    (this.handlers.close ?? []).forEach(fn => fn({code: 1000}));
  }
  open() {
    this.readyState = 1;
    (this.handlers.open ?? []).forEach(fn => fn({}));
  }
  emitFrame(obj: any) {
    (this.handlers.message ?? []).forEach(fn =>
      fn({data: JSON.stringify(obj)}),
    );
  }
}

describe('HermesClient (unit)', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  it('parses multi-cookie Set-Cookie headers correctly', async () => {
    const fetchMock = makeMockFetch(url => {
      if (url.endsWith('/auth/password-login')) {
        return {
          status: 200,
          body: '{}',
          headers: {
            'set-cookie':
              'hermes_session_at="abc"; HttpOnly, hermes_session_rt=xyz; HttpOnly',
          },
        };
      }
      if (url.endsWith('/api/auth/ws-ticket')) {
        return {status: 200, body: '{"ticket":"tk1"}'};
      }
      return {status: 404, body: 'not found'};
    });
    const WS = MockWebSocket as any;
    const client = new HermesClient({
      host: '1.2.3.4',
      port: 9119,
      username: 'u',
      password: 'p',
      fetchImpl: fetchMock,
      WebSocketImpl: WS,
    });
    // WS is constructed during the connect() flow but the open() event
    // hasn't fired yet — drive it, then await.
    const connectPromise = client.connect();
    // Yield once so connect() can finish its first two awaits (login + ticket)
    // and the WebSocket is constructed.
    await new Promise(r => setImmediate(r));
    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();
    ws.open();
    await connectPromise;
    expect(ws.url).toContain('ticket=tk1');
  });

  it('throws HermesError on bad login status', async () => {
    const fetchMock = makeMockFetch(() => ({
      status: 401,
      body: '{"error":"Invalid credentials"}',
    }));
    const client = new HermesClient({
      host: '1.2.3.4',
      port: 9119,
      username: 'u',
      password: 'wrong',
      fetchImpl: fetchMock,
    });
    await expect(client.connect()).rejects.toBeInstanceOf(HermesError);
  });

  it('routes response frames back to the right pending rpc', async () => {
    const fetchMock = makeMockFetch(url => {
      if (url.endsWith('/auth/password-login')) return {status: 200, body: '{}'};
      if (url.endsWith('/api/auth/ws-ticket')) {
        return {status: 200, body: '{"ticket":"t"}'};
      }
      return {status: 404, body: ''};
    });
    const WS = MockWebSocket as any;
    const client = new HermesClient({
      host: '1.2.3.4',
      port: 9119,
      username: 'u',
      password: 'p',
      fetchImpl: fetchMock,
      WebSocketImpl: WS,
    });
    const connectPromise = client.connect();
    await new Promise(r => setImmediate(r));
    const ws = MockWebSocket.instances[0];
    ws.open();
    await connectPromise;

    const sessionPromise = client.createSession();
    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0]).method).toBe('session.create');
    ws.emitFrame({id: 1, result: {session_id: 'sid-123'}});
    // createSession() unwraps result.session_id and returns just the string.
    await expect(sessionPromise).resolves.toBe('sid-123');
  });

  it('rejects pending rpcs when WS closes', async () => {
    const fetchMock = makeMockFetch(() => ({status: 200, body: '{"ticket":"t"}'}));
    const WS = MockWebSocket as any;
    const client = new HermesClient({
      host: '1.2.3.4',
      port: 9119,
      username: 'u',
      password: 'p',
      fetchImpl: fetchMock,
      WebSocketImpl: WS,
    });
    const connectPromise = client.connect();
    await new Promise(r => setImmediate(r));
    const ws = MockWebSocket.instances[0];
    ws.open();
    await connectPromise;
    const p = client.createSession();
    ws.close();
    await expect(p).rejects.toBeInstanceOf(HermesError);
  });
});
