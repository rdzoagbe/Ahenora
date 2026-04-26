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
    accent: '#F7B733',
    accentSoft: 'rgba(247,183,51,0.16)',
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

export const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    bg: '#F6F1E7',
    bgElevated: '#FFFFFF',
    bgSoft: '#EEE7DA',
    card: '#FFFFFF',
    cardBorder: '#D9D0C2',
    glassTint: '#FFFFFF',
    text: '#172033',
    textMuted: '#4B5870',
    textSoft: '#778399',
    tabBar: '#FFFFFF',
    tabBorder: '#D9D0C2',
    primary: '#172033',
    primaryText: '#FFFFFF',
    accent: '#B7791F',
    accentSoft: 'rgba(183,121,31,0.14)',
    success: '#16A34A',
    shadow: '#172033',
  },
  ambient: {
    base: '#F6F1E7',
    glowA: ['rgba(247,183,51,0.24)', 'rgba(247,183,51,0)'],
    glowB: ['rgba(14,165,233,0.12)', 'rgba(14,165,233,0)'],
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
