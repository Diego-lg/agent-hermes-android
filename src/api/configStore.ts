/**
 * Persisted app config: Hermes server host, port, and any optional auth.
 *
 * Backed by AsyncStorage on device, an in-memory shim in tests. As of the
 * "no login wall" change, `username`/`password` are optional and default
 * to empty — the phone boots into the app and connects in passwordless
 * mode. Set them in Settings → Connection if the desktop server has the
 * basic-auth provider enabled and you want to send credentials.
 */
import {kv, STORAGE_KEYS} from './storage';

/**
 * Per-capability toggle for YOLO / Independent mode. When `yoloMode` is
 * `true`, every capability below is treated as allowed and the engine
 * should request the corresponding runtime permission on first use. When
 * `false`, individual rows can still be ticked on a case-by-case basis.
 */
export interface YoloCapabilities {
  internet: boolean;     // always true — kept here for shape stability
  files: boolean;
  photos: boolean;
  camera: boolean;
  microphone: boolean;
  location: boolean;
  notifications: boolean;
  contacts: boolean;
  calendar: boolean;
  phone: boolean;
}

export interface AppConfig {
  host: string;
  port: number;
  /** Optional basic-auth username. Empty by default — no login wall. */
  username?: string;
  /**
   * Optional basic-auth password. Empty by default. When empty, the
   * client skips `/auth/password-login` and goes straight to ws-ticket.
   * The desktop server in loopback / `--insecure` mode serves the ticket
   * endpoint without a session cookie, so passwordless = direct entry.
   */
  password?: string;
  /** Direct OpenAI-compatible model API key (used when server is offline). */
  modelApiKey?: string;
  /** Base URL of the model API. Defaults to https://api.minimax.io/v1. */
  modelBaseUrl?: string;
  /** Model identifier sent to the model API. */
  modelId?: string;
  /** User-selected engine: auto (probe), desktop (server-pinned), minimax (cloud-pinned). */
  engineMode?: 'auto' | 'desktop' | 'minimax';
  /** Optional GroupId sent as `GroupId:` header. Required by some MiniMax
   *  model series (e.g. abab/M-series) for /models + /chat/completions. */
  modelGroupId?: string;
  /** Master YOLO switch. When true, every YOLO capability is allowed. The
   *  `yoloCapabilities` map is the user's per-capability override — when
   *  YOLO is on, those overrides don't apply (master wins). When YOLO is
   *  off, the per-cap map tells us which subsets are still allowed. */
  yoloMode?: boolean;
  /** Per-capability opt-ins, used when YOLO is off. */
  yoloCapabilities?: Partial<YoloCapabilities>;
}

const DEFAULT_CONFIG: AppConfig = {
  host: '192.168.18.54',
  port: 9119,
  username: '',
  password: '',
  modelBaseUrl: 'https://api.minimax.io/v1',
  modelId: 'MiniMax-Text-01',
  engineMode: 'auto',
  /** YOLO ON by default — independent mobile mode grants the agent
   *  everything. The user can dial it back from Settings → YOLO. */
  yoloMode: true,
  yoloCapabilities: {
    files: true,
    photos: true,
    camera: true,
    microphone: true,
    location: true,
    notifications: true,
    contacts: true,
    calendar: true,
    phone: true,
  },
};

export interface ConfigStore {
  load(): Promise<AppConfig>;
  save(cfg: AppConfig): Promise<void>;
  clear(): Promise<void>;
}

class StoredConfigStore implements ConfigStore {
  async load(): Promise<AppConfig> {
    const raw = await kv.getItem(STORAGE_KEYS.config);
    if (!raw) return {...DEFAULT_CONFIG};
    try {
      const parsed = JSON.parse(raw) as Partial<AppConfig>;
      return {...DEFAULT_CONFIG, ...parsed};
    } catch {
      return {...DEFAULT_CONFIG};
    }
  }
  async save(cfg: AppConfig): Promise<void> {
    await kv.setItem(STORAGE_KEYS.config, JSON.stringify(cfg));
  }
  async clear(): Promise<void> {
    await kv.removeItem(STORAGE_KEYS.config);
  }
}

export function makeConfigStore(): ConfigStore {
  return new StoredConfigStore();
}
