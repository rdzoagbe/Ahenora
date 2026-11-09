/**
 * "Ce mois-ci" is this month. It used to lead with the newest FINISHED month,
 * so on 9 November it showed October and left November's receipts out
 * (Roland, 2026-11-09). The finished month keeps its own line, with its
 * comparison, beneath this month's number. Server side (one shop however its
 * name is typed): tests/test_expenses_overview.py.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'SpendingView.tsx'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'i18n.ts'), 'utf8');

describe('this month', () => {
  it('leads with the month in progress, always', () => {
    expect(src).toContain('const lead = overview?.current ?? null;');
    expect(src).not.toContain('return finished.length ? finished[finished.length - 1] : overview.current;');
  });

  it('shows last month on its own line, with the comparison attached to it', () => {
    expect(src).toContain('testID="exp-last-month"');
    expect(src).toContain('comparison.month === lastMonth.month');
  });

  it('last month is the calendar month before this one, even when it had no receipts', () => {
    expect(src).toContain('return overview.months[overview.months.length - 2];');
  });

  it('never promises a comparison that will not come', () => {
    expect(src).not.toContain('exp_wait_for_month_end');
    expect(i18n).toContain("exp_not_enough_yet: 'Nous pourrons comparer un mois dès qu\\'il y aura trois mois complets avant lui.',");
  });

  it('the six months list every month, newest first, with what was spent and on how many receipts', () => {
    expect(src).toContain('testID="exp-month-list"');
    expect(src).toContain('{monthsShown.map((m) => (');
    // From the first month with a receipt: earlier months are not "missing".
    expect(src).toContain('return first < 0 ? months.slice(-1) : months.slice(first).reverse();');
    expect(src).toContain("{m.count > 0 ? shopsLabel(m.count) : t('exp_month_none')}");
  });

  it('averages the finished months that have receipts, saying over how many', () => {
    expect(src).toContain('.filter((m) => m.complete && m.count > 0)');
    expect(src).toContain('if (done.length < 2) return null;');
    for (const key of ['exp_month_none', 'exp_month_average_one', 'exp_month_average_n']) {
      expect((i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length).toBe(4);
    }
    expect(i18n).toContain("exp_month_average_n: 'Moyenne : {amount} par mois, sur {n} mois complets',");
  });

  it('is worded in all four languages', () => {
    expect((i18n.match(/^\s*exp_last_month:/gm) || []).length).toBe(4);
    expect(i18n).toContain("exp_last_month: '{month} : {amount} · {count}',");
  });
});
