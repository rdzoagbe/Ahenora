/**
 * Whether the phone bar's contents fit, and by how much.
 *
 * Written down rather than eyeballed because the question "does a fifth seat
 * fit beside More?" was answered wrongly three times, twice by me with
 * confident arithmetic. The arithmetic was fine; the number underneath it was
 * invented. I had carried "the widest label is German Kalender at 55pt" all
 * session without measuring it. Kalender is 47pt, the same as Calendar, and
 * English is in fact our widest language, not German.
 *
 * So every number below is a browser measurement, and the nav harness
 * re-measures the real rendered boxes in all four languages on every run. A
 * wrong value here fails there rather than shipping.
 *
 * The bar is two objects: a pill holding the five places, and More beside it
 * holding what is not a place — settings, your account, the hand-over.
 */
export const BAR_INSET = 16;        // barWrap left / right
export const BAR_GAP = 8;           // between the pill and the More button
/**
 * More: icon only, and exactly the 44pt minimum tap target.
 *
 * It was 62pt with a 10pt label reading "More" under a grid icon — a word that
 * said what the icon says, spending 18pt the fifth seat needed. At 48 the
 * narrowest phone had 5pt of slack, which is the kind of margin that has
 * already been wrong twice this session; 44 makes it 9.
 */
export const MORE_WIDTH = 44;
export const PILL_PADDING = 6;      // the pill's own paddingHorizontal
export const SEAT_PADDING = 2;      // tabItem paddingHorizontal, per side
export const LABEL_FONT_SIZE = 11;
/** adjustsFontSizeToFit's floor. Native only — see barFits. */
export const LABEL_MIN_SCALE = 0.8;

/**
 * tabItem minWidth — the floor under the focused seat's accent pill.
 *
 * This, not the words, is what decides whether the bar fits. Four of the five
 * labels are shorter than the floor, so at 46pt the bar spent 235pt on 215pt
 * of content and overflowed a 320pt phone; at 40 it spends 215pt and clears
 * every phone we support. A 22pt icon needs 26pt, so 40 is still a pill and
 * not a squeeze.
 */
export const SEAT_MIN_WIDTH = 40;

/**
 * Every tab label, in points, measured in a browser at 11px Inter ExtraBold
 * with -0.1 letter-spacing: Feed · Calendar · Family · Kitchen · Vault, in bar
 * order, for each language we ship.
 *
 * English is the widest set, which is the opposite of what you would guess and
 * the reason this is a table of measurements rather than one remembered
 * worst case.
 */
export const MEASURED_LABEL_PT: Record<string, number[]> = {
  en: [26, 47, 34, 40, 27],
  de: [26, 47, 37, 33, 34],
  fr: [12, 40, 37, 39, 33],
  es: [26, 40, 37, 36, 39],
};

/** The narrowest phone we support (iPhone SE 1st gen / small Androids). */
export const NARROWEST_PHONE_PT = 320;

/** How wide the pill is, once More and the insets have taken their share. */
export function pillWidth(screenWidth: number): number {
  return screenWidth - BAR_INSET * 2 - BAR_GAP - MORE_WIDTH;
}

/**
 * One seat's width. Sized to its own word, not to an equal share.
 *
 * Equal shares are what made this impossible: they spend as much on "Feed" as
 * on "Calendar", so the bar has to fit five copies of its longest label. Sized
 * to content, the five together need about what three equal seats would.
 */
export function seatWidth(labelPt: number): number {
  return Math.max(SEAT_MIN_WIDTH, labelPt + SEAT_PADDING * 2);
}

/** What all the seats need together, for one language. */
export function contentWidth(labels: number[]): number {
  return labels.reduce((total, label) => total + seatWidth(label), 0);
}

/** Room left over once the seats have taken theirs. Negative means overlap. */
export function slackAt(screenWidth: number, lang: string): number {
  const labels = MEASURED_LABEL_PT[lang];
  if (!labels) return NaN;
  return pillWidth(screenWidth) - PILL_PADDING * 2 - contentWidth(labels);
}

/** Whether the bar holds at this width, in every language we ship. */
export function barFits(screenWidth: number): boolean {
  return Object.keys(MEASURED_LABEL_PT).every((lang) => slackAt(screenWidth, lang) >= 0);
}
