/**
 * Controls that were invisible, cut off, or in the wrong language.
 *
 * Four separate places where the app rendered something a person could not
 * read or could not use. None of them crashed, none failed a test, and each
 * was found by looking at a screenshot rather than at the code.
 *
 * These are source-level on purpose: they are rules about what a screen must
 * offer, which survive any refactor of how it renders.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const app = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'app', ...p), 'utf8');
const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

const KIDS = app('(tabs)', 'kids.tsx');
const CALENDAR = app('(tabs)', 'calendar.tsx');
const CHAT = src('components', 'ChatThread.tsx');
const SMARTCARD = src('components', 'SmartCard.tsx');
const I18N = src('i18n.ts');

/** A key is only really there if all four shipped languages have it. */
function inEveryLanguage(key: string): number {
  return I18N.split('\n').filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;
}

describe('the co-parent message button stays visible when there is something to read', () => {
  it('turns the tile orange, not just the icon white', () => {
    // The icon went white on `unread > 0` and the tile stayed ui.soft, so the
    // button vanished into the card at exactly the moment it mattered.
    expect(KIDS).toContain('hubMsgBtnUnread');
    expect(KIDS).toMatch(/hubMsgBtnUnread: \{ backgroundColor: ui\.orange \}/);
    expect(KIDS).toMatch(/style=\{\[styles\.hubMsgBtn, unread > 0 && styles\.hubMsgBtnUnread\]\}/);
  });

  it('still only turns white when there is an unread count', () => {
    expect(KIDS).toContain("<MessageCircle color={unread > 0 ? '#fff' : ui.muted} size={18} />");
  });
});

describe('the calendar day header fits the day it names', () => {
  it('lets a long day name use a second line', () => {
    // flex:1 with one line against "0 events" and "+ Add event" cut every day
    // name on a phone: "Today · Sunday, …".
    expect(CALENDAR).toMatch(/styles\.dayHeadTitle, \{ flex: 1 \}\]} numberOfLines=\{2\}/);
  });

  it('does not print a count of nothing above an empty state that says so', () => {
    expect(CALENDAR).toContain('selectedDay && totalSelectedEvents > 0 ?');
  });

  it('keeps "Add event" level with the first line when the name wraps', () => {
    expect(CALENDAR).toMatch(/dayHead: \{ flexDirection: 'row', alignItems: 'flex-start'/);
  });
});

describe('the app speaks all four of its languages', () => {
  it('says Today and Tomorrow through the dictionary, not a ladder of three', () => {
    // The ladder was `fr ? … : es ? … : 'Today'`, so German read "Today ·
    // Sonntag, 13. September" — the one word the app wrote itself, wrong.
    expect(CALENDAR).toContain("t('feed_today')");
    expect(CALENDAR).toContain("t('feed_tomorrow')");
    expect(CALENDAR).not.toContain("lang === 'fr' ?");
  });

  it('labels sign-slip and RSVP cards through the dictionary too', () => {
    expect(SMARTCARD).toContain("t('card_action_sign')");
    expect(SMARTCARD).toContain("t('card_action_rsvp')");
    expect(SMARTCARD).not.toContain("lang === 'fr' ?");
  });

  it('has those words in every language the app ships', () => {
    for (const key of ['card_action_sign', 'card_action_rsvp']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });
});

describe('a reaction can be taken back the way it was given', () => {
  it('makes the pill a button, not a label', () => {
    // The server has always toggled. Only the pill was inert, so tapping your
    // own reaction to remove it — the gesture every messenger has — did
    // nothing and sent you back to the hold menu.
    expect(CHAT).toMatch(/<Pressable\s+key=\{r\.emoji\}/);
    expect(CHAT).toContain('onPress={() => onToggleReaction?.(item, r.emoji)}');
  });

  it('says which way the tap goes', () => {
    expect(CHAT).toContain("t(r.mine ? 'chat_reaction_remove' : 'chat_reaction_add'");
    for (const key of ['chat_reaction_add', 'chat_reaction_remove']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });

  it('leaves the pill inert for a thread with no react function', () => {
    // The teen thread and the parent thread share this component; one of them
    // could be read-only, and a dead button is worse than a label.
    expect(CHAT).toContain('disabled={!onToggleReaction}');
    expect(CHAT).toContain('onToggleReaction={react ? reactTo : undefined}');
  });
});

describe('pocket money can be stopped, not only started', () => {
  it('offers the control once there is an allowance to stop', () => {
    expect(KIDS).toContain('testID="stop-allowance"');
    expect(KIDS).toContain('{childAllowance ? (');
    expect(KIDS).toContain('api.deleteAllowance(memberId)');
  });

  it('asks first, on both platforms', () => {
    expect(KIDS).toContain('confirmStopAllowance');
    expect(KIDS).toContain("t('kids_stop_allowance_confirm', { name: activeChild.name })");
    expect(KIDS).toContain('webConfirm(message)');
  });

  it('has the words in every language the app ships', () => {
    for (const key of ['kids_stop_allowance', 'kids_stop_allowance_confirm',
                       'kids_allowance_stopped']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });
});

describe('a gift pot nobody paid into has a way out', () => {
  const POT = app('gift-pot.tsx');

  it('offers delete exactly where "mark sorted" does not', () => {
    // "Mark sorted" is gated on total_pledged > 0, so a pot created by
    // mistake had no exit at all and stayed in the Feed and Calendar for good.
    expect(POT).toContain("pot.status !== 'closed' && pot.total_pledged === 0 ?");
    expect(POT).toContain("pot.status !== 'closed' && pot.total_pledged > 0 ?");
    expect(POT).toContain('testID="gift-pot-delete"');
    expect(POT).toContain('api.deleteGiftPot(pot.pot_id)');
  });

  it('asks first, and names the pot', () => {
    expect(POT).toContain("t('gp_delete_confirm', { title: pot.title })");
    expect(POT).toContain('webConfirm(message)');
  });

  it('has the words in every language the app ships', () => {
    for (const key of ['gp_delete', 'gp_delete_confirm']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });
});
