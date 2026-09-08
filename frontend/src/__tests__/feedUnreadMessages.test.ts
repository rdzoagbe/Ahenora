/**
 * A message you have not read has to be visible somewhere.
 *
 * Roland: "the notification doesn't appear on the notification bell, and also
 * when is there a way to have direct access to the chats from the feed page
 * when the notification drops".
 *
 * Both halves were the same gap. The bell was fed by `dashboard.priority` —
 * cards. A chat message is not a card, so it could never appear there, and the
 * Feed never asked the server for conversations at all. If you missed the push
 * notification, nothing anywhere in the app said somebody had written to you.
 *
 * Source-level: the rule is that the Feed must ASK for conversations and offer
 * a way into them, which is what was missing and what a rewrite could lose.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const FEED = readFileSync(
  join(__dirname, '..', '..', 'app', '(tabs)', 'feed.tsx'), 'utf8');

describe('the feed knows about unread conversations', () => {
  it('asks the server for them', () => {
    expect(FEED).toContain('api.chatThreads()');
  });

  it('never lets one screen’s failure take out the rest of the feed', () => {
    // Loaded alongside eight other calls in an allSettled; a chat outage must
    // not blank the Feed.
    expect(FEED).toMatch(/api\.chatThreads\(\)[\s\S]{0,80}\.catch\(/);
  });

  it('counts unread messages in the bell badge', () => {
    expect(FEED).toContain('unreadMessages');
    expect(FEED).toMatch(/unseenAlertCount[\s\S]{0,200}\+ unreadMessages/);
  });
});

describe('and gives you a way straight into them', () => {
  it('lists each unread conversation', () => {
    expect(FEED).toContain('feed-alerts-messages');
    expect(FEED).toContain('feed-alert-chat-');
  });

  it('opens that conversation, not just the chat tab', () => {
    // Landing on a list of threads is the same failure the card
    // notifications had: the tap navigates, to a screen that looks like the
    // one you were already on.
    expect(FEED).toMatch(/pathname: '\/conversation'[\s\S]{0,120}thread: th\.thread/);
  });

  it('does not remember a dismissal for messages the way it does for cards', () => {
    // Unread is the server's answer and clears itself when you open the
    // thread. A device-side "seen" list on top of that could only ever make
    // the badge lie about whether you had read your partner's message.
    expect(FEED).not.toMatch(/seenAlertIds[\s\S]{0,80}th\.thread/);
    expect(FEED).toMatch(/const unreadThreads = useMemo\(/);
  });
});
