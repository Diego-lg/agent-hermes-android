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
}

const DEFAULT_CONFIG: AppConfig = {
  host: '192.168.18.54',
  port: 9119,
  username: 'diego',
  password: 'Maggiemon',
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
