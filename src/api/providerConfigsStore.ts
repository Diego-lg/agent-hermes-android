/**
 * providerConfigsStore — persisted multi-provider API keys + per-provider
 * model cache. The Models tab reads from this to know which providers are
 * enabled, what keys to use, and what models have already been fetched.
 */
import {kv, STORAGE_KEYS} from './storage';
import {PROVIDER_CATALOG, providerById, ProviderDef, ProviderModel} from './providersCatalog';

export interface ProviderConfig {
  /** Stable provider id (matches PROVIDER_CATALOG). */
  providerId: string;
  enabled: boolean;
  /** Override base URL (defaults to the catalog entry's baseUrl). */
  baseUrl?: string;
  /** API key. Stored as-is (the user already trusts the local device). */
  apiKey?: string;
  /** Optional GroupId for providers that require it. */
  groupId?: string;
  /** Cached models from the last successful fetch. */
  models?: ProviderModel[];
  /** Timestamp of the last successful fetch (ms). */
  fetchedAt?: number;
  /** Last error message (cleared on successful refresh). */
  lastError?: string;
}

export interface ProviderConfigsStore {
  load(): Promise<Record<string, ProviderConfig>>;
  save(map: Record<string, ProviderConfig>): Promise<void>;
  /** Update a single provider config (creates if missing). */
  upsert(cfg: ProviderConfig): Promise<Record<string, ProviderConfig>>;
  /** Remove a provider config (the user disabled it). */
  remove(providerId: string): Promise<Record<string, ProviderConfig>>;
  /** Convenience: get the current map for one provider id. */
  get(providerId: string): Promise<ProviderConfig | undefined>;
}

class StoredProviderConfigs implements ProviderConfigsStore {
  async load(): Promise<Record<string, ProviderConfig>> {
    const raw = await kv.getItem(STORAGE_KEYS.providerConfigs);
    if (!raw) return {};
    try { return JSON.parse(raw) as Record<string, ProviderConfig>; } catch { return {}; }
  }
  async save(map: Record<string, ProviderConfig>): Promise<void> {
    await kv.setItem(STORAGE_KEYS.providerConfigs, JSON.stringify(map));
  }
  async upsert(cfg: ProviderConfig): Promise<Record<string, ProviderConfig>> {
    const cur = await this.load();
    cur[cfg.providerId] = {...(cur[cfg.providerId] ?? {providerId: cfg.providerId}), ...cfg};
    await this.save(cur);
    return cur;
  }
  async remove(providerId: string): Promise<Record<string, ProviderConfig>> {
    const cur = await this.load();
    delete cur[providerId];
    await this.save(cur);
    return cur;
  }
  async get(providerId: string): Promise<ProviderConfig | undefined> {
    const cur = await this.load();
    return cur[providerId];
  }
}

export function makeProviderConfigsStore(): ProviderConfigsStore {
  return new StoredProviderConfigs();
}

/** Default configs — seeded so MiniMax has the saved key from the legacy
 *  config, the rest are off until the user opts in. */
export function buildSeedConfigs(opts: {
  legacyModelApiKey?: string;
  legacyModelBaseUrl?: string;
  legacyModelGroupId?: string;
}): Record<string, ProviderConfig> {
  const seed: Record<string, ProviderConfig> = {};
  // Seed every catalog entry as disabled.
  for (const p of PROVIDER_CATALOG) {
    seed[p.id] = {providerId: p.id, enabled: false};
  }
  // If a legacy MiniMax key is set, auto-enable MiniMax.
  if (opts.legacyModelApiKey && opts.legacyModelApiKey.trim().length > 0) {
    const baseUrl = opts.legacyModelBaseUrl?.trim() || 'https://api.minimax.io/v1';
    // Heuristic: legacy baseUrl contains 'minimax' → MiniMax provider.
    const isMiniMax = baseUrl.includes('minimax') || baseUrl.includes('MiniMax');
    if (isMiniMax) {
      seed.MiniMax = {
        providerId: 'MiniMax',
        enabled: true,
        baseUrl,
        apiKey: opts.legacyModelApiKey.trim(),
        groupId: opts.legacyModelGroupId?.trim() || undefined,
      };
    }
  }
  return seed;
}

/** Compose the full URL the fetcher should use for a given provider config. */
export function effectiveBaseUrl(def: ProviderDef, cfg?: ProviderConfig): string {
  return (cfg?.baseUrl?.trim() || def.baseUrl || '').replace(/\/+$/, '');
}
