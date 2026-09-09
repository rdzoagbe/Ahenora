/**
 * The arithmetic that decides how many seats the phone bar can hold.
 *
 * It lives here rather than inline in the tab bar's StyleSheet because the
 * question "does a fifth seat fit?" was answered twice by eye and once by
 * measurement, and only the measurement was right. A number a test can read is
 * a number that cannot quietly drift when someone nudges a padding.
 *
 * The bar is a pill floating between two insets. Its inner width, less its own
 * padding, is split evenly between the seats; each seat spends its padding and
 * gives the rest to the label.
 *
 * These are FIXED, deliberately. The first version of this file branched on
 * useWindowDimensions().width to give narrow phones a tighter bar, and shipped
 * a 12pt inset to a 390pt phone: the web export's first paint reports a
 * degenerate window width (src/responsive.ts documents the same trap costing a
 * ~90px-wide Feed), so a layout that reads the width at mount latches whatever
 * that first measurement said. One geometry that fits everywhere beats a
 * clever one that depends on a number we cannot trust.
 */
export const BAR_INSET = 20;        // barWrap left / right
export const PILL_PADDING = 6;      // the pill's own paddingHorizontal
export const SEAT_PADDING = 2;      // tabItem paddingHorizontal, per side
export const SEAT_MIN_WIDTH = 46;   // tabItem minWidth — the accent pill's floor
export const LABEL_FONT_SIZE = 11;
/** adjustsFontSizeToFit's floor. Native only — see labelsFit. */
export const LABEL_MIN_SCALE = 0.8;

/**
 * The widest tab label across the four languages we ship, in points, measured
 * in a browser at 11px Inter ExtraBold with -0.1 letter-spacing — German
 * "Kalender". English "Calendar" is 54, "Kitchen" 47, "Family" 40, "Vault" 32,
 * "Feed" 29. Re-measure if a language or a label is added; the browser harness
 * measures the real rendered boxes on every run, so a wrong value here fails
 * there rather than shipping.
 */
export const WIDEST_LABEL_PT = 55;

/** Above this width every label fits at full size, in every language. */
export const COMFORTABLE_PHONE_PT = 360;
/** The narrowest phone we support (iPhone SE 1st gen / small Androids). */
export const NARROWEST_PHONE_PT = 320;

/** How much room one seat's label gets, in points. */
export function seatLabelWidth(screenWidth: number, seats: number): number {
  const pill = screenWidth - BAR_INSET * 2 - PILL_PADDING * 2;
  return pill / seats - SEAT_PADDING * 2;
}

/**
 * Whether every label fits outright, with nothing shrunk.
 *
 * Outright, not "after adjustsFontSizeToFit": that prop is native-only, so on
 * the web build nothing shrinks. Below COMFORTABLE_PHONE_PT the longest German
 * label runs out of room — it then shrinks on a phone and ellipsises on the
 * web, which is why the seat is also structurally capped at its share of the
 * pill (maxWidth in the tab bar). Degrading is fine; overlapping the seat next
 * to it is not.
 */
export function labelsFit(screenWidth: number, seats: number): boolean {
  return seatLabelWidth(screenWidth, seats) >= WIDEST_LABEL_PT;
}

/** Whether the seats themselves fit without overflowing the pill. */
export function seatsFit(screenWidth: number, seats: number): boolean {
  return screenWidth - BAR_INSET * 2 - PILL_PADDING * 2 >= SEAT_MIN_WIDTH * seats;
}
