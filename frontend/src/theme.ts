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

export const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    bg: '#F5F7FB',
    bgElevated: '#FFFFFF',
    bgSoft: '#F1F5F9',
    card: '#FFFFFF',
    cardBorder: '#E3E8F1',
    glassTint: '#FFFFFF',
    text: '#141923',
    textMuted: '#596474',
    textSoft: '#8A94A5',
    tabBar: '#FFFFFF',
    tabBorder: '#E3E8F1',
    primary: '#20252B',
    primaryText: '#FFFFFF',
    accent: '#F97316',
    accentSoft: '#FFF3E8',
    success: '#10B981',
    shadow: '#0F172A',
  },
  ambient: {
    base: '#F5F7FB',
    glowA: ['rgba(255,255,255,0.90)', 'rgba(255,255,255,0)'],
    glowB: ['rgba(226,232,240,0.65)', 'rgba(226,232,240,0)'],
    glowC: ['rgba(224,242,254,0.55)', 'rgba(224,242,254,0)'],
  },
};

export const darkTheme: AppTheme = {
  mode: 'dark',
  colors: {
    bg: '#071120',
    bgElevated: '#111C2F',
    bgSoft: '#1A2942',
    card: '#142238',
    cardBorder: '#314561',
    glassTint: '#142238',
    text: '#F8FAFC',
    textMuted: '#D5DEEA',
    textSoft: '#9FB0C7',
    tabBar: '#FFFFFF',
    tabBorder: '#D9E1ED',
    primary: '#FFFFFF',
    primaryText: '#071120',
    accent: '#F97316',
    accentSoft: 'rgba(249,115,22,0.16)',
    success: '#22C55E',
    shadow: '#000000',
  },
  ambient: {
    base: '#071120',
    glowA: ['rgba(37,99,235,0.16)', 'rgba(37,99,235,0)'],
    glowB: ['rgba(247,183,51,0.12)', 'rgba(247,183,51,0)'],
    glowC: ['rgba(20,184,166,0.10)', 'rgba(20,184,166,0)'],
  },
};

export function resolveAppearance(mode: AppearanceMode, systemScheme: 'light' | 'dark' | null | undefined): ResolvedAppearance {
  if (mode === 'system') return systemScheme === 'light' ? 'light' : 'dark';
  return mode;
}

export function getTheme(mode: AppearanceMode, systemScheme: 'light' | 'dark' | null | undefined): AppTheme {
  return resolveAppearance(mode, systemScheme) === 'light' ? lightTheme : darkTheme;
}
