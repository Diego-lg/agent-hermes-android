/**
 * Design tokens. Six complete design systems the user can switch between.
 *
 * Each theme has the same shape — palette / type / spacing / radii / meta —
 * so screens can do `const {palette, type, spacing, radii} = useTheme()` and
 * the same code renders correctly in all six.
 *
 * The active theme is selected in Settings → Appearance and persisted via
 * AsyncStorage. Live preview: tap a theme card in Settings and the screen
 * re-renders immediately.
 */
import React, {createContext, useContext} from 'react';
import {Platform} from 'react-native';

const monoFamily = Platform.select({ios: 'Menlo', android: 'monospace', default: 'monospace'});
const displayFamily = Platform.select({ios: 'System', android: 'sans-serif', default: 'System'});
const serifFamily = Platform.select({ios: 'Georgia', android: 'serif', default: 'serif'});

/* ============================================================================
 * INDUSTRIAL  —  OLED black, monospace, single warm off-white accent
 * ========================================================================== */

const industrial = {
  id: 'industrial',
  meta: {
    name: 'Industrial',
    tagline: 'OLED black · mono · machined',
    swatches: ['#000000', '#f5f5f5', '#5b6370'] as [string, string, string],
  },
  palette: {
    bg: '#000000',
    surface: '#0c0c0c',
    surfaceAlt: '#141414',
    border: '#1f1f1f',
    borderStrong: '#2a2a2a',
    text: '#e8e8e8',
    textMuted: '#8a8a8a',
    textDim: '#5b6370',
    textGhost: '#2a2a2a',
    accent: '#f5f5f5',
    accentDim: '#b8b8b8',
    accentMuted: '#ffffff14',
    success: '#d4a84b',
    error: '#c2593f',
    highlight: '#d4a84b',
    type: 'mono' as const,
  },
  type: {
    display: {fontSize: 36, fontWeight: '600' as const, letterSpacing: -1.2, lineHeight: 40, fontFamily: displayFamily},
    displaySmall: {fontSize: 22, fontWeight: '600' as const, letterSpacing: -0.6, lineHeight: 26, fontFamily: displayFamily},
    h1: {fontSize: 16, fontWeight: '600' as const, letterSpacing: -0.2, lineHeight: 22, fontFamily: displayFamily},
    h2: {fontSize: 14, fontWeight: '600' as const, letterSpacing: -0.1, lineHeight: 20, fontFamily: displayFamily},
    body: {fontSize: 13, lineHeight: 19, letterSpacing: -0.1, fontFamily: displayFamily},
    bodyMuted: {fontSize: 13, lineHeight: 19, letterSpacing: -0.1, fontFamily: displayFamily},
    label: {fontSize: 9, letterSpacing: 1.6, fontWeight: '600' as const, textTransform: 'uppercase' as const, fontFamily: displayFamily},
    mono: {fontSize: 12, letterSpacing: 0, fontFamily: monoFamily, fontVariant: ['tabular-nums' as const]},
    monoMuted: {fontSize: 11, letterSpacing: 0, fontFamily: monoFamily, fontVariant: ['tabular-nums' as const]},
    num: {fontSize: 28, fontWeight: '600' as const, letterSpacing: -0.8, lineHeight: 30, fontFamily: displayFamily, fontVariant: ['tabular-nums' as const]},
    numSmall: {fontSize: 14, fontWeight: '600' as const, letterSpacing: -0.2, fontFamily: displayFamily, fontVariant: ['tabular-nums' as const]},
  },
  spacing: {xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48},
  radii: {none: 0, sm: 2, md: 4, lg: 6, xl: 8, pill: 999},
};

/* ============================================================================
 * BRUTALIST  —  pure black + white, oversized type, hard edges, mono captions
 * ========================================================================== */

const brutalist = {
  id: 'brutalist',
  meta: {
    name: 'Brutalist',
    tagline: 'Pure B/W · oversized · raw',
    swatches: ['#000000', '#ffffff', '#000000'] as [string, string, string],
  },
  palette: {
    bg: '#000000',
    surface: '#0a0a0a',
    surfaceAlt: '#141414',
    border: '#ffffff',
    borderStrong: '#ffffff',
    text: '#ffffff',
    textMuted: '#b0b0b0',
    textDim: '#707070',
    textGhost: '#303030',
    accent: '#ffffff',
    accentDim: '#b0b0b0',
    accentMuted: '#ffffff14',
    success: '#ffffff',
    error: '#ff4040',
    highlight: '#ffeb3b',
    type: 'mono' as const,
  },
  type: {
    display: {fontSize: 56, fontWeight: '900' as const, letterSpacing: -2, lineHeight: 56, fontFamily: displayFamily, textTransform: 'uppercase' as const},
    displaySmall: {fontSize: 32, fontWeight: '900' as const, letterSpacing: -1, lineHeight: 36, fontFamily: displayFamily, textTransform: 'uppercase' as const},
    h1: {fontSize: 20, fontWeight: '800' as const, letterSpacing: -0.3, lineHeight: 24, fontFamily: displayFamily, textTransform: 'uppercase' as const},
    h2: {fontSize: 16, fontWeight: '800' as const, letterSpacing: -0.1, lineHeight: 20, fontFamily: displayFamily, textTransform: 'uppercase' as const},
    body: {fontSize: 14, lineHeight: 20, letterSpacing: -0.1, fontFamily: displayFamily},
    bodyMuted: {fontSize: 14, lineHeight: 20, letterSpacing: -0.1, fontFamily: displayFamily},
    label: {fontSize: 10, letterSpacing: 2, fontWeight: '700' as const, textTransform: 'uppercase' as const, fontFamily: monoFamily},
    mono: {fontSize: 13, letterSpacing: 0, fontFamily: monoFamily},
    monoMuted: {fontSize: 12, letterSpacing: 0, fontFamily: monoFamily},
    num: {fontSize: 48, fontWeight: '900' as const, letterSpacing: -1.5, lineHeight: 48, fontFamily: displayFamily, fontVariant: ['tabular-nums' as const]},
    numSmall: {fontSize: 16, fontWeight: '800' as const, letterSpacing: 0, fontFamily: displayFamily, fontVariant: ['tabular-nums' as const]},
  },
  spacing: {xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48, xxxl: 64},
  radii: {none: 0, sm: 0, md: 0, lg: 0, xl: 0, pill: 0},
};

/* ============================================================================
 * SOFT GLASS  —  pastel gradients, frosted cards, soft shadows, large radii
 * ========================================================================== */

const softGlass = {
  id: 'softGlass',
  meta: {
    name: 'Soft Glass',
    tagline: 'Pastel · glass · iOS 18',
    swatches: ['#f5f3ff', '#7c9cff', '#1a1d2e'] as [string, string, string],
  },
  palette: {
    bg: '#f0eef9',
    surface: 'rgba(255, 255, 255, 0.72)',
    surfaceAlt: 'rgba(255, 255, 255, 0.55)',
    border: 'rgba(124, 156, 255, 0.18)',
    borderStrong: 'rgba(124, 156, 255, 0.4)',
    text: '#1a1d2e',
    textMuted: '#5a6184',
    textDim: '#9da4c0',
    textGhost: '#d0d4e5',
    accent: '#7c9cff',
    accentDim: '#5a78e6',
    accentMuted: 'rgba(124, 156, 255, 0.15)',
    success: '#34d399',
    error: '#f87171',
    highlight: '#a78bfa',
    type: 'sans' as const,
  },
  type: {
    display: {fontSize: 34, fontWeight: '700' as const, letterSpacing: -1, lineHeight: 40, fontFamily: displayFamily},
    displaySmall: {fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.5, lineHeight: 28, fontFamily: displayFamily},
    h1: {fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.2, lineHeight: 24, fontFamily: displayFamily},
    h2: {fontSize: 15, fontWeight: '600' as const, letterSpacing: -0.1, lineHeight: 20, fontFamily: displayFamily},
    body: {fontSize: 15, lineHeight: 22, letterSpacing: -0.1, fontFamily: displayFamily},
    bodyMuted: {fontSize: 15, lineHeight: 22, letterSpacing: -0.1, fontFamily: displayFamily},
    label: {fontSize: 11, letterSpacing: 1.4, fontWeight: '600' as const, textTransform: 'uppercase' as const, fontFamily: displayFamily},
    mono: {fontSize: 13, letterSpacing: 0, fontFamily: monoFamily},
    monoMuted: {fontSize: 12, letterSpacing: 0, fontFamily: monoFamily},
    num: {fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.6, lineHeight: 32, fontFamily: displayFamily, fontVariant: ['tabular-nums' as const]},
    numSmall: {fontSize: 15, fontWeight: '600' as const, letterSpacing: -0.1, fontFamily: displayFamily, fontVariant: ['tabular-nums' as const]},
  },
  spacing: {xxs: 2, xs: 6, sm: 10, md: 14, lg: 20, xl: 28, xxl: 40, xxxl: 56},
  radii: {none: 0, sm: 8, md: 14, lg: 20, xl: 28, pill: 999},
};

/* ============================================================================
 * EDITORIAL  —  cream background, serif headlines, generous whitespace
 * ========================================================================== */

const editorial = {
  id: 'editorial',
  meta: {
    name: 'Editorial',
    tagline: 'Cream · serif · Substack',
    swatches: ['#faf6ee', '#b1432a', '#2a2a2a'] as [string, string, string],
  },
  palette: {
    bg: '#faf6ee',
    surface: '#f3ede0',
    surfaceAlt: '#ebe3d2',
    border: '#d8cdb3',
    borderStrong: '#b8a878',
    text: '#2a2620',
    textMuted: '#6b5e48',
    textDim: '#9a8c70',
    textGhost: '#c8bda1',
    accent: '#b1432a',
    accentDim: '#8a2f1c',
    accentMuted: 'rgba(177, 67, 42, 0.12)',
    success: '#5a7340',
    error: '#a13828',
    highlight: '#d4a04a',
    type: 'serif' as const,
  },
  type: {
    display: {fontSize: 38, fontWeight: '500' as const, letterSpacing: -0.8, lineHeight: 44, fontFamily: serifFamily},
    displaySmall: {fontSize: 26, fontWeight: '500' as const, letterSpacing: -0.4, lineHeight: 32, fontFamily: serifFamily},
    h1: {fontSize: 18, fontWeight: '600' as const, letterSpacing: -0.1, lineHeight: 24, fontFamily: serifFamily, fontStyle: 'italic' as const},
    h2: {fontSize: 15, fontWeight: '600' as const, letterSpacing: 0, lineHeight: 22, fontFamily: serifFamily},
    body: {fontSize: 15, lineHeight: 24, letterSpacing: 0, fontFamily: serifFamily},
    bodyMuted: {fontSize: 15, lineHeight: 24, letterSpacing: 0, fontFamily: serifFamily},
    label: {fontSize: 10, letterSpacing: 1.8, fontWeight: '700' as const, textTransform: 'uppercase' as const, fontFamily: displayFamily},
    mono: {fontSize: 12, letterSpacing: 0, fontFamily: monoFamily},
    monoMuted: {fontSize: 11, letterSpacing: 0, fontFamily: monoFamily},
    num: {fontSize: 32, fontWeight: '500' as const, letterSpacing: -0.4, lineHeight: 36, fontFamily: serifFamily, fontVariant: ['tabular-nums' as const]},
    numSmall: {fontSize: 15, fontWeight: '500' as const, letterSpacing: 0, fontFamily: serifFamily, fontVariant: ['tabular-nums' as const]},
  },
  spacing: {xxs: 2, xs: 6, sm: 12, md: 18, lg: 24, xl: 36, xxl: 52, xxxl: 72},
  radii: {none: 0, sm: 2, md: 4, lg: 6, xl: 8, pill: 999},
};

/* ============================================================================
 * NEON CYBERPUNK  —  true black, neon cyan/magenta, glow, monospace
 * ========================================================================== */

const neon = {
  id: 'neon',
  meta: {
    name: 'Neon',
    tagline: 'Black · neon · glow',
    swatches: ['#000000', '#00ffff', '#ff00ff'] as [string, string, string],
  },
  palette: {
    bg: '#000000',
    surface: '#080808',
    surfaceAlt: '#0e0e18',
    border: '#1a1a2a',
    borderStrong: '#00ffff',
    text: '#e0e0ff',
    textMuted: '#8080a0',
    textDim: '#50506a',
    textGhost: '#1f1f30',
    accent: '#00ffff',
    accentDim: '#00cccc',
    accentMuted: 'rgba(0, 255, 255, 0.15)',
    success: '#00ff88',
    error: '#ff0066',
    highlight: '#ff00ff',
    type: 'mono' as const,
  },
  type: {
    display: {fontSize: 36, fontWeight: '700' as const, letterSpacing: -0.5, lineHeight: 40, fontFamily: monoFamily, textShadowColor: '#00ffff', textShadowOffset: {width: 0, height: 0}, textShadowRadius: 8} as any,
    displaySmall: {fontSize: 22, fontWeight: '700' as const, letterSpacing: 0, lineHeight: 26, fontFamily: monoFamily},
    h1: {fontSize: 16, fontWeight: '700' as const, letterSpacing: 0.5, lineHeight: 22, fontFamily: monoFamily, textTransform: 'uppercase' as const},
    h2: {fontSize: 14, fontWeight: '600' as const, letterSpacing: 0.3, lineHeight: 20, fontFamily: monoFamily, textTransform: 'uppercase' as const},
    body: {fontSize: 13, lineHeight: 19, letterSpacing: 0, fontFamily: monoFamily},
    bodyMuted: {fontSize: 13, lineHeight: 19, letterSpacing: 0, fontFamily: monoFamily},
    label: {fontSize: 10, letterSpacing: 1.5, fontWeight: '700' as const, textTransform: 'uppercase' as const, fontFamily: monoFamily},
    mono: {fontSize: 12, letterSpacing: 0, fontFamily: monoFamily},
    monoMuted: {fontSize: 11, letterSpacing: 0, fontFamily: monoFamily},
    num: {fontSize: 28, fontWeight: '700' as const, letterSpacing: 0, lineHeight: 30, fontFamily: monoFamily, fontVariant: ['tabular-nums' as const]},
    numSmall: {fontSize: 14, fontWeight: '700' as const, letterSpacing: 0, fontFamily: monoFamily, fontVariant: ['tabular-nums' as const]},
  },
  spacing: {xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48},
  radii: {none: 0, sm: 2, md: 4, lg: 6, xl: 8, pill: 999},
};

/* ============================================================================
 * WARM CLAY  —  earth tones, serif, no pure black, rounded
 * ========================================================================== */

const warmClay = {
  id: 'warmClay',
  meta: {
    name: 'Warm Clay',
    tagline: 'Earth · terracotta · soft',
    swatches: ['#f4ebde', '#c46442', '#2e2a26'] as [string, string, string],
  },
  palette: {
    bg: '#f4ebde',
    surface: '#ede2d0',
    surfaceAlt: '#e0d3bb',
    border: '#d2c1a3',
    borderStrong: '#a08665',
    text: '#2e2a26',
    textMuted: '#6b5d4d',
    textDim: '#9a8c70',
    textGhost: '#cabba1',
    accent: '#c46442',
    accentDim: '#9a4a2e',
    accentMuted: 'rgba(196, 100, 66, 0.15)',
    success: '#5a7340',
    error: '#a13828',
    highlight: '#d4a04a',
    type: 'serif' as const,
  },
  type: {
    display: {fontSize: 34, fontWeight: '500' as const, letterSpacing: -0.6, lineHeight: 40, fontFamily: serifFamily},
    displaySmall: {fontSize: 24, fontWeight: '500' as const, letterSpacing: -0.3, lineHeight: 30, fontFamily: serifFamily},
    h1: {fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.1, lineHeight: 24, fontFamily: serifFamily, fontStyle: 'italic' as const},
    h2: {fontSize: 15, fontWeight: '600' as const, letterSpacing: 0, lineHeight: 22, fontFamily: serifFamily},
    body: {fontSize: 15, lineHeight: 23, letterSpacing: 0, fontFamily: serifFamily},
    bodyMuted: {fontSize: 15, lineHeight: 23, letterSpacing: 0, fontFamily: serifFamily},
    label: {fontSize: 10, letterSpacing: 1.8, fontWeight: '700' as const, textTransform: 'uppercase' as const, fontFamily: displayFamily},
    mono: {fontSize: 12, letterSpacing: 0, fontFamily: monoFamily},
    monoMuted: {fontSize: 11, letterSpacing: 0, fontFamily: monoFamily},
    num: {fontSize: 28, fontWeight: '500' as const, letterSpacing: -0.4, lineHeight: 32, fontFamily: serifFamily, fontVariant: ['tabular-nums' as const]},
    numSmall: {fontSize: 15, fontWeight: '500' as const, letterSpacing: 0, fontFamily: serifFamily, fontVariant: ['tabular-nums' as const]},
  },
  spacing: {xxs: 2, xs: 6, sm: 10, md: 14, lg: 20, xl: 28, xxl: 40, xxxl: 56},
  radii: {none: 0, sm: 8, md: 14, lg: 20, xl: 28, pill: 999},
};

/* ============================================================================
 * Registry + React context
 * ========================================================================== */

export const THEMES = {
  industrial,
  brutalist,
  softGlass,
  editorial,
  neon,
  warmClay,
} as const;

export type ThemeId = keyof typeof THEMES;
export type Theme = (typeof THEMES)[ThemeId];

export const THEME_LIST: Theme[] = Object.values(THEMES);
export const DEFAULT_THEME: ThemeId = 'industrial';

const ThemeContext = createContext<Theme>(industrial);

export const ThemeProvider: React.FC<{theme: Theme; children: React.ReactNode}> = ({theme, children}) => (
  <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
);

/** Hook: read the current theme's tokens from anywhere. */
export const useTheme = (): Theme => useContext(ThemeContext);

/** Helper: get theme by id, falling back to the default. */
export function getTheme(id: string | null | undefined): Theme {
  if (id && (id in THEMES)) return (THEMES as any)[id];
  return industrial;
}
