/**
 * A row should say what is behind it.
 *
 * Two things Roland picked out of a screenshot of his own Settings screen.
 *
 * "MORE · 1.1.0". The least descriptive label in the app, sitting on the group
 * that holds Usage analytics — which is where the billing screen lives, and
 * the screen I had asked him three times to open. A version number as a
 * subtitle tells you nothing about what is inside, and the word collided with
 * the More in the tab bar: same word, a different destination, one nested
 * inside the other.
 *
 * "PREFERENCES · English" as a section heading, with the globe icon, directly
 * above a single "Language · English" row with the same globe icon. The same
 * word and the same value, twice, one under the other. A group of one is not
 * a group.
 *
 * Neither was a bug. Both were the app being harder to read than it needed to
 * be, which is the kind of thing only a person looking at it ever finds.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const SETTINGS = readFileSync(join(ROOT, 'app', '(tabs)', 'settings.tsx'), 'utf8');
const I18N = readFileSync(join(ROOT, 'src', 'i18n.ts'), 'utf8');

describe('the overflow group says what is in it', () => {
  it('is no longer titled with the same word as the tab bar', () => {
    expect(SETTINGS).toContain("t('set_tools')");
    expect(SETTINGS).not.toMatch(/t\('set_more'\),\s*\n\s*versionLabel,/);
  });

  it('is subtitled with its contents, not a version number', () => {
    expect(SETTINGS).toContain("t('set_tools_sub')");
  });

  it('still shows the version where a version belongs', () => {
    // On the App version row inside — removing the subtitle must not lose it.
    expect(SETTINGS).toMatch(/styles\.updateVersion[\s\S]{0,60}\{versionLabel\}/);
  });

  it('has both new labels in all four languages', () => {
    expect((I18N.match(/set_tools:/g) || []).length).toBe(4);
    expect((I18N.match(/set_tools_sub:/g) || []).length).toBe(4);
  });

  it('no language subtitles it with a bare version', () => {
    for (const line of I18N.split('\n')) {
      if (line.includes('set_tools_sub:')) expect(line).not.toMatch(/\d+\.\d+\.\d+/);
    }
  });
});

describe('language is one row, not a heading over one row', () => {
  it('the Preferences heading is gone', () => {
    expect(SETTINGS).not.toContain("t('set_preferences'),");
  });

  it('but the row itself is still there, and still searchable', () => {
    expect(SETTINGS).toContain('testID="settings-lang"');
    // GK.preferences carries 'language translation locale' for the search box;
    // dropping the heading must not drop the row out of search results.
    expect(SETTINGS).toContain('groupVisible(GK.preferences)');
  });

  it('and the value is shown once, on the row', () => {
    const near = SETTINGS.slice(SETTINGS.indexOf('groupVisible(GK.preferences)'),
                                SETTINGS.indexOf('GK.more'));
    expect((near.match(/LANG_NAMES\[lang\]/g) || []).length).toBe(1);
  });
});
