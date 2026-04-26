import React, { useRef } from 'react';
import {
  Animated,
  Pressable,
  ViewStyle,
  StyleProp,
  GestureResponderEvent,
} from 'react-native';

interface Props {
  onPress?: (e: GestureResponderEvent) => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  disabled?: boolean;
}

export function PressScale({ onPress, children, style, testID, disabled }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

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
    >
      <Animated.View style={[{ transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}
