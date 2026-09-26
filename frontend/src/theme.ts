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
 * The Ahenóra palette (rebrand, stage 1):
 * - Shea, a warm off-white ground, under white cards
 * - Ink, a warm near-black, for text and dark buttons
 * - one orange (#F26A1B) for actions and stars; a deeper ink of it for text
 */
export const lightTheme: AppTheme = {
  mode: 'light',
  colors: {
    // The rebrand's warm ground (Shea) under white cards. Every ink below was
    // measured against bg, card and bgSoft; src/__tests__/brandContrast.test.ts
    // holds each pair at the WCAG bar so a later tweak cannot quietly fail it.
    bg: '#FAF6F1',
    bgElevated: '#FFFFFF',
    bgSoft: '#F3ECE3',
    card: '#FFFFFF',
    cardBorder: 'rgba(34,32,29,0.09)',
    glassTint: '#FFFFFF',
    text: '#22201D',
    // textMuted is body text (4.5:1); textSoft marks inactive controls, which
    // WCAG holds to 3:1.
    textMuted: '#6B635B',
    textSoft: '#80776E',
    tabBar: '#FFFFFF',
    tabBorder: 'rgba(34,32,29,0.08)',
    primary: '#22201D',
    primaryText: '#FFFFFF',
    accent: '#F26A1B',
    accentSoft: 'rgba(242,106,27,0.12)',
    accentInk: '#B0450B',
    success: '#2F7D55',
    danger: '#B8322A',
    shadow: '#22201D',
  },
  ambient: {
    base: '#FAF6F1',
    glowA: ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0)'],
    glowB: ['rgba(243,236,227,0.74)', 'rgba(243,236,227,0)'],
    glowC: ['rgba(242,106,27,0.08)', 'rgba(242,106,27,0)'],
  },
};

export const darkTheme: AppTheme = {
  mode: 'dark',
  colors: {
    // Warm dark, not blue-grey: the same brand at night.
    bg: '#15120F',
    bgElevated: '#211D19',
    bgSoft: '#2A2520',
    card: '#211D19',
    cardBorder: 'rgba(255,240,225,0.10)',
    glassTint: '#211D19',
    text: '#F5EFE8',
    textMuted: '#B3A698',
    textSoft: '#8F8377',
    tabBar: '#1B1815',
    tabBorder: 'rgba(255,240,225,0.08)',
    primary: '#F5EFE8',
    primaryText: '#22201D',
    accent: '#F26A1B',
    accentSoft: 'rgba(242,106,27,0.18)',
    accentInk: '#FF9B5E',
    success: '#7CCB9C',
    danger: '#F08A80',
    shadow: '#000000',
  },
  ambient: {
    base: '#15120F',
    glowA: ['rgba(255,240,225,0.04)', 'rgba(255,240,225,0)'],
    glowB: ['rgba(242,106,27,0.12)', 'rgba(242,106,27,0)'],
    glowC: ['rgba(124,203,156,0.06)', 'rgba(124,203,156,0)'],
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
