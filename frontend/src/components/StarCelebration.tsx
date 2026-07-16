import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useStore } from '../store';

/** What to celebrate: stars earned, or a reward redeemed. */
export type CelebrationContent =
  | { kind: 'stars'; amount: number }
  | { kind: 'reward'; title: string };

interface Props {
  content: CelebrationContent | null;
  onDone: () => void;
}

const PRAISE_KEYS = ['kids_praise_1', 'kids_praise_2', 'kids_praise_3'];

/**
 * A lightweight celebratory burst shown when stars are awarded
 * ("🎉 +5 ⭐ — Wow, good job!") or a reward is redeemed
 * ("🎁 Movie night — Enjoy your reward!"). Uses the built-in Animated API
 * (spring in, float up, fade out) — no external animation libraries.
 */
export function StarCelebration({ content, onDone }: Props) {
  const { t, theme } = useStore();
  const scale = useRef(new Animated.Value(0.3)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!content) return;
    scale.setValue(0.3);
    opacity.setValue(0);
    rise.setValue(0);
    Animated.sequence([
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]),
      Animated.delay(1100),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
        Animated.timing(rise, { toValue: -26, duration: 350, useNativeDriver: true }),
      ]),
    ]).start(({ finished }) => {
      if (finished) onDone();
    });
  }, [content, scale, opacity, rise, onDone]);

  if (content === null) return null;

  const isStars = content.kind === 'stars';
  const burst = isStars ? '🎉' : '🎁';
  const headline = isStars ? `+${content.amount} ⭐` : content.title;
  // Vary the praise line per burst without needing randomness at render time.
  const praiseIndex = isStars ? Math.abs(content.amount) % PRAISE_KEYS.length : 0;
  const subtitle = isStars ? t(PRAISE_KEYS[praiseIndex]) : t('kids_reward_enjoy');

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.accent,
          shadowColor: theme.colors.shadow,
          opacity,
          transform: [{ scale }, { translateY: rise }],
        },
      ]}
    >
      <Text style={styles.burst}>{burst}</Text>
      <Text style={[styles.amount, { color: theme.colors.accent }]} numberOfLines={2}>{headline}</Text>
      <Text style={[styles.praise, { color: theme.colors.text }]}>{subtitle}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: '32%',
    alignSelf: 'center',
    alignItems: 'center',
    maxWidth: '82%',
    paddingHorizontal: 28,
    paddingVertical: 20,
    borderRadius: 24,
    borderWidth: 2,
    elevation: 8,
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    zIndex: 999,
  },
  burst: { fontSize: 34, marginBottom: 2 },
  amount: { fontFamily: 'Inter_800ExtraBold', fontSize: 26, textAlign: 'center' },
  praise: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginTop: 4, textAlign: 'center' },
});
