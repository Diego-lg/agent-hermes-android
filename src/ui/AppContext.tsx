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
 *
 * No-login-wall: the phone boots straight into the Home screen and tries
 * to connect in passwordless mode. The desktop Hermes server in loopback /
 * `--insecure` mode serves `/api/auth/ws-ticket` directly without a
 * session cookie, so this works without prompting for credentials.
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
import {ProviderConfig, ProviderConfigsStore, makeProviderConfigsStore, buildSeedConfigs} from '../api/providerConfigsStore';
import {fetchProviderModels, PROVIDER_CATALOG} from '../api/providersCatalog';

export type Screen =
  | 'home' | 'chat' | 'agents' | 'settings' | 'profile'
  | 'notes' | 'noteEditor' | 'cron'
  | 'sessions' | 'models' | 'profiles' | 'tasks' | 'skills' | 'workspace' | 'memory' | 'insights'
  | 'groupChat' | 'personalities'
  | 'yolo';

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
  /** Display title for the active session (auto-generated after 1st turn). */
  currentSessionTitle: string | null;
  setCurrentSessionTitle: (t: string | null) => void;
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
  /** Force a fresh connect (used by Home's retry button when
   *  connectionError is set, and to recover from a stale engine). */
  retryConnect: () => Promise<void>;
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
  /** Attach a file (text) to the current session. Best-effort. `base64Data`,
   *  when present, is forwarded as raw bytes to the server-side attachFile
   *  RPC for non-text attachments (PDFs, images, etc). */
  attachTextFile: (name: string, content: string, mime?: string, base64Data?: string) => Promise<void>;
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
  /** Multi-provider config store (api keys, base urls, fetched model caches). */
  providerConfigs: Record<string, ProviderConfig>;
  /** Replace the full provider-configs map and persist it. */
  setProviderConfigs: (map: Record<string, ProviderConfig>) => Promise<void>;
  /** Update one provider config in place (auto-creates if missing). */
  upsertProviderConfig: (cfg: Partial<ProviderConfig> & {providerId: string}) => Promise<void>;
  /** Fetch the live model list for one provider from its REST endpoint. */
  refreshProviderModels: (providerId: string) => Promise<void>;
  /** Refresh all enabled providers in parallel. */
  refreshAllEnabledProviders: () => Promise<void>;
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
  const providerConfigsStore = useMemo(() => makeProviderConfigsStore(), []);
  const historyCache = useMemo(() => makeSessionHistoryCacheStore(), []);
  // Start with the hardcoded default so the UI can render immediately
  // (HomeScreen, etc.). The real saved config is loaded async in the
  // effect below and replaces it. There's no login wall anymore — the
  // phone boots into home, and the `connect()` effect below tries the
  // desktop in passwordless mode.
  const [config, setConfigState] = useState<AppConfig>({
    host: '192.168.18.54',
    port: 9119,
    username: '',
    password: '',
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
  // Boot straight into the Home screen — no login wall. The connect
  // effect below tries to reach the desktop server in the background.
  const [screen, setScreen] = useState<Screen>('home');

  // Load the saved config on mount. Without this, the app would
  // re-render with the hardcoded default on every cold start, losing
  // the API key, GroupId, model id, host, port, etc. that the user
  // configured last time. Once the saved (or default) config is in
  // place, kick off the engine connect.
  //
  // Seed-credentials bootstrap: a fresh install has no saved creds
  // (username/password empty), which means the desktop server — which
  // does require basic-auth even on loopback — won't let us in. To
  // preserve the "boot straight into the app, no login wall" UX on
  // this server, if the saved config has empty auth AND no prior
  // server creds, we fill in the LAN-default username/password the
  // first time around and persist that. After that one bootstrap the
  // user is free to clear auth in Settings → Connection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await store.load();
        if (cancelled) return;
        // Anything the user has customised at any point — even just
        // toggling a YOLO row or changing the model id — is "user data".
        const hasUserData =
          (saved.modelApiKey && saved.modelApiKey.length > 0) ||
          (saved.modelGroupId && saved.modelGroupId.length > 0) ||
          (saved.username && saved.username.length > 0) ||
          (saved.password && saved.password.length > 0) ||
          saved.host !== '192.168.18.54' ||
          saved.port !== 9119 ||
          (saved.modelBaseUrl && saved.modelBaseUrl !== 'https://api.minimax.io/v1') ||
          (saved.modelId && saved.modelId !== 'MiniMax-Text-01') ||
          (saved.engineMode && saved.engineMode !== 'auto');
        if (hasUserData) {
          setConfigState(saved);
        } else if (!saved.password) {
          // One-shot bootstrap: fill in the user's preferred LAN creds
          // the first time so the desktop server lets us straight in.
          // We do this only on a TRUE first launch (no user data at
          // all), so the user can still clear auth later by editing
          // it to empty via Settings → Auth.
          const seeded: AppConfig = {
            ...saved,
            username: 'diego',
            password: 'Maggiemon',
          };
          setConfigState(seeded);
          await store.save(seeded);
        }
      } catch {
        // Storage failure (rare). Stay on the hardcoded defaults.
      } finally {
        if (!cancelled) setConfigLoaded(true);
        // One-shot notifee bootstrap. Idempotent — does nothing if the
        // native module isn't linked (returns `available: false`), and is
        // safe to fire on every cold start since createChannel is a no-op
        // on existing channel ids and the runtime permission request is
        // suppressed by the OS on subsequent launches.
        try {
          const {ensureNotificationSetup} = await import('../api/notifications');
          await ensureNotificationSetup();
        } catch { /* notifs are optional, never break boot */ }
      }
      // The connect itself is kicked off by the `bootConnectedRef` effect
      // below, which runs after `doConnect` is in scope.
    })();
    return () => { cancelled = true; };
  }, []);

  // Load persisted chat options, recents/favorites, cached sessions, profile, workspace.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [opts, rec, fav, sc, prof, ws, savedProviders] = await Promise.all([
          optsStore.load(),
          modelsStore.getRecents(),
          modelsStore.getFavorites(),
          sessionCache.load(),
          kv.getItem(STORAGE_KEYS.activeProfile),
          kv.getItem(STORAGE_KEYS.activeWorkspace),
          providerConfigsStore.load(),
        ]);
        if (cancelled) return;
        setChatOptionsState(opts);
        setRecentModels(rec);
        setFavoriteModels(fav);
        setCachedSessions(sc);
        setActiveProfileState(prof);
        setActiveWorkspaceState(ws);
        // If nothing is saved yet, seed from the legacy single-provider config.
        if (Object.keys(savedProviders).length === 0) {
          const seed = buildSeedConfigs({
            legacyModelApiKey: config.modelApiKey,
            legacyModelBaseUrl: config.modelBaseUrl,
            legacyModelGroupId: config.modelGroupId,
          });
          await providerConfigsStore.save(seed);
          setProviderConfigsState(seed);
        } else {
          setProviderConfigsState(savedProviders);
        }
      } catch {
        /* fine — defaults stay */
      }
    })();
    return () => { cancelled = true; };
  }, [optsStore, modelsStore, sessionCache, providerConfigsStore, config.modelApiKey, config.modelBaseUrl, config.modelGroupId]);

  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [currentSessionTitle, setCurrentSessionTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [streamedReasoning, setStreamedReasoning] = useState('');
  const streamRef = useMemo(() => ({current: null as StreamHandle | null}), []);
  // Stable ref that always points at the most recently built engine. Used
  // by callbacks like openOrCreateSession that need to read the latest
  // engine inside an async callback without rebinding on every render.
  const engineRef = useMemo(() => ({current: null as ChatEngine | null}), []);

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
  // Holds the ACTUAL attachment data (image data URIs / file text) queued for
  // the next turn — kept in a ref so it doesn't trigger re-renders. Populated
  // by attachImageFile/attachTextFile, drained on a successful sendPrompt.
  const pendingDataRef = useMemo(() => ({current: [] as Array<{kind: 'file' | 'image'; name: string; size?: number; dataUri?: string; content?: string; mime?: string}>}), []);
  const [activeProfile, setActiveProfileState] = useState<string | null>(null);
  const [activeWorkspace, setActiveWorkspaceState] = useState<string | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [providerConfigs, setProviderConfigsState] = useState<Record<string, ProviderConfig>>({});
  const [refreshingProviders, setRefreshingProviders] = useState<Set<string>>(new Set());

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

      // Try the desktop first if user asked for it (or 'auto'). The
      // client now supports passwordless mode (skips /auth/password-login),
      // so an empty password is fine — `!!cfg.host` is the only true
      // precondition for attempting the desktop.
      const tryDesktop = mode !== 'minimax' && !!cfg.host;
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
          // mode === 'auto' || 'minimax'(engineMode) → desktop failed,
          // continue to fallback. Note: even when mode === 'minimax'
          // (user pinned cloud), if desktop fails the user almost
          // certainly wants to TRY the cloud fallback anyway, so we
          // don't re-throw — we keep going.
          setServerOnline(false);
        }
      } else {
        setServerOnline(false);
      }

      // Fallback: direct model API. Accept keys from the legacy
      // single-provider slot OR the new multi-provider system
      // (providerConfigs.minimax). Whichever has a key wins.
      const minimaxCfg = pickMinimaxCfg(cfg, providerConfigs);
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
    // providerConfigs is read at call-time so updates from Settings
    // are picked up the next time the user pings connect.
    [providerConfigs],
  );

  const doConnect = useCallback(
    async (cfg: AppConfig) => {
      // Tear down any prior engine.
      engine?.disconnect();
      try {
        const e = await buildEngine(cfg, cfg.engineMode ?? 'auto');
        setEngine(e);
        engineRef.current = e;
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

  /** Force a fresh connect. Tears down any prior engine, then builds
   *  a new one. Used by Home's retry button when connectionError is
   *  set, and by openOrCreateSession when the engine reference is
   *  null. Safe to call repeatedly — the underlying HermesClient /
   *  MinimaxEngine constructors are cheap and the prior WS / abort
   *  controllers are torn down by their disconnect(). */
  const retryConnect = useCallback(async () => {
    setConnectionError(null);
    await doConnect(config);
  }, [config, doConnect]);

  // Boot-strap connect — runs ONCE after the layout wires up. The `null`
  // dependency array means "fire on mount only". See the comment on the
  // config-load effect for why we don't subscribe to config changes
  // (that would tear down the WS during Settings edits).
  const bootConnectedRef = useMemo(() => ({current: false}), []);
  useEffect(() => {
    if (bootConnectedRef.current) return;
    bootConnectedRef.current = true;
    void doConnect(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    engineRef.current = null;
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
    engineRef.current = null;
    setCurrentSession(null);
    setMessages([]);
    setStreamedText('');
    setStreaming(false);
    setSessions([]);
    setServerOnline(false);
    setOfflineModeBanner(false);
    // No login wall — stay on home instead of routing back to a
    // (now-removed) login screen. The user can manually switch engine
    // from the Home status row if they want to re-probe.
    setScreen('home');
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
      // Auto-recover: if no engine is set (the prior connect failed or
      // is still pending), retry the connect first. We don't throw at
      // the call-site any more — opening a chat from Home is a much
      // more common path than the user wants to "see the engine
      // diagnostics". The connect happens behind the scenes; if it
      // still fails, setEngine stays null and ChatScreen will surface
      // a "set up API key" hint instead of crashing.
      let active = engine;
      if (!active) {
        try {
          await doConnect(config);
          active = engineRef.current;
        } catch {
          /* fall through with active === null; ChatScreen handles it */
        }
      }
      if (!active) throw new Error('Not connected');
      const agent = agentId ? agentById(agentId) ?? null : null;
      const title = agent ? agent.name : 'Quick Chat';
      const sid = await active.createSession(title);
      // Set the active session id back on the engine so loadHistory works.
      if (active.id === 'desktop') {
        (active as HermesEngine)['client']?.setSessionId?.(sid);
      } else {
        (active as MinimaxEngine).setSessionId(sid);
      }
      setCurrentSession(sid);
      setCurrentSessionTitle(title);
      setCurrentAgent(agent);
      setMessages([]);
      setStreamedText('');
      return sid;
    },
    // engineRef reads the latest engine state without making this
    // callback churn on every connect — see useMemo ref below.
    [engine, config, doConnect],
  );

  /** Produce a short session title. Uses the MiniMax cloud for a smart
   *  title when a key is available; otherwise derives one from the first
   *  user message. Never throws. */
  const genTitle = useCallback(async (userText: string, assistantText: string): Promise<string> => {
    const fallback = () => {
      const s = (userText || '').trim().replace(/\s+/g, ' ');
      if (!s) return 'New chat';
      return s.length <= 42 ? s : s.slice(0, 42).trim() + '…';
    };
    const mm = pickMinimaxCfg(config, providerConfigs);
    if (!mm) return fallback();
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${mm.apiKey}`,
      };
      if (mm.groupId) headers.GroupId = mm.groupId;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(`${mm.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers,
        signal: ctrl.signal,
        body: JSON.stringify({
          model: mm.model,
          stream: false,
          messages: [
            {role: 'system', content: 'You write a concise 3-6 word title for a conversation. Reply with ONLY the title — no quotes, no trailing punctuation.'},
            {role: 'user', content: `User: ${userText.slice(0, 600)}\nAssistant: ${assistantText.slice(0, 600)}\n\nTitle:`},
          ],
        }),
      });
      clearTimeout(timer);
      if (!r.ok) return fallback();
      const j: any = await r.json();
      let t: string = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text ?? '';
      t = String(t).replace(/["'`\r\n]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.。!?]+$/, '');
      if (!t) return fallback();
      return t.length > 48 ? t.slice(0, 48).trim() + '…' : t;
    } catch {
      return fallback();
    }
  }, [config, providerConfigs]);

  /** Human-readable byte string ("3.4 MB", "1.2 KB", "47 B"). Used when
   *  inlining binary attachments so the agent can see the file's size
   *  without us forcing a full UTF-8 dump. */
  function formatBytes(n: number): string {
    if (!n || n < 0) return '?';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  /** Pick a code-fence language hint from the filename's extension so the
   *  model can syntax-highlight / parse the inlined attachment correctly. */
  function guessFenceLang(name?: string): string {
    const lower = (name || '').toLowerCase();
    if (lower.endsWith('.py')) return 'python';
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
    if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.md')) return 'markdown';
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
    if (lower.endsWith('.csv')) return 'csv';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
    if (lower.endsWith('.css')) return 'css';
    if (lower.endsWith('.sql')) return 'sql';
    if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'bash';
    if (lower.endsWith('.rs')) return 'rust';
    if (lower.endsWith('.go')) return 'go';
    if (lower.endsWith('.kt') || lower.endsWith('.kts')) return 'kotlin';
    return '';
  }

  const sendPrompt = useCallback(
    async (text: string) => {
      if (!engine || !currentSession || !text.trim()) return;
      const firstTurn = messages.length === 0;
      // Snapshot the queued attachments for this turn.
      const outboundAtts = pendingDataRef.current.slice();
      const userImages = outboundAtts
        .filter(a => a.kind === 'image' && a.dataUri)
        .map(a => ({kind: 'image' as const, name: a.name, dataUri: a.dataUri, mime: a.mime}));
      const userFiles = outboundAtts.filter(a => a.kind === 'file');

      // Inline file contents into the prompt text so the agent always sees
      // them, even when the server's `file.attach` RPC isn't implemented.
      // Each non-image attachment becomes a fenced block in the prompt —
      // filename + optional first N chars + length summary. Binary files
      // (whose `content` is the `[binary:...]` placeholder or looks like
      // a UTF-8 decode failure) are summarised instead of dumped; the
      // server can still pick up the raw bytes out-of-band if its
      // attachFile RPC is available (handled by attachTextFile caller).
      const attachmentBlock = userFiles.length
        ? '\n\n' + userFiles.map(a => {
            const name = a.name || 'file';
            const c = a.content ?? '';
            const isBinaryPlaceholder = c.startsWith('[binary:') || c.startsWith('[binary]');
            if (isBinaryPlaceholder) {
              const bytes = a.size ? ` (~${formatBytes(a.size)})` : '';
              return `\`\`\`\nATTACHMENT: ${name}${bytes} (binary; not inlined — see server-side attach if available)\n\`\`\``;
            }
            // Cap inlined content at 6 KB per file so a giant log file doesn't
            // blow the context window. Show the head if truncated.
            const MAX = 6 * 1024;
            const truncated = c.length > MAX;
            const body = truncated ? c.slice(0, MAX) : c;
            return `\`\`\`${guessFenceLang(a.name)}\nATTACHMENT: ${name} (${c.length.toLocaleString()} chars${truncated ? `, first ${MAX.toLocaleString()} shown` : ''})\n${body}${truncated ? '\n…(truncated)' : ''}\n\`\`\``;
          }).join('\n\n') + '\n'
        : '';
      const promptWithAtts = text + attachmentBlock;
      const effectiveText =
        firstTurn && currentAgent
          ? `[System: ${currentAgent.systemPrompt}]\n\n${promptWithAtts}`
          : promptWithAtts;

      const userMsg: ChatMessage = {
        role: 'user',
        text,
        ts: Date.now(),
        attachments: userImages.length ? userImages : undefined,
      };
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
      if (outboundAtts.length) turnOpts.attachments = outboundAtts;

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
      let assistantMsg: ChatMessage | null = null;
      try {
        const result = await handle.done;
        assistantMsg = {
          role: 'assistant',
          text: result.text,
          reasoning: reasoningAccum || undefined,
          usage: result.usage,
          ts: Date.now(),
        };
        setMessages(prev => assistantMsg ? [...prev, assistantMsg] : prev);
        setStreamedText('');
        setStreamedReasoning('');
        // Successful submit — clear any queued attachments (metadata + data).
        setPendingAttachments([]);
        pendingDataRef.current = [];
        // Auto-generate a session title after the first exchange.
        if (firstTurn && currentSession && result.text) {
          const sid = currentSession;
          void (async () => {
            const title = await genTitle(text, result.text);
            if (!title) return;
            setCurrentSessionTitle(title);
            setSessions(prev => prev.map(s => (s.id === sid ? {...s, title} : s)));
            try { await engine.setSessionTitle?.(sid, title); } catch { /* best-effort */ }
          })();
        }
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
        // Post a "reply ready" notification if the user has the app
        // backgrounded / locked or is on a different tab. We don't try
        // to be clever about checking app foreground state here — the
        // phone handles that for us at the OS level (the notif heads-up
        // appears even with the app open, which is fine here because
        // the user just submitted a prompt and is likely to look up
        // from the keyboard for the result). We DO suppress the notif
        // when the user is on the chat screen looking at the same
        // session, which is the actual noise we'd want to avoid.
        if (currentSession && assistantMsg && assistantMsg.text) {
          const suppress = screen === 'chat';
          void (async () => {
            try {
              const {notifyReplyReadyIfBackgrounded} = await import('../api/notifications');
              await notifyReplyReadyIfBackgrounded({
                sessionId: currentSession,
                sessionTitle: currentSessionTitle,
                previewText: assistantMsg.text,
                engineLabel: engine?.id === 'minimax' ? 'mobile' : 'desktop',
                suppressed: suppress,
              });
            } catch { /* notifs are best-effort */ }
          })();
        }
      }
    },
    [engine, currentSession, currentAgent, messages, streamRef, chatOptions, activeWorkspace, activeProfile, activeProjectId, modelsStore, historyCache, genTitle, pendingDataRef],
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
    setCurrentSessionTitle(sessions.find(s => s.id === id)?.title ?? null);
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

  /** Attach a file to the next turn. Held in the data ref for the
   *  cloud engine (inlined at send time) and also pushed to the desktop
   *  server out-of-band when connected. `base64Data` is optional and
   *  carries binary bytes for non-text attachments; servers that
   *  implement the extended `attachFile` contract can use it. */
  const attachTextFile = useCallback(async (name: string, content: string, mime?: string, base64Data?: string) => {
    pendingDataRef.current.push({kind: 'file', name, content, mime, dataUri: base64Data ? `data:${mime ?? 'application/octet-stream'};base64,${base64Data}` : undefined});
    if (engine?.id === 'desktop' && currentSession) {
      try {
        await (engine as HermesEngine).attachFile?.(currentSession, {
          name,
          content,
          mime,
          // Servers that support base64 bytes opt into raw delivery by
          // checking this field; legacy attachFile RPCs ignore unknown
          // keys, so passing it is harmless.
          ...(base64Data ? {data: base64Data, encoding: 'base64'} : {}),
        } as any);
      } catch { /* best-effort */ }
    }
  }, [engine, currentSession, pendingDataRef]);

  const attachImageFile = useCallback(async (name: string, base64: string, mime?: string) => {
    const dataUri = base64.startsWith('data:') ? base64 : `data:${mime ?? 'image/jpeg'};base64,${base64}`;
    pendingDataRef.current.push({kind: 'image', name, dataUri, mime});
    if (engine?.id === 'desktop' && currentSession) {
      try {
        await (engine as HermesEngine).attachImage?.(currentSession, {name, data: base64, mime});
      } catch { /* best-effort */ }
    }
  }, [engine, currentSession, pendingDataRef]);

  const addAttachment = useCallback((a: {kind: 'file' | 'image'; name: string; size?: number}) => {
    setPendingAttachments(prev => [...prev, {...a, id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`}]);
  }, []);
  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments(prev => {
      const item = prev.find(a => a.id === id);
      if (item) {
        const idx = pendingDataRef.current.findIndex(d => d.kind === item.kind && d.name === item.name);
        if (idx >= 0) pendingDataRef.current.splice(idx, 1);
      }
      return prev.filter(a => a.id !== id);
    });
  }, [pendingDataRef]);
  const clearAttachments = useCallback(() => {
    pendingDataRef.current = [];
    setPendingAttachments([]);
  }, [pendingDataRef]);

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

  const setProviderConfigs = useCallback(async (map: Record<string, ProviderConfig>) => {
    setProviderConfigsState(map);
    await providerConfigsStore.save(map);
  }, [providerConfigsStore]);

  const upsertProviderConfig = useCallback(async (cfg: Partial<ProviderConfig> & {providerId: string}) => {
    const cur = await providerConfigsStore.load();
    const existing = cur[cfg.providerId] ?? {providerId: cfg.providerId, enabled: false};
    const next = {...cur, [cfg.providerId]: {...existing, ...cfg}};
    setProviderConfigsState(next);
    await providerConfigsStore.save(next);
  }, [providerConfigsStore]);

  const refreshProviderModels = useCallback(async (providerId: string) => {
    const cur = await providerConfigsStore.load();
    const cfg = cur[providerId];
    if (!cfg) return;
    setRefreshingProviders(prev => new Set(prev).add(providerId));
    try {
      const def = PROVIDER_CATALOG.find(p => p.id === providerId);
      if (!def) return;
      const result = await fetchProviderModels(def, {
        apiKey: cfg.apiKey,
        groupId: cfg.groupId,
        baseUrlOverride: cfg.baseUrl,
      });
      const updated: Record<string, ProviderConfig> = {...cur};
      if (result.ok) {
        updated[providerId] = {
          ...cfg,
          models: result.models,
          fetchedAt: Date.now(),
          lastError: undefined,
        };
      } else {
        updated[providerId] = {
          ...cfg,
          lastError: result.error,
        };
      }
      setProviderConfigsState(updated);
      await providerConfigsStore.save(updated);
    } finally {
      setRefreshingProviders(prev => {
        const next = new Set(prev);
        next.delete(providerId);
        return next;
      });
    }
  }, [providerConfigsStore]);

  const refreshAllEnabledProviders = useCallback(async () => {
    const cur = await providerConfigsStore.load();
    const enabled = Object.values(cur).filter(c => c.enabled);
    await Promise.allSettled(enabled.map(c => refreshProviderModels(c.providerId)));
  }, [providerConfigsStore, refreshProviderModels]);

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
    retryConnect,
    logout,
    switchEngine,
    currentSession,
    setCurrentSession,
    currentSessionTitle,
    setCurrentSessionTitle,
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
    providerConfigs,
    setProviderConfigs,
    upsertProviderConfig,
    refreshProviderModels,
    refreshAllEnabledProviders,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
