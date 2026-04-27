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

/**
 * Reference-style palette:
 * - soft warm-grey app canvas
 * - solid white elevated cards
 * - near-black text/buttons
 * - restrained orange accent for task dots/counts only
 */
export const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    bg: '#F4F5F2',
    bgElevated: '#FFFFFF',
    bgSoft: '#ECEEEC',
    card: '#FFFFFF',
    cardBorder: 'rgba(31,35,35,0.08)',
    glassTint: '#FFFFFF',
    text: '#202323',
    textMuted: '#747B7C',
    textSoft: '#A0A6A7',
    tabBar: '#202323',
    tabBorder: 'rgba(32,35,35,0.04)',
    primary: '#202323',
    primaryText: '#FFFFFF',
    accent: '#F26A1B',
    accentSoft: 'rgba(242,106,27,0.12)',
    success: '#11B886',
    shadow: '#202323',
  },
  ambient: {
    base: '#F4F5F2',
    glowA: ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0)'],
    glowB: ['rgba(222,225,222,0.74)', 'rgba(222,225,222,0)'],
    glowC: ['rgba(242,106,27,0.08)', 'rgba(242,106,27,0)'],
  },
};

export const darkTheme: AppTheme = {
  mode: 'dark',
  colors: {
    bg: '#101419',
    bgElevated: '#171D24',
    bgSoft: '#202833',
    card: '#171D24',
    cardBorder: 'rgba(255,255,255,0.10)',
    glassTint: '#171D24',
    text: '#F8FAFC',
    textMuted: '#CBD5E1',
    textSoft: '#94A3B8',
    tabBar: '#202323',
    tabBorder: 'rgba(255,255,255,0.08)',
    primary: '#FFFFFF',
    primaryText: '#202323',
    accent: '#F26A1B',
    accentSoft: 'rgba(242,106,27,0.18)',
    success: '#22C55E',
    shadow: '#000000',
  },
  ambient: {
    base: '#101419',
    glowA: ['rgba(255,255,255,0.04)', 'rgba(255,255,255,0)'],
    glowB: ['rgba(242,106,27,0.12)', 'rgba(242,106,27,0)'],
    glowC: ['rgba(17,184,134,0.08)', 'rgba(17,184,134,0)'],
  },
};

export function resolveAppearance(
  mode: AppearanceMode,
  systemScheme: 'light' | 'dark' | null | undefined
): ResolvedAppearance {
  if (mode === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
  return mode;
}

export function getTheme(
  mode: AppearanceMode,
  systemScheme: 'light' | 'dark' | null | undefined
): AppTheme {
  return resolveAppearance(mode, systemScheme) === 'light' ? lightTheme : darkTheme;
}
