import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlertCircle } from 'lucide-react-native';

import { PressScale } from './PressScale';

type ErrorStateProps = {
  title?: string;
  message?: string;
  actionLabel?: string;
  onRetry?: () => void;
  actionTestID?: string;
};

export default function ErrorState({
  title = 'Something went wrong',
  message = 'Please try again.',
  actionLabel = 'Try again',
  onRetry,
  actionTestID = 'error-state-retry',
}: ErrorStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.icon}>
        <AlertCircle color="#EF4444" size={19} />
      </View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>

      {onRetry ? (
        <PressScale testID={actionTestID} onPress={onRetry} style={styles.action}>
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
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  title: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: '#fff',
    fontSize: 23,
    textAlign: 'center',
  },
  message: {
    marginTop: 7,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.55)',
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
