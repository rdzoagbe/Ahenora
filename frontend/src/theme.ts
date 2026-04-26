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

// Family-friendly product palette.
// The app still has a few legacy screens with hard-coded white text. Until those
// are fully converted to semantic tokens, both modes intentionally keep enough
// depth behind the content so every screen remains readable on real phones.
export const darkTheme: AppTheme = {
  mode: 'dark',
  colors: {
    bg: '#0B1020',
    bgElevated: '#111827',
    bgSoft: '#1B2436',
    card: '#151D2C',
    cardBorder: '#334155',
    glassTint: '#151D2C',
    text: '#F8FAFC',
    textMuted: '#D7DEE9',
    textSoft: '#A7B3C5',
    tabBar: '#FFFFFF',
    tabBorder: '#D7DEE9',
    primary: '#0F172A',
    primaryText: '#FFFFFF',
    accent: '#F59E0B',
    accentSoft: 'rgba(245,158,11,0.18)',
    success: '#22C55E',
    shadow: '#000000',
  },
  ambient: {
    base: '#0B1020',
    glowA: ['rgba(37,99,235,0.18)', 'rgba(37,99,235,0)'],
    glowB: ['rgba(245,158,11,0.14)', 'rgba(245,158,11,0)'],
    glowC: ['rgba(16,185,129,0.10)', 'rgba(16,185,129,0)'],
  },
};

export const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    bg: '#152033',
    bgElevated: '#1D2A42',
    bgSoft: '#24344F',
    card: '#1D2A42',
    cardBorder: '#4A5C78',
    glassTint: '#1D2A42',
    text: '#FFFFFF',
    textMuted: '#E4ECF8',
    textSoft: '#BCC9DB',
    tabBar: '#FFFFFF',
    tabBorder: '#D7DEE9',
    primary: '#0F172A',
    primaryText: '#FFFFFF',
    accent: '#FBBF24',
    accentSoft: 'rgba(251,191,36,0.20)',
    success: '#22C55E',
    shadow: '#000000',
  },
  ambient: {
    base: '#152033',
    glowA: ['rgba(96,165,250,0.20)', 'rgba(96,165,250,0)'],
    glowB: ['rgba(251,191,36,0.15)', 'rgba(251,191,36,0)'],
    glowC: ['rgba(34,197,94,0.10)', 'rgba(34,197,94,0)'],
  },
};

export function resolveAppearance(mode: AppearanceMode, systemScheme: 'light' | 'dark' | null | undefined): ResolvedAppearance {
  if (mode === 'system') return systemScheme === 'light' ? 'light' : 'dark';
  return mode;
}

export function getTheme(mode: AppearanceMode, systemScheme: 'light' | 'dark' | null | undefined): AppTheme {
  return resolveAppearance(mode, systemScheme) === 'light' ? lightTheme : darkTheme;
}
