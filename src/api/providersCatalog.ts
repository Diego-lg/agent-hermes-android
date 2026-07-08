/**
 * providersCatalog — registry of LLM providers the Models screen can pull
 * live model lists from.
 *
 * Each provider declares:
 *   - id / label                       stable identifier and display name
 *   - baseUrl                          base URL for the API
 *   - listPath                         path to the models-list endpoint
 *   - authHeader / authPrefix          how to attach the API key
 *   - needsGroupId                     whether the provider requires a GroupId header
 *   - anthropicVersion                 if set, sent as `anthropic-version`
 *   - modelsParser                     which response shape to expect
 *   - defaultModelId                   hint when the picker is empty
 *   - responseShape                    one of: openai | anthropic | google | ollama
 *
 * The fetcher (`fetchProviderModels`) handles all four shapes and returns
 * a normalized `ProviderModel[]` sorted by id.
 */

export type ProviderResponseShape = 'openai' | 'anthropic' | 'google' | 'ollama';

export interface ProviderDef {
  id: string;
  label: string;
  baseUrl: string;
  listPath: string;
  authHeader: string;
  authPrefix: string;
  needsGroupId: boolean;
  anthropicVersion?: string;
  responseShape: ProviderResponseShape;
  defaultModelId?: string;
  /** Human-friendly note shown in the UI. */
  description?: string;
}

export const PROVIDER_CATALOG: ProviderDef[] = [
  {
    id: 'MiniMax',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.io/v1',
    listPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    needsGroupId: true,
    responseShape: 'openai',
    defaultModelId: 'MiniMax-Text-01',
    description: 'Anthropic-compatible /v1/models + GroupId header required for abab/M-series.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    listPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    needsGroupId: false,
    responseShape: 'openai',
    defaultModelId: 'gpt-4o',
    description: 'OpenAI /v1/models (gpt-*, o1-*, omni-*).',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    listPath: '/models',
    authHeader: 'x-api-key',
    authPrefix: '',
    needsGroupId: false,
    anthropicVersion: '2023-06-01',
    responseShape: 'anthropic',
    defaultModelId: 'claude-sonnet-4',
    description: 'Anthropic /v1/models (claude-*-*). Uses x-api-key header.',
  },
  {
    id: 'google',
    label: 'Google AI',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    listPath: '/models',
    authHeader: 'x-goog-api-key',
    authPrefix: '',
    needsGroupId: false,
    responseShape: 'google',
    defaultModelId: 'gemini-2.5-pro',
    description: 'Google AI Studio /v1beta/models (gemini-*).',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    listPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    needsGroupId: false,
    responseShape: 'openai',
    defaultModelId: 'openai/gpt-4o',
    description: 'OpenRouter catalog (cross-provider).',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    listPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    needsGroupId: false,
    responseShape: 'openai',
    defaultModelId: 'llama-3.3-70b-versatile',
    description: 'Groq hosted open-source models.',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    listPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    needsGroupId: false,
    responseShape: 'openai',
    defaultModelId: 'mistral-large-latest',
    description: 'Mistral AI (mistral-*, codestral-*, mixtral-*).',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    listPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    needsGroupId: false,
    responseShape: 'openai',
    defaultModelId: 'deepseek-chat',
    description: 'DeepSeek (deepseek-chat, deepseek-reasoner).',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://10.0.2.2:11434/v1',
    listPath: '/models',
    authHeader: '',
    authPrefix: '',
    needsGroupId: false,
    responseShape: 'ollama',
    description: 'Local Ollama. 10.0.2.2 routes to host loopback from the emulator.',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    baseUrl: 'http://10.0.2.2:1234/v1',
    listPath: '/models',
    authHeader: '',
    authPrefix: '',
    needsGroupId: false,
    responseShape: 'openai',
    description: 'Local LM Studio OpenAI-compatible endpoint.',
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    baseUrl: '',
    listPath: '/models',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    needsGroupId: false,
    responseShape: 'openai',
    description: 'Any OpenAI-compatible /v1/models endpoint — set baseUrl + key.',
  },
];

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDER_CATALOG.find(p => p.id === id);
}

export interface ProviderModel {
  id: string;
  label?: string;
  ownedBy?: string;
  raw?: any;
}

/**
 * Fetch the model list for a provider using the saved config.
 * Returns `{ ok: true, models }` or `{ ok: false, error }`.
 *
 * Used by ModelsScreen and the ProviderConfigsScreen.
 */
export async function fetchProviderModels(
  provider: ProviderDef,
  opts: {apiKey?: string; groupId?: string; baseUrlOverride?: string; timeoutMs?: number} = {},
): Promise<{ok: true; models: ProviderModel[]} | {ok: false; error: string; status?: number}> {
  const apiKey = opts.apiKey?.trim();
  const groupId = opts.groupId?.trim();
  const baseUrl = (opts.baseUrlOverride?.trim() || provider.baseUrl || '').replace(/\/+$/, '');
  const timeoutMs = opts.timeoutMs ?? 12000;

  if (!baseUrl) {
    return {ok: false, error: 'No base URL configured.'};
  }
  if (provider.authHeader && provider.authHeader !== '' && !apiKey && provider.id !== 'ollama' && provider.id !== 'lmstudio') {
    return {ok: false, error: 'API key required for this provider.'};
  }

  const url = `${baseUrl}${provider.listPath.startsWith('/') ? provider.listPath : '/' + provider.listPath}`;
  const headers: Record<string, string> = {Accept: 'application/json'};

  if (apiKey) {
    if (provider.authHeader === 'x-goog-api-key') {
      headers['x-goog-api-key'] = apiKey;
    } else if (provider.authHeader === 'x-api-key') {
      headers['x-api-key'] = apiKey;
    } else if (provider.authHeader) {
      headers[provider.authHeader] = `${provider.authPrefix ? provider.authPrefix + ' ' : ''}${apiKey}`;
    }
  }
  if (groupId) {
    headers['GroupId'] = groupId;
  }
  if (provider.anthropicVersion) {
    headers['anthropic-version'] = provider.anthropicVersion;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {method: 'GET', headers, signal: ctrl.signal});
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {ok: false, status: res.status, error: `HTTP ${res.status}: ${body.slice(0, 200)}`};
    }
    const data = await res.json().catch(() => ({}));
    const models = parseModels(provider.responseShape, data);
    return {ok: true, models};
  } catch (e: any) {
    const msg = e?.name === 'AbortError'
      ? `Timed out after ${timeoutMs}ms`
      : (e?.message ?? String(e));
    return {ok: false, error: msg};
  } finally {
    clearTimeout(timer);
  }
}

function parseModels(shape: ProviderResponseShape, data: any): ProviderModel[] {
  const out: ProviderModel[] = [];
  if (shape === 'openai') {
    const list = (data?.data ?? data?.models ?? []) as any[];
    for (const m of list) {
      const id = m?.id ?? m?.name ?? m?.model;
      if (!id || typeof id !== 'string') continue;
      out.push({
        id,
        label: m?.display_name ?? m?.name,
        ownedBy: m?.owned_by ?? m?.ownedBy ?? deriveOwner(id),
        raw: m,
      });
    }
  } else if (shape === 'anthropic') {
    const list = (data?.data ?? []) as any[];
    for (const m of list) {
      const id = m?.id;
      if (!id) continue;
      out.push({
        id,
        label: m?.display_name,
        ownedBy: 'anthropic',
        raw: m,
      });
    }
  } else if (shape === 'google') {
    const list = (data?.models ?? []) as any[];
    for (const m of list) {
      // Gemini's `name` is like "models/gemini-2.5-pro" — strip the prefix.
      const rawName = m?.name ?? '';
      const id = rawName.startsWith('models/') ? rawName.slice('models/'.length) : rawName;
      if (!id) continue;
      out.push({
        id,
        label: m?.displayName,
        ownedBy: 'google',
        raw: m,
      });
    }
  } else if (shape === 'ollama') {
    const list = (data?.models ?? data?.data ?? []) as any[];
    for (const m of list) {
      const id = m?.name ?? m?.id;
      if (!id) continue;
      out.push({
        id,
        label: m?.details?.family ?? m?.details?.parameter_size,
        ownedBy: 'ollama',
        raw: m,
      });
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** Guess the provider family from a model id when the API doesn't tell us. */
function deriveOwner(id: string): string {
  if (!id) return '';
  const head = id.split(/[-_/:.]/, 1)[0].toLowerCase();
  if (head === 'gpt' || head === 'o1' || head === 'o3' || head === 'o4' || head === 'omni') return 'openai';
  if (head === 'claude') return 'anthropic';
  if (head === 'gemini' || head === 'palm') return 'google';
  if (head === 'MiniMax' || head === 'abab') return 'MiniMax';
  if (head === 'llama' || head === 'mistral' || head === 'mixtral' || head === 'codestral') return 'meta';
  if (head === 'deepseek') return 'deepseek';
  return head;
}
