/**
 * Industrial design tokens. Single source of truth.
 *
 * Philosophy: Teenage Engineering × Linear × Braun × Rivian HMI.
 * - Pure OLED black background
 * - Two surface tiers, no more
 * - Hairline borders, not cards
 * - Tabular figures for all numerics
 * - 4dp baseline grid
 * - One accent: warm off-white (no other color, ever)
 */
import {Platform} from 'react-native';

const monoFamily = Platform.select({ios: 'Menlo', android: 'monospace', default: 'monospace'});
const displayFamily = Platform.select({ios: 'System', android: 'sans-serif', default: 'System'});

export const palette = {
  // True OLED black
  bg: '#000000',
  // Two surface tiers
  surface: '#0c0c0c',
  surfaceAlt: '#141414',
  // Borders / dividers
  hairline: '#1f1f1f',        // 1px on dark — barely there
  hairlineStrong: '#2a2a2a', // focused state
  // Type
  text: '#e8e8e8',           // primary
  textMuted: '#8a8a8a',      // secondary
  textDim: '#555555',        // tertiary
  textGhost: '#2a2a2a',      // hint / placeholder before typing
  // Single accent — warm off-white for "on" state
  on: '#f5f5f5',
  onDim: '#b8b8b8',
  // Status — muted, single-pixel-LED style
  active: '#d4a84b',         // ochre — connected / thinking
  activeDim: '#d4a84b44',
  error: '#c2593f',          // ember
  errorDim: '#c2593f44',
  // Legacy (kept for backwards compat with existing screens)
  border: '#1f1f1f',
  accent: '#f5f5f5',
  accentMuted: '#ffffff14',
  surfaceHigh: '#1a1a1a',
  borderStrong: '#2a2a2a',
  violet: '#a78bfa',
  success: '#d4a84b',
  warning: '#d4a84b',
  danger: '#c2593f',
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radii = {
  none: 0,
  sm: 2,
  md: 4,
  lg: 6,
  xl: 8,
  pill: 999,
};

export const type = {
  // Display — tight, negative letter-spacing, like a vehicle cluster readout
  display: {
    fontSize: 36,
    fontWeight: '600' as const,
    color: palette.text,
    letterSpacing: -1.2,
    lineHeight: 40,
    fontFamily: displayFamily,
  },
  displaySmall: {
    fontSize: 22,
    fontWeight: '600' as const,
    color: palette.text,
    letterSpacing: -0.6,
    lineHeight: 26,
  },
  // Body
  h1: {
    fontSize: 16, fontWeight: '600' as const,
    color: palette.text, letterSpacing: -0.2, lineHeight: 22,
  },
  h2: {
    fontSize: 14, fontWeight: '600' as const,
    color: palette.text, letterSpacing: -0.1, lineHeight: 20,
  },
  body: {
    fontSize: 13, color: palette.text, lineHeight: 19, letterSpacing: -0.1,
  },
  bodyMuted: {
    fontSize: 13, color: palette.textMuted, lineHeight: 19, letterSpacing: -0.1,
  },
  // Etched label — all-caps, wide tracking, dim — like a label on aluminum
  label: {
    fontSize: 9, color: palette.textDim, letterSpacing: 1.6,
    fontWeight: '600' as const, textTransform: 'uppercase' as const,
  },
  // Mono — IDs, timestamps, raw data
  mono: {
    fontSize: 12, color: palette.text, fontFamily: monoFamily, letterSpacing: 0,
    fontVariant: ['tabular-nums' as const],
  },
  monoMuted: {
    fontSize: 11, color: palette.textMuted, fontFamily: monoFamily, letterSpacing: 0,
    fontVariant: ['tabular-nums' as const],
  },
  // Tabular numerics for stat readouts
  num: {
    fontSize: 28, fontWeight: '600' as const, color: palette.text,
    letterSpacing: -0.8, fontVariant: ['tabular-nums' as const],
    lineHeight: 30,
  },
  numSmall: {
    fontSize: 14, fontWeight: '600' as const, color: palette.text,
    letterSpacing: -0.2, fontVariant: ['tabular-nums' as const],
  },
};
