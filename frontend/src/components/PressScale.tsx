import React, { useRef } from 'react';
import {
  AccessibilityRole,
  Animated,
  Pressable,
  ViewStyle,
  StyleProp,
  StyleSheet,
  GestureResponderEvent,
} from 'react-native';

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
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
  accessibilityHint?: string;
}

export function PressScale({ onPress, children, style, testID, disabled, accessibilityLabel, accessibilityRole, accessibilityHint }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const { layout, visual } = splitStyles(style);

  const onIn = () => {
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  };
  const onOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  };

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onPressIn={onIn}
      onPressOut={onOut}
      disabled={disabled}
      style={layout}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityHint={accessibilityHint}
    >
      <Animated.View style={[{ transform: [{ scale }] }, visual]}>{children}</Animated.View>
    </Pressable>
  );
}
