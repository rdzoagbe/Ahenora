/**
 * The Vault opens on what needs attention.
 *
 * The final design Roland chose (2026-10-26): "Family documents" over the
 * tab, a search box, the drawers as chips, then the one document closest to
 * running out as a card, then every document as a row saying whose it is
 * and when it runs out. The storage meter, the add sheet, the preview and
 * the expiry picker stay as they were. This pins:
 *
 *  - how far off a date is reads the way a person says it: days, then
 *    weeks, then months, and "expired … ago" once it has passed;
 *  - the headline is the soonest to run out, the already-expired first;
 *  - a search answers on the title, the drawer, or whose it is;
 *  - your own document says "You", another's says their name;
 *  - the screen draws the search, the card and the rows, and the storage
 *    meter has moved below the list rather than gone;
 *  - every new string exists in all four languages.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { CLOSE_DAYS, closeAlerts, daysUntil, expiryPhrase, groupByDrawer, headlineAlert, matchesQuery, ownerLine, whenLabel } from '../vaultTop';
import type { ExpiryAlert } from '../api';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const screen = read('app', '(tabs)', 'vault.tsx');
const t = (key: string, params?: Record<string, string | number>) =>
  Object.entries(params || {}).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key);
const now = new Date('2026-10-29T12:00:00Z');
const alert = (doc_id: string, days_left: number): ExpiryAlert =>
  ({ doc_id, title: doc_id, category: 'Medical', expiry_date: '', days_left, status: days_left < 0 ? 'expired' : 'soon' });

describe('how far off a date is', () => {
  it('reads as days, then weeks, then months', () => {
    expect(whenLabel(1, t)).toBe('vault_one_day');
    expect(whenLabel(5, t)).toBe('vault_n_days');
    expect(whenLabel(13, t)).toBe('vault_n_days');
    expect(whenLabel(14, t)).toBe('vault_n_weeks');
    expect(whenLabel(10, (k, p) => `${k}:${p?.n}`)).toBe('vault_n_days:10');
    expect(whenLabel(21, (k, p) => `${k}:${p?.n}`)).toBe('vault_n_weeks:3');
    expect(whenLabel(60, (k, p) => `${k}:${p?.n}`)).toBe('vault_n_months:2');
    expect(whenLabel(125, (k, p) => `${k}:${p?.n}`)).toBe('vault_n_months:4');
    expect(whenLabel(-3, t)).toBe('vault_n_days');
  });

  it('says expires in, or expired ago, or nothing for a document that does not run out', () => {
    expect(daysUntil('2026-11-02T12:00:00Z', now)).toBe(4);
    expect(expiryPhrase({ expiry_date: '2026-11-02T12:00:00Z' }, now, t)).toBe('vault_expires_in');
    expect(expiryPhrase({ expiry_date: '2026-10-26T12:00:00Z' }, now, t)).toBe('vault_expired_ago');
    expect(expiryPhrase({ expiry_date: null }, now, t)).toBeNull();
    expect(expiryPhrase({ expiry_date: 'never' }, now, t)).toBeNull();
  });
});

describe('the headline', () => {
  it('is the soonest to run out, with the already-expired first', () => {
    expect(headlineAlert([alert('a', 40), alert('b', 5), alert('c', 120)])?.doc_id).toBe('b');
    expect(headlineAlert([alert('a', 40), alert('gone', -3)])?.doc_id).toBe('gone');
    expect(headlineAlert([])).toBeNull();
  });
});

describe('search and whose', () => {
  const doc = { title: 'Health card', category: 'Medical', owner_name: 'Sam', owner_user_id: 'u_sam' };

  it('answers on the title, the drawer, or whose it is, and on nothing typed', () => {
    expect(matchesQuery(doc, 'health')).toBe(true);
    expect(matchesQuery(doc, 'MEDICAL')).toBe(true);
    expect(matchesQuery(doc, 'sam')).toBe(true);
    expect(matchesQuery(doc, 'passport')).toBe(false);
    expect(matchesQuery(doc, '   ')).toBe(true);
  });

  it('says You for your own document, else the name, else nothing', () => {
    expect(ownerLine(doc, 'u_sam', t)).toBe('hub_you');
    expect(ownerLine(doc, 'u_me', t)).toBe('Sam');
    expect(ownerLine({ owner_name: '', owner_user_id: null }, 'u_me', t)).toBeNull();
  });
});

describe('what is close to running out', () => {
  // Tidy-up Roland approved on 2026-11-24 ("go"): the page only raises what
  // is close. The old alert list called an ID card with 1,558 days left an
  // alert, and repeated documents already shown above it.
  it('is what has run out or will within ninety days, soonest first', () => {
    expect(CLOSE_DAYS).toBe(90);
    const close = closeAlerts([alert('far', 1558), alert('soon', 60), alert('gone', -3), alert('edge', 90), alert('later', 91)]);
    expect(close.map((a) => a.doc_id)).toEqual(['gone', 'soon', 'edge']);
    expect(closeAlerts([alert('far', 400)])).toEqual([]);
  });
});

describe('the drawers', () => {
  const d = (title: string, category: string) => ({ title, category });
  it('keep their order, leave out the empty ones, and never hide a stray', () => {
    const groups = groupByDrawer([d('a', 'School'), d('b', 'Medical'), d('c', 'School'), d('x', 'Other')], ['Medical', 'School', 'Insurance']);
    expect(groups.map((g) => [g.key, g.items.map((i) => i.title)])).toEqual([
      ['Medical', ['b']], ['School', ['a', 'c']], ['Other', ['x']],
    ]);
    expect(groupByDrawer([], ['Medical'])).toEqual([]);
  });
});

describe('the screen', () => {
  it('opens on family documents, with a search and the drawers', () => {
    expect(screen).toContain("title={t('vault_family_documents')}");
    expect(screen).toContain('testID="vault-search"');
    expect(screen).toContain('docs.filter((d) => matchesQuery(d, query))');
    expect(screen).toContain('groupByDrawer(filtered, CATEGORIES.map((c) => c.key))');
    expect(screen).toContain('testID={`vault-drawer-${key}`}');
    // The row of filter chips went: grouped, the list does that job.
    expect(screen).not.toContain('vault-filter-');
  });

  it('says what needs renewing in the corner, and has one Add that says what it adds', () => {
    const header = screen.slice(screen.indexOf('<ScreenHeader'), screen.indexOf('{docs.length === 0 && !loading ? ('));
    expect(header).toContain('testID="vault-tile"');
    expect(header).toContain("t(close.length > 0 ? 'vault_tile_renew' : 'vault_tile_stored')");
    expect(header).toContain('showAdd={false}');
    expect(header).toContain("accessibilityLabel={t('add_document')}");
  });

  it('puts the one that needs attention first, the other close ones under it, and nothing twice', () => {
    expect(screen).toContain('testID="vault-attention"');
    expect(screen).toContain('const close = useMemo(() => closeAlerts(expiryAlerts), [expiryAlerts]);');
    expect(screen).toContain('const headline = close[0] || null;');
    expect(screen).toContain('const otherAlerts = close.slice(1, 4);');
    expect(screen).not.toContain("t('vault_expiry_alerts')");
  });

  it('greets a first visit with one sentence and one thing to do', () => {
    expect(screen).toContain("{t('vault_intro')}");
    expect(screen).toContain('testID="vault-empty-add"');
    expect(screen).not.toContain('FirstRunTip');
  });

  it('says whose a row is and when it runs out', () => {
    expect(screen).toContain('ownerLine(d, user?.user_id, t)');
    expect(screen).toContain("expiryPhrase(d, now, t) || t('vault_no_expiry')");
  });

  it('keeps the storage meter, below the list', () => {
    const list = screen.indexOf('testID="vault-all-documents"');
    const meter = screen.indexOf('testID="vault-storage"');
    expect(list).toBeGreaterThan(0);
    expect(meter).toBeGreaterThan(list);
  });

  it('says every new thing in all four languages', () => {
    for (const key of ['vault_family_documents', 'vault_search_docs', 'vault_needs_attention', 'vault_all_documents',
      'vault_expires_in', 'vault_expired_ago', 'vault_n_days', 'vault_one_day', 'vault_n_weeks', 'vault_one_week',
      'vault_n_months', 'vault_open', 'vault_tile_renew', 'vault_tile_stored', 'vault_renew_soon', 'vault_open_doc',
      'vault_add_pill', 'vault_intro', 'vault_first_photo', 'vault_or_file', 'vault_you_choose', 'vault_no_match']) {
      for (const lang of LANGS) {
        expect([lang, key, typeof (TRANSLATIONS[lang] as Record<string, unknown>)[key]]).toEqual([lang, key, 'string']);
      }
    }
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      for (const key of ['vault_expires_in', 'vault_expired_ago']) expect(table[key]).toContain('{when}');
      for (const key of ['vault_n_days', 'vault_n_weeks', 'vault_n_months']) expect(table[key]).toContain('{n}');
    }
  });
});
