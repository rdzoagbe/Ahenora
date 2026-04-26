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
  const { theme, resolvedAppearance } = useStore();
  const isLight = resolvedAppearance === 'light';

  return (
    <View
      testID={testID}
      style={[
        styles.wrap,
        {
          borderColor: theme.colors.cardBorder,
          backgroundColor: theme.colors.card,
          shadowColor: theme.colors.shadow,
          shadowOpacity: isLight ? 0.08 : 0.22,
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
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 2,
  },
  inner: {
    minHeight: 1,
  },
  innerPadded: {
    padding: 20,
  },
});
