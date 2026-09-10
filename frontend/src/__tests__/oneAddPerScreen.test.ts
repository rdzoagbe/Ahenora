/**
 * One "Add" per screen, and it means one thing.
 *
 * ScreenHeader draws the quick-add picker in the top-right by default, and
 * takes a `right` slot for whatever else a screen needs there. The Vault put
 * its own add-a-document button in that slot — so the corner carried TWO plus
 * buttons, side by side, both announcing themselves to a screen reader as
 * "Add", doing different things. Roland found it in a photograph.
 *
 * The irony is in the code it replaced: that button was moved up from a
 * floating FAB *because* the FAB "read as a second, duplicate + beside the nav
 * bar's own". It was moved next to a different duplicate.
 *
 * So: a screen whose own header control is an Add must turn the generic one
 * off. Screens whose control means something else — Calendar's import, the
 * Family tab's invite — keep both, because two buttons that do two things and
 * say so are not the same problem.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const TABS = join(__dirname, '..', '..', 'app', '(tabs)');

/** Every tab screen that draws a ScreenHeader, with its source. */
const screens = () =>
  readdirSync(TABS)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => [f, readFileSync(join(TABS, f), 'utf8')] as const)
    .filter(([, src]) => src.includes('<ScreenHeader'));

/** The header block: from <ScreenHeader to the closing /> of that element. */
const header = (src: string) => {
  const start = src.indexOf('<ScreenHeader');
  const end = src.indexOf('/>', start);
  return src.slice(start, end);
};

describe('the top-right corner', () => {
  it('finds the screens at all', () => {
    // A glob that quietly matched nothing would make every check below pass.
    expect(screens().length).toBeGreaterThanOrEqual(5);
  });

  it('never puts two Adds beside each other', () => {
    // The exact bug: a `right` control labelled a11y_add, next to the generic
    // one that ScreenHeader draws unless told not to.
    const doubled = screens()
      .filter(([, src]) => {
        const h = header(src);
        return h.includes("t('a11y_add')") && !h.includes('showAdd={false}');
      })
      .map(([name]) => name);
    expect(doubled).toEqual([]);
  });

  it('gives the Vault one Add, and it says what it adds', () => {
    const [, vault] = screens().find(([name]) => name === 'vault.tsx')!;
    const h = header(vault);
    expect(h).toContain('showAdd={false}');
    expect(h).toContain("accessibilityLabel={t('add_document')}");
    expect(h).not.toContain("t('a11y_add')");
  });

  it('leaves screens whose control means something else alone', () => {
    // Two buttons that do two things and say so are not the problem. The
    // Calendar imports, the Family tab invites — both keep the quick-add.
    for (const name of ['calendar.tsx', 'kids.tsx']) {
      const found = screens().find(([f]) => f === name);
      if (!found) continue;
      const h = header(found[1]);
      expect({ name, generic: h.includes('showAdd={false}') })
        .toEqual({ name, generic: false });
    }
  });
});
