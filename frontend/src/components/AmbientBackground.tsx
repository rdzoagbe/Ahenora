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
        style={[styles.blob, light ? styles.lightA : styles.darkA]}
      />
      <LinearGradient
        colors={theme.ambient.glowB}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[styles.blob, light ? styles.lightB : styles.darkB]}
      />
      <LinearGradient
        colors={theme.ambient.glowC}
        start={{ x: 0, y: 1 }}
        end={{ x: 1, y: 0 }}
        style={[styles.blob, light ? styles.lightC : styles.darkC]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    ...StyleSheet.absoluteFillObject,
  },
  blob: {
    position: 'absolute',
    borderRadius: 9999,
  },
  lightA: { top: -80, left: -80, width: 340, height: 340, opacity: 1 },
  lightB: { top: 170, right: -110, width: 300, height: 300, opacity: 0.95 },
  lightC: { bottom: -90, left: -70, width: 300, height: 300, opacity: 0.85 },
  darkA: { top: -180, left: -180, width: 520, height: 520, opacity: 0.9 },
  darkB: { bottom: -200, right: -200, width: 560, height: 560, opacity: 0.9 },
  darkC: { top: 380, left: -160, width: 400, height: 400, opacity: 0.9 },
});
