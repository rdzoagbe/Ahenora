/**
 * Pick the one thing an invitation hands over.
 *
 * Two of 92 households have a second adult. The invitation that produced that
 * number named nobody and offered nothing, so the person who accepted arrived
 * in an empty app and was asked to fill it in. Choosing one real card here is
 * what makes joining land on something that has already moved.
 *
 * Required, not optional: an adult invitation cannot be sent until something
 * is chosen. The server accepts an invitation without one — an older build
 * must still be able to invite somebody — so this screen is where the rule
 * actually lives.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { api, HandoverCandidate } from '../api';
import { glyphFor } from '../cardIcons';
import { logger } from '../logger';
import { useStore } from '../store';
import { PressScale } from './PressScale';

type Props = {
  /** The chosen card, or null while nothing is chosen yet. */
  value: string | null;
  onChange: (cardId: string | null, card: HandoverCandidate | null) => void;
  /**
   * False once we know this household has nothing to hand over, so the caller
   * can stop requiring a choice. A household created five minutes ago really
   * does have no cards, and "you must hand something over" would otherwise be
   * an invitation nobody can send.
   */
  onAvailability?: (possible: boolean) => void;
};

export function HandoverPicker({ value, onChange, onAvailability }: Props) {
  const { t, theme, lang } = useStore();
  const [candidates, setCandidates] = useState<HandoverCandidate[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getHandoverCandidates()
      .then((res) => {
        if (!alive) return;
        const rows = res.candidates || [];
        setCandidates(rows);
        onAvailability?.(rows.length > 0);
      })
      .catch((e) => {
        // A list we could not load must not block the invitation either: the
        // ask still works, it just arrives without a handover.
        logger.warn('handover candidates failed', e);
        if (!alive) return;
        setCandidates([]);
        setFailed(true);
        onAvailability?.(false);
      });
    return () => { alive = false; };
    // Once per mount: the parent's callback identity must not refetch the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dueLabel = (card: HandoverCandidate): string => {
    if (!card.due_date) return t('handover_no_date');
    const when = new Date(card.due_date);
    if (Number.isNaN(when.getTime())) return t('handover_no_date');
    const day = when.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'short' });
    return card.recurrence && card.recurrence !== 'none'
      ? `${day} · ${t('handover_repeats')}`
      : day;
  };

  if (candidates === null) {
    return (
      <View style={styles.centre} testID="handover-loading">
        <ActivityIndicator color={theme.colors.textMuted} />
      </View>
    );
  }

  // Nothing to hand over is a real state, not an error: a household that has
  // just been created has no cards yet. Saying so beats an empty box, and the
  // caller treats it as "no choice required" so the invitation can still go.
  if (candidates.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
        <Text style={[styles.emptyText, { color: theme.colors.textMuted }]} testID="handover-empty">
          {failed ? t('handover_failed') : t('handover_empty')}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: theme.colors.text }]}>{t('handover_title')}</Text>
      <Text style={[styles.hint, { color: theme.colors.textMuted }]}>{t('handover_hint')}</Text>
      {candidates.map((card) => {
        const chosen = card.card_id === value;
        return (
          <PressScale
            key={card.card_id}
            testID={`handover-${card.card_id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: chosen }}
            accessibilityLabel={card.title}
            // Tapping the chosen one again clears it, so a mis-tap is one tap
            // to undo rather than a choice you are stuck with.
            onPress={() => (chosen ? onChange(null, null) : onChange(card.card_id, card))}
            style={[
              styles.row,
              {
                backgroundColor: theme.colors.bgSoft,
                borderColor: chosen ? theme.colors.primary : theme.colors.cardBorder,
                borderWidth: chosen ? 1.5 : 1,
              },
            ]}
          >
            <View style={[styles.iconTile, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
              <Text style={styles.glyph}>{glyphFor(card.icon || '')}</Text>
            </View>
            <View style={styles.text}>
              <Text style={[styles.cardTitle, { color: theme.colors.text }]} numberOfLines={1}>{card.title}</Text>
              <Text style={[styles.due, { color: theme.colors.textMuted }]} numberOfLines={1}>{dueLabel(card)}</Text>
            </View>
            <View
              style={[
                styles.tick,
                chosen
                  ? { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }
                  : { borderColor: theme.colors.cardBorder },
              ]}
            >
              {chosen ? <Text style={styles.tickMark}>✓</Text> : null}
            </View>
          </PressScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  centre: { paddingVertical: 20, alignItems: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 15, lineHeight: 20 },
  hint: { fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 17, marginBottom: 2 },
  empty: { borderRadius: 14, borderWidth: 1, padding: 14 },
  emptyText: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56,
  },
  iconTile: {
    width: 34, height: 34, borderRadius: 10, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  glyph: { fontSize: 17 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  due: { fontFamily: 'Inter_500Medium', fontSize: 11.5 },
  tick: {
    width: 22, height: 22, borderRadius: 999, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  tickMark: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
});
