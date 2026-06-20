import React from 'react';
import { Animated, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSwipeTabs } from '../hooks/useSwipeTabs';
import { useStore } from '../store';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function SwipeableTabView({ children, style }: Props) {
  const { gesture, translateX } = useSwipeTabs();
  const { theme } = useStore();

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.container,
          { backgroundColor: theme.colors.bg },
          style,
          { transform: [{ translateX }] },
        ]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
