/**
 * The first chores a household can hand its children, offered at setup.
 *
 * The chore chart is what Family is paid for, and a family that installed for
 * it used to land on an empty feed with the kids' side three taps away. Six
 * jobs a child can do today, with the app's own icons (src/cardIcons.ts) and
 * the stars a real household would give; three are ticked to start with. One
 * chore per child per tick — "tidy your room" is nobody's turn.
 *
 * Pure data, in its own file, so a test can read it without mounting the
 * onboarding screen.
 */
export interface StarterChore {
  key: string;
  /** An icon KEY from the catalogue, never a glyph: the server stores keys. */
  icon: string;
  stars: number;
  labelKey: string;
}

export const STARTER_CHORES: StarterChore[] = [
  { key: 'tidy', icon: 'cleaning', stars: 3, labelKey: 'ob_chore_tidy' },
  { key: 'bed', icon: 'bed', stars: 2, labelKey: 'ob_chore_bed' },
  { key: 'homework', icon: 'homework', stars: 3, labelKey: 'ob_chore_homework' },
  { key: 'table', icon: 'cooking', stars: 2, labelKey: 'ob_chore_table' },
  { key: 'pet', icon: 'pet', stars: 2, labelKey: 'ob_chore_pet' },
  { key: 'bins', icon: 'bins', stars: 3, labelKey: 'ob_chore_bins' },
];

export const DEFAULT_CHORES = ['tidy', 'bed', 'homework'];
