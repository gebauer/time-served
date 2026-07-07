/**
 * Theme — one accent color per concept (JOBS.md J8): sun-yellow for day-lock,
 * moon-blue for night-lock, neutral slate for chrome. Light and dark palettes,
 * selected via `useColorScheme` (react-native core — allowed in ui/).
 */
import { useColorScheme, type TextStyle } from 'react-native';

export interface Palette {
  /** Day-lock accent (sun-yellow). */
  readonly day: string;
  readonly dayMuted: string;
  /** Night-lock accent (moon-blue). */
  readonly night: string;
  readonly nightMuted: string;
  /** Screen background. */
  readonly background: string;
  /** Card / elevated surface. */
  readonly surface: string;
  /** Slightly raised surface (chips, tracks, inputs). */
  readonly surfaceAlt: string;
  readonly border: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textFaint: string;
  /** Primary action (slate-derived, deliberately not day/night colored). */
  readonly action: string;
  readonly onAction: string;
  readonly danger: string;
  /** Positive/active state (ACTIVE session). */
  readonly positive: string;
}

export const lightPalette: Palette = {
  day: '#F5B942',
  dayMuted: '#FBE6BC',
  night: '#4A6FA5',
  nightMuted: '#CBD8EA',
  background: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceAlt: '#EBEDF0',
  border: '#DDE0E5',
  text: '#1D2530',
  textMuted: '#5B6672',
  textFaint: '#8B96A3',
  action: '#2F3E51',
  onAction: '#FFFFFF',
  danger: '#B4432F',
  positive: '#3D7A4E',
};

export const darkPalette: Palette = {
  day: '#E8AE3D',
  dayMuted: '#4A3D1F',
  night: '#6E93C7',
  nightMuted: '#26344A',
  background: '#12161C',
  surface: '#1B222B',
  surfaceAlt: '#252E3A',
  border: '#313B48',
  text: '#E8ECF1',
  textMuted: '#A3AEBB',
  textFaint: '#6D7885',
  action: '#C4CFDC',
  onAction: '#171E27',
  danger: '#D97663',
  positive: '#6FAE81',
};

/** 4-pt spacing scale — the only spacing values components use. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const typography: Record<
  'title' | 'heading' | 'body' | 'caption' | 'mono' | 'display',
  TextStyle
> = {
  title: { fontSize: 24, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  caption: { fontSize: 13, fontWeight: '400' },
  mono: { fontSize: 13, fontFamily: 'monospace' },
  /** Large elapsed/countdown readout on Home. */
  display: { fontSize: 44, fontWeight: '700', fontVariant: ['tabular-nums'] },
};

export interface Theme {
  readonly colors: Palette;
  readonly dark: boolean;
}

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  return { colors: dark ? darkPalette : lightPalette, dark };
}
