/**
 * A person can take a copy of their data from the Account screen, in every
 * language the app speaks. Deletion has been self-service from the start; the
 * privacy policy promised a portable copy and answered it by email until now.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const app = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'app', ...p), 'utf8');
const I18N = src('i18n.ts');

function inEveryLanguage(key: string): number {
  return I18N.split('\n').filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;
}

describe('downloading my data', () => {
  it('is a row on the Account screen that calls the export', () => {
    const account = app('(tabs)', 'account.tsx');
    expect(account).toContain('testID="export-data"');
    expect(account).toContain('api.exportMyData()');
    // Never a silent failure: the person is told when the copy could not be made.
    expect(account).toMatch(/Alert\.alert\(t\('acc_export'\), t\('acc_export_error'\)\)/);
  });

  it('asks the server for the copy without the images by default', () => {
    const api = src('api.ts');
    expect(api).toContain("exportMyData: (includeFiles = false)");
    expect(api).toContain('`/auth/export${');
  });

  it('speaks all four languages', () => {
    for (const key of ['acc_export', 'acc_export_sub', 'acc_export_cta', 'acc_export_working', 'acc_export_error']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });
});
