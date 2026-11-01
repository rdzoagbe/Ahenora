import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import type { FamilyMember } from '../api';
import { dayKey } from '../homeDay';
import { personTone } from '../homeFamily';
import { SECTION_ART } from '../sectionArt';
import { TILE } from '../homeTiles';
import { localeFor } from '../utils/date';

/**
 * The top of Home as Roland chose it on 2026-11-01 ("Go with A with B's
 * touches"): the week as a strip, the next thing as a card of its own, and
 * three tiles for dinner, the shopping list and the children's stars. The
 * rules behind what they show are in src/homeDay.ts.
 */

/**
 * Today and the six days after it, today filled in, a dot under each day for
 * each person with something on it, in that person's colour. A day opens the
 * Calendar on that day.
 */
export function HomeWeekStrip({
  week,
  today,
  plans,
  members,
  onPick,
}: {
  week: Date[];
  today: Date;
  plans: Record<string, string[]>;
  members: FamilyMember[];
  onPick: (key: string) => void;
}) {
  const ui = useUI();
  const { t, lang } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const todayKey = dayKey(today);
  return (
    <View style={styles.week} testID="home-week">
      {week.map((d) => {
        const key = dayKey(d);
        const isToday = key === todayKey;
        const who = plans[key] || [];
        const label = d.toLocaleDateString(localeFor(lang), { weekday: 'long', day: 'numeric', month: 'long' });
        return (
          <PressScale
            key={key}
            testID={`home-week-${key}`}
            accessibilityRole="button"
            accessibilityLabel={who.length > 0 ? `${label}, ${t('home_has_plans')}` : label}
            accessibilityState={{ selected: isToday }}
            onPress={() => onPick(key)}
            style={[styles.day, isToday && { backgroundColor: ui.text }]}
          >
            <Text style={[styles.dayName, { color: isToday ? ui.bg : ui.muted }]}>
              {d.toLocaleDateString(localeFor(lang), { weekday: 'short' }).replace('.', '')}
            </Text>
            <Text style={[styles.dayNum, { color: isToday ? ui.bg : ui.text }]}>{d.getDate()}</Text>
            <View style={styles.dots}>
              {who.map((name, i) => (
                <View
                  key={`${name}-${i}`}
                  style={[styles.dot, { backgroundColor: name ? ui[personTone(name, members).fg] : (isToday ? ui.bg : ui.muted) }]}
                />
              ))}
            </View>
          </PressScale>
        );
      })}
    </View>
  );
}

/** The next timed thing today, with how long until it starts. */
export function HomeNextUp({
  cardId,
  title,
  when,
  countdown,
  who,
  onOpen,
}: {
  cardId: string;
  title: string;
  /** "6:00 PM" */
  when: string;
  /** "in 3 h" */
  countdown: string | null;
  who: string;
  onOpen: () => void;
}) {
  const ui = useUI();
  const { t } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const eyebrow = [t('home_next_up'), countdown].filter(Boolean).join(' · ').toUpperCase();
  return (
    <PressScale
      testID={`home-next-${cardId}`}
      accessibilityRole="button"
      accessibilityLabel={[t('home_next_up'), title, when, countdown, who].filter(Boolean).join(', ')}
      onPress={onOpen}
      style={styles.next}
    >
      <View style={styles.nextTop}>
        <Text style={styles.nextEyebrow} numberOfLines={1}>{eyebrow}</Text>
        {who ? <Text style={styles.nextWho} numberOfLines={1}>{who}</Text> : null}
      </View>
      <Text style={styles.nextTitle} numberOfLines={2}>{title}</Text>
      <View style={styles.nextBottom}>
        <Text style={styles.nextWhen}>{when}</Text>
        <View style={styles.nextOpen}>
          <Text style={styles.nextOpenText}>{t('home_open')}</Text>
        </View>
      </View>
    </PressScale>
  );
}

/**
 * Three doors with Roland's paintings: tonight's dinner, the shopping list and
 * the children's stars. A household without children (or with their side put
 * away) gets the week's plans in the third place instead.
 */
export function HomeTiles({
  dinner,
  shopCount,
  kids,
  weekCount,
  onDinner,
  onShopping,
  onStars,
  onWeek,
}: {
  dinner: string | null;
  shopCount: number;
  /** First names and stars, or null when the children's side is not shown. */
  kids: { name: string; stars: number }[] | null;
  weekCount: number;
  onDinner: () => void;
  onShopping: () => void;
  onStars: () => void;
  onWeek: () => void;
}) {
  const ui = useUI();
  const { t } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const starsLine = kids && kids.length > 0
    ? [...kids.slice(0, 2).map((k) => `${k.name} ${k.stars}`), kids.length > 2 ? `+${kids.length - 2}` : '']
      .filter(Boolean).join(' · ')
    : '';
  const tiles = [
    {
      key: 'dinner', art: SECTION_ART.kitchen, label: t('home_tile_dinner'),
      value: dinner || t('home_tile_plan_dinner'), onPress: onDinner,
    },
    {
      key: 'shopping', art: SECTION_ART.shopping, label: t('home_tile_shopping'),
      value: shopCount === 0 ? t('home_tile_nothing_to_buy')
        : shopCount === 1 ? t('home_tile_items_one') : t('home_tile_items_many', { n: shopCount }),
      onPress: onShopping,
    },
    kids && kids.length > 0
      ? { key: 'stars', art: SECTION_ART.family, label: t('home_tile_stars'), value: starsLine, onPress: onStars }
      : {
        key: 'week', art: SECTION_ART.calendar, label: t('home_tile_week'),
        value: weekCount === 1 ? t('home_tile_plans_one') : t('home_tile_plans_many', { n: weekCount }),
        onPress: onWeek,
      },
  ];
  return (
    <View style={styles.tiles} testID="home-tiles">
      {tiles.map((tile) => (
        <PressScale
          key={tile.key}
          testID={`home-tile-${tile.key}`}
          accessibilityRole="button"
          accessibilityLabel={`${tile.label}, ${tile.value}`}
          onPress={tile.onPress}
          style={styles.tile}
        >
          {tile.art ? <Image source={tile.art} style={styles.tileArt} resizeMode="cover" /> : null}
          <Text style={styles.tileLabel} numberOfLines={1}>{tile.label}</Text>
          <Text style={styles.tileValue} numberOfLines={2}>{tile.value}</Text>
        </PressScale>
      ))}
    </View>
  );
}

function createStyles(ui: UIColors) {
  return StyleSheet.create({
    week: { flexDirection: 'row', gap: 4, marginTop: 14 },
    day: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 8, borderRadius: 14, minHeight: 64 },
    dayName: { fontFamily: 'Figtree_700Bold', fontSize: 12, textTransform: 'capitalize' },
    dayNum: { fontFamily: 'Figtree_800ExtraBold', fontSize: 16 },
    dots: { flexDirection: 'row', gap: 3, height: 6 },
    dot: { width: 6, height: 6, borderRadius: 3 },

    next: {
      marginTop: 14, borderRadius: 24, backgroundColor: TILE.orange.solid,
      paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14, gap: 8,
    },
    nextTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    nextEyebrow: { flex: 1, color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 12, letterSpacing: 1.1 },
    nextWho: {
      color: '#FFFFFF', fontFamily: 'Figtree_700Bold', fontSize: 12, maxWidth: 140,
      backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden',
    },
    nextTitle: { color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 23, lineHeight: 28 },
    nextBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    nextWhen: { color: '#FFFFFF', fontFamily: 'Figtree_600SemiBold', fontSize: 14 },
    nextOpen: { height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
    nextOpenText: { color: '#8A3508', fontFamily: 'Figtree_800ExtraBold', fontSize: 14 },

    tiles: { flexDirection: 'row', gap: 8, marginTop: 16 },
    tile: {
      flex: 1, minWidth: 0, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line,
      borderRadius: 18, padding: 8, gap: 3,
    },
    tileArt: { width: '100%', height: 64, borderRadius: 12 },
    tileLabel: { color: ui.muted, fontFamily: 'Figtree_700Bold', fontSize: 12, marginTop: 3 },
    tileValue: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 13, lineHeight: 16 },
  });
}
