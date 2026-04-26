import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { useStore } from '../store';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  testID?: string;
  padded?: boolean;
}

export function GlassCard({ children, style, testID, padded = true }: Props) {
  const { theme } = useStore();

  return (
    <View
      testID={testID}
      style={[
        styles.wrap,
        {
          borderColor: theme.colors.cardBorder,
          backgroundColor: theme.colors.card,
          shadowColor: theme.colors.shadow,
          shadowOpacity: theme.mode === 'light' ? 0.09 : 0.24,
        },
        style,
      ]}
    >
      <View style={[styles.inner, padded && styles.innerPadded]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 5,
  },
  inner: {
    minHeight: 1,
  },
  innerPadded: {
    padding: 20,
  },
});
