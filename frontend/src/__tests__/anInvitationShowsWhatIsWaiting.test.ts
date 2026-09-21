/**
 * The receiving half of the guided invitation.
 *
 * An invitation that shows only who sent it asks somebody to sign up for an
 * unknown. These pin the rules the preview follows, because each one is a way
 * it could quietly go wrong: showing a household's contents to somebody who
 * has not joined, showing three zeros to somebody joining an empty household,
 * or a card that reads "waiting for you" after they already have it.
 */
import * as fs from 'fs';
import * as path from 'path';

const PREVIEW = path.join(__dirname, '..', 'components', 'InvitePreview.tsx');
const PROMPT = path.join(__dirname, '..', 'components', 'InviteJoinPrompt.tsx');
const LANDING = path.join(__dirname, '..', '..', 'app', 'index.tsx');
const I18N = path.join(__dirname, '..', 'i18n.ts');
const SERVER = path.join(__dirname, '..', '..', '..', 'backend', 'server.py');

const read = (p: string) => fs.readFileSync(p, 'utf8');

describe('What is waiting is shown before anybody signs up', () => {
  it('appears on the landing screen, where an invited stranger lands', () => {
    const landing = read(LANDING);
    expect(landing).toContain('<InvitePreview');
    expect(landing).toContain('setInviteHandover(invite.handover || null)');
    expect(landing).toContain('setInviteHousehold(invite.household || null)');
  });

  it('appears in the in-app card too, for somebody who already has an account', () => {
    expect(read(PROMPT)).toContain('<InvitePreview');
  });

  it('is filled in whichever route found the invitation', () => {
    // A link carries a token and gets a full lookup. Server discovery answers
    // who and what role only, so without a second lookup the same invitation
    // would show a handover through one door and nothing through the other.
    const prompt = read(PROMPT);
    expect(prompt).toMatch(/invitesForMe[\s\S]{0,900}api\.getInvite\(first\.token\)/);
  });

  it('never fails the join when that extra lookup fails', () => {
    // Failing it would turn a join that works into a join that never appears.
    expect(read(PROMPT)).toMatch(/api\.getInvite\(first\.token\)[\s\S]{0,400}catch/);
  });
});

describe('It counts the household without naming its contents', () => {
  const preview = read(PREVIEW);

  it('reads only the three counts, never a list of titles', () => {
    expect(preview).toContain('household.things_this_week');
    expect(preview).toContain('household.children');
    expect(preview).toContain('household.shopping_items');
    // If the preview ever reaches for card titles, this is where it shows up.
    expect(preview).not.toMatch(/household\.(cards|titles|items\b)/);
  });

  it('is backed by a server that sends counts and nothing else', () => {
    const server = read(SERVER);
    const fn = server.slice(server.indexOf('async def _invited_household_summary'));
    const body = fn.slice(0, fn.indexOf('\n\n\n'));
    expect(body).toContain('things_this_week');
    expect(body).not.toContain('"title"');
  });

  it('drops a count that is zero rather than showing a zero', () => {
    // Joining a household whose week is empty should not open with "0".
    expect(preview).toContain('household.things_this_week > 0');
    expect(preview).toContain('household.children > 0');
    expect(preview).toContain('household.shopping_items > 0');
  });

  it('renders nothing at all when there is nothing to say', () => {
    // An invitation from an older build carries no handover, and a brand-new
    // household has no counts. An empty bordered box is worse than no box.
    expect(preview).toContain('if (!handover && counts.length === 0) return null;');
  });
});

describe('After joining, the same card reads as theirs', () => {
  const preview = read(PREVIEW);

  it('switches the wording rather than showing "waiting for you" again', () => {
    expect(preview).toContain("t('invite_preview_now_yours')");
    expect(preview).toContain("t('invite_preview_handed_done')");
  });

  it('drops the household counts once they are in it', () => {
    // They have joined: the household is no longer a thing being described
    // from outside.
    expect(preview).toContain('!collected && counts.length > 0');
  });

  it('leaves the confirmation on screen long enough to read', () => {
    const prompt = read(PROMPT);
    const delay = prompt.match(/setTimeout\(\(\) => setToken\(null\), (\d+)\)/);
    expect(delay).not.toBeNull();
    expect(Number(delay![1])).toBeGreaterThanOrEqual(3000);
  });
});

describe('Its words exist in every language the app speaks', () => {
  it('has all seven keys four times over', () => {
    const i18n = read(I18N);
    const keys = [
      'invite_preview_waiting', 'invite_preview_now_yours', 'invite_preview_handed',
      'invite_preview_handed_done', 'invite_preview_week', 'invite_preview_children',
      'invite_preview_shopping',
    ];
    for (const key of keys) {
      const hits = i18n.match(new RegExp(`\\n  ${key}: `, 'g')) || [];
      expect([key, hits.length]).toEqual([key, 4]);
    }
  });

  it('keeps the name placeholder in every translation of it', () => {
    // The component substitutes {name}; a translation that dropped it would
    // read "is handing this to you" with nobody named.
    const i18n = read(I18N);
    const lines = i18n.match(/\n  invite_preview_handed(_done)?: '[^']*'/g) || [];
    expect(lines.length).toBe(8);
    for (const line of lines) expect(line).toContain('{name}');
  });
});

describe('The screen an invited stranger lands on cannot clip', () => {
  const landing = read(LANDING);

  it('scrolls rather than centring a fixed block', () => {
    // The preview card plus a long German heading can push the sign-in
    // buttons off a small phone, which would be an invitation that cannot be
    // accepted. This is the one regression this whole change could cause.
    expect(landing).toContain('<ScrollView');
    expect(landing).toContain('contentContainerStyle={styles.center}');
  });

  it('still centres its content when everything fits', () => {
    expect(landing).toContain("center: { flexGrow: 1, justifyContent: 'center' }");
    expect(landing).not.toContain("center: { flex: 1, justifyContent: 'center' }");
  });

  it('keeps taps working through the scroll view', () => {
    // Without this a tap on a sign-in button while a keyboard is up is eaten
    // by the scroll view dismissing it.
    expect(landing).toContain('keyboardShouldPersistTaps="handled"');
  });
});

describe('A document notification can be tapped more than once', () => {
  const vault = fs.readFileSync(
    path.join(__dirname, '..', '..', 'app', '(tabs)', 'vault.tsx'), 'utf8');

  it('spends the parameter once it has been honoured', () => {
    // A latch keyed on the id stops the preview reappearing on every list
    // reload, but it also meant a second tap on the same notification set the
    // same id, matched the latch, and opened nothing.
    expect(vault).toContain('router.setParams({ docId: undefined })');
  });

  it('releases the latch only when the parameter is actually gone', () => {
    // Releasing it inline would bring the reload problem straight back.
    expect(vault).toMatch(/if \(!notifiedDocId\) \{\s*openedFromNotification\.current = null;/);
  });
});
