/**
 * Theme store — single source of truth for which theme is active.
 *
 * Persisted via AsyncStorage (`hermes.theme`). Default = industrial.
 * Updated in real time by Settings → Appearance.
 */
import {kv, STORAGE_KEYS} from './storage';
import {Theme, ThemeId, DEFAULT_THEME, getTheme, THEMES} from '../ui/theme';

export const themeStore = {
  async load(): Promise<ThemeId> {
    const raw = await kv.getItem(STORAGE_KEYS.theme);
    if (!raw) return DEFAULT_THEME;
    // Validate against the registry — anything else falls back to default.
    const valid = Object.keys(THEMES).includes(raw);
    return (valid ? raw : DEFAULT_THEME) as ThemeId;
  },
  async save(id: ThemeId): Promise<void> {
    await kv.setItem(STORAGE_KEYS.theme, id);
  },
  resolve(id: ThemeId | null | undefined): Theme {
    return getTheme(id);
  },
};
