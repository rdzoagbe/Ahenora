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
    bg: '#0B1220',
    bgElevated: '#121A2A',
    bgSoft: '#182235',
    card: '#121A2A',
    cardBorder: '#273449',
    glassTint: '#121A2A',
    text: '#F8FAFC',
    textMuted: '#CBD5E1',
    textSoft: '#94A3B8',
    tabBar: '#0F172A',
    tabBorder: '#273449',
    primary: '#F8FAFC',
    primaryText: '#0B1220',
    accent: '#F59E0B',
    accentSoft: 'rgba(245,158,11,0.16)',
    success: '#34D399',
    shadow: '#000000',
  },
  ambient: {
    base: '#0B1220',
    glowA: ['rgba(59,130,246,0.13)', 'rgba(59,130,246,0)'],
    glowB: ['rgba(245,158,11,0.10)', 'rgba(245,158,11,0)'],
    glowC: ['rgba(16,185,129,0.07)', 'rgba(16,185,129,0)'],
  },
};

// NOTE: This is intentionally a readable high-contrast day palette, not a pale
// white palette. Several production screens still contain legacy hard-coded
// light text, so a pure white theme makes important content disappear. This
// keeps the app usable for families while individual screens are progressively
// moved to fully theme-aware styles.
export const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    bg: '#172033',
    bgElevated: '#202B42',
    bgSoft: '#273650',
    card: '#202B42',
    cardBorder: '#40506A',
    glassTint: '#202B42',
    text: '#FFFFFF',
    textMuted: '#DCE6F6',
    textSoft: '#B9C6D9',
    tabBar: '#F8FAFC',
    tabBorder: '#D6DEE9',
    primary: '#0F172A',
    primaryText: '#FFFFFF',
    accent: '#FBBF24',
    accentSoft: 'rgba(251,191,36,0.18)',
    success: '#34D399',
    shadow: '#000000',
  },
  ambient: {
    base: '#172033',
    glowA: ['rgba(59,130,246,0.18)', 'rgba(59,130,246,0)'],
    glowB: ['rgba(251,191,36,0.13)', 'rgba(251,191,36,0)'],
    glowC: ['rgba(52,211,153,0.10)', 'rgba(52,211,153,0)'],
  },
};

export function resolveAppearance(mode: AppearanceMode, systemScheme: 'light' | 'dark' | null | undefined): ResolvedAppearance {
  if (mode === 'system') return systemScheme === 'light' ? 'light' : 'dark';
  return mode;
}

export function getTheme(mode: AppearanceMode, systemScheme: 'light' | 'dark' | null | undefined): AppTheme {
  return resolveAppearance(mode, systemScheme) === 'light' ? lightTheme : darkTheme;
}
