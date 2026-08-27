import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import {
  findNodeHandle,
  Keyboard,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  ScrollViewProps,
  TextInput,
  UIManager,
  NativeScrollEvent,
} from 'react-native';

/**
 * A ScrollView that keeps the focused text field visible above the keyboard.
 *
 * `adjustResize` (Android) and `behavior="padding"` (iOS) are supposed to do
 * this, but on full-screen pushed routes the focused input near the bottom of a
 * form still ended up hidden under the keyboard. So we do it explicitly and
 * predictably: when the keyboard shows, measure the currently-focused input
 * against the keyboard's top edge and, if it overlaps, scroll it clear with a
 * small margin. When the platform already handled it, the overlap is ≤ 0 and we
 * do nothing — so this never fights the OS, only fills the gap it leaves.
 *
 * Drop-in replacement for ScrollView: same props, forwards the ref.
 */
export const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ onScroll, scrollEventThrottle, ...props }, ref) => {
    const inner = useRef<ScrollView>(null);
    const offsetY = useRef(0);
    useImperativeHandle(ref, () => inner.current as ScrollView);

    React.useEffect(() => {
      const sub = Keyboard.addListener('keyboardDidShow', (e) => {
        const kbTop = e.endCoordinates.screenY;
        // The RN-tracked focused input node, if any.
        const focused = (TextInput as unknown as {
          State?: { currentlyFocusedInput?: () => unknown; currentlyFocusedField?: () => number };
        }).State;
        const inputNode = focused?.currentlyFocusedInput?.();
        const node = inputNode ? findNodeHandle(inputNode as never) : (focused?.currentlyFocusedField?.() ?? null);
        if (node == null || !inner.current) return;
        UIManager.measureInWindow(node as number, (_x, y, _w, h) => {
          const overlap = (y + h) - kbTop + 20; // 20px breathing room below the field
          if (overlap > 0) {
            inner.current?.scrollTo({ y: offsetY.current + overlap, animated: true });
          }
        });
      });
      return () => sub.remove();
    }, []);

    const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetY.current = e.nativeEvent.contentOffset.y;
      onScroll?.(e);
    };

    return (
      <ScrollView
        ref={inner}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        onScroll={handleScroll}
        scrollEventThrottle={scrollEventThrottle ?? 16}
        {...props}
      />
    );
  },
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';
