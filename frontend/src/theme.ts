export type AppearanceMode = 'system' | 'dark' | 'light';
export type ResolvedAppearance = 'dark' | 'light';

export interface AppTheme {
  mode: ResolvedAppearance;
  colors: {
    bg: string;
    bgElevated: string;
    bgSoft: string;
    card: string;
    cardBorder: string;
    glassTint: string;
    text: string;
    textMuted: string;
    textSoft: string;
    tabBar: string;
    tabBorder: string;
    primary: string;
    primaryText: string;
    accent: string;
    accentSoft: string;
    success: string;
    shadow: string;
  };
  ambient: {
    base: string;
    glowA: [string, string];
    glowB: [string, string];
    glowC: [string, string];
  };
}

export const darkTheme: AppTheme = {
  mode: 'dark',
  colors: {
    bg: '#080910',
    bgElevated: '#11131C',
    bgSoft: 'rgba(255,255,255,0.04)',
    card: 'rgba(255,255,255,0.04)',
    cardBorder: 'rgba(255,255,255,0.10)',
    glassTint: 'rgba(255,255,255,0.03)',
    text: '#FFFFFF',
    textMuted: 'rgba(255,255,255,0.72)',
    textSoft: 'rgba(255,255,255,0.48)',
    tabBar: 'rgba(14,15,22,0.78)',
    tabBorder: 'rgba(255,255,255,0.08)',
    primary: '#FFFFFF',
    primaryText: '#080910',
    accent: '#F97316',
    accentSoft: 'rgba(249,115,22,0.14)',
    success: '#34D399',
    shadow: '#000000',
  },
  ambient: {
    base: '#080910',
    glowA: ['rgba(99,102,241,0.35)', 'rgba(99,102,241,0)'],
    glowB: ['rgba(249,115,22,0.22)', 'rgba(249,115,22,0)'],
    glowC: ['rgba(16,185,129,0.14)', 'rgba(16,185,129,0)'],
  },
};

export const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    bg: '#131722',
    bgElevated: '#1A2030',
    bgSoft: 'rgba(255,255,255,0.07)',
    card: 'rgba(255,255,255,0.08)',
    cardBorder: 'rgba(255,255,255,0.14)',
    glassTint: 'rgba(255,255,255,0.05)',
    text: '#FFFFFF',
    textMuted: 'rgba(255,255,255,0.78)',
    textSoft: 'rgba(255,255,255,0.56)',
    tabBar: 'rgba(26,32,48,0.88)',
    tabBorder: 'rgba(255,255,255,0.12)',
    primary: '#FFF7ED',
    primaryText: '#111827',
    accent: '#FB923C',
    accentSoft: 'rgba(251,146,60,0.14)',
    success: '#6EE7B7',
    shadow: '#000000',
  },
  ambient: {
    base: '#131722',
    glowA: ['rgba(125,211,252,0.16)', 'rgba(125,211,252,0)'],
    glowB: ['rgba(251,146,60,0.16)', 'rgba(251,146,60,0)'],
    glowC: ['rgba(196,181,253,0.14)', 'rgba(196,181,253,0)'],
  },
};

export function resolveAppearance(mode: AppearanceMode, systemScheme: 'light' | 'dark' | null | undefined): ResolvedAppearance {
  if (mode === 'system') return systemScheme === 'light' ? 'light' : 'dark';
  return mode;
}

export function getTheme(mode: AppearanceMode, systemScheme: 'light' | 'dark' | null | undefined): AppTheme {
  return resolveAppearance(mode, systemScheme) === 'light' ? lightTheme : darkTheme;
}
