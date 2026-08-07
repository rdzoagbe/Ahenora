// A trimmed-down version of the Household-COO palette, retuned for a gym app:
// dark by default (the gym is a dark-mode context), with an energetic accent.

export type ResolvedAppearance = 'dark' | 'light';

export interface AppTheme {
  mode: ResolvedAppearance;
  colors: {
    bg: string;
    bgElevated: string;
    bgSoft: string;
    card: string;
    cardBorder: string;
    text: string;
    textMuted: string;
    textSoft: string;
    tabBar: string;
    tabBorder: string;
    accent: string;
    accentInk: string;
    accentSoft: string;
    success: string;
    warning: string;
    danger: string;
    onAccent: string;
  };
}

export const darkTheme: AppTheme = {
  mode: 'dark',
  colors: {
    bg: '#0C0F14',
    bgElevated: '#141A22',
    bgSoft: '#1C2530',
    card: '#141A22',
    cardBorder: 'rgba(255,255,255,0.09)',
    text: '#F5F8FC',
    textMuted: '#C2CBD6',
    textSoft: '#8A97A6',
    tabBar: '#10151C',
    tabBorder: 'rgba(255,255,255,0.08)',
    accent: '#FF5A1F',
    accentInk: '#FF8A5C',
    accentSoft: 'rgba(255,90,31,0.16)',
    success: '#22C55E',
    warning: '#F5B301',
    danger: '#F87171',
    onAccent: '#0C0F14',
  },
};

export const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    bg: '#F3F5F8',
    bgElevated: '#FFFFFF',
    bgSoft: '#E9EDF2',
    card: '#FFFFFF',
    cardBorder: 'rgba(15,23,32,0.08)',
    text: '#141A22',
    textMuted: '#4A5563',
    textSoft: '#6B7686',
    tabBar: '#FFFFFF',
    tabBorder: 'rgba(15,23,32,0.08)',
    accent: '#E8480E',
    accentInk: '#C23A08',
    accentSoft: 'rgba(232,72,14,0.12)',
    success: '#12A150',
    warning: '#B7791F',
    danger: '#C81E1E',
    onAccent: '#FFFFFF',
  },
};

export function resolveTheme(
  appearance: 'system' | 'light' | 'dark',
  system: 'light' | 'dark' | null | undefined
): AppTheme {
  const resolved = appearance === 'system' ? (system ?? 'dark') : appearance;
  return resolved === 'light' ? lightTheme : darkTheme;
}
