import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gift, ChevronRight } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { useUI, UIColors } from './Kit';
import { Card, GiftPot } from '../api';

interface Props {
  /** Upcoming birthdays (soonest first), already windowed and filtered. */
  birthdays: Card[];
  /** Live pots keyed by their birthday card id. */
  potByCard: Record<string, GiftPot>;
  lang: string;
  onOpen: (card: Card) => void;
  onSeeAll: () => void;
}

const MAX_ROWS = 4;
const DAY = 24 * 60 * 60 * 1000;

function shortMonth(d: Date, lang: string): string {
  try { return d.toLocaleDateString(lang, { month: 'short' }); }
  catch { return d.toLocaleDateString(undefined, { month: 'short' }); }
}
function longMonth(d: Date, lang: string): string {
  try { return d.toLocaleDateString(lang, { month: 'long' }); }
  catch { return d.toLocaleDateString(undefined, { month: 'long' }); }
}

/**
 * The Gift Pot strip on the Feed — a compact, glanceable list of the birthdays
 * coming up, gathered so nobody enters one by hand. It shows only the month(s)
 * and who's in them; each row opens (or starts) that birthday's pot, where the
 * real work — chipping in, sharing the link, marking paid — happens. Hidden
 * entirely when there are no upcoming birthdays, so it never wastes Feed space.
 */
export function GiftPotStrip({ birthdays, potByCard, lang, onOpen, onSeeAll }: Props) {
  const { t } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  if (!birthdays.length) return null;

  const shown = birthdays.slice(0, MAX_ROWS);
  const now = Date.now();

  // The month range the window spans — "August" if it's all one month, else
  // "August – September".
  const first = new Date(birthdays[0].due_date as string);
  const last = new Date(birthdays[birthdays.length - 1].due_date as string);
  const monthLabel = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()
    ? longMonth(first, lang)
    : `${longMonth(first, lang)} – ${longMonth(last, lang)}`;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Gift color={ui.orangeText} size={17} />
        <Text style={styles.title}>{t('gp_title')}</Text>
        <Text style={styles.month} numberOfLines={1}>{monthLabel}</Text>
      </View>

      {shown.map((card, i) => {
        const due = new Date(card.due_date as string);
        const pot = potByCard[card.card_id];
        const target = pot
          ? (pot.target_total ?? pot.per_head * Math.max(pot.contributor_count, 2))
          : 0;
        return (
          <PressScale
            key={card.card_id}
            testID={`gift-pot-row-${card.card_id}`}
            onPress={() => onOpen(card)}
            style={[styles.row, i === 0 && styles.rowFirst]}
            accessibilityRole="button"
            accessibilityLabel={card.title}
          >
            <View style={styles.day}>
              <Text style={styles.dayD}>{String(due.getDate()).padStart(2, '0')}</Text>
              <Text style={styles.dayM}>{shortMonth(due, lang)}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>{(card.title || '').trim()}</Text>
            {pot ? (
              <Text style={styles.chip}>
                {t('gp_chip', { total: String(pot.total_pledged), target: String(Math.round(target)) })}
              </Text>
            ) : (
              <Text style={styles.start}>{t('gp_start_short')}</Text>
            )}
            <ChevronRight color={ui.muted} size={16} />
          </PressScale>
        );
      })}

      {birthdays.length > MAX_ROWS ? (
        <PressScale testID="gift-pot-see-all" onPress={onSeeAll} style={styles.seeAll}>
          <Text style={styles.seeAllText}>{t('gp_see_all', { n: String(birthdays.length) })}</Text>
        </PressScale>
      ) : null}
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  card: { backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 6, marginBottom: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 2 },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15, letterSpacing: -0.2 },
  month: { marginLeft: 'auto', color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 11.5 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderTopWidth: 1, borderTopColor: ui.line },
  rowFirst: { borderTopWidth: 0, marginTop: 6 },
  day: { width: 38, alignItems: 'center' },
  dayD: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 16, lineHeight: 17, fontVariant: ['tabular-nums'] },
  dayM: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 1 },
  name: { flex: 1, minWidth: 0, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  chip: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 11, backgroundColor: ui.orangeSoft, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, fontVariant: ['tabular-nums'] },
  start: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12 },

  seeAll: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  seeAllText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
});
