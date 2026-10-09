import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlertCircle, ChevronRight, ShoppingCart, UserCheck } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import type { Card } from '../api';
import { aisleKey, groupByAisle } from '../shoppingAisles';
import { planPulseRows } from '../pulseRows';

/**
 * What needs you, before anything else on Home (rebrand Stage 2, agreed on the
 * design canvas 2026-10-07; lightened 2026-10-09 after Roland found the
 * shipped Home "too charged").
 *
 * Three kinds of thing, and only these: what is overdue, what somebody else
 * handed you (whatever its date: a job for next week given to you today is
 * news today), and the shopping list by aisle. Everything else about the day
 * is in the Today list under it, so nothing is shown twice. How overdue work
 * folds into one row is in src/pulseRows.ts.
 */
export interface PulseShopItem {
  name: string;
  category?: string | null;
  checked?: boolean;
}

function dueMs(card: Card): number | null {
  if (!card.due_date) return null;
  const time = new Date(card.due_date).getTime();
  return Number.isNaN(time) ? null : time;
}

export function FamilyPulse({
  overdue,
  handed,
  shopping,
  handedByName,
  dayLine,
  onOpenCard,
  onOpenShopping,
  onSeeAll,
}: {
  overdue: Card[];
  handed: Card[];
  shopping: PulseShopItem[];
  /** Who handed a card over, or '' when unknown. */
  handedByName: (card: Card) => string;
  dayLine: (card: Card) => string;
  onOpenCard: (card: Card) => void;
  onOpenShopping: () => void;
  onSeeAll: () => void;
}) {
  const ui = useUI();
  const { t } = useStore();
  const styles = createStyles(ui);

  const { rows, more, needing } = planPulseRows(overdue, handed, dueMs);

  const open = shopping.filter((i) => !i.checked);
  const aisles = groupByAisle(open).map((g) => t(aisleKey(g.aisle)));
  const aisleLine = aisles.length > 3
    ? `${aisles.slice(0, 3).join(', ')}, ${t('pulse_more_aisles', { n: aisles.length - 3 })}`
    : aisles.join(', ');

  const count = needing + (open.length > 0 ? 1 : 0);
  const headline = count === 0
    ? t('pulse_all_calm')
    : count === 1 ? t('pulse_need_you_one') : t('pulse_need_you', { n: count });

  const chevron = <ChevronRight color={ui.muted} size={18} />;

  const renderCardRow = (kind: 'overdue' | 'handed', card: Card, first: boolean) => {
    const by = kind === 'handed' ? handedByName(card) : '';
    const sub = kind === 'overdue'
      ? t('pulse_overdue', { when: dayLine(card) })
      : by ? t('pulse_handed_by', { name: by }) : t('pulse_handed');
    return (
      <PressScale
        key={card.card_id}
        testID={`pulse-${kind}-${card.card_id}`}
        accessibilityRole="button"
        accessibilityLabel={`${card.title}, ${sub}`}
        onPress={() => onOpenCard(card)}
        style={[styles.row, !first && styles.rowLine]}
      >
        <View style={[styles.icon, kind === 'overdue'
          ? { backgroundColor: ui.dangerSoft }
          : { backgroundColor: ui.orangeSoft }]}
        >
          {kind === 'overdue'
            ? <AlertCircle color={ui.danger} size={17} />
            : <UserCheck color={ui.orangeText} size={17} />}
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{card.title}</Text>
          <Text style={[styles.sub, kind === 'overdue' && { color: ui.danger }]} numberOfLines={1}>{sub}</Text>
        </View>
        {chevron}
      </PressScale>
    );
  };

  const renderGroupRow = (cards: Card[], first: boolean) => {
    const names = cards.slice(0, 2).map((c) => c.title).join(', ');
    const rest = cards.length - 2;
    const oldest = t('pulse_overdue_oldest', { when: dayLine(cards[0]) });
    const sub = `${names}${rest > 0 ? ` ${t('pulse_more', { n: rest })}` : ''} · ${oldest}`;
    const title = t('pulse_overdue_n', { n: cards.length });
    return (
      <PressScale
        key="overdue-group"
        testID="pulse-overdue-group"
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${sub}`}
        onPress={onSeeAll}
        style={[styles.row, !first && styles.rowLine]}
      >
        <View style={[styles.icon, { backgroundColor: ui.dangerSoft }]}>
          <AlertCircle color={ui.danger} size={17} />
        </View>
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={[styles.sub, { color: ui.danger }]} numberOfLines={1}>{sub}</Text>
        </View>
        {chevron}
      </PressScale>
    );
  };

  const overdueRows = rows.filter((r) => r.kind !== 'handed');
  const handedRows = rows.filter((r) => r.kind === 'handed');

  return (
    <View style={styles.card} testID="family-pulse">
      <View style={styles.head}>
        <Text style={styles.eyebrow}>{t('pulse_title')}</Text>
        <Text style={styles.headline} testID="family-pulse-headline" numberOfLines={1}>{headline}</Text>
      </View>

      {overdueRows.map((r, i) => (r.kind === 'overdue_group'
        ? renderGroupRow(r.cards, i === 0)
        : renderCardRow('overdue', (r as { card: Card }).card, i === 0)))}
      {handedRows.length > 0 ? (
        // One container for what was handed over, so "what somebody gave me"
        // can be found as a whole (the hand-off harness reads it).
        <View testID="feed-assigned">
          {handedRows.map((r, i) => renderCardRow('handed', (r as { card: Card }).card, i === 0 && overdueRows.length === 0))}
        </View>
      ) : null}

      {more > 0 ? (
        <PressScale testID="pulse-more" onPress={onSeeAll} style={[styles.row, styles.rowLine]} accessibilityRole="button">
          <Text style={styles.more}>{t('pulse_more', { n: more })}</Text>
        </PressScale>
      ) : null}

      {open.length > 0 ? (
        <PressScale
          testID="pulse-shopping"
          accessibilityRole="button"
          onPress={onOpenShopping}
          style={[styles.row, rows.length > 0 && styles.rowLine]}
        >
          <View style={[styles.icon, { backgroundColor: ui.mint }]}>
            <ShoppingCart color={ui.mintText} size={17} />
          </View>
          <View style={styles.body}>
            <Text style={styles.title} numberOfLines={1}>
              {open.length === 1 ? t('pulse_shopping_one') : t('pulse_shopping', { n: open.length })}
            </Text>
            {aisleLine ? <Text style={styles.sub} numberOfLines={1}>{aisleLine}</Text> : null}
          </View>
          {chevron}
        </PressScale>
      ) : null}
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
      paddingBottom: 6,
      marginBottom: 16,
      shadowColor: '#000000',
      shadowOpacity: 0.05,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 2,
    },
    // One line: the eyebrow on the left, the count in grey on the right. The
    // orange star that sat here was the same colour and weight as the +, so
    // neither read as the thing to press.
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, paddingBottom: 4 },
    eyebrow: {
      color: ui.orangeText, fontFamily: 'Figtree_800ExtraBold', fontSize: 11.5,
      letterSpacing: 1.2, textTransform: 'uppercase',
    },
    headline: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12.5, flexShrink: 1 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, minHeight: 50 },
    rowLine: { borderTopWidth: 1, borderTopColor: ui.line },
    icon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0 },
    title: { color: ui.text, fontFamily: 'Figtree_600SemiBold', fontSize: 14.5 },
    sub: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12.5, marginTop: 1 },
    more: { color: ui.orangeText, fontFamily: 'Figtree_700Bold', fontSize: 13.5, paddingLeft: 44 },
  });
