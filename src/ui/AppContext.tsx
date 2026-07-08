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
import {HermesClient, ChatMessage, StreamHandle, HermesError} from '../api/hermesClient';
import {AppConfig, makeConfigStore} from '../api/configStore';
import {agentById, AgentDef} from '../agents/catalog';
import {
  ChatEngine,
  HermesEngine,
  MinimaxEngine,
  pickMinimaxCfg,
  EngineId,
} from '../api/ChatEngine';

export type Screen =
  | 'home' | 'chat' | 'agents' | 'settings' | 'profile' | 'login'
  | 'notes' | 'noteEditor' | 'cron';

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

  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const streamRef = useMemo(() => ({current: null as StreamHandle | null}), []);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentAgent, setCurrentAgent] = useState<AgentDef | null>(null);
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
  const [offlineModeBanner, setOfflineModeBanner] = useState(false);

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
      } else {
        const list = await (engine as MinimaxEngine).listSessions();
        setSessions(list.map(s => ({id: s.id, title: s.title})));
      }
    } catch {
      // Non-fatal.
    }
  }, [engine]);

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

      const off =
        engine.id === 'desktop'
          ? ((engine as HermesEngine).client as HermesClient).onEvent(
              (type, params) => {
                if (
                  params?.session_id &&
                  params.session_id !== currentSession
                )
                  return;
                if (type === 'message.delta') {
                  setStreamedText(prev => prev + (params.payload?.text ?? ''));
                } else if (type === 'message.start') {
                  setStreamedText('');
                }
              },
            )
          : (engine as MinimaxEngine).onEvent((type, params) => {
              if (
                params?.session_id &&
                params.session_id !== currentSession
              )
                return;
              if (type === 'message.delta') {
                setStreamedText(prev => prev + (params.payload?.text ?? ''));
              } else if (type === 'message.start') {
                setStreamedText('');
              }
            });

      const handle = engine.submitPrompt(effectiveText, currentSession);
      streamRef.current = handle;
      try {
        const result = await handle.done;
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          text: result.text,
          usage: result.usage,
          ts: Date.now(),
        };
        setMessages(prev => [...prev, assistantMsg]);
        setStreamedText('');
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
    [engine, currentSession, currentAgent, messages.length, streamRef],
  );

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
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
