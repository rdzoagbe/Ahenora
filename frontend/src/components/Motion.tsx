import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useReducedMotion } from '../hooks/useReducedMotion';

/**
 * Small touches of life (Roland, 2026-11-02: "Ok go for 2", from the plan of
 * 2026-10-31): gentle movement where something good just happened, and
 * nowhere else. Built on React Native's own Animated, so it ships over the air
 * with no new native code. Everything here stands still for a person who has
 * asked their phone for less motion.
 */

/** A dot that breathes slowly: where "now" is in the day. */
export function PulseDot({ color, size = 8, testID }: { color: string; size?: number; testID?: string }) {
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduced, pulse]);
  return (
    <Animated.View
      testID={testID}
      style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: color,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
      }}
    />
  );
}

/**
 * Pops its child in when `active` turns on: a tick that has just been earned.
 * Shown as it is, without movement, when `active` is off or motion is reduced.
 */
export function PopIn({ active, children, style }: { active: boolean; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!active || reduced) return;
    scale.setValue(0.4);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 14 }).start();
  }, [active, reduced, scale]);
  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

/**
 * Bumps its child once each time `trigger` changes: a star count going up.
 */
export function Bump({ trigger, children, style }: { trigger: unknown; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced || trigger == null) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.28, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 10 }),
    ]).start();
  }, [trigger, reduced, scale]);
  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

/**
 * "+3 ★" floating up and fading, once per `burst.key`: stars just given.
 * Says nothing to a screen reader, which already hears the new count.
 */
export function StarBurst({ burst, color }: { burst: { n: number; key: number } | null; color: string }) {
  const reduced = useReducedMotion();
  const [rise] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!burst || reduced) return;
    rise.setValue(0);
    Animated.timing(rise, { toValue: 1, duration: 950, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [burst, reduced, rise]);
  if (!burst || reduced) return null;
  return (
    <Animated.Text
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="star-burst"
      style={[
        styles.burst,
        { color },
        {
          opacity: rise.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [6, -30] }) }],
        },
      ]}
    >
      {`+${burst.n} ★`}
    </Animated.Text>
  );
}

/**
 * A light "well done" tap from the phone, where the phone can give one.
 * expo-haptics has been in the store builds since 2026-09-28
 * (frontend/native-modules.json); the web has no haptics, and a phone that
 * refuses is simply silent.
 */
export function successTap(): void {
  if (Platform.OS === 'web') return;
  try {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } catch {
    // Never let a missing vibration stop the thing that was celebrated.
  }
}

const styles = StyleSheet.create({
  burst: { position: 'absolute', left: 0, top: -2, width: 90, fontFamily: 'Figtree_800ExtraBold', fontSize: 20 },
});
