import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useStore } from '../store';

type LoadingOverlayProps = {
  visible: boolean;
  label?: string;
};

export default function LoadingOverlay({
  visible,
  label = 'Loading...',
}: LoadingOverlayProps) {
  const { theme } = useStore();
  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="auto">
      <View style={[styles.card, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
        <ActivityIndicator color={theme.colors.text} />
        <Text style={[styles.label, { color: theme.colors.textMuted }]}>{label}</Text>
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
    backgroundColor: 'rgba(15,23,42,0.18)',
  },
  card: {
    minWidth: 150,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 18,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 6,
  },
  label: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
});
