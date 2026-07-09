/**
 * Persistent storage wrapper. In-memory shim with the same shape as
 * AsyncStorage so swapping in the real module is one import change.
 *
 * The shim survives only for the current app process — that's fine for the
 * MVP. AsyncStorage is added in the same patch when wired up.
 */
export interface KVStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

class MemoryKV implements KVStore {
  private data = new Map<string, string>();
  async getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  async setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  async removeItem(key: string) {
    this.data.delete(key);
  }
}

const _memory = new MemoryKV();

/** Real AsyncStorage — used when the npm package is installed. */
let _real: KVStore | null = null;
try {
  // require lazily so jest/metro only fails at first use, not at import.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-async-storage/async-storage');
  _real = mod.default ?? mod;
} catch {
  _real = null;
}

export const kv: KVStore = _real ?? _memory;

export const STORAGE_KEYS = {
  config: 'hermes.config',
  enabledAgents: 'hermes.enabledAgents',
  recentSessions: 'hermes.recentSessions',
  theme: 'hermes.theme',
  driveTokens: 'hermes.drive.tokens',
  driveConfig: 'hermes.drive.config',
  notes: 'hermes.notes',
  cronJobs: 'hermes.cron',
  serverProfiles: 'hermes.servers',
  // Chat options (per-turn overrides)
  chatOptions: 'hermes.chatOptions',
  // Recents / favorites for the Models tab
  recentModels: 'hermes.recentModels',
  favoriteModels: 'hermes.favoriteModels',
  // Session cache for offline read in the Sessions tab
  sessionCache: 'hermes.sessionCache',
  // Per-session message history, cached for offline reading
  sessionHistory: 'hermes.sessionHistory',
  // Memory read snapshot (read-only panel)
  memorySnapshot: 'hermes.memorySnapshot',
  // Active profile (server-side Hermes profile) and active workspace
  activeProfile: 'hermes.activeProfile',
  activeWorkspace: 'hermes.activeWorkspace',
  // Multi-provider API key + per-provider model cache
  providerConfigs: 'hermes.providerConfigs',
  // MiniMax voice assistant settings (TTS model, voice, cloned voice, etc.)
  voiceSettings: 'hermes.voiceSettings',
  // Group Chat: user-created/cloned personalities (built-ins live in code)
  personalities: 'hermes.personalities',
  // Group Chat: saved group configurations (rosters, mode, voice toggle)
  groups: 'hermes.groups',
  // LAN discovery cache (last-scan results)
  discoveredHosts: 'hermes.discoveredHosts',
} as const;
