import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useStore } from '../store';

export function AmbientBackground() {
  const { theme } = useStore();

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.base, { backgroundColor: theme.ambient.base }]} />
      <LinearGradient
        colors={theme.ambient.glowA}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.glow, { top: -180, left: -180, width: 520, height: 520 }]}
      />
      <LinearGradient
        colors={theme.ambient.glowB}
        start={{ x: 1, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={[styles.glow, { bottom: -200, right: -200, width: 560, height: 560 }]}
      />
      <LinearGradient
        colors={theme.ambient.glowC}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.glow, { top: 380, left: -160, width: 400, height: 400 }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    ...StyleSheet.absoluteFillObject,
  },
  glow: {
    position: 'absolute',
    borderRadius: 9999,
    opacity: 0.9,
  },
});
