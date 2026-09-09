/**
 * A date a person reads is written for a person.
 *
 * `toLocalDateInput` exists to fill a date INPUT — it returns `2026-09-09`,
 * which is exactly right in a form field and wrong the moment it is put on
 * screen as prose. ReviewImportSheet hit this, and its comment says the thing
 * worth remembering: "Seeing it on screen is what made that obvious; it looked
 * fine in the source."
 *
 * It was fixed there and nowhere else, so the two sheets people actually use —
 * the add-a-card sheet, and assigning a child a task — went on showing
 * "2026-09-09 · 18:00" where the rest of the app says "Today · 18:00". Found
 * by photographing a modal that had never been photographed.
 *
 * Source-level because the rule is about which formatter a screen may use,
 * which survives any rewrite of the sheets themselves.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');
const SHEETS = [
  join(SRC, 'src', 'components', 'AddCardModal.tsx'),
  join(SRC, 'app', '(tabs)', 'kids.tsx'),
];

describe('due dates shown to a person are human-formatted', () => {
  it('no sheet prints the input formatter as a label', () => {
    // The exact shape: `${toLocalDateInput(x)} · ${toLocalTimeInput(x)}`.
    for (const file of SHEETS) {
      const body = readFileSync(file, 'utf8');
      expect(body).not.toMatch(/\$\{toLocalDateInput\([^)]*\)\}\s*·/);
    }
  });

  it('both use the shared friendly formatter', () => {
    for (const file of SHEETS) {
      expect(readFileSync(file, 'utf8')).toContain('formatCompactDue(');
    }
  });

  it('and pass the reader’s language to it', () => {
    // formatCompactDue defaults to English. A French household reading "Today"
    // is the same bug wearing a different hat.
    for (const file of SHEETS) {
      expect(readFileSync(file, 'utf8')).toMatch(/formatCompactDue\([^)]*,\s*lang\)/);
    }
  });
});

describe('the formatter itself says something a person would say', () => {
  // Imported here rather than asserted on source: this one is pure.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { formatCompactDue } = require('../utils/date');

  it('says Today for today', () => {
    const at = new Date();
    at.setHours(18, 0, 0, 0);
    expect(formatCompactDue(at.toISOString(), 'en')).toMatch(/^Today ·/);
  });

  it('says Tomorrow for tomorrow', () => {
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(18, 0, 0, 0);
    expect(formatCompactDue(at.toISOString(), 'en')).toMatch(/^Tomorrow ·/);
  });

  it('never returns the machine form', () => {
    const at = new Date();
    at.setDate(at.getDate() + 40);
    expect(formatCompactDue(at.toISOString(), 'en')).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('answers in the reader’s language', () => {
    const at = new Date();
    at.setHours(18, 0, 0, 0);
    expect(formatCompactDue(at.toISOString(), 'fr')).toMatch(/^Aujourd/);
  });
});
