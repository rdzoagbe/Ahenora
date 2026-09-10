/**
 * The badge under your name has to be true.
 *
 * It used to be two hard-coded words. "OWNER" appeared under every signed-in
 * person — a grandmother invited as a carer opened her own profile and was
 * told she owned the household — and "VERIFIED" appeared next to it, which
 * nothing in the app ever verifies: an account that signs in with a password
 * has confirmed no address at all.
 *
 * It is not a cosmetic slip. That badge is the only place the app tells you
 * your standing, and the household's real permission model — who can remove
 * whom, who reaches the vault, who is billed — turns on exactly the
 * distinction it was erasing.
 *
 * The rule now lives once, server-side (tests/test_who_am_i_badge.py), beside
 * the permission checks that depend on it. What this file guards is the half
 * that lives here: that the screen renders what the server said, that it says
 * nothing at all until the server has said something, and that no hard-coded
 * claim about a person has crept back in.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const ACCOUNT = readFileSync(join(ROOT, 'app', '(tabs)', 'account.tsx'), 'utf8');
const I18N = readFileSync(join(ROOT, 'src', 'i18n.ts'), 'utf8');
const SERVER = readFileSync(join(ROOT, '..', 'backend', 'server.py'), 'utf8');

/** Every standing the server can send, read off the server itself. */
const STANDINGS = (SERVER.match(/^MEMBER_STANDINGS = \(([^)]*)\)/m)?.[1] ?? '')
  .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);

describe('the badge under your name', () => {
  it('claims nothing on its own', () => {
    // The exact shape of the old bug: a label under a person's name that the
    // screen decided by itself. If one comes back, it comes back for everyone.
    expect(ACCOUNT).not.toMatch(/acc_badge_owner|acc_badge_verified/);
    expect(I18N).not.toMatch(/acc_badge_owner|acc_badge_verified/);
    const badges = ACCOUNT.match(/<Badge\b[^>]*label=\{[^}]*\}/g) ?? [];
    expect(badges).toHaveLength(1);
    expect(badges[0]).toContain('label={standing}');
  });

  it('waits for the server rather than guessing', () => {
    // `me` is null until /family/members answers. Rendering a fallback in that
    // window is how a wrong badge gets in front of someone: it would be shown
    // to everyone, briefly, which is exactly what it did before.
    expect(ACCOUNT).toMatch(/const standing = me\s*\n?\s*\?/);
    expect(ACCOUNT).toMatch(/\{standing \? \(/);
  });

  it('has a word for every standing the server can send', () => {
    // Read from the server's own tuple, so adding a standing there without a
    // label here fails rather than rendering a blank badge under a name.
    expect(STANDINGS.length).toBeGreaterThan(0);
    for (const s of STANDINGS) {
      if (s === 'member') continue;   // shown as the family's own word — below
      expect(ACCOUNT).toContain(`${s}: t('acc_standing_${s}')`);
      // Four languages ship, and a missing one renders the key itself.
      expect(I18N.match(new RegExp(`acc_standing_${s}:`, 'g')) ?? []).toHaveLength(4);
    }
  });

  it("calls an adult invited by relationship what the family called them", () => {
    // 'member' is a grandmother, an uncle, a nanny — a full member who is not
    // a parent. The family already chose a word; ours would be worse.
    expect(ACCOUNT).not.toContain("member: t('acc_standing_member')");
    expect(ACCOUNT).toMatch(/\(me\.role \|\| ''\)\.toUpperCase\(\)/);
  });
});
