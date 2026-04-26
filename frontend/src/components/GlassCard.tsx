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
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 4,
  },
  inner: {
    minHeight: 1,
  },
  innerPadded: {
    padding: 20,
  },
});
