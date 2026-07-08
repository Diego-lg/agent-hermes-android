/**
 * Persisted app config: Hermes server host, port, and last-used credentials.
 *
 * Backed by the storage shim (memory now, AsyncStorage on device). For an MVP
 * the password lives in the same store as the host; a real release should
 * move it to the Android Keystore via react-native-keychain.
 */
import {kv, STORAGE_KEYS} from './storage';

export interface AppConfig {
  host: string;
  port: number;
  username: string;
  password: string;
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
}

const DEFAULT_CONFIG: AppConfig = {
  host: '192.168.18.54',
  port: 9119,
  username: 'diego',
  password: 'Maggiemon',
  modelBaseUrl: 'https://api.minimax.io/v1',
  modelId: 'MiniMax-Text-01',
  engineMode: 'auto',
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
