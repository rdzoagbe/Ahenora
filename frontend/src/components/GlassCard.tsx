import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { useStore } from '../store';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  testID?: string;
}

export function GlassCard({ children, style, intensity = 24, testID }: Props) {
  const { theme, resolvedAppearance } = useStore();

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
      <BlurView intensity={intensity} tint={resolvedAppearance} style={StyleSheet.absoluteFill} />
      <View style={[styles.tint, { backgroundColor: theme.colors.glassTint }]} pointerEvents="none" />
      <View style={styles.inner}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  tint: {
    ...StyleSheet.absoluteFillObject,
  },
  inner: {
    padding: 20,
  },
});
