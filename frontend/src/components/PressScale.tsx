import React, { useRef } from 'react';
import {
  AccessibilityRole,
  Animated,
  Insets,
  Platform,
  Pressable,
  ViewStyle,
  StyleProp,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native';

import { noteInteraction } from '../interaction';

const LAYOUT_KEYS: Set<string> = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'position', 'top', 'right', 'bottom', 'left',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'marginHorizontal', 'marginVertical',
  'alignSelf', 'zIndex',
]);

function splitStyles(style?: StyleProp<ViewStyle>): { layout: ViewStyle; visual: ViewStyle } {
  const flat = StyleSheet.flatten(style) || {};
  const layout: Record<string, any> = {};
  const visual: Record<string, any> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (LAYOUT_KEYS.has(key)) {
      layout[key] = value;
    }
    visual[key] = value;
  }
  return { layout: layout as ViewStyle, visual: visual as ViewStyle };
}

interface Props {
  onPress?: (e: GestureResponderEvent) => void;
  /** Optional long-press, e.g. to enter a multi-select mode from a row. */
  onLongPress?: (e: GestureResponderEvent) => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityHint?: string;
  /** So a selected chip, day or toggle announces itself as selected. Without
   *  it a screen reader reads a row of dates and never says which one is
   *  chosen, which makes a picker unusable rather than merely unlabelled. */
  accessibilityState?: { selected?: boolean; disabled?: boolean; checked?: boolean };
  /**
   * Expands the touchable area beyond the visual bounds without affecting
   * layout — used to bring small icon buttons up to a comfortable target size.
   */
  hitSlop?: number | Insets;
}

/**
 * `hitSlop` on the web.
 *
 * react-native-web implements hitSlop only in its legacy Touchable mixin, not
 * in Pressable — which is what this component is built on. So every hitSlop in
 * the app works on iOS and Android and does nothing at all on ahenora.com/app,
 * where a 20pt dismiss cross stays a 20pt dismiss cross. Measuring the laid-out
 * page found 28 controls under 44x44 on the web that are comfortably above it
 * on a phone.
 *
 * Restored the way hitSlop works natively: an invisible child stretched BEYOND
 * the parent's box by the slop. It is inside the Pressable, so a press on it
 * is a press on the control, and being absolutely positioned it changes no
 * layout — which is the whole reason hitSlop exists rather than padding.
 */
function slopInsets(hitSlop?: number | Insets) {
  if (hitSlop == null) return null;
  const n = (v?: number) => -(v ?? 0);
  if (typeof hitSlop === 'number') {
    return { top: -hitSlop, bottom: -hitSlop, left: -hitSlop, right: -hitSlop };
  }
  return { top: n(hitSlop.top), bottom: n(hitSlop.bottom),
           left: n(hitSlop.left), right: n(hitSlop.right) };
}

export function PressScale({ onPress, onLongPress, children, style, testID, disabled, accessibilityLabel, accessibilityRole, accessibilityHint, accessibilityState, hitSlop }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const { layout, visual } = splitStyles(style);
  const webSlop = Platform.OS === 'web' ? slopInsets(hitSlop) : null;

  const onIn = () => {
    // Somebody is here and doing something. Read only by the silent-update
    // check, which will not relaunch the app under an active pair of hands.
    noteInteraction();
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  };
  const onOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  };

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onIn}
      onPressOut={onOut}
      disabled={disabled}
      hitSlop={hitSlop}
      style={layout}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
    >
      {webSlop ? (
        // A direct child of the Pressable, NOT of the styled view below. The
        // styled view carries the control's own `overflow`, and a rounded
        // button with `overflow: hidden` clips anything reaching past its
        // edge — which is what silently swallowed the first attempt at this.
        <Animated.View
          aria-hidden
          pointerEvents="auto"
          style={[{ position: 'absolute' }, webSlop]}
        />
      ) : null}
      <Animated.View style={[{ transform: [{ scale }] }, visual]}>{children}</Animated.View>
    </Pressable>
  );
}
