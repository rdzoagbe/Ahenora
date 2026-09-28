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
import { announcement, CURRENT_RELEASE, RELEASE_NOTES, WHATS_NEW } from '../whatsNew';

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

  it('store versions keep their own notes', () => {
    expect(WHATS_NEW['1.2.0']?.length).toBeGreaterThan(0);
  });
});

describe('feedback', () => {
  it('is in the More menu, which every screen reaches', () => {
    const more = read('components', 'MoreSheet.tsx');
    expect(more).toContain("key: 'feedback'");
    expect(more).toContain('<FeedbackSheet');
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
