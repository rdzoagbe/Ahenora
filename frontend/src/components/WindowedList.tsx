import React, { useCallback, useMemo, useState } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { windowGeometry } from '../windowGeometry';
import { useUI, UIColors } from './Kit';

type WindowedListProps = {
  /** How many rows are inside. Decides whether the list needs capping at all. */
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
 * large-text phone. Rows are measured INDIVIDUALLY. The first version divided
 * the total content height by the row count, which is only the same thing when
 * every row is the same height — and they are not: a shopping item called
 * "eggs" is one line and a task called "take Amara to the orthodontist on
 * Thursday" is two. With an average, a list whose early rows are the tall ones
 * cut the third row through the middle. Summing the first N measured heights
 * makes the window exactly N whole rows, which is what this always claimed.
 *
 * The arithmetic itself lives in ../windowGeometry, where it can be tested
 * without a renderer — which is how the rest of this app's logic is tested.
 */
export function WindowedList({ count, window: windowSize, children, testID }: WindowedListProps) {
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const rows = useMemo(() => React.Children.toArray(children), [children]);
  const [contentH, setContentH] = useState(0);
  const [rowHeights, setRowHeights] = useState<number[]>([]);

  // The scroll position drives the thumb through Animated, not through state.
  // As plain state it re-rendered this component — and therefore every row
  // inside it — on every scroll frame, so dragging a fifty-item shopping list
  // re-rendered fifty rows sixty times a second to move one bar four points.
  // Held here it never re-renders at all while scrolling.
  const scrollY = useMemo(() => new Animated.Value(0), []);

  // Only a genuinely new height re-renders; a re-layout at the same size, of
  // which there are many, settles immediately. A row that changes identity —
  // the list was edited — re-lays out and overwrites its slot, so nothing has
  // to be invalidated by hand.
  const onRowLayout = useCallback((index: number, h: number) => {
    if (!(h > 0)) return;
    setRowHeights((prev) => {
      if (prev[index] === h) return prev;
      const next = prev.slice();
      next[index] = h;
      return next;
    });
  }, []);

  const { windowH, thumbH, travel, maxScroll } =
    windowGeometry(count, windowSize, rowHeights, contentH);

  const thumbY = useMemo(
    () => scrollY.interpolate({
      inputRange: [0, maxScroll],
      outputRange: [0, travel],
      extrapolate: 'clamp',
    }),
    [scrollY, maxScroll, travel],
  );

  return (
    <View style={styles.wrap}>
      <Animated.ScrollView
        testID={testID}
        style={[styles.scroll, windowH ? { maxHeight: windowH } : null]}
        // Without this the inner list does not scroll on Android at all — the
        // drag is taken by the page behind it.
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onContentSizeChange={(_w: number, h: number) => setContentH(h)}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          // react-native-web has no native animated module, and asking for one
          // there is a console warning on every list.
          { useNativeDriver: Platform.OS !== 'web' },
        )}
      >
        {rows.map((row, i) => (
          <View
            key={(React.isValidElement(row) && row.key) || i}
            onLayout={(e) => onRowLayout(i, e.nativeEvent.layout.height)}
          >
            {row}
          </View>
        ))}
      </Animated.ScrollView>
      {windowH ? (
        <View style={styles.rail}>
          <Animated.View
            style={[styles.thumb, { height: thumbH, transform: [{ translateY: thumbY }] }]}
          />
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
