import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';

import { PressScale } from './PressScale';

type EmptyStateProps = {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionTestID?: string;
};

export default function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  actionTestID = 'empty-state-action',
}: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.icon}>
        <Sparkles color="rgba(255,255,255,0.6)" size={18} />
      </View>

      <Text style={styles.title}>{title}</Text>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {actionLabel && onAction ? (
        <PressScale testID={actionTestID} onPress={onAction} style={styles.action}>
          <Text style={styles.actionText}>{actionLabel}</Text>
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
    paddingVertical: 58,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  title: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: 'rgba(255,255,255,0.82)',
    fontSize: 23,
    textAlign: 'center',
  },
  message: {
    marginTop: 7,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  action: {
    marginTop: 18,
    borderRadius: 9999,
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  actionText: {
    color: '#080910',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
});
