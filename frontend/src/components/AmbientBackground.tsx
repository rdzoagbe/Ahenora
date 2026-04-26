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
        style={[
          styles.glow,
          light ? styles.lightGlowA : styles.darkGlowA,
        ]}
      />
      <LinearGradient
        colors={theme.ambient.glowB}
        start={{ x: 1, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={[
          styles.glow,
          light ? styles.lightGlowB : styles.darkGlowB,
        ]}
      />
      <LinearGradient
        colors={theme.ambient.glowC}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[
          styles.glow,
          light ? styles.lightGlowC : styles.darkGlowC,
        ]}
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
  darkGlowA: { top: -180, left: -180, width: 520, height: 520, opacity: 0.9 },
  darkGlowB: { bottom: -200, right: -200, width: 560, height: 560, opacity: 0.9 },
  darkGlowC: { top: 380, left: -160, width: 400, height: 400, opacity: 0.9 },
  lightGlowA: { top: -170, left: -150, width: 460, height: 460, opacity: 0.95 },
  lightGlowB: { bottom: -180, right: -180, width: 500, height: 500, opacity: 0.75 },
  lightGlowC: { top: 360, left: -140, width: 360, height: 360, opacity: 0.55 },
});
