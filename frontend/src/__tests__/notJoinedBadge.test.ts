/**
 * A member row must say when the person never actually joined.
 *
 * The server has always known: family_members carries a user_id only once
 * somebody signs in, and public_member exposes that as `has_account`. The app
 * never showed it — so a co-parent who joined and one who never did rendered
 * identically, name, avatar, badge and all.
 *
 * That is what turned one missed invite into three separate bug reports. The
 * household looked complete, so "she can't see the kids", "I got no
 * notification when she added a task" and "the invite link didn't work" were
 * read as three faults in three subsystems, when they were one person sitting
 * outside the household the whole time.
 *
 * Source-level, because what matters is which branch decides the label and on
 * what — and the two failure modes worth pinning are both structural.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('the "hasn\'t joined yet" marker', () => {
  const hub = read('app/(tabs)/kids.tsx');
  const code = hub
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('is decided by has_account, the field the server already sends', () => {
    expect(code).toMatch(/const notJoined = .*has_account === false/);
  });

  it('treats a missing field as "do not know", never as "absent"', () => {
    // An older server that omits has_account must not paint every co-parent as
    // never having joined — that would be a scarier bug than the one being
    // fixed. Hence `=== false` rather than a falsy check.
    expect(code).not.toMatch(/const notJoined = [^\n]*!m\.has_account/);
  });

  it('applies to adults only', () => {
    // A young child has no login by design. Marking them "invited" would be
    // nonsense, and would bury the one row that matters in noise.
    expect(code).toMatch(/const notJoined = \(isParent \|\| isHelper\)/);
  });

  it('changes the badge AND the line under the name', () => {
    // The badge alone is easy to miss on a row somebody has seen fifty times.
    // The subtitle says what it costs them.
    expect(code).toMatch(/badgeLabel = notJoined/);
    expect(code).toMatch(/const sub = notJoined/);
  });

  it('says what it means for the household, not just that it happened', () => {
    const i18n = read('src/i18n.ts');
    for (const key of ['hub_role_invited', 'hub_not_joined_sub']) {
      expect((i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || [])).toHaveLength(4);
    }
    // The English copy has to name the consequence — "Invited" alone reads as
    // a status, not as a warning that everything added is going nowhere.
    expect(i18n).toMatch(/hub_not_joined_sub: "Hasn't joined yet[^"]*won't see/);
  });
});
