import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  findNodeHandle,
  Keyboard,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  ScrollViewProps,
  TextInput,
  UIManager,
  View,
  NativeScrollEvent,
} from 'react-native';

/**
 * A ScrollView that keeps the focused text field visible above the keyboard.
 *
 * `adjustResize` (Android) and `behavior="padding"` (iOS) are supposed to do
 * this, but on full-screen pushed routes the focused input near the bottom of a
 * form still ended up hidden under the keyboard. So we do it explicitly: when
 * the keyboard shows, measure the focused input against the keyboard's top edge
 * and, if it overlaps, scroll it clear.
 *
 * The measure-and-scroll alone was NOT enough, and this is the part that kept
 * the bug alive through two attempted fixes: a ScrollView can only scroll as
 * far as `contentHeight - viewportHeight`. A form whose content ends soon after
 * its last field has nothing left to scroll INTO once the keyboard covers the
 * bottom half, so scrollTo was silently clamped and the field stayed hidden —
 * no matter where the field sat. Moving a field up the page only ever hid the
 * symptom for that one field.
 *
 * So we grow the scrollable area by the keyboard's height for as long as the
 * keyboard is up (a spacer, not a padding override, so a caller's own
 * contentContainerStyle is never fought with). The room is created first, then
 * the scroll happens — otherwise it would be clamped again.
 *
 * OPEN QUESTION, deliberately not acted on. Android's manifest sets
 * `adjustResize`, so in principle the window has ALREADY shrunk by the
 * keyboard's height by the time this runs, and the spacer then adds that
 * height a second time — enough empty room below the form to scroll the whole
 * thing off the top. That reasoning says to drop the spacer on Android.
 *
 * The evidence says otherwise: the bug this fixed was reported on Android, and
 * adjustResize alone did not fix it there. Something — edge-to-edge insets,
 * the pushed-route host, a modal — is eating the resize. Guessing which, and
 * removing the spacer on that guess, would bring back a field you cannot see
 * in order to remove some empty scroll space you can. So the spacer stays
 * until somebody watches a form on a real handset and says which it is.
 *
 * Drop-in replacement for ScrollView: same props, forwards the ref.
 */
export const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(
  ({ onScroll, scrollEventThrottle, children, ...props }, ref) => {
    const inner = useRef<ScrollView>(null);
    const offsetY = useRef(0);
    const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Extra scrollable room, live only while the keyboard is up.
    const [kbRoom, setKbRoom] = useState(0);
    useImperativeHandle(ref, () => inner.current as ScrollView);

    React.useEffect(() => {
      const show = Keyboard.addListener('keyboardDidShow', (e) => {
        const kbTop = e.endCoordinates.screenY;
        setKbRoom(e.endCoordinates.height);

        // The RN-tracked focused input node, if any.
        const focused = (TextInput as unknown as {
          State?: { currentlyFocusedInput?: () => unknown; currentlyFocusedField?: () => number };
        }).State;
        const inputNode = focused?.currentlyFocusedInput?.();
        const node = inputNode ? findNodeHandle(inputNode as never) : (focused?.currentlyFocusedField?.() ?? null);
        if (node == null) return;

        // Wait for the spacer above to be laid out, or the scroll below is
        // clamped to the old (too short) content height and does nothing.
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
          if (!inner.current) return;
          UIManager.measureInWindow(node as number, (_x, y, _w, h) => {
            const overlap = (y + h) - kbTop + 20; // 20px breathing room below the field
            if (overlap > 0) {
              inner.current?.scrollTo({ y: offsetY.current + overlap, animated: true });
            }
          });
        }, 60);
      });
      const hide = Keyboard.addListener('keyboardDidHide', () => setKbRoom(0));
      return () => {
        show.remove();
        hide.remove();
        if (settleTimer.current) clearTimeout(settleTimer.current);
      };
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
      >
        {children}
        {kbRoom > 0 ? <View style={{ height: kbRoom }} /> : null}
      </ScrollView>
    );
  },
);

KeyboardAwareScrollView.displayName = 'KeyboardAwareScrollView';
