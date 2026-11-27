/**
 * A receipt's date can be trusted, or corrected.
 *
 * Roland, 2026-11-27: a Carrefour receipt from that day sat first in the
 * list as "Nov 27" and was missing from November's total (€225.28 where the
 * four receipts added up to €324.09). The total counts a receipt in the
 * month of its date; the list showed anything added lately, with no year.
 * A date read with the wrong year is in the list and in no month on the
 * page. This pins:
 *
 *  - what a date is, and when one deserves a second look;
 *  - a row shows its year when that is not this one;
 *  - the review says a far-off date out loud, with the way back to today;
 *  - a saved date can be corrected, from the row, without deleting it.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { OLD_RECEIPT_DAYS, datedLongBefore, dateIsSuspect, daysAgo, parseDay, receiptDayLabel, receiptDayLong, todayISO } from '../receiptDate';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const screen = read('src', 'components', 'SpendingView.tsx');
const today = new Date(2026, 10, 27, 18, 7); // 27 November 2026, 18:07

describe('a date', () => {
  it('is a real calendar day written YYYY-MM-DD, and nothing else', () => {
    expect(parseDay('2026-11-27')?.getDate()).toBe(27);
    expect(parseDay(' 2026-11-27 ')?.getMonth()).toBe(10);
    for (const bad of ['', '27/11/2026', '2026-11', '2026-02-31', '2026-13-01', 'tomorrow', null, undefined]) {
      expect([bad, parseDay(bad)]).toEqual([bad, null]);
    }
  });

  it('is counted in whole days, whatever the hour', () => {
    expect(daysAgo(new Date(2026, 10, 27, 0, 1), today)).toBe(0);
    expect(daysAgo(new Date(2026, 10, 26, 23, 59), today)).toBe(1);
    expect(daysAgo(new Date(2025, 10, 27), today)).toBe(365);
  });
});

describe('a date that deserves a second look', () => {
  it('is one far in the past, or after today', () => {
    expect(OLD_RECEIPT_DAYS).toBe(45);
    expect(dateIsSuspect('2025-11-27', today)).toBe(true); // the wrong year
    expect(dateIsSuspect('2026-11-28', today)).toBe(true); // tomorrow
    expect(dateIsSuspect('2026-10-12', today)).toBe(true); // 46 days
  });

  it('is not today, last week, or last month', () => {
    expect(dateIsSuspect('2026-11-27', today)).toBe(false);
    expect(dateIsSuspect('2026-11-20', today)).toBe(false);
    expect(dateIsSuspect('2026-10-13', today)).toBe(false); // 45 days
  });

  it('is not a date still being typed', () => {
    expect(dateIsSuspect('2026-1', today)).toBe(false);
    expect(dateIsSuspect('', today)).toBe(false);
  });
});

describe('how a date is written', () => {
  it('shows the year on a row only when it is not this one', () => {
    expect(receiptDayLabel('2026-11-27', 'en-GB', today)).toBe('27 Nov');
    expect(receiptDayLabel('2025-11-27', 'en-GB', today)).toBe('27 Nov 2025');
    expect(receiptDayLabel('2025-11-27', 'fr-FR', today)).toContain('2025');
  });

  it('is in full on the review', () => {
    expect(receiptDayLong('2025-11-27', 'en-GB')).toBe('27 November 2025');
    expect(receiptDayLong('not a date', 'en-GB')).toBe('not a date');
  });
});

describe('the screen', () => {
  it('writes a row with its year when that is not this one', () => {
    expect(screen).toContain('const dayLabel = (iso: string) => receiptDayLabel(iso, locale, new Date());');
  });

  it('says a far-off date out loud on the review, with the way back to today', () => {
    expect(screen).toContain('{dateIsSuspect(when, new Date()) ? (');
    expect(screen).toContain('testID="exp-scan-date-warn"');
    expect(screen).toContain("t('exp_scan_old_date', { date: receiptDayLong(when, locale) })");
    expect(screen).toContain('testID="exp-scan-date-today"');
    expect(screen).toContain('onPress={() => setWhen(todayISO())}');
  });

  it('lets a saved date be corrected from its row, and refuses what is not a date', () => {
    expect(screen).toContain('testID={`exp-row-${e.expense_id}`}');
    expect(screen).toContain('testID="exp-row-date"');
    expect(screen).toContain('testID="exp-row-date-save"');
    expect(screen).toContain('await api.setExpenseDate(saved, dateDraft.trim());');
    expect(screen).toContain('if (!parseDay(dateDraft)) {');
    const api = read('src', 'api.ts');
    expect(api).toContain("request<Expense>(`/expenses/${expenseId}/date?spent_on=${encodeURIComponent(spentOn)}`, { method: 'PATCH' })");
  });

  it('marks a row dated long before the day it was added, and says so to a screen reader', () => {
    expect(screen).toContain('datedLongBefore(e.spent_on, e.created_at) && { color: ui.orangeText }');
    expect(screen).toContain("datedLongBefore(e.spent_on, e.created_at) ? `, ${t('exp_date_far')}` : ''");
    expect(datedLongBefore('2025-11-27', '2026-11-27T17:07:00+00:00')).toBe(true);
    expect(datedLongBefore('2026-11-09', '2026-11-27T17:07:00+00:00')).toBe(false);
    // A day ahead of when it was added is UTC for a family west of it.
    expect(datedLongBefore('2026-11-28', '2026-11-27T23:30:00-08:00')).toBe(false);
    expect(datedLongBefore('', '2026-11-27T17:07:00+00:00')).toBe(false);
  });

  it('asks the same question on the typed form and on the one-tap camera', () => {
    expect(screen).toContain('testID="exp-date-warn"');
    expect(screen).toContain('testID="exp-date-today"');
    const camera = read('src', 'components', 'CameraCaptureModal.tsx');
    expect(camera).toContain('dateIsSuspect(receiptDate || receipt.date, new Date())');
    expect(camera).toContain('testID="cam-receipt-date-today"');
    // "Today" is this phone's today, sent explicitly: left out, the server
    // would use UTC's, which is another day in the evening west of Greenwich.
    expect(camera).toContain('onPress={() => setReceiptDate(todayISO())}');
    expect(camera).toContain('spent_on: receiptDate || receipt.date || undefined,');
    expect(todayISO(new Date(2026, 10, 30, 20, 0))).toBe('2026-11-30');
    expect(todayISO(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05');
  });

  it('says when the reader corrected the date it read, and offers that date back', () => {
    expect(screen).toContain('{scan.date_read && when === scan.date ? (');
    expect(screen).toContain('testID="exp-scan-date-keep"');
    expect(screen).toContain("onPress={() => setWhen(scan.date_read || '')}");
    const camera = read('src', 'components', 'CameraCaptureModal.tsx');
    expect(camera).toContain('{receipt.date_read && !receiptDate ? (');
    expect(camera).toContain('onPress={() => setReceiptDate(receipt.date_read || null)}');
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect(table.exp_scan_date_adjusted).toContain('{read}');
      expect(table.exp_scan_date_adjusted).toContain('{used}');
      expect(table.exp_scan_date_keep).toContain('{read}');
    }
  });

  it('keeps another row open when the one that was saving finishes', () => {
    expect(screen).toContain('setDateFor((cur) => (cur === saved ? null : cur));');
    expect(screen).toContain('onSubmitEditing={saveDate}');
  });

  it('says every new thing in all four languages', () => {
    for (const key of ['exp_scan_old_date', 'exp_use_today', 'exp_edit_date', 'exp_edit_date_hint', 'exp_date_saved', 'exp_date_invalid', 'exp_date_far', 'exp_scan_date_adjusted', 'exp_scan_date_keep']) {
      for (const lang of LANGS) {
        expect([lang, key, typeof (TRANSLATIONS[lang] as Record<string, unknown>)[key]]).toEqual([lang, key, 'string']);
      }
    }
    for (const lang of LANGS) {
      expect((TRANSLATIONS[lang] as Record<string, string>).exp_scan_old_date).toContain('{date}');
    }
  });
});
