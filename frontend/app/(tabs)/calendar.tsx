import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { ChevronLeft, ChevronRight, CalendarDays, ListChecks } from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { PressScale } from '../../src/components/PressScale';
import EmptyState from '../../src/components/EmptyState';
import ErrorState from '../../src/components/ErrorState';
import LoadingOverlay from '../../src/components/LoadingOverlay';

import { useStore } from '../../src/store';
import { api, Card } from '../../src/api';
import { logger } from '../../src/logger';

const TYPE_COLOR: Record<string, string> = {
  SIGN_SLIP: '#F97316',
  RSVP: '#6366F1',
  TASK: '#10B981',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function toDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseCardDate(value?: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function getCardDayKey(card: Card) {
  const date = parseCardDate(card.due_date);
  return date ? toDateKey(date) : null;
}

function groupCardsByDay(cards: Card[]) {
  const groups: Record<string, Card[]> = {};

  cards.forEach((card) => {
    const key = getCardDayKey(card);
    if (!key) return;

    groups[key] = groups[key] || [];
    groups[key].push(card);
  });

  Object.values(groups).forEach((items) => {
    items.sort((a, b) => {
      const da = parseCardDate(a.due_date)?.getTime() || 0;
      const db = parseCardDate(b.due_date)?.getTime() || 0;
      return da - db;
    });
  });

  return groups;
}

function buildMonthCells(monthDate: Date, grouped: Record<string, Card[]>) {
  const first = startOfMonth(monthDate);
  const startOffset = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    const key = toDateKey(date);
    const todayKey = toDateKey(new Date());

    return {
      key,
      date,
      dayNumber: date.getDate(),
      inCurrentMonth: date.getMonth() === monthDate.getMonth(),
      isToday: key === todayKey,
      items: grouped[key] || [],
    };
  });
}

function formatCardTime(value?: string | null) {
  const date = parseCardDate(value);
  if (!date) return '';

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(value?: string | null) {
  const date = parseCardDate(value);
  if (!date) return '';

  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function CalendarScreen() {
  const { t, lang } = useStore();

  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [monthDate, setMonthDate] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => toDateKey(new Date()));

  const load = useCallback(async () => {
    try {
      setErrorMessage(null);

      const res = await api.listCards();

      setCards(res.filter((card) => card.status === 'OPEN' && Boolean(card.due_date)));
    } catch (e: any) {
      logger.warn('Calendar load failed:', e?.message || e);
      setErrorMessage(e?.message || 'Could not load calendar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => groupCardsByDay(cards), [cards]);

  const monthCells = useMemo(
    () => buildMonthCells(monthDate, grouped),
    [monthDate, grouped]
  );

  const monthCards = useMemo(() => {
    return cards
      .filter((card) => {
        const date = parseCardDate(card.due_date);
        if (!date) return false;

        return (
          date.getFullYear() === monthDate.getFullYear() &&
          date.getMonth() === monthDate.getMonth()
        );
      })
      .sort((a, b) => {
        const da = parseCardDate(a.due_date)?.getTime() || 0;
        const db = parseCardDate(b.due_date)?.getTime() || 0;
        return da - db;
      });
  }, [cards, monthDate]);

  const selectedItems = grouped[selectedDay] || [];

  const locale = lang === 'es' ? 'es-ES' : 'en-US';

  const monthLabel = monthDate.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });

  const selectedLabel = new Date(`${selectedDay}T12:00:00`).toLocaleDateString(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const openCount = cards.length;
  const monthCount = monthCards.length;

  const showBlockingError = !loading && Boolean(errorMessage) && cards.length === 0;

  return (
    <View style={styles.container}>
      <AmbientBackground />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>{t('calendar')}</Text>
          <Text style={styles.sub}>{t('upcoming')}</Text>

          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <CalendarDays color="#F97316" size={16} />
              <Text style={styles.summaryValue}>{monthCount}</Text>
              <Text style={styles.summaryLabel}>This month</Text>
            </View>

            <View style={styles.summaryCard}>
              <ListChecks color="#10B981" size={16} />
              <Text style={styles.summaryValue}>{openCount}</Text>
              <Text style={styles.summaryLabel}>Scheduled open items</Text>
            </View>
          </View>

          <View style={styles.monthHeader}>
            <PressScale
              testID="calendar-prev-month"
              onPress={() => setMonthDate((current) => addMonths(current, -1))}
              style={styles.monthNavBtn}
            >
              <ChevronLeft color="#fff" size={18} />
            </PressScale>

            <Text style={styles.monthTitle}>{monthLabel}</Text>

            <PressScale
              testID="calendar-next-month"
              onPress={() => setMonthDate((current) => addMonths(current, 1))}
              style={styles.monthNavBtn}
            >
              <ChevronRight color="#fff" size={18} />
            </PressScale>
          </View>

          {showBlockingError ? (
            <ErrorState
              title="Calendar unavailable"
              message={errorMessage || 'Could not load calendar.'}
              onRetry={load}
            />
          ) : (
            <>
              <View style={styles.weekRow}>
                {WEEKDAYS.map((day) => (
                  <Text key={day} style={styles.weekDay}>
                    {day}
                  </Text>
                ))}
              </View>

              <View style={styles.monthGrid}>
                {monthCells.map((cell) => {
                  const selected = cell.key === selectedDay;

                  return (
                    <PressScale
                      key={cell.key}
                      testID={`calendar-day-${cell.key}`}
                      onPress={() => setSelectedDay(cell.key)}
                      style={[
                        styles.dayCell,
                        !cell.inCurrentMonth && styles.dayCellMuted,
                        cell.isToday && styles.dayCellToday,
                        selected && styles.dayCellSelected,
                      ]}
                    >
                      <View style={styles.dayTopRow}>
                        <Text
                          style={[
                            styles.dayNumber,
                            !cell.inCurrentMonth && styles.dayNumberMuted,
                          ]}
                        >
                          {cell.dayNumber}
                        </Text>

                        {cell.items.length > 0 ? (
                          <View style={styles.dayCountBadge}>
                            <Text style={styles.dayCountText}>{cell.items.length}</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.dayDots}>
                        {cell.items.slice(0, 3).map((item) => (
                          <View
                            key={item.card_id}
                            style={[
                              styles.dayDot,
                              { backgroundColor: TYPE_COLOR[item.type] || '#fff' },
                            ]}
                          />
                        ))}
                      </View>
                    </PressScale>
                  );
                })}
              </View>

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{selectedLabel}</Text>
                <Text style={styles.sectionMeta}>
                  {selectedItems.length} {selectedItems.length === 1 ? 'item' : 'items'}
                </Text>
              </View>

              {selectedItems.length === 0 ? (
                <EmptyState
                  title={t('no_events')}
                  message="No scheduled household cards for this date."
                />
              ) : (
                selectedItems.map((card) => (
                  <GlassCard key={card.card_id} style={styles.itemCard}>
                    <View style={styles.row}>
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: TYPE_COLOR[card.type] || '#fff' },
                        ]}
                      />

                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemTitle} numberOfLines={2}>
                          {card.title}
                        </Text>

                        <Text style={styles.meta}>
                          {[formatCardTime(card.due_date), card.assignee]
                            .filter(Boolean)
                            .join(' · ') || 'No assignee'}
                        </Text>
                      </View>

                      <Text style={[styles.typeLabel, { color: TYPE_COLOR[card.type] }]}>
                        {card.type === 'SIGN_SLIP'
                          ? t('sign_slip')
                          : card.type === 'RSVP'
                          ? t('rsvp')
                          : t('task')}
                      </Text>
                    </View>
                  </GlassCard>
                ))
              )}

              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Monthly recap</Text>
                <Text style={styles.sectionMeta}>{monthCount} scheduled</Text>
              </View>

              {monthCards.length === 0 ? (
                <GlassCard style={styles.emptyCard}>
                  <Text style={styles.emptyText}>Nothing scheduled for this month yet.</Text>
                </GlassCard>
              ) : (
                monthCards.map((card) => (
                  <GlassCard key={`recap-${card.card_id}`} style={styles.recapCard}>
                    <View style={styles.recapRow}>
                      <Text style={styles.recapDate}>{formatShortDate(card.due_date)}</Text>

                      <View style={{ flex: 1 }}>
                        <Text style={styles.recapTitle} numberOfLines={1}>
                          {card.title}
                        </Text>

                        <Text style={styles.recapMeta} numberOfLines={1}>
                          {[formatCardTime(card.due_date), card.assignee]
                            .filter(Boolean)
                            .join(' · ') || 'Unassigned'}
                        </Text>
                      </View>
                    </View>
                  </GlassCard>
                ))
              )}
            </>
          )}

          <View style={{ height: 200 }} />
        </ScrollView>
      </SafeAreaView>

      <LoadingOverlay visible={loading} label="Loading calendar..." />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080910' },
  safeArea: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 14 },
  title: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: '#fff',
    fontSize: 40,
    lineHeight: 46,
  },
  sub: {
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    marginBottom: 18,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 18,
  },
  summaryCard: {
    flex: 1,
    borderRadius: 20,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  summaryValue: {
    color: '#fff',
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 30,
    lineHeight: 34,
    marginTop: 8,
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  monthNavBtn: {
    width: 40,
    height: 40,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  monthTitle: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    textTransform: 'capitalize',
  },
  weekRow: { flexDirection: 'row', marginBottom: 8 },
  weekDay: {
    width: `${100 / 7}%`,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  dayCell: {
    width: `${100 / 7}%`,
    minHeight: 72,
    padding: 7,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  dayCellMuted: { opacity: 0.38 },
  dayCellToday: { backgroundColor: 'rgba(249,115,22,0.10)' },
  dayCellSelected: { backgroundColor: 'rgba(99,102,241,0.20)' },
  dayTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayNumber: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  dayNumberMuted: { color: 'rgba(255,255,255,0.45)' },
  dayCountBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  dayCountText: {
    color: '#080910',
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
  },
  dayDots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    marginTop: 12,
  },
  dayDot: { width: 6, height: 6, borderRadius: 9999 },
  sectionHeader: {
    marginTop: 22,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  sectionMeta: {
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  emptyCard: { marginBottom: 10 },
  emptyText: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 18,
  },
  itemCard: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dot: { width: 10, height: 10, borderRadius: 9999 },
  itemTitle: {
    fontFamily: 'Inter_500Medium',
    color: '#fff',
    fontSize: 15,
  },
  meta: {
    color: 'rgba(255,255,255,0.5)',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 2,
  },
  typeLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  recapCard: { marginBottom: 8 },
  recapRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  recapDate: {
    width: 82,
    color: 'rgba(255,255,255,0.65)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  recapTitle: {
    color: '#fff',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
  recapMeta: {
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
});
