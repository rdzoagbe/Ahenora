import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gift, ChevronRight, Plus } from 'lucide-react-native';

import { SECRET_SANTA_ENABLED } from '../features';
import { PressScale } from './PressScale';
import { useStore } from '../store';
import { useUI, UIColors } from './Kit';
import { Card, GiftPot, SantaDraw } from '../api';

interface Props {
  /** Upcoming birthdays (soonest first), already windowed and filtered. */
  birthdays: Card[];
  /** Live pots keyed by their birthday card id. */
  potByCard: Record<string, GiftPot>;
  /** Active Secret Santa draws (not closed). */
  santaDraws: SantaDraw[];
  lang: string;
  onOpenBirthday: (card: Card) => void;
  onSeeAllBirthdays: () => void;
  onOpenSanta: (draw: SantaDraw) => void;
  onNewSanta: () => void;
}

const MAX_ROWS = 4;

function shortMonth(d: Date, lang: string): string {
  try { return d.toLocaleDateString(lang, { month: 'short' }); }
  catch { return d.toLocaleDateString(undefined, { month: 'short' }); }
}
function longMonth(d: Date, lang: string): string {
  try { return d.toLocaleDateString(lang, { month: 'long' }); }
  catch { return d.toLocaleDateString(undefined, { month: 'long' }); }
}

/**
 * The gifting card on the Feed. Gift Pot and Secret Santa share ONE card with a
 * segmented toggle — the Kitchen-tabs pattern — so the two features cost one
 * footprint, not two. The card hides entirely when both are empty; when only
 * one has anything it shows without the toggle. It opens on whichever is more
 * urgent: a Secret Santa draw that's ready to send or freshly sent wins,
 * otherwise the birthdays. Each row opens its full screen, where the real work
 * happens.
 */
export function GiftingStrip({
  birthdays, potByCard, santaDraws, lang, onOpenBirthday, onSeeAllBirthdays, onOpenSanta, onNewSanta,
}: Props) {
  const { t } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  // Seasonal and currently hidden (src/features.ts). Emptying the list here
  // rather than branching further down means every downstream condition —
  // whether the card shows at all, which side it opens on, whether the toggle
  // is worth drawing — resolves correctly on its own.
  const draws = SECRET_SANTA_ENABLED
    ? santaDraws.filter((d) => d.status !== 'closed')
    : [];
  const hasBirthdays = birthdays.length > 0;
  const hasSanta = draws.length > 0;

  // Open on Secret Santa when a draw is actionable now (ready to send, or sent);
  // otherwise the birthdays lead.
  const santaUrgent = draws.some((d) => d.status === 'matched' || d.status === 'sent');
  const [tab, setTab] = useState<'giftpot' | 'santa'>(
    hasSanta && (santaUrgent || !hasBirthdays) ? 'santa' : 'giftpot');

  if (!hasBirthdays && !hasSanta) return null;

  // Both tabs are ALWAYS shown once the card is on screen, so Secret Santa is
  // discoverable (and startable) even when there's no draw yet — an empty tab
  // simply offers to start one, rather than hiding the feature.
  //
  // Unless the feature is off, in which case the card is gift pot only and a
  // one-option segmented control would be a control that does nothing.
  const showSegments = SECRET_SANTA_ENABLED;
  const active = SECRET_SANTA_ENABLED ? tab : 'giftpot';

  const santaSub = (d: SantaDraw): string => {
    const people = d.participant_count === 1 ? t('ss_one_person') : t('ss_n_people', { n: String(d.participant_count) });
    if (d.status === 'sent') return `${people} · ${d.opened_count}/${d.participant_count} ${t('ss_status_opened').toLowerCase()}`;
    if (d.status === 'matched') return `${people} · ${t('ss_matched_pill')}`;
    return people;
  };

  return (
    <View style={styles.card}>
      {showSegments ? (
      <View style={styles.seg}>
        <PressScale testID="gifting-tab-giftpot" onPress={() => setTab('giftpot')} style={[styles.segBtn, active === 'giftpot' && styles.segBtnOn]}>
          <Gift color={active === 'giftpot' ? ui.orangeText : ui.muted} size={14} />
          <Text style={[styles.segText, active === 'giftpot' && styles.segTextOn]}>{t('gp_title')}</Text>
        </PressScale>
        <PressScale testID="gifting-tab-santa" onPress={() => setTab('santa')} style={[styles.segBtn, active === 'santa' && styles.segBtnOn]}>
          <Gift color={active === 'santa' ? ui.orangeText : ui.muted} size={14} />
          <Text style={[styles.segText, active === 'santa' && styles.segTextOn]}>{t('ss_title')}</Text>
        </PressScale>
      </View>
      ) : null}

      {active === 'giftpot' ? (
        hasBirthdays ? (
          <GiftPotContent
            birthdays={birthdays} potByCard={potByCard} lang={lang} styles={styles} ui={ui} t={t}
            onOpen={onOpenBirthday} onSeeAll={onSeeAllBirthdays}
          />
        ) : (
          <Text style={styles.emptyTab}>{t('gp_none_soon')}</Text>
        )
      ) : (
        <View>
          {draws.slice(0, MAX_ROWS).map((d, i) => (
            <PressScale
              key={d.draw_id}
              testID={`gifting-santa-${d.draw_id}`}
              onPress={() => onOpenSanta(d)}
              style={[styles.row, i === 0 && styles.rowFirst]}
              accessibilityRole="button"
              accessibilityLabel={d.title || t('ss_title')}
            >
              <View style={styles.santaBadge}><Gift color={ui.orangeText} size={17} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{d.title || t('ss_title')}</Text>
                <Text style={styles.sub} numberOfLines={1}>{santaSub(d)}</Text>
              </View>
              <ChevronRight color={ui.muted} size={16} />
            </PressScale>
          ))}
          <PressScale testID="gifting-santa-new" onPress={onNewSanta} style={styles.newRow}>
            <Plus color={ui.orangeText} size={15} />
            <Text style={styles.newText}>{t('ss_new')}</Text>
          </PressScale>
        </View>
      )}
    </View>
  );
}

function GiftPotContent({ birthdays, potByCard, lang, styles, ui, t, onOpen, onSeeAll }: {
  birthdays: Card[]; potByCard: Record<string, GiftPot>; lang: string;
  styles: ReturnType<typeof createStyles>; ui: UIColors; t: (k: string, v?: Record<string, string>) => string;
  onOpen: (c: Card) => void; onSeeAll: () => void;
}) {
  const shown = birthdays.slice(0, MAX_ROWS);
  const first = new Date(birthdays[0].due_date as string);
  const last = new Date(birthdays[birthdays.length - 1].due_date as string);
  const monthLabel = first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()
    ? longMonth(first, lang)
    : `${longMonth(first, lang)} – ${longMonth(last, lang)}`;

  return (
    <View>
      <Text style={styles.monthLine}>{monthLabel}</Text>
      {shown.map((card, i) => {
        const due = new Date(card.due_date as string);
        const pot = potByCard[card.card_id];
        const target = pot ? (pot.target_total ?? pot.per_head * Math.max(pot.contributor_count, 2)) : 0;
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
              <Text style={styles.chip}>{t('gp_chip', { total: String(pot.total_pledged), target: String(Math.round(target)) })}</Text>
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
  card: { backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, marginBottom: 16 },

  seg: { flexDirection: 'row', backgroundColor: ui.soft, borderRadius: 12, padding: 4, gap: 4, marginBottom: 4 },
  segBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 9 },
  segBtnOn: { backgroundColor: ui.card },
  segText: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5, letterSpacing: -0.1 },
  segTextOn: { color: ui.orangeText },

  head: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 2 },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15, letterSpacing: -0.2 },
  monthLine: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 11.5, marginTop: 8, marginLeft: 2 },
  emptyTab: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', paddingVertical: 18 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, borderTopWidth: 1, borderTopColor: ui.line },
  rowFirst: { borderTopWidth: 0, marginTop: 6 },
  day: { width: 38, alignItems: 'center' },
  dayD: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 16, lineHeight: 17, fontVariant: ['tabular-nums'] },
  dayM: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 1 },
  santaBadge: { width: 38, height: 38, borderRadius: 11, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, minWidth: 0, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 14.5 },
  sub: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 11.5, marginTop: 1 },
  chip: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 11, backgroundColor: ui.orangeSoft, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, fontVariant: ['tabular-nums'] },
  start: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12 },

  newRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderTopWidth: 1, borderTopColor: ui.line, marginTop: 2 },
  newText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 12.5 },

  seeAll: { alignItems: 'center', paddingVertical: 10, marginTop: 2 },
  seeAllText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
});
