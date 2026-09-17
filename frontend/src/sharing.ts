/**
 * "Who sees this", as one decision the card AND its vault copy both follow.
 *
 * The sheet used to answer the question for the card only: a scanned letter
 * filed in the vault went in private whatever the pills said, so "Everyone"
 * shared the task and hid the document behind it. Roland: "I need to be able
 * to choose who I share the doc with." Three answers now — everyone, just me,
 * or these people — and one function turns the answer into what each API
 * call needs, so the two halves cannot disagree.
 */
import type { VaultVisibility } from './api';

export type ShareMode = 'everyone' | 'me' | 'chosen';

export interface SharingPayload {
  /** For the card: the household-wide flag the server already understands. */
  shared: boolean;
  /** For the card and the document: member ids, only in 'chosen' mode. */
  visible_to_members?: string[];
  /** For the vault copy. */
  vaultVisibility: VaultVisibility;
}

export function sharingPayload(mode: ShareMode, chosenMemberIds: string[]): SharingPayload {
  if (mode === 'chosen' && chosenMemberIds.length > 0) {
    return { shared: true, visible_to_members: [...chosenMemberIds], vaultVisibility: 'selected' };
  }
  if (mode === 'me') return { shared: false, vaultVisibility: 'private' };
  return { shared: true, vaultVisibility: 'shared' };
}

/** 'chosen' with nobody picked is not a decision; the sheet refuses to save
 *  rather than silently filing it as "everyone" or "just me". */
export function sharingIsIncomplete(mode: ShareMode, chosenMemberIds: string[]): boolean {
  return mode === 'chosen' && chosenMemberIds.length === 0;
}

/** Which mode an existing card is in, from what the server sent back. */
export function shareModeOf(card: { shared?: boolean; chosen_visible_to?: string[] | null } | null | undefined): ShareMode {
  if (!card) return 'everyone';
  if (card.chosen_visible_to && card.chosen_visible_to.length > 0) return 'chosen';
  return card.shared === false ? 'me' : 'everyone';
}
