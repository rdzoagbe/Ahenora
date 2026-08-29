/**
 * The arithmetic behind WindowedList's capped, scrollable window — kept out of
 * the component so it can be tested without a renderer, which is how the rest
 * of this app's logic is tested.
 *
 * The rule the component always claimed, and until now did not keep: the
 * window is exactly N whole rows tall. The first version divided total content
 * height by row count, which only equals a row height when every row is the
 * same height. They are not — "eggs" is one line, "take Amara to the
 * orthodontist on Thursday" is two — so on a list whose early rows are the tall
 * ones, the cap fell through the middle of row three.
 */

export type WindowGeometry = {
  /** Height to cap the scroller at, or null when it should not be capped. */
  windowH: number | null;
  /** Length of the rail's thumb: the share of the list currently on screen. */
  thumbH: number;
  /** How far that thumb can travel from top to bottom of the rail. */
  travel: number;
  /** Scroll offset at which the thumb reaches the bottom. */
  maxScroll: number;
};

/** The thumb never shrinks below this, or a very long list leaves a dot. */
export const MIN_THUMB = 24;
/** The rail insets itself 4pt top and bottom. */
const RAIL_INSET = 8;

export function windowGeometry(
  count: number,
  windowSize: number,
  rowHeights: readonly number[],
  contentH: number,
): WindowGeometry {
  const none: WindowGeometry = { windowH: null, thumbH: 0, travel: 0, maxScroll: 1 };
  if (count <= windowSize) return none;

  const first = rowHeights.slice(0, windowSize);
  const measured = first.length === windowSize && first.every((h) => h > 0);

  let windowH: number;
  if (measured) {
    windowH = first.reduce((a, b) => a + b, 0);
  } else if (contentH > 0) {
    // Nothing measured yet. The average is the opening guess: one frame of a
    // slightly wrong cap beats one frame of an uncapped list shoving the page
    // around, and the measurements land on the very next layout pass.
    windowH = (contentH / count) * windowSize;
  } else {
    return none;
  }

  // A window taller than the content is not a window. This can happen for one
  // frame while measurements and the content size disagree.
  if (contentH > 0 && windowH >= contentH) return none;

  const trackH = windowH - RAIL_INSET;
  if (trackH <= 0) return { windowH, thumbH: 0, travel: 0, maxScroll: 1 };

  const thumbH = Math.max(MIN_THUMB, Math.min(trackH, trackH * (windowH / Math.max(contentH, 1))));
  return {
    windowH,
    thumbH,
    travel: Math.max(trackH - thumbH, 0),
    maxScroll: Math.max(contentH - windowH, 1),
  };
}
