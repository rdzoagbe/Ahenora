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

  it('is worded in all four languages', () => {
    expect((i18n.match(/^\s*exp_last_month:/gm) || []).length).toBe(4);
    expect(i18n).toContain("exp_last_month: '{month} : {amount} · {count}',");
  });
});
