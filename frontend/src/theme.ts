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

export const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    bg: '#F7F2E8',
    bgElevated: '#FFFFFF',
    bgSoft: '#F1E8D8',
    card: '#FFFFFF',
    cardBorder: '#D9D2C4',
    glassTint: '#FFFFFF',
    text: '#111827',
    textMuted: '#475569',
    textSoft: '#64748B',
    tabBar: '#FFFFFF',
    tabBorder: '#D9D2C4',
    primary: '#111827',
    primaryText: '#FFFFFF',
    accent: '#B45309',
    accentSoft: '#FEF3C7',
    success: '#047857',
    shadow: '#475569',
  },
  ambient: {
    base: '#F7F2E8',
    glowA: ['rgba(251,191,36,0.10)', 'rgba(251,191,36,0)'],
    glowB: ['rgba(96,165,250,0.07)', 'rgba(96,165,250,0)'],
    glowC: ['rgba(52,211,153,0.05)', 'rgba(52,211,153,0)'],
  },
};

export function resolveAppearance(mode: AppearanceMode, systemScheme: 'light' | 'dark' | null | undefined): ResolvedAppearance {
  if (mode === 'system') return systemScheme === 'light' ? 'light' : 'dark';
  return mode;
}

export function getTheme(mode: AppearanceMode, systemScheme: 'light' | 'dark' | null | undefined): AppTheme {
  return resolveAppearance(mode, systemScheme) === 'light' ? lightTheme : darkTheme;
}
