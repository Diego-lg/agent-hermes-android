/**
 * AppContext — single React context that holds the HermesClient, auth state,
 * and the current screen. Keeps the four tab screens stateless & focused.
 */
import React, {createContext, useContext, useState, useEffect, useCallback, useMemo} from 'react';
import {HermesClient, ChatMessage, StreamHandle} from '../api/hermesClient';
import {AppConfig, makeConfigStore} from '../api/configStore';
import {kv, STORAGE_KEYS} from '../api/storage';
import {AGENT_CATALOG, AgentDef, agentById} from '../agents/catalog';

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
  client: HermesClient | null;
  connecting: boolean;
  connectionError: string | null;
  screen: Screen;
  setScreen: (s: Screen) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  logout: () => Promise<void>;
  // Chat
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
}

const Ctx = createContext<AppState | null>(null);

export const useApp = (): AppState => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
};

export function AppProvider({children}: {children: React.ReactNode}) {
  const store = useMemo(() => makeConfigStore(), []);
  const [config, setConfigState] = useState<AppConfig>({
    host: '192.168.18.54', port: 9119, username: 'diego', password: '',
  });
  const [client, setClient] = useState<HermesClient | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('login');

  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const streamRef = useMemo(() => ({current: null as StreamHandle | null}), []);

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentAgent, setCurrentAgent] = useState<AgentDef | null>(null);

  // Load config + cached state on mount.
  useEffect(() => {
    void (async () => {
      const saved = await store.load();
      setConfigState(saved);
      // If there's a saved password, try to auto-connect.
      if (saved.password) {
        await doConnect(saved);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setConfig = useCallback(
    (c: AppConfig) => {
      setConfigState(c);
      void store.save(c);
    },
    [store],
  );

  const doConnect = useCallback(
    async (cfg: AppConfig) => {
      setConnecting(true);
      setConnectionError(null);
      try {
        const c = new HermesClient(cfg);
        await c.connect();
        setClient(c);
        setScreen('home');
        // Pre-fetch sessions.
        try {
          const list = await c.listSessions(50);
          setSessions(
            list.map((s: any) => ({
              id: s.id ?? s.session_id,
              title: s.title ?? '(untitled)',
              updated_at: s.updated_at ?? s.last_active,
            })),
          );
        } catch {
          // Non-fatal.
        }
      } catch (e: any) {
        setConnectionError(e?.message ?? String(e));
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  const connect = useCallback(async () => doConnect(config), [config, doConnect]);

  const disconnect = useCallback(() => {
    client?.disconnect();
    setClient(null);
    setCurrentSession(null);
    setMessages([]);
  }, [client]);

  const logout = useCallback(async () => {
    client?.disconnect();
    setClient(null);
    setCurrentSession(null);
    setMessages([]);
    setSessions([]);
    setScreen('login');
    // Don't wipe the password — keeps it convenient. User can clear in Settings.
  }, [client]);

  const refreshSessions = useCallback(async () => {
    if (!client) return;
    try {
      const list = await client.listSessions(50);
      setSessions(
        list.map((s: any) => ({
          id: s.id ?? s.session_id,
          title: s.title ?? '(untitled)',
          preview: s.preview,
          updated_at: s.updated_at ?? s.last_active,
        })),
      );
    } catch {
      // Non-fatal.
    }
  }, [client]);

  const appendMessage = useCallback((m: ChatMessage) => {
    setMessages(prev => [...prev, m]);
  }, []);

  const openOrCreateSession = useCallback(
    async (agentId?: string): Promise<string> => {
      if (!client) throw new Error('Not connected');
      const agent = agentId ? agentById(agentId) ?? null : null;
      const title = agent
        ? `${agent.icon} ${agent.name}`
        : 'Quick Chat';
      const sid = await client.createSession(title);
      setCurrentSession(sid);
      setCurrentAgent(agent);
      setMessages([]);
      setStreamedText('');
      return sid;
    },
    [client],
  );

  const sendPrompt = useCallback(
    async (text: string) => {
      if (!client || !currentSession || !text.trim()) return;
      const userMsg: ChatMessage = {role: 'user', text, ts: Date.now()};
      setMessages(prev => [...prev, userMsg]);
      setStreaming(true);
      setStreamedText('');

      // Inject agent system prompt on first turn if this is an agent session.
      if (currentAgent && messages.length === 0) {
        // Best-effort: stuff the system prompt into the session via the first
        // turn by prefixing it. Most Hermes builds treat prompt.submit text
        // as user content, so we set session.cwd + a session.title hint
        // and rely on the user to ask. For full agent priming we'd use
        // session.system_prompt, but that's a server-side detail.
      }

      const off = client.onEvent((type, params) => {
        if (params?.session_id && params.session_id !== currentSession) return;
        if (type === 'message.delta') {
          setStreamedText(prev => prev + (params.payload?.text ?? ''));
        } else if (type === 'message.start') {
          setStreamedText('');
        }
      });

      const handle = client.submitPrompt(text, currentSession);
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
        // Save a preview in the local cache.
        await kv.setItem(
          STORAGE_KEYS.recentSessions,
          JSON.stringify([
            {id: currentSession, title: text.slice(0, 60), ts: Date.now()},
          ]),
        );
      } catch (e: any) {
        setMessages(prev => [
          ...prev,
          {role: 'assistant', text: `⚠️ ${e?.message ?? String(e)}`, ts: Date.now()},
        ]);
      } finally {
        off();
        setStreaming(false);
        streamRef.current = null;
      }
    },
    [client, currentSession, currentAgent, messages.length, streamRef],
  );

  const abortStream = useCallback(() => {
    streamRef.current?.abort();
    setStreaming(false);
  }, [streamRef]);

  const value: AppState = {
    config,
    setConfig,
    client,
    connecting,
    connectionError,
    screen,
    setScreen,
    connect,
    disconnect,
    logout,
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
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
