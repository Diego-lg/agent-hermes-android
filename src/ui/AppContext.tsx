/**
 * AppContext — single React context that holds the active engine, auth
 * state, and the current screen. Keeps the screens stateless & focused.
 *
 * Engine model:
 *   - The phone can talk to EITHER your desktop Hermes server (full agent
 *     tools, sessions, cron, PC control) OR a direct OpenAI-compatible
 *     model API (chat only, no PC control). Both routes share the same UI.
 *   - `engineMode` ('auto' | 'desktop' | 'minimax') chooses. 'auto' tries
 *     the desktop first; if probing/connecting fails it falls back to the
 *     minimax engine so the app keeps working when the server is down.
 *   - Switching is automatic on connect, and reflected in the UI (HomeScreen
 *     status row, ChatScreen header). User can pin from Settings.
 */
import React, {createContext, useContext, useState, useEffect, useCallback, useMemo} from 'react';
import {HermesClient, ChatMessage, StreamHandle, HermesError, SessionSummary, PromptOptions} from '../api/hermesClient';
import {AppConfig, makeConfigStore} from '../api/configStore';
import {agentById, AgentDef} from '../agents/catalog';
import {
  ChatEngine,
  HermesEngine,
  MinimaxEngine,
  pickMinimaxCfg,
  EngineId,
} from '../api/ChatEngine';
import {ChatOptions, ChatOptionsStore, makeChatOptionsStore, ModelsListStore, makeModelsListStore, SessionCacheStore, makeSessionCacheStore, SessionHistoryCacheStore, makeSessionHistoryCacheStore} from '../api/chatOptionsStore';
import {kv, STORAGE_KEYS} from '../api/storage';

export type Screen =
  | 'home' | 'chat' | 'agents' | 'settings' | 'profile' | 'login'
  | 'notes' | 'noteEditor' | 'cron'
  | 'sessions' | 'models' | 'profiles' | 'tasks' | 'skills' | 'workspace' | 'memory' | 'insights';

export interface SessionInfo {
  id: string;
  title?: string;
  preview?: string;
  updated_at?: number;
  agentId?: string;
  usage?: {input: number; output: number; context_percent: number};
}

export interface AppState {
  config: AppConfig;
  setConfig: (c: AppConfig) => void;
  /** The currently-active chat engine. Always non-null after login. */
  engine: ChatEngine | null;
  /** If the engine is a HermesEngine, exposes the underlying client (null in mobile mode). */
  engineClient: HermesClient | null;
  /** Convenience flag: engine is the desktop (vs. direct model API). */
  serverOnline: boolean;
  /** Engine label to render in the UI ('Desktop Hermes' or 'Mobile Cloud'). */
  engineLabel: string;
  connecting: boolean;
  connectionError: string | null;
  screen: Screen;
  setScreen: (s: Screen) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  logout: () => Promise<void>;
  /** Force the active engine and re-test connectivity. */
  switchEngine: (mode: 'auto' | 'desktop' | 'minimax') => Promise<void>;
  /** Chat */
  currentSession: string | null;
  setCurrentSession: (id: string | null) => void;
  messages: ChatMessage[];
  setMessages: (m: ChatMessage[]) => void;
  appendMessage: (m: ChatMessage) => void;
  streaming: boolean;
  setStreaming: (s: boolean) => void;
  streamedText: string;
  setStreamedText: (t: string) => void;
  /** Live chain-of-thought for the in-flight turn (reasoning models). */
  streamedReasoning: string;
  setStreamedReasoning: (t: string) => void;
  streamRef: React.MutableRefObject<StreamHandle | null>;
  sendPrompt: (text: string) => Promise<void>;
  abortStream: () => void;
  openOrCreateSession: (agentId?: string) => Promise<string>;
  // Sessions
  sessions: SessionInfo[];
  refreshSessions: () => Promise<void>;
  // Active agent for the current session (if any)
  currentAgent: AgentDef | null;
  setCurrentAgent: (a: AgentDef | null) => void;
  // Selected note in the editor (null = new note)
  currentNoteId: string | null;
  setCurrentNoteId: (id: string | null) => void;
  /** Was the last chat message generated offline (no PC tools)? */
  offlineModeBanner: boolean;
  /** True when the currently-open session was loaded from the offline cache
   *  (server unreachable) rather than fetched live — the UI can show a
   *  "cached / read-only" marker. */
  offlineHistoryBanner: boolean;
  /** Per-turn chat options (model id, reasoning, workspace, profile, agent). */
  chatOptions: ChatOptions;
  setChatOptions: (opts: ChatOptions) => void;
  patchChatOption: <K extends keyof ChatOptions>(key: K, value: ChatOptions[K]) => void;
  /** Persisted recent + favorite model ids for the Models tab. */
  recentModels: string[];
  favoriteModels: string[];
  pushRecentModel: (m: string) => Promise<void>;
  toggleFavoriteModel: (m: string) => Promise<boolean>;
  /** Cached offline sessions (read-only when server unreachable). */
  cachedSessions: SessionSummary[];
  refreshCachedSessions: () => Promise<void>;
  /** Inject guidance mid-turn without aborting (session.steer). */
  steerStream: (text: string) => void;
  /** Resume a past session — sets currentSession, loads history. */
  resumeSession: (id: string) => Promise<void>;
  /** Attach a file (text) to the current session. Best-effort. */
  attachTextFile: (name: string, content: string, mime?: string) => Promise<void>;
  /** Attach an image (base64) to the current session. Best-effort. */
  attachImageFile: (name: string, base64: string, mime?: string) => Promise<void>;
  /** Currently-queued attachments (cleared after a successful submit). */
  pendingAttachments: Array<{id: string; kind: 'file' | 'image'; name: string; size?: number}>;
  addAttachment: (a: {kind: 'file' | 'image'; name: string; size?: number}) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
  /** Active Hermes profile + workspace (independent of per-turn chatOptions). */
  activeProfile: string | null;
  setActiveProfile: (id: string | null) => void;
  activeWorkspace: string | null;
  setActiveWorkspace: (path: string | null) => void;
  /** List of projects the server knows about. */
  projects: any[];
  activeProjectId: string | null;
  refreshProjects: () => Promise<void>;
  setActiveProject: (id: string | null) => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export const useApp = (): AppState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
};

function engineLabel(id: EngineId | null, mode: 'auto' | 'desktop' | 'minimax'): string {
  if (mode === 'minimax' || id === 'minimax') return 'MOBILE · INDEPENDENT';
  if (id === 'desktop') return 'PC SERVER · ONLINE';
  return 'PC SERVER · OFFLINE';
}

export function AppProvider({children}: {children: React.ReactNode}) {
  const store = useMemo(() => makeConfigStore(), []);
  const optsStore = useMemo(() => makeChatOptionsStore(), []);
  const modelsStore = useMemo(() => makeModelsListStore(), []);
  const sessionCache = useMemo(() => makeSessionCacheStore(), []);
  const historyCache = useMemo(() => makeSessionHistoryCacheStore(), []);
  // Start with the hardcoded default so the UI can render immediately
  // (LoginScreen, etc.). The real saved config is loaded async in the
  // effect below and replaces it. We do NOT use a "loading" gate here
  // because the user-visible default is correct enough to show the
  // login screen — the saved values get swapped in once they're ready.
  const [config, setConfigState] = useState<AppConfig>({
    host: '192.168.18.54',
    port: 9119,
    username: 'diego',
    password: 'Maggiemon',
    modelBaseUrl: 'https://api.minimax.io/v1',
    modelId: 'MiniMax-Text-01',
    engineMode: 'auto',
  });
  // Tracks whether the initial load from AsyncStorage has completed.
  // Screens that need to gate UI on a fully-loaded config (none right
  // now, but the flag is here for future use) can read this.
  const [configLoaded, setConfigLoaded] = useState(false);
  const [engine, setEngine] = useState<ChatEngine | null>(null);
  const [serverOnline, setServerOnline] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('login');

  // Load the saved config on mount. Without this, the app would
  // re-render with the hardcoded default on every cold start, losing
  // the API key, GroupId, model id, host, port, etc. that the user
  // configured last time.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await store.load();
        if (cancelled) return;
        // Only override state with the saved config if it actually has
        // anything the user set. We treat an empty record (no fields
        // beyond the defaults) as "no save", to keep the seed defaults
        // for first-time installs.
        const hasUserData =
          (saved.modelApiKey && saved.modelApiKey.length > 0) ||
          (saved.modelGroupId && saved.modelGroupId.length > 0) ||
          saved.host !== '192.168.18.54' ||
          saved.port !== 9119 ||
          saved.username !== 'diego' ||
          saved.password !== 'Maggiemon' ||
          (saved.modelBaseUrl && saved.modelBaseUrl !== 'https://api.minimax.io/v1') ||
          (saved.modelId && saved.modelId !== 'MiniMax-Text-01') ||
          (saved.engineMode && saved.engineMode !== 'auto');
        if (hasUserData) {
          setConfigState(saved);
        }
      } catch {
        // Storage failure (rare). Stay on the hardcoded defaults.
      } finally {
        if (!cancelled) setConfigLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [store]);

  // Load persisted chat options, recents/favorites, cached sessions, profile, workspace.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [opts, rec, fav, sc, prof, ws] = await Promise.all([
          optsStore.load(),
          modelsStore.getRecents(),
          modelsStore.getFavorites(),
          sessionCache.load(),
          kv.getItem(STORAGE_KEYS.activeProfile),
          kv.getItem(STORAGE_KEYS.activeWorkspace),
        ]);
        if (cancelled) return;
        setChatOptionsState(opts);
        setRecentModels(rec);
        setFavoriteModels(fav);
        setCachedSessions(sc);
        setActiveProfileState(prof);
        setActiveWorkspaceState(ws);
      } catch {
        /* fine — defaults stay */
      }
    })();
    return () => { cancelled = true; };
  }, [optsStore, modelsStore, sessionCache]);

  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [streamedReasoning, setStreamedReasoning] = useState('');
  const streamRef = useMemo(() => ({current: null as StreamHandle | null}), []);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentAgent, setCurrentAgent] = useState<AgentDef | null>(null);
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
  const [offlineModeBanner, setOfflineModeBanner] = useState(false);
  const [offlineHistoryBanner, setOfflineHistoryBanner] = useState(false);

  // Per-turn chat options
  const [chatOptions, setChatOptionsState] = useState<ChatOptions>({
    modelLabel: 'auto',
    reasoningEffort: 'medium',
  });
  const [recentModels, setRecentModels] = useState<string[]>([]);
  const [favoriteModels, setFavoriteModels] = useState<string[]>([]);
  const [cachedSessions, setCachedSessions] = useState<SessionSummary[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{id: string; kind: 'file' | 'image'; name: string; size?: number}>>([]);
  const [activeProfile, setActiveProfileState] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspaceState] = useState<string | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const setConfig = useCallback(
    (c: AppConfig) => {
      setConfigState(c);
      void store.save(c);
    },
    [store],
  );

  /** Build & activate an engine. Returns the engine (or throws). */
  const buildEngine = useCallback(
    async (
      cfg: AppConfig,
      mode: 'auto' | 'desktop' | 'minimax',
    ): Promise<ChatEngine> => {
      setConnecting(true);
      setConnectionError(null);

      // Try the desktop first if user asked for it (or 'auto').
      const tryDesktop = mode !== 'minimax' && !!cfg.host && !!cfg.password;
      if (tryDesktop) {
        try {
          const client = new HermesClient(cfg);
          await client.connect();
          setServerOnline(true);
          setOfflineModeBanner(false);
          return new HermesEngine(client);
        } catch (e: any) {
          if (mode === 'desktop') {
            // User pinned desktop — surface the error, don't fall back.
            setServerOnline(false);
            throw e;
          }
          // mode === 'auto' && desktop failed → continue to fallback.
        }
      } else {
        setServerOnline(false);
      }

      // Fallback: direct model API.
      const minimaxCfg = pickMinimaxCfg(cfg);
      if (!minimaxCfg) {
        throw new HermesError(
          'No desktop server reachable, and no model API key configured. Add a key in Settings → AI.',
          0,
        );
      }
      const m = new MinimaxEngine(minimaxCfg);
      const ok = await m.isAvailable();
      if (!ok) {
        throw new HermesError(
          `Cannot reach model API at ${minimaxCfg.baseUrl}. Check the URL and key in Settings → AI.`,
          0,
        );
      }
      setServerOnline(false);
      setOfflineModeBanner(true);
      return m;
    },
    [],
  );

  const doConnect = useCallback(
    async (cfg: AppConfig) => {
      // Tear down any prior engine.
      engine?.disconnect();
      try {
        const e = await buildEngine(cfg, cfg.engineMode ?? 'auto');
        setEngine(e);
        setScreen('home');
        // Pre-fetch sessions where possible.
        try {
          const list = await (e as any).listSessions?.();
          if (Array.isArray(list)) {
            setSessions(
              list.map((s: any) => ({
                id: s.id ?? s.session_id,
                title: s.title ?? '(untitled)',
                updated_at: s.updated_at ?? s.last_active,
                preview: s.preview,
              })),
            );
            return;
          }
        } catch {
          /* fallthrough */
        }
        // For HermesEngine, fetch via client API.
        if (e.id === 'desktop') {
          try {
            const hermes = (e as HermesEngine);
            // The underlying client is private; use the public loadHistory
            // path which won't expose sessions list. We fall back to empty.
            setSessions([]);
          } catch {
            setSessions([]);
          }
        } else {
          // MinimaxEngine sessions are loaded by the engine itself.
          const list = await (e as MinimaxEngine).listSessions();
          setSessions(
            list.map(s => ({
              id: s.id,
              title: s.title,
            })),
          );
        }
      } catch (e: any) {
        setConnectionError(e?.message ?? String(e));
      } finally {
        setConnecting(false);
      }
    },
    [engine, buildEngine],
  );

  const connect = useCallback(async () => doConnect(config), [config, doConnect]);

  const switchEngine = useCallback(
    async (mode: 'auto' | 'desktop' | 'minimax') => {
      const cfg = {...config, engineMode: mode};
      setConfigState(cfg);
      void store.save(cfg);
      await doConnect(cfg);
    },
    [config, doConnect, store],
  );

  const disconnect = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.abort();
      streamRef.current = null;
    }
    engine?.disconnect();
    setEngine(null);
    setCurrentSession(null);
    setMessages([]);
    setStreamedText('');
    setStreaming(false);
    setServerOnline(false);
  }, [engine, streamRef]);

  const logout = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.abort();
      streamRef.current = null;
    }
    engine?.disconnect();
    setEngine(null);
    setCurrentSession(null);
    setMessages([]);
    setStreamedText('');
    setStreaming(false);
    setSessions([]);
    setServerOnline(false);
    setOfflineModeBanner(false);
    setScreen('login');
  }, [engine, streamRef]);

  const refreshSessions = useCallback(async () => {
    if (!engine) return;
    try {
      if (engine.id === 'desktop') {
        const list = await (engine as HermesEngine).loadHistory
          ? null
          : null;
        // We need a listSessions on HermesEngine too; add one inline.
        const hermesClient = (engine as any).client as HermesClient;
        const list2 = await hermesClient.listSessions(50);
        setSessions(
          list2.map((s: any) => ({
            id: s.id ?? s.session_id,
            title: s.title ?? '(untitled)',
            preview: s.preview,
            updated_at: s.updated_at ?? s.last_active,
          })),
        );
        // Mirror the list into the offline cache so the Sessions tab still
        // renders when the desktop is later unreachable.
        try {
          const summaries: SessionSummary[] = list2.map((s: any) => ({
            id: s.id ?? s.session_id,
            title: s.title,
            preview: s.preview,
            started_at: s.started_at,
            last_active: s.last_active ?? s.updated_at,
            message_count: s.message_count,
            model: s.model,
            status: s.status,
            source: s.source,
            cached: true,
          }));
          await sessionCache.save(summaries);
          setCachedSessions(summaries);
        } catch { /* cache write is best-effort */ }
      } else {
        const list = await (engine as MinimaxEngine).listSessions();
        setSessions(list.map(s => ({id: s.id, title: s.title})));
      }
    } catch {
      // Non-fatal.
    }
  }, [engine, sessionCache]);

  const appendMessage = useCallback((m: ChatMessage) => {
    setMessages(prev => [...prev, m]);
  }, []);

  const openOrCreateSession = useCallback(
    async (agentId?: string): Promise<string> => {
      if (!engine) throw new Error('Not connected');
      const agent = agentId ? agentById(agentId) ?? null : null;
      const title = agent ? agent.name : 'Quick Chat';
      const sid = await engine.createSession(title);
      // Set the active session id back on the engine so loadHistory works.
      if (engine.id === 'desktop') {
        (engine as HermesEngine)['client']?.setSessionId?.(sid);
      } else {
        (engine as MinimaxEngine).setSessionId(sid);
      }
      setCurrentSession(sid);
      setCurrentAgent(agent);
      setMessages([]);
      setStreamedText('');
      return sid;
    },
    [engine],
  );

  const sendPrompt = useCallback(
    async (text: string) => {
      if (!engine || !currentSession || !text.trim()) return;
      const firstTurn = messages.length === 0;
      const effectiveText =
        firstTurn && currentAgent
          ? `[System: ${currentAgent.systemPrompt}]\n\n${text}`
          : text;
      const userMsg: ChatMessage = {role: 'user', text, ts: Date.now()};
      setMessages(prev => [...prev, userMsg]);
      setStreaming(true);
      setStreamedText('');
      setStreamedReasoning('');

      // Build the per-turn options object from chatOptions state.
      const turnOpts: PromptOptions = {};
      if (chatOptions.model && chatOptions.modelLabel !== 'auto') {
        turnOpts.model = chatOptions.model;
      }
      if (chatOptions.reasoningEffort) {
        turnOpts.reasoningEffort = chatOptions.reasoningEffort;
      }
      if (activeWorkspace) turnOpts.workspace = activeWorkspace;
      if (activeProfile) turnOpts.profile = activeProfile;
      if (activeProjectId) turnOpts.projectId = activeProjectId;

      // Accumulate reasoning locally so we can attach it to the finished
      // message (the engine `done` promise only carries the answer text).
      let reasoningAccum = '';
      const handleStreamEvent = (type: string, params: any) => {
        if (params?.session_id && params.session_id !== currentSession) return;
        if (type === 'message.delta') {
          setStreamedText(prev => prev + (params.payload?.text ?? ''));
        } else if (type === 'reasoning.delta') {
          const t = params.payload?.text ?? '';
          reasoningAccum += t;
          setStreamedReasoning(prev => prev + t);
        } else if (type === 'message.start') {
          setStreamedText('');
          setStreamedReasoning('');
          reasoningAccum = '';
        }
      };

      const off =
        engine.id === 'desktop'
          ? ((engine as HermesEngine).client as HermesClient).onEvent(handleStreamEvent)
          : (engine as MinimaxEngine).onEvent(handleStreamEvent);

      const handle = engine.submitPrompt(effectiveText, currentSession, turnOpts);
      streamRef.current = handle;
      try {
        const result = await handle.done;
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          text: result.text,
          reasoning: reasoningAccum || undefined,
          usage: result.usage,
          ts: Date.now(),
        };
        setMessages(prev => [...prev, assistantMsg]);
        setStreamedText('');
        setStreamedReasoning('');
        // Successful submit — clear any queued attachments.
        setPendingAttachments([]);
        // Write-through the freshest conversation to the offline cache so
        // it's readable later without the LAN server. (Minimax persists its
        // own sessions internally, so only cache desktop turns here.)
        if (engine.id === 'desktop' && currentSession) {
          const full = [...messages, userMsg, assistantMsg];
          void historyCache.put(currentSession, full, currentAgent?.name);
        }
        // Track the model in recents (best-effort).
        if (chatOptions.model) {
          await modelsStore.pushRecent(chatOptions.model);
          setRecentModels(await modelsStore.getRecents());
        }
      } catch (e: any) {
        setMessages(prev => [
          ...prev,
          {
            role: 'assistant',
            text: `⚠️ ${e?.message ?? String(e)}`,
            ts: Date.now(),
          },
        ]);
      } finally {
        off();
        setStreaming(false);
        streamRef.current = null;
      }
    },
    [engine, currentSession, currentAgent, messages, streamRef, chatOptions, activeWorkspace, activeProfile, activeProjectId, modelsStore, historyCache],
  );

  /** Inject guidance into an in-flight turn without aborting. */
  const steerStream = useCallback((text: string) => {
    streamRef.current?.steer?.(text);
  }, [streamRef]);

  /** Resume a previously-existing session (load history, set active).
   *  Live fetch is write-through cached; if it fails (server offline) we
   *  fall back to the last cached snapshot so the conversation is still
   *  readable. */
  const resumeSession = useCallback(async (id: string) => {
    if (!engine) return;
    setCurrentSession(id);
    if (engine.id === 'desktop') {
      (engine as HermesEngine)['client']?.setSessionId?.(id);
    } else {
      (engine as MinimaxEngine).setSessionId(id);
    }

    let loaded: ChatMessage[] | null = null;
    try {
      const hist = await engine.loadHistory(id);
      if (hist && hist.length) {
        loaded = hist;
        setOfflineHistoryBanner(false);
        // Cache live desktop history for offline reading later. (Minimax
        // already persists its own sessions, so skip it there.)
        if (engine.id === 'desktop') {
          void historyCache.put(id, hist, sessions.find(s => s.id === id)?.title);
        }
      }
    } catch {
      /* fall through to the offline cache */
    }

    if (!loaded) {
      const cached = await historyCache.get(id);
      if (cached && cached.messages.length) {
        loaded = cached.messages;
        setOfflineHistoryBanner(true);
      }
    }

    setMessages(loaded ?? []);
    setStreamedText('');
    setStreamedReasoning('');
    setScreen('chat');
  }, [engine, historyCache, sessions]);

  /** Attach a text/base64 file to the active session (best-effort). */
  const attachTextFile = useCallback(async (name: string, content: string, mime?: string) => {
    if (!engine || !currentSession) return;
    if (engine.id === 'desktop') {
      try {
        await (engine as HermesEngine).attachFile?.(currentSession, {name, content, mime});
      } catch { /* best-effort */ }
    }
  }, [engine, currentSession]);

  const attachImageFile = useCallback(async (name: string, base64: string, mime?: string) => {
    if (!engine || !currentSession) return;
    if (engine.id === 'desktop') {
      try {
        await (engine as HermesEngine).attachImage?.(currentSession, {name, data: base64, mime});
      } catch { /* best-effort */ }
    }
  }, [engine, currentSession]);

  const addAttachment = useCallback((a: {kind: 'file' | 'image'; name: string; size?: number}) => {
    setPendingAttachments(prev => [...prev, {...a, id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`}]);
  }, []);
  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments(prev => prev.filter(a => a.id !== id));
  }, []);
  const clearAttachments = useCallback(() => setPendingAttachments([]), []);

  const setChatOptions = useCallback((opts: ChatOptions) => {
    setChatOptionsState(opts);
    void optsStore.save(opts);
  }, [optsStore]);
  const patchChatOption = useCallback(<K extends keyof ChatOptions>(key: K, value: ChatOptions[K]) => {
    setChatOptionsState(prev => {
      const next = {...prev, [key]: value};
      void optsStore.save(next);
      return next;
    });
  }, [optsStore]);

  const pushRecentModel = useCallback(async (m: string) => {
    await modelsStore.pushRecent(m);
    setRecentModels(await modelsStore.getRecents());
  }, [modelsStore]);
  const toggleFavoriteModel = useCallback(async (m: string) => {
    const now = await modelsStore.toggleFavorite(m);
    setFavoriteModels(await modelsStore.getFavorites());
    return now;
  }, [modelsStore]);

  const refreshCachedSessions = useCallback(async () => {
    setCachedSessions(await sessionCache.load());
  }, [sessionCache]);

  const setActiveProfile = useCallback((id: string | null) => {
    setActiveProfileState(id);
    void kv.setItem(STORAGE_KEYS.activeProfile, id ?? '');
  }, []);
  const setActiveWorkspace = useCallback((path: string | null) => {
    setActiveWorkspaceState(path);
    void kv.setItem(STORAGE_KEYS.activeWorkspace, path ?? '');
  }, []);

  const refreshProjects = useCallback(async () => {
    if (!engine || engine.id !== 'desktop') return;
    try {
      const r = await (engine as HermesEngine).listProjects?.();
      if (r) {
        setProjects(r.projects ?? []);
        setActiveProjectId(r.active_id ?? null);
      }
    } catch {/* fine */}
  }, [engine]);

  const setActiveProject = useCallback(async (id: string | null) => {
    setActiveProjectId(id);
    if (engine && engine.id === 'desktop') {
      try {
        await (engine as HermesEngine).setActiveProject?.(id);
      } catch {/* fine */}
    }
  }, [engine]);

  const abortStream = useCallback(() => {
    streamRef.current?.abort();
    setStreaming(false);
  }, [streamRef]);

  const value: AppState = {
    config,
    setConfig,
    engine,
    engineClient: engine instanceof HermesEngine ? engine.client : null,
    serverOnline,
    engineLabel: engineLabel(
      engine?.id ?? null,
      (config.engineMode ?? 'auto') as any,
    ),
    connecting,
    connectionError,
    screen,
    setScreen,
    connect,
    disconnect,
    logout,
    switchEngine,
    currentSession,
    setCurrentSession,
    messages,
    setMessages,
    appendMessage,
    streaming,
    setStreaming,
    streamedText,
    setStreamedText,
    streamedReasoning,
    setStreamedReasoning,
    streamRef,
    sendPrompt,
    abortStream,
    openOrCreateSession,
    sessions,
    refreshSessions,
    currentAgent,
    setCurrentAgent,
    currentNoteId,
    setCurrentNoteId,
    offlineModeBanner,
    offlineHistoryBanner,
    chatOptions,
    setChatOptions,
    patchChatOption,
    recentModels,
    favoriteModels,
    pushRecentModel,
    toggleFavoriteModel,
    cachedSessions,
    refreshCachedSessions,
    steerStream,
    resumeSession,
    attachTextFile,
    attachImageFile,
    pendingAttachments,
    addAttachment,
    removeAttachment,
    clearAttachments,
    activeProfile,
    setActiveProfile,
    activeWorkspace,
    setActiveWorkspace,
    projects,
    activeProjectId,
    refreshProjects,
    setActiveProject,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
