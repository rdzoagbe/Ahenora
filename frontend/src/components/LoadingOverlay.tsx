import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type LoadingOverlayProps = {
  visible: boolean;
  label?: string;
};

export default function LoadingOverlay({
  visible,
  label = 'Loading...',
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="auto">
      <View style={styles.card}>
        <ActivityIndicator color="#fff" />
        <Text style={styles.label}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,9,16,0.28)',
  },
  card: {
    minWidth: 140,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(20,22,32,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  label: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
});
