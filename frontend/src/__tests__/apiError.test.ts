/**
 * A server's words are for the log, never for a person.
 *
 * A French household ran out of AI scans and was shown "AI scan limit reached
 * for this billing period." — the backend's own English, printed verbatim,
 * because every call site wrote `e?.message || t('fallback')` and `e.message`
 * wins that expression whenever the server said anything at all.
 */
import fs from 'fs';
import path from 'path';
import { apiErrorText, isAiAllowanceError, isPlanLimitError } from '../apiError';

const t = (key: string) => key;

describe('what a failed call says out loud', () => {
  it('never repeats the server back at the user', () => {
    const outOfScans = Object.assign(new Error('AI scan limit reached for this billing period.'), {
      status: 402,
      planLimit: { feature: 'ai_scans' },
    });
    const said = apiErrorText(outOfScans, t, 'scan_failed');
    expect(said).toBe('err_ai_allowance');
    expect(said).not.toContain('billing period');
  });

  it('tells an allowance that returns next month apart from a plan that never had it', () => {
    const allowance = { status: 402, planLimit: { feature: 'ai_scans' } };
    const feature = { status: 402, planLimit: { feature: 'weekly_brief' } };
    expect(apiErrorText(allowance, t, 'x')).toBe('err_ai_allowance');
    expect(apiErrorText(feature, t, 'x')).toBe('err_plan_feature');
    expect(isAiAllowanceError(allowance)).toBe(true);
    expect(isAiAllowanceError(feature)).toBe(false);
    expect(isPlanLimitError(feature)).toBe(true);
  });

  it('has a sentence for the failures people actually meet', () => {
    expect(apiErrorText({ status: 401 }, t, 'x')).toBe('err_signed_out');
    expect(apiErrorText({ status: 413 }, t, 'x')).toBe('err_too_large');
    expect(apiErrorText({ status: 500 }, t, 'x')).toBe('err_server');
    // No status is what fetch leaves behind when the network is gone.
    expect(apiErrorText(new Error('Network request failed'), t, 'x')).toBe('err_offline');
  });

  it('falls back to what this particular action says', () => {
    expect(apiErrorText({ status: 422 }, t, 'exp_scan_failed')).toBe('exp_scan_failed');
  });

  it('translates every new key in all four languages', () => {
    const I18N = fs.readFileSync(path.join(__dirname, '..', 'i18n.ts'), 'utf8');
    for (const key of ['err_ai_allowance', 'err_plan_feature', 'err_signed_out',
                       'err_too_large', 'err_server', 'err_offline',
                       'scans_left', 'scans_none_left']) {
      expect((I18N.match(new RegExp(`^\\s*${key}:`, 'gm')) || [])).toHaveLength(4);
    }
  });
});

describe('the AI surfaces that can run out', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

  it('the Kitchen never prints a raw server message', () => {
    // Where the reported failure happened. Planning a week spends a scan per
    // recipe opened, so this is the file most likely to meet the wall — and it
    // had seven separate places that would have shown the backend's English.
    expect(read('app/(tabs)/kitchen.tsx')).not.toMatch(/e\?\.message \|\| t\(/);
  });

  it('no AI path prints the raw server message any more', () => {
    for (const file of [
      'app/(tabs)/kitchen.tsx',
      'src/components/SpendingView.tsx',
      'src/components/CameraCaptureModal.tsx',
    ]) {
      const src = read(file);
      // The specific expression that leaked English into four languages.
      expect(src).not.toMatch(/e\?\.message \|\| t\('(scan_failed|exp_scan_failed|cam_vision_failed|recipe_ai_failed)'\)/);
      expect(src).toContain('apiErrorText');
    }
  });

  it('warns before the wall, on the sheets that spend the allowance', () => {
    // The count used to live only in Settings, which nobody opens before
    // photographing a school letter — so the first mention of a limit was the
    // limit stopping you.
    for (const file of ['app/(tabs)/kitchen.tsx', 'src/components/CameraCaptureModal.tsx']) {
      expect(read(file)).toContain('<ScansLeft />');
    }
    const comp = read('src/components/ScansLeft.tsx');
    // Only when it is nearly gone: a counter on every scan turns a generous
    // allowance into something to ration.
    expect(comp).toContain('left > WARN_AT');
    // And never on a plan whose ceiling nobody can reach.
    expect(comp).toContain('limit >= 1000');
  });

  it('running out of scans hands the shopping list back to the person', () => {
    // The sheet must close and let the manual add take over. An allowance that
    // runs out is not permission to stop somebody adding their own shopping.
    const kitchen = read('app/(tabs)/kitchen.tsx');
    expect(kitchen).toContain('isAiAllowanceError');
    expect(kitchen).toMatch(/isAiAllowanceError\(e\)\s*\)\s*\{[\s\S]{0,200}setShowScan\(false\)/);
  });
});
