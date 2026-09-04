import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';

import { useStore } from '../store';

/**
 * How many AI reads are left, said BEFORE they run out.
 *
 * The count lived only in Settings, which nobody opens to check before
 * photographing a school letter. So the first anyone heard of a limit was the
 * moment it stopped them — and an allowance you meet only as a wall reads as
 * the app breaking rather than as a plan doing what it says.
 *
 * Shown only when it is nearly gone. A counter on every scan turns a generous
 * allowance into something to ration, which is the opposite of the point: at
 * 80 of 100 nobody needs telling, and being told anyway makes the product feel
 * meaner than it is.
 */

/** Below this many remaining, say so. */
const WARN_AT = 3;

export function ScansLeft() {
  const { subscription, theme, t } = useStore();
  const ui = theme.colors;

  const limit = subscription?.limits?.ai_scans_per_month;
  const used = subscription?.ai_scans_used;
  if (typeof limit !== 'number' || typeof used !== 'number') return null;
  // The top plans carry a nominal ceiling so high it is not a limit anyone can
  // reach; counting down from it would be theatre.
  if (limit >= 1000) return null;

  const left = Math.max(0, limit - used);
  if (left > WARN_AT) return null;

  const out = left === 0;
  return (
    <View
      testID="scans-left"
      style={[
        styles.row,
        { backgroundColor: ui.accentSoft, borderColor: out ? ui.danger : ui.cardBorder },
      ]}
    >
      <Sparkles color={out ? ui.danger : ui.accentInk} size={13} />
      <Text style={[styles.text, { color: out ? ui.danger : ui.accentInk }]}>
        {out ? t('scans_none_left') : t('scans_left', { n: left })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10,
  },
  text: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5 },
});
