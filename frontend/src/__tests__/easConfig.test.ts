/**
 * eas.json has to be valid before a build is worth starting.
 *
 * Two iOS env slots were added as empty strings, purely to document that they
 * exist. EAS rejects an empty value outright — "is not allowed to be empty" —
 * so the config was invalid and every build failed at the first validation
 * step, before anything useful happened.
 *
 * A variable that is absent is exactly what the code already handles
 * (`process.env.X?.trim() || ''`), so absence is the correct way to say "not
 * configured yet". Documentation belongs somewhere that cannot break a build.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const EAS = JSON.parse(readFileSync(join(__dirname, '..', '..', 'eas.json'), 'utf8'));

describe('eas.json', () => {
  const profiles = Object.keys(EAS.build || {});

  it('has the profiles the workflows invoke', () => {
    expect(profiles).toEqual(expect.arrayContaining(['preview', 'production']));
  });

  it.each(profiles)('profile %s declares no empty env value', (name) => {
    const env = EAS.build[name].env || {};
    const empty = Object.entries(env)
      .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('carries no leftover REPLACE_WITH placeholders', () => {
    // A placeholder reaching a real submit is an authentication failure ten
    // minutes into a build.
    expect(JSON.stringify(EAS)).not.toContain('REPLACE_WITH');
  });

  it('names the App Store target on both submit profiles', () => {
    for (const prof of ['internal', 'production']) {
      const ios = EAS.submit[prof].ios;
      expect(ios.appleId).toBeTruthy();
      expect(ios.ascAppId).toMatch(/^\d+$/);
      expect(ios.appleTeamId).toMatch(/^[A-Z0-9]{10}$/);
    }
  });
});
