/**
 * The ＋ on the Feed's capture bar.
 *
 * It was a plain <View>: an orange square, the exact size and colour of every
 * primary action in the app, and inert. The two things it looked like it did —
 * add by hand, snap a photo — were small grey icons at the far end of the same
 * bar. Three controls, one job, and the loudest one did nothing.
 *
 * Two things have to stay true after consolidating them:
 *
 *   1. The ＋ is a button, and both destinations are behind it.
 *   2. The field still teaches that it is a FIELD. Collapsing the icons makes
 *      the bar look more like a button, and typing is the capable half — a
 *      typed line routes itself to the shopping list, the meal planner or the
 *      calendar, which no menu row does. So the placeholder keeps its rotating
 *      real examples, and the menu says so too.
 */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';

import { CaptureMenuSheet } from '../components/CaptureMenuSheet';

jest.mock('../store', () => ({
  useStore: () => ({ t: (key: string) => key, theme: { colors: {} } }),
}));

/** jsdom reports no safe-area metrics, and the sheet pads itself by them. */
const FRAME = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// The first render in a fresh worker pays for the RN preset, the Modal and
// lucide's icon set all at once, and has taken over 5s on a cold CI runner —
// a flake that says nothing about the component.
jest.setTimeout(30000);

const feed = readFileSync(join(__dirname, '..', '..', 'app', '(tabs)', 'feed.tsx'), 'utf8');

/** The capture bar's own markup, from <View style={styles.addBar}> to its close. */
const addBar = () => {
  const start = feed.indexOf('style={styles.addBar}');
  expect(start).toBeGreaterThan(0);
  return feed.slice(start, feed.indexOf('</View>', feed.indexOf('feed-capture-send', start)) + 7);
};

describe('the capture bar', () => {
  it('makes the ＋ a button, not a decoration', () => {
    const bar = addBar();
    expect(bar).toContain('testID="feed-capture-plus"');
    expect(bar).toContain('setShowCaptureMenu(true)');
    // A bare <View> wrapping the Plus icon is the shape of the original bug.
    expect(bar).not.toMatch(/<View style={styles\.addBarPlus}>/);
  });

  it('leaves no loose icons beside the field', () => {
    // The whole point of the consolidation: what used to sit at the right-hand
    // end is inside the ＋ now. Only the send arrow may appear there, and only
    // while there is something to send.
    const bar = addBar();
    expect(bar).not.toContain('feed-open-add');
    expect(bar).not.toContain('styles.addBarIcon');
    expect(bar).toContain('testID="feed-capture-send"');
  });

  it('keeps the placeholder teaching what the field does', () => {
    // Replacing the rotating examples with "tap the + to add" would turn the
    // one thing that teaches the bar's routing into a button instruction, and
    // make a field look like it is not for typing.
    expect(addBar()).toContain('placeholder={capturePlaceholder}');
    expect(feed).toContain("t('feed_capture_eg_shopping')");
  });
});

describe('what the ＋ opens', () => {
  const open = (fns: { onManual?: () => void; onPhoto?: () => void } = {}) =>
    render(
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FRAME}>
        <CaptureMenuSheet
          visible
          onClose={() => undefined}
          onManual={fns.onManual ?? (() => undefined)}
          onPhoto={fns.onPhoto ?? (() => undefined)}
        />
      </SafeAreaProvider>,
    );

  it('offers both of the controls it replaced', async () => {
    const view = await open();
    expect(view.queryByTestId('capture-menu-manual')).not.toBeNull();
    expect(view.queryByTestId('capture-menu-photo')).not.toBeNull();
  });

  it('runs the one that was tapped, and only that one', async () => {
    const onManual = jest.fn();
    const onPhoto = jest.fn();
    const view = await open({ onManual, onPhoto });
    fireEvent.press(view.getByTestId('capture-menu-photo'));
    expect(onPhoto).toHaveBeenCalledTimes(1);
    expect(onManual).not.toHaveBeenCalled();
  });

  it('says that typing is still the quicker way', async () => {
    // Without this line the menu quietly teaches that adding means picking
    // from a list of two, which is the smaller half of what the bar can do.
    const view = await open();
    expect(view.queryByText('feed_capture_menu_hint')).not.toBeNull();
  });

  it('draws nothing while it is closed', async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FRAME}>
        <CaptureMenuSheet visible={false} onClose={() => undefined} onManual={() => undefined} onPhoto={() => undefined} />
      </SafeAreaProvider>,
    );
    expect(view.queryByTestId('capture-menu-manual')).toBeNull();
  });
});
