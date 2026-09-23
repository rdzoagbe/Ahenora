/**
 * The invite sheet's title names who is being invited.
 *
 * The sheet has three modes — co-parent, family member, helper — and its title
 * had two branches: "Send an invite" for a family member, "Invite co-parent"
 * for everything else. So a parent adding a grandparent or a carer as a helper
 * was shown "Invite co-parent", which reads as handing over a co-parent's
 * access. A helper account deliberately has far less: no vault, no billing, no
 * member management. Found while photographing every screen of the app.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const settings = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', '(tabs)', 'settings.tsx'), 'utf8');

describe('the invite sheet title', () => {
  it('has a helper title in every language', () => {
    LANGS.forEach((lang) => {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect(`${lang}: ${table.set_invite_helper_title || ''}`).not.toMatch(/: $/);
    });
  });

  it('never calls a helper a co-parent, in any language', () => {
    LANGS.forEach((lang) => {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect(table.set_invite_helper_title).not.toBe(table.set_invite_coparent);
    });
  });

  it('picks the helper title when the sheet is in helper mode', () => {
    // Pinned against the source: the title is chosen inline in the sheet, and
    // the bug was precisely a missing branch in that choice.
    const title = settings.slice(settings.indexOf('styles.sheetTitle'));
    const block = title.slice(0, title.indexOf('</Text>'));
    expect(block).toMatch(/inviteMode === 'helper'\s*\?\s*t\('set_invite_helper_title'\)/);
  });
});
