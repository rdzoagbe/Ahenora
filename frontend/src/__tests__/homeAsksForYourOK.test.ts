/**
 * Home asks for your OK on what the children finished.
 *
 * Roland, 2026-11-03, "go with 3": a child's ticked job or task pays nothing
 * until a grown-up approves it, and the queue lived only on the Family tab and
 * in a notification. Home now shows it, and the stars are chosen right there.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const feed = read('app', '(tabs)', 'feed.tsx');
const card = read('src', 'components', 'HomeApprovals.tsx');
const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];

describe('the approvals on Home', () => {
  it('loads the same queue as the Family tab, without ever taking Home down', () => {
    expect(feed).toContain('api.getTeenApprovals().then((r) => setApprovals(r.approvals)).catch(() => undefined);');
  });

  it('offers the Family tab’s star choices in one tap, with no pop-up', () => {
    expect(card).toContain('export const STAR_CHOICES = [1, 3, 5] as const;');
    expect(card).toContain('onPress={() => onApprove(r.card_id, n)}');
    expect(card).not.toMatch(/Alert\./);
    expect(feed).toContain('onApprove={(id, n) => resolveApproval(id, true, n)}');
    expect(feed).toContain('await api.resolveTeenApproval(id, approve, stars);');
  });

  it('lets a parent say it was not done, which pays nothing', () => {
    expect(feed).toContain('onDismiss={(id) => resolveApproval(id, false)}');
  });

  it('takes a row away at once and puts it back if the server refused', () => {
    const fn = feed.slice(feed.indexOf('const resolveApproval = async'), feed.indexOf('return (\n    <SwipeableTabView'));
    expect(fn).toContain('if (approvingId) return;');
    expect(fn).toContain('setApprovals((prev) => prev.filter((a) => a.card_id !== id));');
    expect(fn).toContain('if (row) setApprovals((prev) => [row, ...prev]);');
  });

  it('shows a few and sends the rest to the Family page', () => {
    expect(card).toContain('export const HOME_APPROVALS_SHOWN = 3;');
    expect(feed).toContain("onMore={() => router.navigate('/(tabs)/kids' as never)}");
  });

  it('is not shown while the children’s side is put away, and says nothing when empty', () => {
    expect(feed).toMatch(/\{kidsHidden \? null : \(\s*<HomeApprovals/);
    expect(card).toContain('if (rows.length === 0) return null;');
  });
});

describe('every new string exists in all four languages', () => {
  it.each(['home_approvals_title', 'home_approvals_more', 'home_approve_n'])('%s', (key) => {
    LANGS.forEach((lang) => {
      expect(`${lang}.${key}: ${(TRANSLATIONS[lang] as Record<string, string>)[key] ?? ''}`).not.toMatch(/: $/);
    });
  });
});
