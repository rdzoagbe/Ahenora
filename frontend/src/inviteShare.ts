import { Platform, Share } from 'react-native';

import { api } from './api';
import { logger } from './logger';

/**
 * Handing someone the household, in one tap.
 *
 * The app asked twice — once in onboarding, once on the Feed — and 87% of
 * households still never invited anybody. The asking was never the problem.
 * What the ask LED to was: a jump to Settings, then a field wanting a partner's
 * email address typed from memory. For a couple that is the wrong input through
 * the wrong channel; the thing a person actually does is send their partner a
 * WhatsApp.
 *
 * The link invite and the share sheet both already existed — buried behind an
 * expandable row in Settings, where the people being nudged never went. This
 * puts them where the asking happens.
 */
export type ShareInviteOutcome =
  /** The share sheet opened (or the person dismissed it — the OS does not say). */
  | { kind: 'shared' }
  /** Web has no share sheet, so the link went to the clipboard instead. */
  | { kind: 'copied'; url: string }
  /** The server would not mint a link — plan limits, or the household is full. */
  | { kind: 'unavailable' }
  /** Something failed after the link existed; hand it back so it is not lost. */
  | { kind: 'failed'; url: string | null };

/**
 * What the recipient reads. Kept apart from the sending so it can be tested
 * without a share sheet, and so the wording cannot quietly differ between the
 * two places that send invitations.
 */
export function inviteMessage(inviterName: string, url: string, invitedYou: string): string {
  const who = inviterName.trim();
  return `${who ? `${who} ` : ''}${invitedYou}\n\n${url}`;
}

export async function shareHouseholdInvite(opts: {
  inviterName: string;
  title: string;
  invitedYou: string;
  relationship?: string;
}): Promise<ShareInviteOutcome> {
  let url: string | null = null;
  try {
    const res = await api.createInviteLink(
      opts.relationship ? { relationship: opts.relationship } : undefined);
    url = res?.invite_url || null;
  } catch (e) {
    logger.warn('invite link could not be created', e);
    return { kind: 'unavailable' };
  }
  if (!url) return { kind: 'unavailable' };

  try {
    // No share sheet in a browser. Copying is the honest equivalent — the link
    // is in hand either way, which is the only part that matters.
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        return { kind: 'copied', url };
      }
      return { kind: 'failed', url };
    }
    await Share.share({
      title: opts.title,
      message: inviteMessage(opts.inviterName, url, opts.invitedYou),
      url,
    });
    return { kind: 'shared' };
  } catch (e) {
    // The link is already minted and valid. Returning it means the person can
    // still be given it by hand rather than being told to start again.
    logger.warn('invite share sheet failed', e);
    return { kind: 'failed', url };
  }
}
