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
    bg: '#0B1020',
    bgElevated: '#141B2D',
    bgSoft: 'rgba(255,255,255,0.08)',
    card: 'rgba(24,31,48,0.94)',
    cardBorder: 'rgba(255,255,255,0.16)',
    glassTint: 'rgba(24,31,48,0.78)',
    text: '#FFFFFF',
    textMuted: 'rgba(255,255,255,0.82)',
    textSoft: 'rgba(255,255,255,0.68)',
    tabBar: 'rgba(13,18,30,0.96)',
    tabBorder: 'rgba(255,255,255,0.18)',
    primary: '#FFFFFF',
    primaryText: '#0B1020',
    accent: '#F59E0B',
    accentSoft: 'rgba(245,158,11,0.18)',
    success: '#34D399',
    shadow: '#000000',
  },
  ambient: {
    base: '#0B1020',
    glowA: ['rgba(79,70,229,0.22)', 'rgba(79,70,229,0)'],
    glowB: ['rgba(245,158,11,0.16)', 'rgba(245,158,11,0)'],
    glowC: ['rgba(20,184,166,0.10)', 'rgba(20,184,166,0)'],
  },
};

export const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    bg: '#F7F2E8',
    bgElevated: '#FFFFFF',
    bgSoft: 'rgba(31,41,55,0.06)',
    card: 'rgba(255,255,255,0.96)',
    cardBorder: 'rgba(31,41,55,0.13)',
    glassTint: 'rgba(255,255,255,0.82)',
    text: '#111827',
    textMuted: 'rgba(17,24,39,0.78)',
    textSoft: 'rgba(17,24,39,0.62)',
    tabBar: 'rgba(255,255,255,0.98)',
    tabBorder: 'rgba(31,41,55,0.16)',
    primary: '#111827',
    primaryText: '#FFFFFF',
    accent: '#B45309',
    accentSoft: 'rgba(180,83,9,0.12)',
    success: '#047857',
    shadow: '#475569',
  },
  ambient: {
    base: '#F7F2E8',
    glowA: ['rgba(250,204,21,0.18)', 'rgba(250,204,21,0)'],
    glowB: ['rgba(96,165,250,0.12)', 'rgba(96,165,250,0)'],
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
