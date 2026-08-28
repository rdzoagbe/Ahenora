import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useUI, UIColors } from './Kit';

type WindowedListProps = {
  /** How many rows are inside. Used to derive one row's height. */
  count: number;
  /** How many to show at once before the list starts scrolling. */
  window: number;
  children: React.ReactNode;
  testID?: string;
};

/**
 * A list that shows the first N rows and scrolls the rest inside itself,
 * with a rail on the right saying so.
 *
 * Long lists were pushing everything beneath them off the screen — the Feed's
 * handed-over work and the Kitchen's shopping list both did it. Capping the
 * height fixes that, but a bare capped list is worse than a long one: nothing
 * tells you the remaining rows exist. The system scrollbar does not fill that
 * gap, being a hairline that fades a second after you stop moving. So the rail
 * is drawn, always visible while the list overflows, and its THUMB LENGTH is
 * the share of the list on screen — its size alone says how much is hidden.
 *
 * The window height is measured, never a hardcoded row height: rows grow with
 * the reader's font size, and a constant would slice a row in half on a
 * large-text phone. One row is the measured content over the row count, so the
 * window is always exactly whole rows.
 */
export function WindowedList({ count, window: windowSize, children, testID }: WindowedListProps) {
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [contentH, setContentH] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  const overflowing = count > windowSize;
  const windowH = overflowing && contentH > 0 ? (contentH / count) * windowSize : undefined;

  // Rail geometry. The 4pt inset top and bottom is the rail's own margin.
  const trackH = windowH ? windowH - 8 : 0;
  const thumbH = trackH > 0 ? Math.max(24, trackH * (windowH! / Math.max(contentH, 1))) : 0;
  const thumbY = trackH > 0
    ? (offsetY / Math.max(contentH - windowH!, 1)) * (trackH - thumbH)
    : 0;

  return (
    <View style={styles.wrap}>
      <ScrollView
        testID={testID}
        style={[styles.scroll, windowH ? { maxHeight: windowH } : null]}
        // Without this the inner list does not scroll on Android at all — the
        // drag is taken by the page behind it.
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onContentSizeChange={(_w, h) => setContentH(h)}
        onScroll={(e) => setOffsetY(e.nativeEvent.contentOffset.y)}
      >
        {children}
      </ScrollView>
      {overflowing && windowH ? (
        <View style={styles.rail}>
          <View style={[styles.thumb, { height: thumbH, transform: [{ translateY: thumbY }] }]} />
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'stretch', gap: 7 },
  scroll: { flex: 1 },
  rail: {
    width: 4, borderRadius: 999, marginVertical: 4,
    backgroundColor: ui.line, overflow: 'hidden',
  },
  thumb: { width: 4, borderRadius: 999, backgroundColor: ui.orange },
});
