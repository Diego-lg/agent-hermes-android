/**
 * HermesClientConfig — what the desktop engine needs to talk to a
 * `hermes serve` instance over HTTP + WebSocket.
 *
 * The wire dance (no auth wall by default):
 *   1. (Optional) POST /auth/password-login  → cookies
 *   2.           POST /api/auth/ws-ticket    → single-use ticket (30s TTL)
 *   3.           WS   /api/ws?ticket=…       → JSON-RPC 2.0 stream
 *   4. Subscribe to server-pushed events (message.delta, message.complete, ...)
 *   5. Send prompt.submit; collect deltas until message.complete.
 *
 * Step 1 is skipped when `password` is empty — that's the default for the
 * Android client now (no login screen). The desktop server's loopback /
 * `--insecure` mode serves /api/auth/ws-ticket directly without a
 * session cookie, so the phone boots straight into the app.
 *
 * Cookie storage is in-memory only (a real release would persist them via
 * AsyncStorage + Android Keystore). This module is framework-agnostic: it
 * works in RN, in Node tests, and in any future iOS / Electron / web build.
 */

export interface HermesClientConfig {
  host: string;        // e.g. "192.168.18.54"
  port: number;        // e.g. 9119
  /**
   * Username for the basic-auth provider. Optional — only used when
   * `password` is also set. Leave empty for passwordless / loopback mode.
   */
  username?: string;
  /**
   * Basic-auth password. Empty string (default) means: skip the
   * `/auth/password-login` step and go straight to ws-ticket. The phone
   * never needs a password for the user's LAN server.
   */
  password?: string;
  /** Override fetch for tests. */
  fetchImpl?: typeof fetch;
  /** Override WebSocket constructor for tests. */
  WebSocketImpl?: typeof WebSocket;
  /** Silent auto-reconnect with exponential backoff after an unexpected
   *  socket drop. Defaults to true. Tests that assert on close behaviour
   *  can set this false to keep timing deterministic. */
  autoReconnect?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Reasoning / chain-of-thought captured separately from the answer.
   *  Populated for reasoning models (either a `reasoning_content` field or
   *  `<think>…</think>` tags in the content). Rendered as a collapsible block. */
  reasoning?: string;
  /** Set on assistant messages when the model emits a final usage block. */
  usage?: {
    input: number;
    output: number;
    total: number;
    context_percent: number;
    /** Optional extended fields from the server (best-effort). */
    context_used?: number;
    context_max?: number;
    calls?: number;
  };
  ts: number;
  /** Media attached to (user) or produced by (assistant) this message, for
   *  inline rendering. Images carry a data: URI or http URL. */
  attachments?: Array<{kind: 'image' | 'file'; name: string; dataUri?: string; mime?: string}>;
}

export interface StreamHandle {
  sessionId: string;
  /** Resolves with the full assistant text once message.complete arrives. */
  done: Promise<{text: string; usage?: ChatMessage['usage']}>;
  /** Abort the in-flight turn (calls session.interrupt). */
  abort: () => void;
  /** Inject guidance mid-turn without aborting (calls session.steer). */
  steer?: (text: string) => void;
}

/** Options the user can override per turn before sending. */
export interface PromptOptions {
  /** Optional model id override for this turn (server-side). */
  model?: string;
  /** Reasoning effort ("minimal" | "low" | "medium" | "high" | "xhigh"). */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /** Optional workspace / cwd the server should use for this session. */
  workspace?: string;
  /** Optional profile name (server-side Hermes profile). */
  profile?: string;
  /** Optional project id (organisational grouping). */
  projectId?: string;
  /** Files/images to send with this turn (cloud engine builds multimodal
   *  content; the desktop engine attaches them out-of-band instead). */
  attachments?: Array<{kind: 'file' | 'image'; name: string; dataUri?: string; content?: string; mime?: string}>;
}

/** Lightweight summary record for the Sessions tab. */
export interface SessionSummary {
  id: string;
  title?: string;
  preview?: string;
  started_at?: number;
  last_active?: number;
  message_count?: number;
  model?: string;
  status?: string;
  source?: string;
  /** True if cached locally (offline read). */
  cached?: boolean;
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
  /** True once we've had at least one successful connection. Guards against
   *  auto-reconnecting after an initial connect failure (the app's own
   *  fallback logic owns that case). */
  private connectedOnce = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxReconnectAttempts = 8;

  constructor(cfg: HermesClientConfig) {
    this.cfg = cfg;
  }

  /* -------------------- public API -------------------- */

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1 /* OPEN */;
  }

  /** True while a background reconnect is in progress (for a status banner). */
  isReconnecting(): boolean {
    return this.reconnecting;
  }

  onEvent(handler: (type: string, params: any) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /** Three-step (or two-step in passwordless mode) auth + WS upgrade. Idempotent. */
  async connect(): Promise<void> {
    if (this.isConnected()) return;
    // A fresh connect() cancels any in-flight reconnect and clears the
    // intentional-close flag set by a prior disconnect().
    this.cancelReconnect();
    this.closed = false;

    // Skip the password-login step when no password is configured. The
    // desktop server in loopback / `--insecure` mode serves the
    // ws-ticket endpoint without a session cookie, so the phone can
    // boot directly into the chat — no login wall.
    if (this.cfg.password) {
      await this.login();
    }
    await this.mintTicketAndOpen();   // Step 2+3: ws-ticket → WS upgrade

    this.connectedOnce = true;
    this.reconnectAttempts = 0;
    this.reconnecting = false;
  }

  /** True iff this client was configured with a password (basic-auth). */
  hasPassword(): boolean {
    return !!this.cfg.password;
  }

  /* ----- auth steps (shared by connect() and reconnect) ----- */

  /** Step 1: password login. Populates the cookie jar. */
  private async login(): Promise<void> {
    const fetchFn = this.cfg.fetchImpl ?? globalThis.fetch;
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
  }

  /** Step 2: mint a single-use WS ticket (30s TTL) using current cookies. */
  private async mintTicket(): Promise<string> {
    const fetchFn = this.cfg.fetchImpl ?? globalThis.fetch;
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
    return ticket;
  }

  /** Step 2+3: mint a ticket and upgrade the WebSocket. */
  private async mintTicketAndOpen(): Promise<void> {
    const WS = this.cfg.WebSocketImpl ?? globalThis.WebSocket;
    const ticket = await this.mintTicket();
    await this.openWebSocket(ticket, WS);
  }

  /**
   * Re-establish a dropped connection. Tries to reuse the still-valid
   * session cookie (mint a fresh ticket only). If the ticket mint is
   * rejected (401/403 — the session expired), re-runs password login
   * (only if a password is configured) and retries. The server-side
   * session id is preserved on `this.sessionId`, so the resumed socket
   * picks up the same conversation.
   */
  private async reestablish(): Promise<void> {
    try {
      await this.mintTicketAndOpen();
    } catch (e) {
      if (e instanceof HermesError && (e.code === 401 || e.code === 403) && this.cfg.password) {
        await this.login();
        await this.mintTicketAndOpen();
      } else {
        throw e;
      }
    }
  }

  /* ----- reconnect scheduling ----- */

  /** Fan an event out to every registered handler (swallow handler errors). */
  private emitEvent(type: string, params: any): void {
    for (const h of this.eventHandlers) {
      try { h(type, params); } catch { /* ignore */ }
    }
  }

  /** Cancel any pending reconnect timer and reset backoff. */
  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;
    this.reconnectAttempts = 0;
  }

  /** Schedule a reconnect with exponential backoff + full jitter. */
  private scheduleReconnect(): void {
    if (this.cfg.autoReconnect === false) return;
    if (this.closed) return;               // intentional disconnect
    if (!this.connectedOnce) return;       // never successfully connected
    if (this.reconnectTimer) return;       // already scheduled

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.reconnecting = false;
      this.emitEvent('connection.failed', {attempts: this.reconnectAttempts});
      // Surface a terminal error so the UI can prompt a manual retry.
      this.emitEvent('error', {
        message: `Lost connection to the server and could not reconnect after ${this.maxReconnectAttempts} attempts.`,
      });
      return;
    }

    this.reconnecting = true;
    const attempt = this.reconnectAttempts++;
    // base doubles each try, capped at 30s; full jitter halves the variance.
    const ceiling = Math.min(30_000, 500 * 2 ** attempt);
    const delay = Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
    this.emitEvent('connection.reconnecting', {
      attempt: attempt + 1,
      max: this.maxReconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnectOnce();
    }, delay);
  }

  /** One reconnect attempt. On success resets backoff; on failure re-schedules. */
  private async reconnectOnce(): Promise<void> {
    if (this.closed) return;
    try {
      await this.reestablish();
      this.reconnectAttempts = 0;
      this.reconnecting = false;
      this.emitEvent('connection.restored', {session_id: this.sessionId});
    } catch {
      this.scheduleReconnect();
    }
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

  /** Fetch the list of models the desktop server has configured. Best-effort
   *  — the server may not implement `model.list` (older versions). Returns
   *  an empty array in that case so the UI can show "no models" cleanly. */
  async listModels(): Promise<any[]> {
    if (!this.isConnected()) return [];
    try {
      const r = await this.rpc('model.list', {});
      // Tolerate several response shapes.
      return r?.models ?? r?.data ?? (Array.isArray(r) ? r : []);
    } catch {
      return [];
    }
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
   *
   * `opts` (model, reasoning, workspace, profile, projectId) are forwarded
   * to `prompt.submit` so the server can apply them per-turn.
   */
  submitPrompt(text: string, sessionId?: string, opts?: PromptOptions): StreamHandle {
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

    const submitParams: any = {session_id: sid, text};
    if (opts?.model) submitParams.model = opts.model;
    if (opts?.reasoningEffort) submitParams.reasoning_effort = opts.reasoningEffort;
    if (opts?.workspace) submitParams.workspace = opts.workspace;
    if (opts?.profile) submitParams.profile = opts.profile;
    if (opts?.projectId) submitParams.project_id = opts.projectId;

    void this.rpc('prompt.submit', submitParams).catch(err => {
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
      steer: (text: string) => {
        // Inject guidance mid-turn without aborting. Fire and forget;
        // the server applies the steer on its next tool-call boundary.
        void this.rpc('session.steer', {session_id: sid, text}).catch(() => {});
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

  /** Project grouping (organisational; server-side via projects.list). */
  async listProjects(): Promise<{projects: any[]; active_id: string | null}> {
    try {
      const r = await this.rpc('projects.list', {});
      return {
        projects: r?.projects ?? [],
        active_id: r?.active_id ?? null,
      };
    } catch {
      return {projects: [], active_id: null};
    }
  }

  async setActiveProject(projectId: string | null): Promise<void> {
    try { await this.rpc('project.activate', {project_id: projectId ?? ''}); } catch { /* best-effort */ }
  }

  /** Browse the active sessions (live, server-side view). */
  async listActiveSessions(): Promise<SessionSummary[]> {
    try {
      const r = await this.rpc('session.active_list', {});
      const list = r?.sessions ?? r?.active ?? [];
      return list.map((s: any) => ({
        id: s.id ?? s.session_id,
        title: s.title,
        preview: s.preview,
        started_at: s.started_at,
        last_active: s.last_active ?? s.started_at,
        message_count: s.message_count,
        model: s.model,
        status: s.status,
        source: s.source,
      }));
    } catch {
      return [];
    }
  }

  /** Server's idea of the most recent session. */
  async mostRecentSession(): Promise<SessionSummary | null> {
    try {
      const r = await this.rpc('session.most_recent', {});
      if (!r?.session_id) return null;
      return {
        id: r.session_id,
        title: r.title,
        started_at: r.started_at,
        source: r.source,
      };
    } catch {
      return null;
    }
  }

  /**
   * Browse slash-commands catalogued by the server. Returned as
   *   [{name, description, usage}, ...]
   * Tolerant of empty or oddly-shaped responses.
   */
  async listCommands(): Promise<Array<{name: string; description: string; usage?: string}>> {
    try {
      const r = await this.rpc('commands.catalog', {});
      const pairs = r?.pairs ?? r?.commands ?? [];
      const out: Array<{name: string; description: string; usage?: string}> = [];
      for (const p of pairs) {
        if (Array.isArray(p) && p.length >= 2) {
          out.push({name: String(p[0]), description: String(p[1]), usage: p[2]});
        } else if (p && typeof p === 'object') {
          out.push({
            name: p.name ?? p.command ?? '',
            description: p.description ?? p.desc ?? '',
            usage: p.usage,
          });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  /** Read a single config key. Returns {value, display?, warning?} or null. */
  async getConfig(key: string): Promise<{value: any; display?: string; warning?: string} | null> {
    if (!this.isConnected()) return null;
    try {
      const r = await this.rpc('config.get', {key});
      return r ?? null;
    } catch {
      return null;
    }
  }

  /** Set a single config key. Returns the server's response (may include a warning). */
  async setConfig(key: string, value: any): Promise<any> {
    return this.rpc('config.set', {key, value});
  }

  /**
   * Attach a file (text/base64) to the active session. The server side
   * reads it into context. Best-effort — older servers return "session
   * not found" or "unknown method" and we swallow that.
   */
  async attachFile(sessionId: string, payload: {name: string; content: string; mime?: string}): Promise<void> {
    try {
      await this.rpc('file.attach', {session_id: sessionId, ...payload});
    } catch {
      // Older server: silently fail — the file is still embedded in the
      // user's prompt text by the ChatScreen wrapper if needed.
    }
  }

  /**
   * Attach an image (base64) to the active session. Best-effort.
   */
  async attachImage(sessionId: string, payload: {name: string; data: string; mime?: string}): Promise<void> {
    try {
      await this.rpc('image.attach_bytes', {
        session_id: sessionId,
        name: payload.name,
        data: payload.data,
        mime: payload.mime ?? 'image/png',
      });
    } catch {
      try {
        await this.rpc('image.attach', {session_id: sessionId, ...payload});
      } catch {/* best-effort */}
    }
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
    this.cancelReconnect();
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
    // Note: `closed` is managed by connect()/disconnect() only, so a stale
    // socket opening during a reconnect race can't resurrect a closed client.
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
    // Reject all pending RPCs (this also ends any in-flight chat turn).
    for (const {reject, method} of this.pending.values()) {
      reject(new HermesError(`WS closed (${code}) during ${method}`, code));
    }
    this.pending.clear();
    if (this.closed) return; // intentional disconnect — stay down
    // Unexpected drop (server kick, Wi-Fi roam, phone sleep). Try to
    // recover silently with backoff instead of surfacing a hard error;
    // scheduleReconnect() emits a terminal `error` only once it gives up.
    this.emitEvent('connection.lost', {code});
    this.scheduleReconnect();
  }

  /** Execute a single JSON-RPC call. Public so sub-clients (cron, notes AI) can call too. */
  async rpc(method: string, params: any): Promise<any> {
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
