import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useStore } from '../store';

export function AmbientBackground() {
  const { theme } = useStore();
  const light = theme.mode === 'light';

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.base, { backgroundColor: theme.ambient.base }]} />
      <LinearGradient
        colors={theme.ambient.glowA}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.glow, light ? styles.lightGlowA : styles.darkGlowA]}
      />
      <LinearGradient
        colors={theme.ambient.glowB}
        start={{ x: 1, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={[styles.glow, light ? styles.lightGlowB : styles.darkGlowB]}
      />
      <LinearGradient
        colors={theme.ambient.glowC}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.glow, light ? styles.lightGlowC : styles.darkGlowC]}
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
  },
  lightGlowA: { top: -160, left: -140, width: 470, height: 470, opacity: 0.95 },
  lightGlowB: { top: 160, right: -220, width: 520, height: 520, opacity: 0.85 },
  lightGlowC: { bottom: -200, left: -150, width: 430, height: 430, opacity: 0.75 },
  darkGlowA: { top: -180, left: -180, width: 520, height: 520, opacity: 0.9 },
  darkGlowB: { bottom: -200, right: -200, width: 560, height: 560, opacity: 0.9 },
  darkGlowC: { top: 380, left: -160, width: 400, height: 400, opacity: 0.9 },
});
