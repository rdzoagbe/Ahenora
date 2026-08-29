import { MIN_THUMB, windowGeometry } from '../windowGeometry';

describe('windowGeometry', () => {
  it('does not cap a list that fits', () => {
    expect(windowGeometry(3, 3, [40, 40, 40], 120).windowH).toBeNull();
    expect(windowGeometry(1, 10, [40], 40).windowH).toBeNull();
  });

  it('shows exactly the first N rows when they are all the same height', () => {
    const g = windowGeometry(10, 3, Array(10).fill(40), 400);
    expect(g.windowH).toBe(120);
  });

  it('shows whole rows when the rows are different heights', () => {
    // The bug this replaces: two two-line rows first, then short ones. The
    // average row is 30pt, so the old maths capped at 90 and sliced the third
    // row in half. The first three rows are actually 50 + 50 + 20 = 120.
    const heights = [50, 50, 20, 20, 20, 20, 20, 20, 20, 20];
    const contentH = heights.reduce((a, b) => a + b, 0);
    const g = windowGeometry(heights.length, 3, heights, contentH);
    expect(g.windowH).toBe(120);
    expect(g.windowH).not.toBe((contentH / heights.length) * 3);
  });

  it('cuts nothing off when the tall rows come last', () => {
    const heights = [20, 20, 20, 50, 50, 50];
    const g = windowGeometry(heights.length, 3, heights, 210);
    expect(g.windowH).toBe(60);
  });

  it('falls back to the average until the rows have been measured', () => {
    // First frame: content size known, per-row layouts not yet delivered.
    expect(windowGeometry(10, 3, [], 400).windowH).toBe(120);
    // Partially measured is still not measured — one missing row would make
    // the sum short, which is worse than the average.
    expect(windowGeometry(10, 3, [50, 50], 400).windowH).toBe(120);
    expect(windowGeometry(10, 3, [50, 50, 0], 400).windowH).toBe(120);
  });

  it('caps nothing before anything at all has been measured', () => {
    expect(windowGeometry(10, 3, [], 0).windowH).toBeNull();
  });

  it('refuses a window taller than the content it would cap', () => {
    // Can happen for a frame while the row layouts and the content size
    // disagree; capping above the content would draw a rail with no travel.
    expect(windowGeometry(10, 3, [200, 200, 200], 400).windowH).toBeNull();
  });

  it('sizes the thumb by the share of the list on screen', () => {
    // Three rows of ten visible: the thumb is three tenths of the track.
    const g = windowGeometry(10, 3, Array(10).fill(100), 1000);
    const track = 300 - 8;
    expect(g.thumbH).toBeCloseTo(track * 0.3, 5);
    expect(g.travel).toBeCloseTo(track - g.thumbH, 5);
  });

  it('keeps the thumb grabbable on a very long list', () => {
    const g = windowGeometry(500, 3, Array(500).fill(40), 20000);
    expect(g.thumbH).toBe(MIN_THUMB);
    expect(g.travel).toBeGreaterThan(0);
  });

  it('never lets the thumb outgrow its track', () => {
    const g = windowGeometry(4, 3, [40, 40, 40, 1], 121);
    expect(g.thumbH).toBeLessThanOrEqual(g.windowH! - 8);
    expect(g.travel).toBeGreaterThanOrEqual(0);
  });

  it('reports the offset at which the thumb reaches the bottom', () => {
    const g = windowGeometry(10, 3, Array(10).fill(40), 400);
    expect(g.maxScroll).toBe(400 - 120);
  });

  it('never divides by zero on a scroll that cannot happen', () => {
    const g = windowGeometry(4, 3, [40, 40, 40, 0], 120);
    expect(Number.isFinite(g.maxScroll)).toBe(true);
    expect(g.maxScroll).toBeGreaterThan(0);
  });
});
