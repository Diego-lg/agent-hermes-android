/**
 * chatOptionsStore — persistence for per-turn chat options (model, reasoning,
 * workspace, profile, agent) plus the recents/favorites used by the Models
 * tab and a session cache for the Sessions tab.
 *
 * Everything here is local-only — the server doesn't know about these keys.
 * The engine reads them via PromptOptions at submit-time.
 */
import {kv, STORAGE_KEYS} from './storage';
import type {PromptOptions, ChatMessage} from './hermesClient';

export interface ChatOptions extends PromptOptions {
  /** Optional agent preset id (pc-controller / coder / researcher / …). */
  agentId?: string;
  /** Display-only label for the chip row, e.g. "auto". */
  modelLabel?: string;
}

const DEFAULT_OPTS: ChatOptions = {
  modelLabel: 'auto',
  reasoningEffort: 'medium',
};

export interface ChatOptionsStore {
  load(): Promise<ChatOptions>;
  save(opts: ChatOptions): Promise<void>;
  /** Patch a single field (and persist). */
  patch<K extends keyof ChatOptions>(key: K, value: ChatOptions[K]): Promise<void>;
  /** Reset to defaults. */
  reset(): Promise<void>;
}

class StoredChatOptions implements ChatOptionsStore {
  async load(): Promise<ChatOptions> {
    const raw = await kv.getItem(STORAGE_KEYS.chatOptions);
    if (!raw) return {...DEFAULT_OPTS};
    try {
      const parsed = JSON.parse(raw) as Partial<ChatOptions>;
      return {...DEFAULT_OPTS, ...parsed};
    } catch {
      return {...DEFAULT_OPTS};
    }
  }
  async save(opts: ChatOptions): Promise<void> {
    await kv.setItem(STORAGE_KEYS.chatOptions, JSON.stringify(opts));
  }
  async patch<K extends keyof ChatOptions>(key: K, value: ChatOptions[K]): Promise<void> {
    const cur = await this.load();
    cur[key] = value;
    await this.save(cur);
  }
  async reset(): Promise<void> {
    await kv.removeItem(STORAGE_KEYS.chatOptions);
  }
}

export function makeChatOptionsStore(): ChatOptionsStore {
  return new StoredChatOptions();
}

/* ---------------------------------------------------------------------------
 * Model recents + favorites (separate from chat options so they survive a
 * chat-options reset).
 * -------------------------------------------------------------------------*/

const MAX_RECENTS = 8;
const MAX_FAVORITES = 16;

export interface ModelsListStore {
  getRecents(): Promise<string[]>;
  getFavorites(): Promise<string[]>;
  pushRecent(model: string): Promise<void>;
  toggleFavorite(model: string): Promise<boolean>;  // returns new state
  isFavorite(model: string): Promise<boolean>;
}

class StoredModelsList implements ModelsListStore {
  async getRecents(): Promise<string[]> {
    const raw = await kv.getItem(STORAGE_KEYS.recentModels);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }
  async getFavorites(): Promise<string[]> {
    const raw = await kv.getItem(STORAGE_KEYS.favoriteModels);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }
  async pushRecent(model: string): Promise<void> {
    if (!model) return;
    const cur = await this.getRecents();
    const next = [model, ...cur.filter(m => m !== model)].slice(0, MAX_RECENTS);
    await kv.setItem(STORAGE_KEYS.recentModels, JSON.stringify(next));
  }
  async toggleFavorite(model: string): Promise<boolean> {
    const favs = await this.getFavorites();
    const idx = favs.indexOf(model);
    if (idx >= 0) {
      const next = favs.filter(m => m !== model);
      await kv.setItem(STORAGE_KEYS.favoriteModels, JSON.stringify(next));
      return false;
    }
    const next = [...favs, model].slice(0, MAX_FAVORITES);
    await kv.setItem(STORAGE_KEYS.favoriteModels, JSON.stringify(next));
    return true;
  }
  async isFavorite(model: string): Promise<boolean> {
    const favs = await this.getFavorites();
    return favs.includes(model);
  }
}

export function makeModelsListStore(): ModelsListStore {
  return new StoredModelsList();
}

/* ---------------------------------------------------------------------------
 * Session cache — used by SessionsScreen when the server is unreachable so
 * the user can still browse past conversations offline.
 * -------------------------------------------------------------------------*/

import type {SessionSummary} from './hermesClient';

const MAX_CACHED_SESSIONS = 50;

export interface SessionCacheStore {
  load(): Promise<SessionSummary[]>;
  save(list: SessionSummary[]): Promise<void>;
  upsert(s: SessionSummary): Promise<SessionSummary[]>;
  remove(id: string): Promise<SessionSummary[]>;
}

class StoredSessionCache implements SessionCacheStore {
  async load(): Promise<SessionSummary[]> {
    const raw = await kv.getItem(STORAGE_KEYS.sessionCache);
    if (!raw) return [];
    try { return JSON.parse(raw) as SessionSummary[]; } catch { return []; }
  }
  async save(list: SessionSummary[]): Promise<void> {
    await kv.setItem(STORAGE_KEYS.sessionCache, JSON.stringify(list.slice(0, MAX_CACHED_SESSIONS)));
  }
  async upsert(s: SessionSummary): Promise<SessionSummary[]> {
    const cur = await this.load();
    const idx = cur.findIndex(x => x.id === s.id);
    if (idx >= 0) cur[idx] = {...cur[idx], ...s};
    else cur.unshift(s);
    const next = cur.slice(0, MAX_CACHED_SESSIONS);
    await this.save(next);
    return next;
  }
  async remove(id: string): Promise<SessionSummary[]> {
    const cur = await this.load();
    const next = cur.filter(x => x.id !== id);
    await this.save(next);
    return next;
  }
}

export function makeSessionCacheStore(): SessionCacheStore {
  return new StoredSessionCache();
}

/* ---------------------------------------------------------------------------
 * Session history cache — stores the actual messages of recent conversations
 * so a session opens (read-only) even when the desktop server is unreachable.
 *
 * Layout: one storage key holds a map of { [sessionId]: CachedHistory }. We
 * keep the most-recently-cached MAX_CACHED_HISTORIES sessions and cap each to
 * the last MAX_MESSAGES_PER_SESSION turns so the blob stays small.
 * -------------------------------------------------------------------------*/

const MAX_CACHED_HISTORIES = 30;
const MAX_MESSAGES_PER_SESSION = 200;

export interface CachedHistory {
  sessionId: string;
  title?: string;
  messages: ChatMessage[];
  /** ms since epoch, when this snapshot was written. */
  cachedAt: number;
}

export interface SessionHistoryCacheStore {
  get(sessionId: string): Promise<CachedHistory | null>;
  put(sessionId: string, messages: ChatMessage[], title?: string): Promise<void>;
  remove(sessionId: string): Promise<void>;
  clear(): Promise<void>;
}

class StoredSessionHistoryCache implements SessionHistoryCacheStore {
  private async readAll(): Promise<Record<string, CachedHistory>> {
    const raw = await kv.getItem(STORAGE_KEYS.sessionHistory);
    if (!raw) return {};
    try { return JSON.parse(raw) as Record<string, CachedHistory>; } catch { return {}; }
  }

  private async writeAll(map: Record<string, CachedHistory>): Promise<void> {
    // Evict the oldest snapshots beyond the cap (LRU by cachedAt).
    const entries = Object.values(map).sort((a, b) => b.cachedAt - a.cachedAt);
    const kept = entries.slice(0, MAX_CACHED_HISTORIES);
    const next: Record<string, CachedHistory> = {};
    for (const e of kept) next[e.sessionId] = e;
    await kv.setItem(STORAGE_KEYS.sessionHistory, JSON.stringify(next));
  }

  async get(sessionId: string): Promise<CachedHistory | null> {
    const all = await this.readAll();
    return all[sessionId] ?? null;
  }

  async put(sessionId: string, messages: ChatMessage[], title?: string): Promise<void> {
    if (!sessionId || !messages || messages.length === 0) return;
    const all = await this.readAll();
    const trimmed = messages.slice(-MAX_MESSAGES_PER_SESSION);
    all[sessionId] = {
      sessionId,
      title: title ?? all[sessionId]?.title,
      messages: trimmed,
      cachedAt: Date.now(),
    };
    await this.writeAll(all);
  }

  async remove(sessionId: string): Promise<void> {
    const all = await this.readAll();
    if (all[sessionId]) {
      delete all[sessionId];
      await this.writeAll(all);
    }
  }

  async clear(): Promise<void> {
    await kv.removeItem(STORAGE_KEYS.sessionHistory);
  }
}

export function makeSessionHistoryCacheStore(): SessionHistoryCacheStore {
  return new StoredSessionHistoryCache();
}
