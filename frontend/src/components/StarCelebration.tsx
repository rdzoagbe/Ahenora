import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useStore } from '../store';

/** What to celebrate: stars earned (optionally for a known chore), or a reward redeemed. */
export type CelebrationContent =
  | { kind: 'stars'; amount: number; chore?: 'bed' | 'read' | 'table' }
  | { kind: 'reward'; title: string };

interface Props {
  content: CelebrationContent | null;
  onDone: () => void;
}

const PRAISE_KEYS = ['kids_praise_1', 'kids_praise_2', 'kids_praise_3', 'kids_praise_4', 'kids_praise_5', 'kids_praise_6'];

// Chore-specific praise ties the effort to its own little payoff ("made bed →
// sleep like a king"), which lands far better with kids than a generic "good
// job". Two variants each so it doesn't feel canned.
const CHORE_PRAISE: Record<string, string[]> = {
  bed: ['qa_praise_bed_1', 'qa_praise_bed_2'],
  read: ['qa_praise_read_1', 'qa_praise_read_2'],
  table: ['qa_praise_table_1', 'qa_praise_table_2'],
};

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
  // The parent passes an inline onDone; keep it in a ref so a mid-celebration
  // re-render (e.g. the history refresh) can't restart the animation.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

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
      Animated.delay(1700),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 350, useNativeDriver: true }),
        Animated.timing(rise, { toValue: -26, duration: 350, useNativeDriver: true }),
      ]),
    ]).start(({ finished }) => {
      if (finished) onDoneRef.current();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  // Chore-specific praise when we know the chore; otherwise rotate the generic
  // pool. Picked once per celebration (not per render) so the line never
  // switches mid-animation. Hook stays above the early return (rules of hooks).
  const isStars = content?.kind === 'stars';
  const chorePool = content?.kind === 'stars' && content.chore ? CHORE_PRAISE[content.chore] : null;
  const pool = chorePool ?? PRAISE_KEYS;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const praiseIndex = useMemo(() => Math.floor(Date.now() / 1000) % pool.length, [content]);

  if (content === null) return null;

  const burst = isStars ? '🎉' : '🎁';
  const headline = content.kind === 'stars' ? `+${content.amount} ⭐` : content.title;
  const subtitle = isStars ? t(pool[praiseIndex]) : t('kids_reward_enjoy');

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
