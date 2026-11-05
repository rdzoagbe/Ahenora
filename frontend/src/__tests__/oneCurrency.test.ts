/**
 * The app shows one currency, one way round.
 *
 * Found by photographing two screens side by side: House expenses said
 * "$0.00" and the co-parent balance beneath it said "62 €". One feature, two
 * currencies, and the symbol on opposite sides of the number.
 *
 * The cause was that `currency_symbol` was '$' in English and '€' in the other
 * three languages, while several screens skipped the key and wrote a euro
 * straight into the markup. So the symbol a household saw depended on which
 * screen they were looking at and which language they read in — and the app
 * bills in euros regardless.
 *
 * What this does NOT fix: currency is still inferred from language, which is
 * wrong in both directions — an English speaker in Dublin, a Spanish speaker
 * in Mexico City. That wants a household setting and is a decision, not a
 * defect. This only stops the app from contradicting itself.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { formatMoney } from '../money';

const ROOT = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const SCREENS = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'src'))];
const I18N = readFileSync(join(ROOT, 'src', 'i18n.ts'), 'utf8');

describe('every language names the same currency', () => {
  it('there is exactly one symbol across the four locales', () => {
    const symbols = new Set(
      [...I18N.matchAll(/currency_symbol:\s*'([^']+)'/g)].map((m) => m[1]),
    );
    expect([...symbols]).toEqual(['€']);
  });

  it('and it is defined in all four', () => {
    expect((I18N.match(/currency_symbol:/g) || []).length).toBe(4);
  });
});

describe('household money is formatted from that one place', () => {
  // src/money.ts. Each screen used to build its own text, so the list said
  // "2,40 €", Spending "€2.40", the weekly report on Home a dollar sign and the
  // receipt camera no currency at all. Now the language decides the shape, in
  // one function, and no screen writes a currency sign of its own.
  it('the co-parent balance uses it', () => {
    const body = readFileSync(
      join(ROOT, 'src', 'components', 'CoParentBalance.tsx'), 'utf8');
    expect(body).toContain('formatMoney(');
    expect(body).not.toContain("t('currency_symbol')");
  });

  it('no screen builds a money string by hand', () => {
    for (const file of SCREENS) {
      const body = readFileSync(file, 'utf8');
      const bad = [
        /t\('currency_symbol'\)/,
        /`€\$\{/,
        /\$\{[^}]*\}\s*€`/,
        />\$\{[^}]*toFixed\(2\)\}/,
      ].find((re) => re.test(body));
      if (bad) throw new Error(`${file} builds money by hand (${bad})`);
    }
  });

  it('English puts the sign first; French, Spanish and German after, with a comma', () => {
    expect(formatMoney(2.4, 'en')).toBe('€2.40');
    expect(formatMoney(2.4, 'fr')).toBe('2,40\u00a0€');
    expect(formatMoney(2.4, 'es')).toBe('2,40\u00a0€');
    expect(formatMoney(2.4, 'de')).toBe('2,40\u00a0€');
    expect(formatMoney(-5, 'fr')).toBe('−5,00\u00a0€');
  });
});
