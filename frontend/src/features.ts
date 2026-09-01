/**
 * Features that exist, work, and are deliberately not shown yet.
 *
 * A flag here hides the ENTRY POINTS only. Routes, API and data all stay live,
 * so a household that already made something can still reach it by link and
 * nothing is destroyed by flipping the switch. Deleting the code instead would
 * mean rewriting it later and losing whatever people had already created.
 */

/**
 * Secret Santa.
 *
 * Works, and is out of season. Hidden until early December, when it ships with
 * something to say about it rather than sitting unused in a menu for three
 * months — and unexplained in front of an App Store reviewer who has to decide
 * what it is.
 *
 * To reveal: set this to true and publish an OTA update. No rebuild needed,
 * because nothing native changes.
 *
 * Deliberately NOT a date window. A feature that appears on a calendar trigger
 * appears whether or not anyone is ready for it — no announcement, no support
 * note, nobody watching. Turning it on should be a decision someone makes.
 */
export const SECRET_SANTA_ENABLED = false;
