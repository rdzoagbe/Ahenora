/**
 * Whether the children's sections of the app are put away.
 *
 * True on Duo (a plan for two, with no children's side) and whenever the
 * household chose to hide them in Settings. Hiding is only ever hiding: the
 * server keeps every child, star and chore, and turning it back on — or moving
 * up to Family — shows them exactly as they were.
 */
import { useStore } from './store';

export function useKidsSectionsHidden(): boolean {
  const { subscription } = useStore();
  return Boolean(subscription?.kids_sections_hidden);
}
