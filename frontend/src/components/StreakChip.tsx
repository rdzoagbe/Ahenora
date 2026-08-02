import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useStore } from '../store';
import { useUI, UIColors } from './Kit';

const KEY = 'coo_streak';

// Local YYYY-MM-DD so the streak follows the user's own day, not UTC.
function localDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A gentle daily-habit nudge: counts consecutive days the household opened
 * the app. Client-side (AsyncStorage) — advances once per local day, resets
 * to 1 after a missed day. Renders nothing until the count is known.
 */
export function StreakChip() {
  const { t } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const [streak, setStreak] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const now = new Date();
      const today = localDay(now);
      const yesterday = localDay(new Date(now.getTime() - 86400000));
      let count = 1;
      try {
        const raw = await AsyncStorage.getItem(KEY);
        if (raw) {
          const prev = JSON.parse(raw) as { day: string; count: number };
          if (prev.day === today) count = prev.count;
          else if (prev.day === yesterday) count = prev.count + 1;
          else count = 1;
        }
        await AsyncStorage.setItem(KEY, JSON.stringify({ day: today, count }));
      } catch {
        // If storage is unavailable, still show a friendly Day 1.
      }
      if (alive) setStreak(count);
    })();
    return () => { alive = false; };
  }, []);

  if (streak === null) return null;

  const label = streak >= 2 ? t('streak_days', { n: streak }) : t('streak_day1');

  return (
    <View style={styles.chip}>
      <Text style={styles.fire}>🔥</Text>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: ui.orangeSoft, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7, marginTop: 12 },
  fire: { fontSize: 14 },
  text: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
});
