import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';

type EmptyStateProps = {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { theme } = useStore();

  return (
    <View style={styles.wrap}>
      <View style={[styles.icon, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
        <Sparkles color={theme.colors.accent} size={18} />
      </View>

      <Text style={[styles.title, { color: theme.colors.text }]}>{title}</Text>

      {message ? <Text style={[styles.message, { color: theme.colors.textMuted }]}>{message}</Text> : null}

      {actionLabel && onAction ? (
        <PressScale testID="empty-state-action" onPress={onAction} style={[styles.action, { backgroundColor: theme.colors.primary }]}>
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
    borderWidth: 1,
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
