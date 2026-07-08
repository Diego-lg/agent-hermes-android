/**
 * HermesClient — talks to a `hermes serve` instance over HTTP + WebSocket.
 *
 * The wire dance:
 *   1. POST /auth/password-login      → cookies
 *   2. POST /api/auth/ws-ticket        → single-use ticket (30s TTL)
 *   3. WS  /api/ws?ticket=…            → JSON-RPC 2.0 stream
 *   4. Subscribe to server-pushed events (message.delta, message.complete, ...)
 *   5. Send prompt.submit; collect deltas until message.complete
 *
 * Cookie storage is in-memory only (the Android app uses AsyncStorage in
 * a real build; in tests we accept the trade-off). A real mobile client
 * would also persist the username/password via the platform keychain.
 *
 * This module is framework-agnostic: it works in RN (uses global WebSocket
 * + fetch), in Node tests (uses the `ws` package + node-fetch polyfill),
 * and in a future Electron / iOS / web build with no changes.
 */

export interface HermesClientConfig {
  host: string;        // e.g. "192.168.18.54"
  port: number;        // e.g. 9119
  username: string;
  password: string;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override WebSocket constructor for tests. */
  WebSocketImpl?: typeof WebSocket;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Set on assistant messages when the model emits a final usage block. */
  usage?: {
    input: number;
    output: number;
    total: number;
    context_percent: number;
  };
  ts: number;
}

export interface StreamHandle {
  sessionId: string;
  /** Resolves with the full assistant text once message.complete arrives. */
  done: Promise<{text: string; usage?: ChatMessage['usage']}>;
  /** Abort the in-flight turn (calls session.interrupt). */
  abort: () => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export class HermesClient {
  private cfg: HermesClientConfig;
  private cookies: Map<string, string> = new Map();
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private nextId = 1;
  private pending = new Map<number, {resolve: (v: any) => void; reject: (e: any) => void; method: string}>();
  private eventHandlers = new Set<(type: string, params: any) => void>();
  private reconnecting = false;
  private closed = false;

  constructor(cfg: HermesClientConfig) {
    this.cfg = cfg;
  }

  /* -------------------- public API -------------------- */

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1 /* OPEN */;
  }

  onEvent(handler: (type: string, params: any) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /** Three-step auth + WS upgrade. Idempotent. */
  async connect(): Promise<void> {
    if (this.isConnected()) return;

    const fetchFn = this.cfg.fetchImpl ?? globalThis.fetch;
    const WS = this.cfg.WebSocketImpl ?? globalThis.WebSocket;

    // Step 1: password login
    const loginRes = await fetchFn(this.baseHttp() + '/auth/password-login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        provider: 'basic',
        username: this.cfg.username,
        password: this.cfg.password,
        next: '',
      }),
    });
    if (!loginRes.ok) {
      const body = await loginRes.text();
      throw new HermesError(
        `Login failed (${loginRes.status}): ${body.slice(0, 200)}`,
        loginRes.status,
      );
    }
    this.absorbSetCookie(loginRes.headers.get('set-cookie'));

    // Step 2: WS ticket
    const ticketRes = await fetchFn(this.baseHttp() + '/api/auth/ws-ticket', {
      method: 'POST',
      headers: {Cookie: this.cookieHeader()},
    });
    if (!ticketRes.ok) {
      const body = await ticketRes.text();
      throw new HermesError(
        `Ticket mint failed (${ticketRes.status}): ${body.slice(0, 200)}`,
        ticketRes.status,
      );
    }
    const {ticket} = await ticketRes.json();
    if (!ticket) throw new HermesError('No ticket in response', 0);

    // Step 3: WS upgrade
    await this.openWebSocket(ticket, WS);
  }

  /** Create a new conversation session. Returns the session id. */
  async createSession(title?: string): Promise<string> {
    if (!this.isConnected()) throw new HermesError('Not connected', 0);
    const r = await this.rpc('session.create', {title: title ?? ''});
    this.sessionId = r.session_id;
    return r.session_id;
  }

  /** Reuse an existing session id (e.g. after a reconnect). */
  setSessionId(sid: string): void {
    this.sessionId = sid;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Fetch the last N sessions (for the home screen). */
  async listSessions(limit = 50): Promise<any[]> {
    if (!this.isConnected()) throw new HermesError('Not connected', 0);
    const r = await this.rpc('session.list', {limit});
    return r.sessions ?? [];
  }

  /** Load full message history for a session. */
  async loadHistory(sessionId: string): Promise<any[]> {
    if (!this.isConnected()) throw new HermesError('Not connected', 0);
    const r = await this.rpc('session.history', {session_id: sessionId});
    return r.history ?? [];
  }

  /**
   * Send a prompt and stream the reply.
   *
   * Returns a handle whose `done` promise resolves when the server emits
   * `message.complete`. Intermediate deltas are dispatched through the
   * `onEvent` callback registered via `onEvent()`.
   */
  submitPrompt(text: string, sessionId?: string): StreamHandle {
    const sid = sessionId ?? this.sessionId;
    if (!sid) throw new HermesError('No session', 0);
    if (!this.isConnected()) throw new HermesError('Not connected', 0);

    let resolveDone!: (v: {text: string; usage?: ChatMessage['usage']}) => void;
    let rejectDone!: (e: any) => void;
    const done = new Promise<{text: string; usage?: ChatMessage['usage']}>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });

    const off = this.onEvent((type, params) => {
      if (params?.session_id && params.session_id !== sid) return;
      if (type === 'message.complete') {
        const text = params.payload?.text ?? '';
        const usage = params.payload?.usage;
        off();
        resolveDone({text, usage});
      } else if (type === 'error') {
        off();
        rejectDone(new HermesError(params.message ?? 'Server error', 0));
      }
    });

    void this.rpc('prompt.submit', {session_id: sid, text}).catch(err => {
      off();
      rejectDone(err);
    });

    return {
      sessionId: sid,
      done,
      abort: () => {
        off();
        void this.rpc('session.interrupt', {session_id: sid}).catch(() => {});
      },
    };
  }

  /** Close the current session. */
  async closeSession(sessionId?: string): Promise<void> {
    const sid = sessionId ?? this.sessionId;
    if (!sid) return;
    await this.rpc('session.close', {session_id: sid});
    if (sid === this.sessionId) this.sessionId = null;
  }

  /** Rename a session. */
  async setSessionTitle(sessionId: string, title: string): Promise<void> {
    await this.rpc('session.title', {session_id: sessionId, title});
  }

  /** Get usage stats (input/output tokens, context %) for a session. */
  async sessionUsage(sessionId: string): Promise<any> {
    const r = await this.rpc('session.usage', {session_id: sessionId});
    return r;
  }

  /** List sub-agents the user has spawned / is running. */
  async listDelegations(): Promise<any[]> {
    try {
      const r = await this.rpc('delegation.status', {});
      return (r?.active ?? []) as any[];
    } catch {
      return [];
    }
  }

  /** Read project facts (cwd, model, branch, etc.) for the active session. */
  async projectFacts(): Promise<any> {
    try {
      const r = await this.rpc('project.facts', {});
      return r;
    } catch {
      return {};
    }
  }

  /** Pause / resume a sub-agent. */
  async pauseSubagent(id: string): Promise<void> {
    try { await this.rpc('delegation.pause', {id}); } catch { /* best effort */ }
  }

  /** Fire-and-forget a background prompt (no streaming, no ack). */
  async submitBackground(text: string, sessionId?: string): Promise<void> {
    const sid = sessionId ?? this.sessionId;
    if (!sid) throw new HermesError('No session', 0);
    await this.rpc('prompt.background', {session_id: sid, text});
  }

  /** Tear down the WS. The client must `connect()` again before reuse. */
  disconnect(): void {
    this.closed = true;
    if (this.ws) {
      try {this.ws.close();} catch { /* ignore */ }
      this.ws = null;
    }
    for (const {reject} of this.pending.values()) {
      reject(new HermesError('Disconnected', 0));
    }
    this.pending.clear();
  }

  /* -------------------- internals -------------------- */

  private baseHttp(): string {
    return `http://${this.cfg.host}:${this.cfg.port}`;
  }

  private baseWs(): string {
    return `ws://${this.cfg.host}:${this.cfg.port}`;
  }

  /** Capture Set-Cookie headers (RN's fetch returns them as one combined header). */
  private absorbSetCookie(setCookie: string | null): void {
    if (!setCookie) return;
    // The header may contain multiple cookies separated by ", " but the
    // Set-Cookie syntax itself uses "; " between attributes. We split on
    // ", hermes_session" / ", SESSION_RT" prefixes to recover boundaries.
    const parts = setCookie.split(/, (?=hermes_session)/);
    for (const raw of parts) {
      const first = raw.split(';')[0];
      const eq = first.indexOf('=');
      if (eq < 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).replace(/^"|"$/g, '').trim();
      if (name) this.cookies.set(name, value);
    }
  }

  private cookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private async openWebSocket(ticket: string, WS: typeof WebSocket): Promise<void> {
    this.closed = false;
    return new Promise<void>((resolve, reject) => {
      const url = `${this.baseWs()}/api/ws?ticket=${encodeURIComponent(ticket)}`;
      const ws = new WS(url);
      this.ws = ws;

      const onOpen = () => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        resolve();
      };
      const onError = (e: any) => {
        ws.removeEventListener('open', onOpen);
        ws.removeEventListener('error', onError);
        reject(new HermesError(`WebSocket error: ${e?.message ?? 'unknown'}`, 0));
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('error', onError);
      ws.addEventListener('message', ev => this.handleFrame(ev.data));
      ws.addEventListener('close', ev => this.handleClose(ev));
    });
  }

  private handleFrame(data: any): void {
    let msg: any;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : data.toString());
    } catch {
      return; // ignore non-JSON frames
    }
    if (msg.id !== undefined && msg.id !== null) {
      // response to a request
      const entry = this.pending.get(msg.id);
      if (entry) {
        this.pending.delete(msg.id);
        if (msg.error) entry.reject(new HermesError(msg.error.message, msg.error.code));
        else entry.resolve(msg.result);
      }
      return;
    }
    // notification
    if (msg.method === 'event') {
      const type = msg.params?.type;
      for (const h of this.eventHandlers) {
        try {h(type, msg.params);} catch { /* swallow handler errors */ }
      }
    }
  }

  private handleClose(ev: any): void {
    const code = ev?.code ?? 0;
    this.ws = null;
    // Reject all pending
    for (const {reject, method} of this.pending.values()) {
      reject(new HermesError(`WS closed (${code}) during ${method}`, code));
    }
    this.pending.clear();
    if (!this.closed && !this.reconnecting) {
      // Server kicked us. Surface via a synthetic error event so the UI
      // can show "Disconnected" and offer reconnect.
      for (const h of this.eventHandlers) {
        try {h('error', {message: `WS closed (code ${code})`});} catch { /* ignore */ }
      }
    }
  }

  private rpc(method: string, params: any): Promise<any> {
    if (!this.ws || this.ws.readyState !== 1) {
      return Promise.reject(new HermesError('Not connected', 0));
    }
    const id = this.nextId++;
    const frame = JSON.stringify({jsonrpc: '2.0', id, method, params: params ?? {}});
    return new Promise((resolve, reject) => {
      this.pending.set(id, {resolve, reject, method});
      try {
        this.ws!.send(frame);
      } catch (err: any) {
        this.pending.delete(id);
        reject(new HermesError(`Send failed: ${err?.message ?? err}`, 0));
      }
    });
  }
}

export class HermesError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.name = 'HermesError';
    this.code = code;
  }
}
