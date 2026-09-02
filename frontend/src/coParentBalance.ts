import { SettlementInfo } from './api';

/**
 * Whether this household has a balance worth putting on the home screen.
 *
 * The server answers `enabled` only for exactly two parents. On top of that,
 * a card reading "square with Keigh · 0 shared costs" is noise on every
 * family's home screen to serve the few who have started splitting — so it
 * also waits until something has actually been split.
 */
export function shouldShowBalance(info: SettlementInfo | null | undefined): boolean {
  return !!info?.enabled && (info.shared_count ?? 0) >= 1;
}
