import { parseDisplayDate } from '../dateDisplay';

describe('reading back a date the app wrote', () => {
  it('reads its own output in every language the app ships', () => {
    // Written by DatePickerSheet as { day: numeric, month: short, year: numeric }.
    const cases: [string, string][] = [
      ['en-GB', '24 Dec 2026'],
      ['es', '24 dic 2026'],
      ['fr', '24 déc. 2026'],
      ['de', '24. Dez. 2026'],
    ];
    for (const [locale, text] of cases) {
      const d = parseDisplayDate(text, locale);
      expect(d).not.toBeNull();
      expect([d!.getFullYear(), d!.getMonth(), d!.getDate()]).toEqual([2026, 11, 24]);
    }
  });

  it('round-trips whatever the picker itself produces', () => {
    for (const locale of ['en-GB', 'es', 'fr', 'de']) {
      const written = new Date(2027, 2, 3)
        .toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
      const back = parseDisplayDate(written, locale);
      expect(back).not.toBeNull();
      expect([back!.getFullYear(), back!.getMonth(), back!.getDate()]).toEqual([2027, 2, 3]);
    }
  });

  it('does not let the year donate digits to the day', () => {
    // "2026" contains "20" and "26"; a naive day match takes one of them.
    const d = parseDisplayDate('4 Dec 2026', 'en-GB');
    expect(d!.getDate()).toBe(4);
  });

  it('still reads an ISO date', () => {
    const d = parseDisplayDate('2026-12-24T00:00:00.000Z', 'fr');
    expect(d!.getFullYear()).toBe(2026);
  });

  it('returns null rather than a wrong date for something it cannot read', () => {
    expect(parseDisplayDate('sometime before Christmas', 'en-GB')).toBeNull();
    expect(parseDisplayDate('', 'fr')).toBeNull();
    expect(parseDisplayDate('24 Dec', 'en-GB')).toBeNull();   // no year
  });
});
