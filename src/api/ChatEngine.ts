/**
 * ChatEngine — abstraction over the two backends the app can talk to:
 *
 *   - HermesEngine: the desktop Hermes server over WebSocket JSON-RPC.
 *     Gives you full agent tools, sessions, cron. Requires the LAN server.
 *
 *   - MinimaxEngine: a direct OpenAI-compatible chat-completions endpoint
 *     using SSE streaming. No server required, no tools, just chat. The
 *     phone works when the desktop is off.
 *
 * Each engine implements the same surface so AppContext can route
 * `sendPrompt()` through either without a special case. Deltas are
 * surfaced through `onEvent()` exactly like the WebSocket engine did
 * before this refactor.
 */
import {ChatMessage, HermesClient, HermesError, StreamHandle, SessionSummary, PromptOptions} from './hermesClient';
import {kv, STORAGE_KEYS} from './storage';

export type EngineId = 'desktop' | 'minimax';

export interface ChatEngine {
  readonly id: EngineId;
  /** Cheap connectivity probe. Must not throw; resolve false on failure. */
  isAvailable(): Promise<boolean>;
  /** Create a new conversation. Returns a session id (engine-local). */
  createSession(title?: string): Promise<string>;
  /** Send a prompt and stream the response. `opts` carries per-turn overrides. */
  submitPrompt(text: string, sessionId?: string, opts?: PromptOptions): StreamHandle;
  /** Subscribe to engine-level events (deltas, complete, error). Returns unsubscribe. */
  onEvent(handler: (type: string, params: any) => void): () => void;
  /** Best-effort: load prior messages for a session. */
  loadHistory(sessionId: string): Promise<ChatMessage[]>;
  /** Best-effort: list sessions for the UI dashboard. */
  listSessions?(limit?: number): Promise<any[]>;
  /** Best-effort: list models the engine knows about. Empty array if not supported. */
  listModels?(): Promise<any[]>;
  /** Best-effort: list the slash-command catalog ("skills"). Empty if not supported. */
  listCommands?(): Promise<Array<{name: string; description: string; usage?: string}>>;
  /** Best-effort: list projects the server knows about. */
  listProjects?(): Promise<{projects: any[]; active_id: string | null}>;
  /** Best-effort: list live (active) sessions. */
  listActiveSessions?(): Promise<SessionSummary[]>;
  /** Best-effort: read a single config key from the server. */
  getConfig?(key: string): Promise<{value: any; display?: string; warning?: string} | null>;
  /** Best-effort: set a config key on the server. */
  setConfig?(key: string, value: any): Promise<any>;
  /** Best-effort: attach a text/base64 file to a session. */
  attachFile?(sessionId: string, payload: {name: string; content: string; mime?: string}): Promise<void>;
  /** Best-effort: attach an image to a session. */
  attachImage?(sessionId: string, payload: {name: string; data: string; mime?: string}): Promise<void>;
  /** Free any sockets / timers. */
  disconnect(): void;
}

/* ----------------------------------------------------------------------------
 * HermesEngine — thin wrapper over the existing HermesClient.
 * --------------------------------------------------------------------------*/

export class HermesEngine implements ChatEngine {
  readonly id: EngineId = 'desktop';
  readonly client: HermesClient;
  constructor(client: HermesClient) {
    this.client = client;
  }

  async isAvailable(): Promise<boolean> {
    return this.client.isConnected();
  }

  async createSession(title?: string): Promise<string> {
    return this.client.createSession(title);
  }

  submitPrompt(text: string, sessionId?: string, opts?: any): StreamHandle {
    return this.client.submitPrompt(text, sessionId, opts);
  }

  async loadHistory(sessionId: string): Promise<ChatMessage[]> {
    const h = await this.client.loadHistory(sessionId);
    return h.map((m: any) => ({
      role: m.role,
      text: m.text ?? m.content ?? '',
      ts: m.ts ?? Date.now(),
    }));
  }

  async listSessions(limit = 50): Promise<Array<{id: string; title?: string; preview?: string; updated_at?: number}>> {
    const list = await this.client.listSessions(limit);
    return list.map((s: any) => ({
      id: s.id ?? s.session_id,
      title: s.title ?? '(untitled)',
      preview: s.preview,
      updated_at: s.updated_at ?? s.last_active,
    }));
  }

  async listModels(): Promise<any[]> {
    return this.client.listModels();
  }

  async listCommands() {
    return this.client.listCommands();
  }

  async listProjects() {
    return this.client.listProjects();
  }

  async listActiveSessions() {
    return this.client.listActiveSessions();
  }

  async mostRecentSession() {
    return this.client.mostRecentSession();
  }

  async getConfig(key: string) {
    return this.client.getConfig(key);
  }

  async setConfig(key: string, value: any) {
    return this.client.setConfig(key, value);
  }

  async attachFile(sessionId: string, payload: {name: string; content: string; mime?: string}) {
    return this.client.attachFile(sessionId, payload);
  }

  async attachImage(sessionId: string, payload: {name: string; data: string; mime?: string}) {
    return this.client.attachImage(sessionId, payload);
  }

  async setActiveProject(projectId: string | null) {
    return this.client.setActiveProject(projectId);
  }

  onEvent(handler: (type: string, params: any) => void): () => void {
    return this.client.onEvent(handler);
  }

  disconnect(): void {
    this.client.disconnect();
  }
}

/* ----------------------------------------------------------------------------
 * MinimaxEngine — direct OpenAI-compatible chat with SSE streaming.
 *
 * POST {baseUrl}/chat/completions
 *   body: { model, messages, stream: true }
 *   Authorization: Bearer ${key}
 *
 *   Reads NDJSON (one JSON object per line) shaped like:
 *     {"choices":[{"delta":{"content":"..."}, "finish_reason":null|"stop"}]}
 *
 * Surfaces the same delta/complete events the Hermes engine does, so the
 * chat UI doesn't have to know it's looking at a different backend.
 * --------------------------------------------------------------------------*/

export interface MinimaxConfig {
  baseUrl: string;   // e.g. https://api.minimax.io/v1
  apiKey: string;  // Bearer key for the model API
  model: string;      // e.g. MiniMax-Text-01
  /** Optional GroupId. MiniMax requires it for some model series. */
  groupId?: string;
}

type DeltaHandler = (type: string, params: any) => void;

interface LocalSession {
  id: string;
  title: string;
  messages: ChatMessage[];
}

export class MinimaxEngine implements ChatEngine {
  readonly id: EngineId = 'minimax';
  private currentSessionId: string | null = null;
  private abortControllers = new Map<string, AbortController>();
  private listeners = new Set<DeltaHandler>();
  private sessionCache: LocalSession[] = [];

  constructor(private cfg: MinimaxConfig) {}

  async isAvailable(): Promise<boolean> {
    if (!this.cfg.apiKey) return false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const headers: Record<string, string> = {Authorization: 'Bearer ' + this.cfg.apiKey};
      if (this.cfg.groupId) headers.GroupId = this.cfg.groupId;
      const r = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/models`, {
        method: 'GET',
        signal: controller.signal,
        headers,
      });
      clearTimeout(timeout);
      return r.ok;
    } catch {
      return false;
    }
  }

  onEvent(handler: DeltaHandler): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  private emit(type: string, params: any) {
    for (const h of this.listeners) {
      try {
        h(type, params);
      } catch {
        /* swallow */
      }
    }
  }

  /** Parse an OpenAI-style response (streamed or not) and emit deltas.
   *
   *  Handles the four shapes the cloud engine actually returns:
   *    1. Plain non-streaming JSON:
   *         {"choices":[{"message":{"content":"..."}}],"usage":{...}}
   *    2. SSE stream of `data: {delta.content}\n\n` lines ending with
   *       `data: [DONE]` (OpenAI / MiniMax streaming).
   *    3. SSE with CRLF line endings (`\r\n\r\n` between events).
   *    4. SSE with a non-`data:` prefix line we should ignore (heartbeats,
   *       `: OPEN` comment lines, etc).
   *
   *  Each chunk is emitted via `message.delta` and accumulated by the
   *  caller's `append` callback. If we get nothing back (provider
   *  returned 200 OK with an empty body), we surface a real error so the
   *  user sees something useful instead of an empty assistant bubble. */
  private parseAndEmit(
    raw: string,
    sid: string,
    append: (chunk: string) => void,
    appendReasoning: (chunk: string) => void = () => {},
  ): void {
    // Routing state: reasoning models interleave chain-of-thought with the
    // answer using <think>…</think> tags inside `content`. We walk each
    // content chunk and split it so the answer bubble never shows raw tags.
    let inThink = false;
    const emitAnswer = (s: string) => {
      if (!s) return;
      this.emit('message.delta', {session_id: sid, payload: {text: s}});
      append(s);
    };
    const emitReasoning = (s: string) => {
      if (!s) return;
      this.emit('reasoning.delta', {session_id: sid, payload: {text: s}});
      appendReasoning(s);
    };
    const routeContent = (chunk: string) => {
      let buf = chunk;
      while (buf.length) {
        if (!inThink) {
          const open = buf.indexOf('<think>');
          if (open === -1) { emitAnswer(buf); return; }
          emitAnswer(buf.slice(0, open));
          inThink = true;
          buf = buf.slice(open + 7);
        } else {
          const close = buf.indexOf('</think>');
          if (close === -1) { emitReasoning(buf); return; }
          emitReasoning(buf.slice(0, close));
          inThink = false;
          buf = buf.slice(close + 8);
        }
      }
    };
    const text = raw ?? '';
    if (!text || !text.trim()) {
      this.emit('error', {session_id: sid, message: 'Provider returned an empty response body. Check your model id and key.'});
      return;
    }

    // Try a non-streaming single-JSON parse first. If it works, we're
    // done — no SSE involved.
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const j = JSON.parse(trimmed);
        // Reasoning content (DeepSeek-R1 / MiniMax M-series expose it as a
        // sibling field of `content`). Route it to the thinking block.
        const rc0 = j?.choices?.[0]?.message?.reasoning_content ?? j?.choices?.[0]?.message?.reasoning;
        if (typeof rc0 === 'string' && rc0.length > 0) emitReasoning(rc0);
        // OpenAI non-streaming shape: choices[].message.content
        const content = j?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content.length > 0) {
          routeContent(content);
          return;
        }
        if (typeof rc0 === 'string' && rc0.length > 0) return;
        // OpenAI non-streaming shape: choices[].text (legacy / some providers)
        const legacyContent = j?.choices?.[0]?.text;
        if (typeof legacyContent === 'string' && legacyContent.length > 0) {
          routeContent(legacyContent);
          return;
        }
        // Streaming but server only sent the final chunk without [DONE]
        const finalRc = j?.choices?.[0]?.delta?.reasoning_content ?? j?.choices?.[0]?.delta?.reasoning;
        if (typeof finalRc === 'string' && finalRc.length > 0) emitReasoning(finalRc);
        const finalDelta = j?.choices?.[0]?.delta?.content;
        if (typeof finalDelta === 'string' && finalDelta.length > 0) {
          routeContent(finalDelta);
          return;
        }
        if (typeof finalRc === 'string' && finalRc.length > 0) return;
        // The body parsed as JSON but had no content. Maybe an error object.
        if (j?.error) {
          const msg = j.error?.message ?? j.error?.code ?? JSON.stringify(j.error);
          this.emit('error', {session_id: sid, message: `Provider error: ${msg}`});
          return;
        }
        // Fall through to SSE parsing — maybe the server wrapped JSON
        // in something weird.
      } catch {
        // Not JSON — try SSE.
      }
    }

    // SSE parse. Normalize CRLF -> LF first, then split on blank lines
    // (event boundary). Each event is one or more `key: value` lines.
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const events = normalized.split(/\n\n+/);
    let emittedAny = false;
    for (const event of events) {
      if (!event.trim()) continue;
      // Each event may have multiple lines; we only care about `data:`.
      const lines = event.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') continue;
        let chunk = '';
        let rchunk = '';
        let parsed: any = null;
        try {
          parsed = JSON.parse(data);
          chunk =
            parsed?.choices?.[0]?.delta?.content ??
            parsed?.choices?.[0]?.message?.content ??
            parsed?.choices?.[0]?.text ??
            '';
          rchunk =
            parsed?.choices?.[0]?.delta?.reasoning_content ??
            parsed?.choices?.[0]?.delta?.reasoning ??
            parsed?.choices?.[0]?.message?.reasoning_content ??
            '';
        } catch {
          // Non-JSON `data:` line — likely a provider comment or
          // heartbeat. Skip.
          continue;
        }
        if (typeof rchunk === 'string' && rchunk.length > 0) {
          emitReasoning(rchunk);
          emittedAny = true;
        }
        if (typeof chunk === 'string' && chunk.length > 0) {
          routeContent(chunk);
          emittedAny = true;
        } else if (parsed && parsed.error) {
          // SSE error event (e.g. {"error": {"message": "..."}})
          const msg = parsed.error?.message ?? parsed.error?.code ?? JSON.stringify(parsed.error);
          this.emit('error', {session_id: sid, message: `Provider error (mid-stream): ${msg}`});
          return;
        }
      }
    }
    if (!emittedAny) {
      // We got a body but couldn't extract any content from it. The
      // body might be JSON in a shape we don't recognize (e.g. Google's
      // Gemini, or a custom format) — tell the user instead of
      // silently producing an empty response.
      const preview = trimmed.slice(0, 160).replace(/\n/g, ' ');
      this.emit('error', {session_id: sid, message: `Could not extract content from provider response. Body starts with: ${preview}`});
    }
  }

  async createSession(title?: string): Promise<string> {
    const sid = `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentSessionId = sid;
    const sess: LocalSession = {id: sid, title: title ?? 'New chat', messages: []};
    this.sessionCache.unshift(sess);
    await this.persistCache();
    return sid;
  }

  getSessionId(): string | null {
    return this.currentSessionId;
  }

  setSessionId(sid: string): void {
    if (this.sessionCache.find(s => s.id === sid)) this.currentSessionId = sid;
  }

  async listSessions(): Promise<LocalSession[]> {
    if (this.sessionCache.length === 0) await this.loadCache();
    return this.sessionCache;
  }

  /** Load cached sessions from AsyncStorage on startup. */
  private async loadCache(): Promise<void> {
    try {
      const raw = await kv.getItem(STORAGE_KEYS.notes); // any safe key
      // Sessions get persisted under their own key below.
    } catch {
      /* fine */
    }
    try {
      const raw = await kv.getItem('hermes.minimax.sessions');
      if (raw) {
        const parsed = JSON.parse(raw) as LocalSession[];
        this.sessionCache = parsed;
      }
    } catch {
      /* fine */
    }
  }

  private async persistCache(): Promise<void> {
    try {
      await kv.setItem('hermes.minimax.sessions', JSON.stringify(this.sessionCache));
    } catch {
      /* fine */
    }
  }

  submitPrompt(text: string, sessionId?: string, opts?: PromptOptions): StreamHandle {
    const sid = sessionId ?? this.currentSessionId;
    if (!sid) throw new HermesError('No session', 0);
    if (!this.cfg.apiKey) throw new HermesError('API key missing', 0);

    const sess = this.sessionCache.find(s => s.id === sid);
    if (!sess) throw new HermesError('Unknown session', 0);

    let resolveDone!: (v: {text: string; usage?: ChatMessage['usage']}) => void;
    let rejectDone!: (e: any) => void;
    const done = new Promise<{text: string; usage?: ChatMessage['usage']}>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });

    // Append the user turn to the local cache before we send.
    sess.messages.push({role: 'user', text, ts: Date.now()});
    void this.persistCache();

    const abort = new AbortController();
    this.abortControllers.set(sid, abort);

    void (async () => {
      let assistantText = '';
      let assistantReasoning = '';
      const off = this.onEvent((type, params) => {
        if (params?.session_id && params.session_id !== sid) return;
        if (type === 'message.complete') {
          off();
          resolveDone({text: assistantText});
        } else if (type === 'error') {
          off();
          rejectDone(new HermesError(params.message ?? 'Stream error', 0));
        }
      });
      try {
        this.emit('message.start', {session_id: sid, payload: {}});
        const history = sess.messages.slice(0, -1).map(m => ({role: m.role, content: m.text}));
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
        };
        if (this.cfg.groupId) headers.GroupId = this.cfg.groupId;
        const r = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          signal: abort.signal,
          headers,
          body: JSON.stringify({
            model: this.cfg.model,
            stream: true,
            messages: history.concat([{role: 'user', content: text}]),
          }),
        });
        if (!r.ok) {
          const body = await r.text();
          throw new HermesError(`HTTP ${r.status}: ${body.slice(0, 200)}`, r.status);
        }

        // Robust body reading. React Native's fetch polyfill is flaky with
        // r.body.getReader() — some providers return a stream that never
        // yields chunks (empty body, server-side hiccup, network blip
        // after the headers), and we'd silently emit a complete with
        // empty text. So we always read the full body as text first, then
        // parse it. That gives us a single source of truth and lets us
        // handle both SSE and non-streaming JSON responses with the same
        // code path.
        const rawText = await r.text();
        if (rawText) {
          this.parseAndEmit(
            rawText,
            sid,
            (chunk) => { assistantText += chunk; },
            (chunk) => { assistantReasoning += chunk; },
          );
        }

        sess.messages.push({
          role: 'assistant',
          text: assistantText,
          reasoning: assistantReasoning || undefined,
          ts: Date.now(),
        });
        await this.persistCache();
        this.emit('message.complete', {
          session_id: sid,
          payload: {text: assistantText, reasoning: assistantReasoning || undefined},
        });
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          this.emit('error', {session_id: sid, message: e?.message ?? String(e)});
        } else {
          this.emit('message.complete', {session_id: sid, payload: {text: assistantText}});
        }
      } finally {
        this.abortControllers.delete(sid);
      }
    })();

    return {
      sessionId: sid,
      done,
      abort: () => {
        this.abortControllers.get(sid)?.abort();
      },
    };
  }

  async loadHistory(sessionId: string): Promise<ChatMessage[]> {
    if (this.sessionCache.length === 0) await this.loadCache();
    const sess = this.sessionCache.find(s => s.id === sessionId);
    return sess?.messages ?? [];
  }

  disconnect(): void {
    for (const c of this.abortControllers.values()) {
      try {
        c.abort();
      } catch {
        /* ignore */
      }
    }
    this.abortControllers.clear();
  }
}

/* ----------------------------------------------------------------------------
 * Factory + cached config.
 * --------------------------------------------------------------------------*/

import {AppConfig} from './configStore';

export function pickMinimaxCfg(cfg: AppConfig): MinimaxConfig | null {
  const key = cfg.modelApiKey?.trim();
  if (!key) return null;
  const groupId = cfg.modelGroupId?.trim();
  return {
    apiKey: key,
    baseUrl: cfg.modelBaseUrl?.trim() || 'https://api.minimax.io/v1',
    model: cfg.modelId?.trim() || 'MiniMax-Text-01',
    groupId: groupId || undefined,
  };
}
