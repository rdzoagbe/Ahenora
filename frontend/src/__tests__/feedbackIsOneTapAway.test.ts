/**
 * Feedback is one tap away, and a release says what changed.
 *
 * Nothing in the app asked families what they thought, and over-the-air
 * releases — most of what ships — arrived in silence, because the "what's
 * new" banner only knew store versions. These pin the three pieces: the
 * feedback entry in More, the week-in question on Home, and release notes
 * that exist in every language the app speaks.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { announcement, newestStoreVersion, CURRENT_RELEASE, RELEASE_NOTES, STORE_RELEASED, WHATS_NEW } from '../whatsNew';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('release notes', () => {
  it('the current release has notes, three at most', () => {
    expect(CURRENT_RELEASE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const items = RELEASE_NOTES[CURRENT_RELEASE];
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(3);
  });

  it('every note exists in every language', () => {
    const keys = [...Object.values(RELEASE_NOTES).flat(), 'update_whats_new_title_release'];
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      for (const key of keys) expect(`${lang}.${key}: ${table[key] ? 'ok' : 'missing'}`).toBe(`${lang}.${key}: ok`);
    }
  });

  it('a dated release is announced before the store version', () => {
    const a = announcement('1.2.0');
    expect(a.byDate).toBe(true);
    expect(a.key).toBe(CURRENT_RELEASE);
    expect(a.items).toEqual(RELEASE_NOTES[CURRENT_RELEASE]);
  });

  it('the newest store version announces its own notes with the dated ones', () => {
    // 1.2.1's "invitation links open the app" was outranked by the dated
    // release and never shown to anybody.
    const newest = newestStoreVersion();
    const a = announcement(newest);
    expect(a.byDate).toBe(false);
    expect(a.items.slice(0, WHATS_NEW[newest].length)).toEqual(WHATS_NEW[newest]);
    expect(a.items.length).toBeLessThanOrEqual(3);
    expect(new Set(a.items).size).toBe(a.items.length);
    // Its own key, so somebody who saw the dated notes on an older build still
    // hears about the new store version once.
    expect(a.key).not.toBe(CURRENT_RELEASE);
    expect(a.key.startsWith(newest)).toBe(true);
  });

  it('names the dated release in its key only when its notes are shown', () => {
    // 1.3.0 fills all three lines itself, so the dated notes are left out and
    // must not be recorded as seen.
    const newest = newestStoreVersion();
    const a = announcement(newest);
    const datedShown = (RELEASE_NOTES[CURRENT_RELEASE] || []).some((k) => a.items.includes(k));
    expect(a.key).toBe(datedShown ? `${newest}+${CURRENT_RELEASE}` : newest);
    expect(WHATS_NEW[newest].length).toBe(3);
    expect(a.key).toBe(newest);
  });

  it('a dated release after the newest store version is the news on it', () => {
    // 1.3.0 fills the banner with its own three notes. A later dated release
    // found no room and no new key, so it announced nothing to anybody who
    // had already dismissed the 1.3.0 notes.
    const newest = newestStoreVersion();
    const later = '2099-01-01';
    RELEASE_NOTES[later] = ['wn_aisles'];
    try {
      const a = announcement(newest, later);
      expect(a).toEqual({ key: later, items: ['wn_aisles'], byDate: true });
      // A new key, so the banner shows again for somebody who saw the store notes.
      expect(a.key).not.toBe(announcement(newest).key);
    } finally {
      delete RELEASE_NOTES[later];
    }
  });

  it('a dated release from before the newest store version does not come back', () => {
    // 2026-10-01 was announced long ago. Nobody on 1.3.0 who dismissed its
    // notes is shown the banner again because of it.
    const newest = newestStoreVersion();
    expect(STORE_RELEASED[newest]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CURRENT_RELEASE <= STORE_RELEASED[newest]).toBe(true);
    expect(announcement(newest).key).toBe(newest);
  });

  it('the newest store version says when it shipped', () => {
    // Without the date a later dated release cannot take over (see above).
    expect(STORE_RELEASED[newestStoreVersion()]).toBeTruthy();
  });

  it('knows which store version is newest', () => {
    expect(newestStoreVersion()).toBe('1.3.0');
  });

  it('store versions keep their own notes', () => {
    expect(WHATS_NEW['1.2.0']?.length).toBeGreaterThan(0);
  });
});

describe('feedback', () => {
  it('is under Help and support on Settings, which your portrait on Home opens', () => {
    // It lived in the More drawer; the drawer went on 2026-10-31.
    const settings = read('..', 'app', '(tabs)', 'settings.tsx');
    expect(settings).toContain('testID="settings-send-feedback"');
    expect(settings).toContain('<FeedbackSheet');
  });

  it('is offered where a release is announced', () => {
    expect(read('components', 'UpdateNotice.tsx')).toContain('testID="update-notice-feedback"');
  });

  it('the week-in question sits on Home', () => {
    expect(read('..', 'app', '(tabs)', 'feed.tsx')).toContain('<Day7Card />');
  });

  it('goes to the inbox marked as feedback, not as a support request', () => {
    const sheet = read('components', 'FeedbackSheet.tsx');
    expect(sheet).toMatch(/submitSupportRequest\(\{[\s\S]*kind,/);
  });

  it('every line it shows exists in every language', () => {
    const keys = ['fb_title', 'fb_help', 'fb_placeholder', 'fb_send', 'fb_sending', 'fb_thanks', 'fb_error',
      'fb_more_sub', 'fb_day7_eyebrow', 'fb_day7_q', 'fb_day7_answer', 'fb_day7_later'];
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      for (const key of keys) expect(`${lang}.${key}: ${table[key] ? 'ok' : 'missing'}`).toBe(`${lang}.${key}: ok`);
    }
  });
});
