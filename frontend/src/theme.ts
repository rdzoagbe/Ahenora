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
    /** The accent as INK — legible on accentSoft, where the fill accent is not. */
    accentInk: string;
    success: string;
    // Error ink that clears WCAG AA in both themes. Components used to hardcode
    // #EF4444 / #DC2626, which fail on their surfaces and never adapt to dark;
    // this is the shared token, matching the ui palette's danger.
    danger: string;
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
    // Both greys were chosen by eye and both failed a measured contrast sweep
    // (4.3:1 and 2.5:1 on white). textSoft is the quieter of the two and marks
    // inactive controls, so it clears the 3:1 bar WCAG sets for those rather
    // than the 4.5:1 for body text.
    textMuted: '#5F6667',
    textSoft: '#767D7E',
    tabBar: '#FFFFFF',
    tabBorder: 'rgba(31,35,35,0.08)',
    primary: '#202323',
    primaryText: '#FFFFFF',
    accent: '#F26A1B',
    accentSoft: 'rgba(242,106,27,0.12)',
    accentInk: '#B8410A',
    success: '#11B886',
    danger: '#C81E1E',
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
    accentInk: '#FF9A63',
    success: '#22C55E',
    danger: '#F87171',
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
