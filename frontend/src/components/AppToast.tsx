import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertCircle, CheckCircle2, Info, Sparkles } from 'lucide-react-native';

export type ToastTone = 'success' | 'error' | 'info' | 'premium';

type AppToastProps = {
  visible: boolean;
  message: string | null;
  tone?: ToastTone;
  bottom?: number;
  /**
   * One optional way to undo or amend what the toast is reporting.
   *
   * Added for the capture bar, which now decides where a typed line goes — a
   * shopping item, a meal, a task. The rules are deliberately timid, but a
   * wrong guess still has to cost one tap rather than a hunt through three
   * tabs. Without an action the toast can only announce; with one it can offer
   * the way back.
   */
  action?: { label: string; onPress: () => void } | null;
};

const TONE = {
  success: {
    color: '#10B981',
    icon: CheckCircle2,
  },
  error: {
    color: '#EF4444',
    icon: AlertCircle,
  },
  info: {
    color: '#60A5FA',
    icon: Info,
  },
  premium: {
    color: '#F59E0B',
    icon: Sparkles,
  },
};

export default function AppToast({
  visible,
  message,
  tone = 'info',
  bottom = 150,
  action = null,
}: AppToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: visible ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: visible ? 0 : 14,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, opacity, translateY]);

  if (!message) return null;

  const Icon = TONE[tone].icon;
  const color = TONE[tone].color;

  return (
    <Animated.View
      // Untouchable unless there is something to touch: a toast that swallows
      // taps over the screen it floats above is worse than no toast.
      pointerEvents={action && visible ? 'box-none' : 'none'}
      style={[
        styles.wrap,
        {
          bottom,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={[styles.toast, { borderColor: `${color}66` }]}>
        <Icon color={color} size={15} />
        <Text style={styles.text}>{message}</Text>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button">
            <Text style={[styles.action, { color }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 50,
  },
  toast: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 9999,
    backgroundColor: 'rgba(20,22,32,0.96)',
    borderWidth: 1,
  },
  text: {
    color: '#fff',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    flexShrink: 1,
  },
  action: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 13,
    marginLeft: 2,
  },
});
