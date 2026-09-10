/**
 * A short message must not be squeezed into a column.
 *
 * Roland's screenshot of a real conversation: "Hi baby" wrapped onto two
 * lines, "okay" rendered as "ok / ay", and a sender's name broke as
 * "Kei / gh". Long messages were fine. That signature — short bubbles
 * collapsing, long ones not — is a width constraint the layout cannot
 * resolve, not a text problem.
 *
 * The cause: PressScale splits a style into a layout half and a visual half,
 * and gives the LAYOUT half to both the outer Pressable and the inner
 * animated view. `maxWidth: '82%'` therefore applied twice — 82% of a box
 * whose own width came from its child. Yoga answers a circular constraint
 * like that by collapsing toward the minimum.
 *
 * Nothing failed. Every test passed, the harness passed, and the bug was
 * plainly visible to anyone who opened the chat — which is the third time
 * this session a layout fault has been invisible to the test suite and
 * obvious in a photograph.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'components', 'ChatThread.tsx'), 'utf8');
const PRESS = readFileSync(join(__dirname, '..', 'components', 'PressScale.tsx'), 'utf8');

describe('the bubble is sized by a plain view, not by PressScale', () => {
  it('PressScale still copies layout styles to both halves', () => {
    // The premise of this whole file. If PressScale ever stops doing this,
    // these tests are guarding nothing and should be revisited rather than
    // silently kept.
    expect(PRESS).toContain('LAYOUT_KEYS.has(key)');
    expect(PRESS).toContain('maxWidth');
  });

  it('so the width cap sits on its own wrapper', () => {
    expect(SRC).toContain("bubbleCap: { maxWidth: '82%' }");
    expect(SRC).toContain('<View style={styles.bubbleCap}>');
  });

  it('and the bubble style itself carries no width constraint', () => {
    const bubble = SRC.match(/\n {2}bubble: \{[^}]*\}/);
    expect(bubble).not.toBeNull();
    expect(bubble![0]).not.toMatch(/maxWidth|minWidth|width:/);
  });
});

describe('the swipe hint is a hint, not a marker', () => {
  it('is invisible until the message is actually dragged', () => {
    // Parked at full opacity it put a reply arrow beside every message in the
    // thread, which reads as an unread badge or a send failure.
    expect(SRC).toContain('dx.interpolate(');
    expect(SRC).toMatch(/outputRange: \[0, 1\]/);
  });
});

describe('starting to type takes you to the newest message', () => {
  it('scrolls on focus, not only when the OS reports a keyboard', () => {
    // The keyboard effect never fires with a hardware keyboard, when the
    // keyboard is already open, or on the web — so tapping the box left you
    // wherever you had scrolled to.
    expect(SRC).toMatch(/onFocus=\{\(\) => \{[\s\S]{0,200}scrollToEnd/);
  });
});
