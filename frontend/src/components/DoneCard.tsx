import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check, ChevronRight } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import type { Card } from '../api';
import { doneWhen } from '../completedHistory';

/**
 * What was ticked off, on the page it was ticked off from.
 *
 * A done card used to vanish from Home and reappear only as "Completed
 * history" under Settings › More — the one place nobody looks for the thing
 * they just finished. Roland, 2026-10-09: it should be "easy for users to find
 * what they have removed from the feed page instead of it hiding in the
 * settings page". So the last few completions sit under Today, each with an
 * Undo, and the whole record is one tap further.
 *
 * Household-wide, not only yours: "Keigh did the school run" is the kind of
 * thing a co-parent opens the app to learn, and the Settings list was already
 * the household's.
 */
const SHOWN = 3;

export { completedForHome } from '../completedHistory';

export function DoneCard({
  done,
  weekCount,
  lang,
  who,
  onUndo,
  onOpen,
  onSeeAll,
}: {
  done: Card[];
  weekCount: number;
  lang: string;
  /** Who finished it, or '' when unknown. */
  who: (card: Card) => string;
  onUndo: (card: Card) => void;
  onOpen: (card: Card) => void;
  onSeeAll: () => void;
}) {
  const ui = useUI();
  const { t } = useStore();
  const styles = createStyles(ui);

  if (done.length === 0) return null;

  const count = weekCount === 1 ? t('done_this_week_one') : t('done_this_week', { n: weekCount });

  return (
    <View style={styles.card} testID="feed-done-card">
      <View style={styles.head}>
        <Text style={styles.eyebrow}>{t('done_title')}</Text>
        <Text style={styles.count} testID="feed-done-count">{count}</Text>
      </View>

      {done.slice(0, SHOWN).map((card, i) => {
        const by = who(card);
        const when = doneWhen(card.completed_at, t, lang);
        const sub = [by, when].filter(Boolean).join(' · ');
        return (
          <PressScale
            key={card.card_id}
            testID={`feed-done-${card.card_id}`}
            accessibilityRole="button"
            accessibilityLabel={`${card.title}, ${t('done_title')}${sub ? `, ${sub}` : ''}`}
            onPress={() => onOpen(card)}
            style={[styles.row, i > 0 && styles.rowLine]}
          >
            <View style={styles.tick}>
              <Check color={ui.doneTick} size={14} strokeWidth={3} />
            </View>
            <View style={styles.body}>
              <Text style={styles.title} numberOfLines={1}>{card.title}</Text>
              {sub ? <Text style={styles.sub} numberOfLines={1}>{sub}</Text> : null}
            </View>
            <PressScale
              testID={`feed-done-undo-${card.card_id}`}
              accessibilityRole="button"
              accessibilityLabel={t('done_undo')}
              onPress={() => onUndo(card)}
              hitSlop={8}
              style={styles.undo}
            >
              <Text style={styles.undoText}>{t('done_undo')}</Text>
            </PressScale>
          </PressScale>
        );
      })}

      <PressScale testID="feed-done-all" accessibilityRole="link" onPress={onSeeAll} style={[styles.row, styles.rowLine, styles.all]}>
        <Text style={styles.allText}>{t('done_see_all')}</Text>
        <ChevronRight color={ui.muted} size={18} />
      </PressScale>
    </View>
  );
}

const createStyles = (ui: UIColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: ui.card,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: ui.line,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 4,
      marginTop: 14,
    },
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 4 },
    eyebrow: {
      color: ui.mintText, fontFamily: 'Figtree_800ExtraBold', fontSize: 11.5,
      letterSpacing: 1.2, textTransform: 'uppercase',
    },
    count: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12.5 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 50 },
    rowLine: { borderTopWidth: 1, borderTopColor: ui.line },
    tick: {
      width: 22, height: 22, borderRadius: 7, backgroundColor: ui.doneFill,
      alignItems: 'center', justifyContent: 'center',
    },
    body: { flex: 1, minWidth: 0 },
    title: { color: ui.muted, fontFamily: 'Figtree_600SemiBold', fontSize: 15 },
    sub: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12.5, marginTop: 1, opacity: 0.85 },
    undo: {
      height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: ui.line,
      backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center',
    },
    undoText: { color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 12.5 },
    all: { paddingBottom: 6, justifyContent: 'space-between' },
    allText: { color: ui.orangeText, fontFamily: 'Figtree_600SemiBold', fontSize: 13 },
  });
