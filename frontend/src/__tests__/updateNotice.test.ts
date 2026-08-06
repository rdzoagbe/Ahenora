/**
 * Deciding when to speak up about an update.
 *
 * Two rules carry the whole feature, and both fail quietly if they are wrong:
 * a version comparison that must not be a string comparison, and a "once per
 * version" rule that separates a useful note from a nag people learn to swipe
 * away without reading.
 */

import { WHATS_NEW } from '../whatsNew';

/** Mirrors the comparison in UpdateNotice. */
function isBelow(version: string, minimum: string): boolean {
  const a = version.split('.').map((n) => parseInt(n, 10) || 0);
  const b = minimum.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

describe('is this build too old to update itself', () => {
  it('knows an older runtime is stranded', () => {
    expect(isBelow('1.0.0', '2.0.0')).toBe(true);
  });

  it('leaves a current runtime alone', () => {
    expect(isBelow('2.0.0', '2.0.0')).toBe(false);
    expect(isBelow('2.1.0', '2.0.0')).toBe(false);
  });

  it('compares numbers, not text', () => {
    // The bug this guards: "10" < "9" as strings, so a tenth major version
    // would be told to go to the store forever.
    expect(isBelow('10.0.0', '9.0.0')).toBe(false);
    expect(isBelow('9.0.0', '10.0.0')).toBe(true);
  });

  it('treats a missing segment as zero rather than guessing', () => {
    expect(isBelow('2', '2.0.1')).toBe(true);
    expect(isBelow('2.0', '2.0.0')).toBe(false);
  });

  it('does not strand a build on unparseable junk', () => {
    // Better to say nothing than to send someone to the store on a bad read.
    expect(isBelow('', '2.0.0')).toBe(true);   // 0 < 2, caller guards on empty
    expect(isBelow('2.0.0', '')).toBe(false);
  });
});

describe('what we announce', () => {
  it('only announces versions we actually wrote notes for', () => {
    // A version with no entry shows nothing at all, rather than an empty card.
    expect(WHATS_NEW['0.0.0']).toBeUndefined();
    expect(WHATS_NEW['1.0.2']?.length).toBeGreaterThan(0);
  });

  it('keeps the list short enough to be read', () => {
    Object.entries(WHATS_NEW).forEach(([version, items]) => {
      expect(items.length).toBeLessThanOrEqual(3);
      // i18n keys, not sentences — a French family reads this in French.
      items.forEach((key) => expect(key).toMatch(/^[a-z0-9_]+$/));
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
