/**
 * The rules for relaunching the app under somebody.
 *
 * An over-the-air update applies on the NEXT cold start, so a release
 * published overnight reaches people on their second open — that evening, next
 * week, or never. Applying it during the first seconds of a launch turns that
 * into a launch that took a beat longer.
 *
 * The entire risk is relaunching over somebody who is mid-something, so every
 * test here is about refusing to.
 */
import {
  AWAY_MS, GRACE_MS, isFreshStart, shouldAutoApplyUpdate,
} from '../autoApplyUpdate';

const NOW = 1_700_000_000_000;

const base = {
  enabled: true,
  pending: true,
  foregroundAt: NOW - 1200,
  now: NOW,
  lastInteractionAt: 0,
  keyboardVisible: false,
};

describe('applying a staged update silently', () => {
  it('does it when the launch is fresh and nobody has touched anything', () => {
    expect(shouldAutoApplyUpdate(base)).toBe(true);
  });

  it('does nothing when there is nothing staged', () => {
    expect(shouldAutoApplyUpdate({ ...base, pending: false })).toBe(false);
  });

  it('does nothing where updates do not apply this way', () => {
    // The web app reloads itself; a build without expo-updates has nothing to
    // apply and would reload for no reason at all.
    expect(shouldAutoApplyUpdate({ ...base, enabled: false })).toBe(false);
  });

  it('never reloads over a keyboard', () => {
    // A keyboard up means a focused field, and a focused field may hold
    // half-typed words. This is the guard that stops the feature from being a
    // way to lose somebody's note.
    expect(shouldAutoApplyUpdate({ ...base, keyboardVisible: true })).toBe(false);
  });

  it('never reloads after somebody has pressed something', () => {
    const pressed = { ...base, lastInteractionAt: base.foregroundAt + 300 };
    expect(shouldAutoApplyUpdate(pressed)).toBe(false);
  });

  it('ignores a press from before this session began', () => {
    // They used the app, left it for an hour, and came back. That press says
    // nothing about whether they are busy now.
    const old = { ...base, lastInteractionAt: base.foregroundAt - 60_000 };
    expect(shouldAutoApplyUpdate(old)).toBe(true);
  });

  it('stops once the launch has settled', () => {
    const late = { ...base, foregroundAt: NOW - (GRACE_MS + 1) };
    expect(shouldAutoApplyUpdate(late)).toBe(false);
    expect(shouldAutoApplyUpdate({ ...base, foregroundAt: NOW - (GRACE_MS - 1) })).toBe(true);
  });

  it('refuses a clock that has gone backwards', () => {
    // A device whose clock jumps would otherwise read as "0ms since launch" —
    // a permanent licence to reload at any moment, which is the one thing
    // this must never be.
    expect(shouldAutoApplyUpdate({ ...base, foregroundAt: NOW + 5000 })).toBe(false);
  });
});

describe('what counts as a fresh start', () => {
  it('treats a first launch as fresh', () => {
    expect(isFreshStart(0, NOW)).toBe(true);
  });

  it('treats a morning open after an overnight release as fresh', () => {
    expect(isFreshStart(NOW - 8 * 60 * 60 * 1000, NOW)).toBe(true);
  });

  it('does not treat a hop out to the camera and back as fresh', () => {
    // This is the middle of a task. Reloading here would throw away whatever
    // they went to fetch.
    expect(isFreshStart(NOW - 20_000, NOW)).toBe(false);
    expect(isFreshStart(NOW - (AWAY_MS - 1), NOW)).toBe(false);
    expect(isFreshStart(NOW - AWAY_MS, NOW)).toBe(true);
  });
});
