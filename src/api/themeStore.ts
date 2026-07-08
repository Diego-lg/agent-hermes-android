/**
 * Theme store — single source of truth for which theme is active.
 *
 * Persisted via AsyncStorage (`hermes.theme`). Default = industrial.
 * Updated in real time by Settings → Appearance.
 */
import {kv, STORAGE_KEYS} from './storage';
import {Theme, ThemeId, DEFAULT_THEME, getTheme} from '../ui/theme';

export const themeStore = {
  async load(): Promise<ThemeId> {
    const raw = await kv.getItem(STORAGE_KEYS.theme);
    if (!raw) return DEFAULT_THEME;
    return (raw as ThemeId) || DEFAULT_THEME;
  },
  async save(id: ThemeId): Promise<void> {
    await kv.setItem(STORAGE_KEYS.theme, id);
  },
  resolve(id: ThemeId | null | undefined): Theme {
    return getTheme(id);
  },
};
