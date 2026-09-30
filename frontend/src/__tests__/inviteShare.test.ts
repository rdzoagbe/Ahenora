/**
 * Handing someone the household in one tap.
 *
 * Both places that asked for a co-parent led to a Settings screen wanting an
 * email address typed from memory, and 87% of households never invited anyone.
 * These cover the part a test can hold: that a link is minted, that the message
 * reads correctly, and — the one that matters most — that a person is never
 * left believing an invitation went out when it did not.
 *
 * react-native is mocked rather than imported: this suite runs in node, and the
 * neighbouring keyboardHeight test does the same for the same reason.
 */
let platform = 'android';
const shareMock = jest.fn();

jest.mock('react-native', () => ({
  get Platform() { return { OS: platform }; },
  Share: { share: (...a: unknown[]) => shareMock(...a) },
}));
jest.mock('../logger', () => ({ logger: { warn: jest.fn() } }));
jest.mock('../api', () => ({ api: { createInviteLink: jest.fn() } }));

import { api } from '../api';
import { inviteMessage, joinUrl, shareHouseholdInvite } from '../inviteShare';

const createInviteLink = api.createInviteLink as jest.Mock;
const URL = 'https://ahenora.com/app/auth?invite=abc123';
// What is actually shared: the invitation page, not the web app.
const JOIN = 'https://ahenora.com/join/?invite=abc123';

describe('inviteMessage', () => {
  it('names the person doing the inviting', () => {
    expect(inviteMessage('Roland', URL, 'invited you to their household.'))
      .toBe('Roland invited you to their household.\n\n' + URL);
  });

  it('reads properly when we do not know their name', () => {
    // Not "undefined invited you", and no stray leading space.
    expect(inviteMessage('', URL, 'invited you to their household.'))
      .toBe('invited you to their household.\n\n' + URL);
    expect(inviteMessage('   ', URL, 'invited you.')).toBe('invited you.\n\n' + URL);
  });

  it('always carries the link', () => {
    expect(inviteMessage('Ama', URL, 'x')).toContain(URL);
  });
});

describe('joinUrl', () => {
  // Roland: "this shouldn't be how the invitation comes". It previewed as the
  // website and opened the web app; now it opens the invitation page.
  it('shares the invitation page, in the sender language', () => {
    expect(joinUrl(URL)).toBe(JOIN);
    expect(joinUrl(URL, 'en')).toBe(JOIN);
    expect(joinUrl(URL, 'fr')).toBe('https://ahenora.com/fr/join/?invite=abc123');
    expect(joinUrl('https://ahenora.com/app/?invite=2B8o_x-9', 'de'))
      .toBe('https://ahenora.com/de/join/?invite=2B8o_x-9');
  });

  it('leaves a link with no invitation in it alone', () => {
    expect(joinUrl('https://ahenora.com/app/')).toBe('https://ahenora.com/app/');
    expect(joinUrl('')).toBe('');
  });
});

describe('shareHouseholdInvite', () => {
  const opts = { inviterName: 'Roland', title: 'Join', invitedYou: 'invited you.' };

  beforeEach(() => {
    jest.clearAllMocks();
    platform = 'android';
  });

  it('mints a link and opens the share sheet', async () => {
    createInviteLink.mockResolvedValue({ invite_url: URL });
    shareMock.mockResolvedValue({ action: 'sharedAction' });

    expect(await shareHouseholdInvite(opts)).toEqual({ kind: 'shared' });
    expect(shareMock).toHaveBeenCalledTimes(1);
    expect((shareMock.mock.calls[0][0] as { message: string }).message).toContain(JOIN);
  });

  it('says so when the server will not mint a link', async () => {
    // Plan limit, or the household is full. Claiming an invite went out when
    // none exists is the failure this app has made before.
    createInviteLink.mockRejectedValue(new Error('403'));
    expect(await shareHouseholdInvite(opts)).toEqual({ kind: 'unavailable' });
  });

  it('treats a missing url as unavailable rather than sharing nothing', async () => {
    createInviteLink.mockResolvedValue({ invite_url: '' });
    expect(await shareHouseholdInvite(opts)).toEqual({ kind: 'unavailable' });
  });

  it('hands the link back when the share sheet fails', async () => {
    createInviteLink.mockResolvedValue({ invite_url: URL });
    shareMock.mockRejectedValue(new Error('no activity'));
    expect(await shareHouseholdInvite(opts)).toEqual({ kind: 'failed', url: JOIN });
  });

  it('copies instead of sharing on the web', async () => {
    platform = 'web';
    createInviteLink.mockResolvedValue({ invite_url: URL });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(global, 'navigator', {
      value: { clipboard: { writeText } }, configurable: true, writable: true,
    });

    expect(await shareHouseholdInvite(opts)).toEqual({ kind: 'copied', url: JOIN });
    expect(writeText).toHaveBeenCalledWith(JOIN);
  });

  it('still returns the link when the browser has no clipboard', async () => {
    platform = 'web';
    createInviteLink.mockResolvedValue({ invite_url: URL });
    Object.defineProperty(global, 'navigator', {
      value: {}, configurable: true, writable: true,
    });
    expect(await shareHouseholdInvite(opts)).toEqual({ kind: 'failed', url: JOIN });
  });
});
