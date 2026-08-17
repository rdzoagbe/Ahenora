import React, { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CalendarDays, Home, ShieldCheck, Star, UtensilsCrossed } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';

interface Props {
  onDone: () => void;
}

const SLIDES = [
  { Icon: Home, titleKey: 'tour1_t', subKey: 'tour1_s' },
  { Icon: CalendarDays, titleKey: 'tour2_t', subKey: 'tour2_s' },
  { Icon: UtensilsCrossed, titleKey: 'tour3_t', subKey: 'tour3_s' },
  { Icon: Star, titleKey: 'tour4_t', subKey: 'tour4_s' },
  { Icon: ShieldCheck, titleKey: 'tour5_t', subKey: 'tour5_s' },
] as const;

export function ValueTour({ onDone }: Props) {
  const { theme, t } = useStore();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  const last = page === SLIDES.length - 1;

  const next = () => {
    if (last) {
      onDone();
      return;
    }
    scrollRef.current?.scrollTo({ x: (page + 1) * width, animated: true });
  };

  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: c.bg }]} testID="value-tour">
      <View style={[styles.topRow, { paddingTop: insets.top + 10 }]}>
        <View style={styles.logoRow}>
          <View style={[styles.logoDot, { backgroundColor: c.accent }]} />
          <Text style={[styles.logoText, { color: c.text }]}>Ahenora</Text>
        </View>
        <PressScale
          testID="tour-skip"
          onPress={onDone}
          style={[styles.skipBtn, { backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}
          accessibilityRole="button"
          accessibilityLabel={t('tour_skip')}
        >
          <Text style={[styles.skipText, { color: c.textMuted }]}>{t('tour_skip')}</Text>
        </PressScale>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={styles.pager}
      >
        {SLIDES.map(({ Icon, titleKey, subKey }) => (
          <View key={titleKey} style={[styles.slide, { width }]}>
            <View style={[styles.iconWrap, { backgroundColor: c.accentSoft, borderColor: c.cardBorder }]}>
              <Icon color={c.accent} size={54} strokeWidth={1.6} />
            </View>
            <Text style={[styles.title, { color: c.text }]}>{t(titleKey)}</Text>
            <Text style={[styles.sub, { color: c.textMuted }]}>{t(subKey)}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 14) + 10 }]}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View
              key={s.titleKey}
              style={[
                styles.dot,
                { backgroundColor: i === page ? c.accent : c.cardBorder },
                i === page && styles.dotActive,
              ]}
            />
          ))}
        </View>
        <PressScale
          testID="tour-next"
          onPress={next}
          style={[styles.nextBtn, { backgroundColor: c.primary }]}
          accessibilityRole="button"
          accessibilityLabel={last ? t('tour_start') : t('tour_next')}
        >
          <Text style={[styles.nextText, { color: c.primaryText }]}>{last ? t('tour_start') : t('tour_next')}</Text>
        </PressScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 40 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 22,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoDot: { width: 15, height: 15, borderRadius: 9999 },
  logoText: { fontFamily: 'Inter_700Bold', fontSize: 15, letterSpacing: 1.5 },
  skipBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
    borderWidth: 1,
  },
  skipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  pager: { flex: 1 },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 34,
  },
  iconWrap: {
    width: 128,
    height: 128,
    borderRadius: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  title: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 34,
    lineHeight: 42,
    textAlign: 'center',
    marginBottom: 14,
  },
  sub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    maxWidth: 320,
  },
  bottom: { paddingHorizontal: 22, gap: 18 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 9999 },
  dotActive: { width: 22 },
  nextBtn: {
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
});
