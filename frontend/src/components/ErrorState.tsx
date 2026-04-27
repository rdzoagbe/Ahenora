import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlertCircle } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';

type ErrorStateProps = {
  title?: string;
  message?: string;
  actionLabel?: string;
  onRetry?: () => void;
};

export default function ErrorState({
  title = 'Something went wrong',
  message = 'Please try again.',
  actionLabel = 'Try again',
  onRetry,
}: ErrorStateProps) {
  const { theme } = useStore();

  return (
    <View style={styles.wrap}>
      <View style={styles.icon}>
        <AlertCircle color="#EF4444" size={20} />
      </View>

      <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[styles.message, { color: theme.colors.textMuted }]}>{message}</Text>

      {onRetry ? (
        <PressScale testID="error-state-retry" onPress={onRetry} style={[styles.action, { backgroundColor: theme.colors.primary }]}>
          <Text style={[styles.actionText, { color: theme.colors.primaryText }]}>{actionLabel}</Text>
        </PressScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
    paddingVertical: 54,
  },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  title: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
    letterSpacing: -0.35,
  },
  message: {
    marginTop: 8,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  action: {
    marginTop: 20,
    borderRadius: 9999,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  actionText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15,
  },
});
