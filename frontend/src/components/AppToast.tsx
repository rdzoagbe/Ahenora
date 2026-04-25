import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { AlertCircle, CheckCircle2, Info, Sparkles } from 'lucide-react-native';

export type ToastTone = 'success' | 'error' | 'info' | 'premium';

type AppToastProps = {
  visible: boolean;
  message: string | null;
  tone?: ToastTone;
  bottom?: number;
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
      pointerEvents="none"
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
  },
});
