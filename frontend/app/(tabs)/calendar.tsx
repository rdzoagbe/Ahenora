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

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function parseDate(value?: string | null) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function cardDateKey(card: Card) {
  const date = parseDate(card.due_date);

  if (!date) return null;

  return dateKey(date);
}

function groupCards(cards: Card[]) {
  const grouped: Record<string, Card[]> = {};

  cards.forEach((card) => {
    const key = cardDateKey(card);

    if (!key) return;

    grouped[key] = grouped[key] || [];
    grouped[key].push(card);
  });

  Object.values(grouped).forEach((items) => {
    items.sort((a, b) => {
      const left = parseDate(a.due_date)?.getTime() || 0;
      const right = parseDate(b.due_date)?.getTime() || 0;

      return left - right;
    });
  });

  return grouped;
}

function buildCells(currentMonth: Date, grouped: Record<string, Card[]>) {
  const first = monthStart(currentMonth);
  const firstWeekday = first.getDay();

  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - firstWeekday);

  const todayKey = dateKey(new Date());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    const key = dateKey(date);

    return {
      key,
      date,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === currentMonth.getMonth(),
      isToday: key === todayKey,
      items: grouped[key] || [],
    };
  });
}

function formatTime(value?: string | null) {
  const date = parseDate(value);

  if (!date) return '';

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShort(value?: string | null) {
  const date = parseDate(value);

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
  const [currentMonth, setCurrentMonth] = useState(() => monthStart(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => dateKey(new Date()));

  const load = useCallback(async () => {
    try {
      setErrorMessage(null);

      const response = await api.listCards();

      setCards(response.filter((card) => card.status === 'OPEN' && Boolean(card.due_date)));
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

  const locale = lang === 'es' ? 'es-ES' : 'en-US';

  const grouped = useMemo(() => groupCards(cards), [cards]);
  const cells = useMemo(() => buildCells(currentMonth, grouped), [currentMonth, grouped]);

  const selectedItems = grouped[selectedDay] || [];

  const monthItems = useMemo(() => {
    return cards
      .filter((card) => {
        const due = parseDate(card.due_date);

        if (!due) return false;

        return (
          due.getFullYear() === currentMonth.getFullYear() &&
          due.getMonth() === currentMonth.getMonth()
        );
      })
      .sort((a, b) => {
        const left = parseDate(a.due_date)?.getTime() || 0;
        const right = parseDate(b.due_date)?.getTime() || 0;

        return left - right;
      });
  }, [cards, currentMonth]);

  const monthLabel = currentMonth.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });

  const selectedLabel = new Date(`${selectedDay}T12:00:00`).toLocaleDateString(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

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
              <Text style={styles.summaryValue}>{monthItems.length}</Text>
              <Text style={styles.summaryLabel}>This month</Text>
            </View>

            <View style={styles.summaryCard}>
              <ListChecks color="#10B981" size={16} />
              <Text style={styles.summaryValue}>{cards.length}</Text>
              <Text style={styles.summaryLabel}>Scheduled open items</Text>
            </View>
          </View>

          <View style={styles.monthHeader}>
            <PressScale
              testID="calendar-prev-month"
              onPress={() => setCurrentMonth((value) => addMonths(value, -1))}
              style={styles.monthNavBtn}
            >
              <ChevronLeft color="#fff" size={18} />
            </PressScale>

            <Text style={styles.monthTitle}>{monthLabel}</Text>

            <PressScale
              testID="calendar-next-month"
              onPress={() => setCurrentMonth((value) => addMonths(value, 1))}
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
                {WEEKDAYS.map((weekday) => (
                  <Text key={weekday} style={styles.weekDay}>
                    {weekday}
                  </Text>
                ))}
              </View>

              <View style={styles.calendarBox}>
                {cells.map((cell) => {
                  const selected = cell.key === selectedDay;

                  return (
                    <PressScale
                      key={cell.key}
                      testID={`calendar-day-${cell.key}`}
                      onPress={() => setSelectedDay(cell.key)}
                      style={[
                        styles.dayCell,
                        !cell.isCurrentMonth && styles.dayCellOtherMonth,
                        cell.isToday && styles.dayCellToday,
                        selected && styles.dayCellSelected,
                      ]}
                    >
                      <View style={styles.dayHeader}>
                        <Text
                          style={[
                            styles.dayNumber,
                            !cell.isCurrentMonth && styles.dayNumberOtherMonth,
                            selected && styles.dayNumberSelected,
                          ]}
                        >
                          {cell.day}
                        </Text>

                        {cell.items.length > 0 ? (
                          <View style={styles.countBadge}>
                            <Text style={styles.countText}>{cell.items.length}</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={styles.dotRow}>
                        {cell.items.slice(0, 3).map((item) => (
                          <View
                            key={item.card_id}
                            style={[
                              styles.dot,
                              { backgroundColor: TYPE_COLOR[item.type] || '#FFFFFF' },
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
                <GlassCard style={styles.emptyMiniCard}>
                  <Text style={styles.emptyMiniText}>No scheduled cards for this date.</Text>
                </GlassCard>
              ) : (
                selectedItems.map((card) => (
                  <GlassCard key={card.card_id} style={styles.itemCard}>
                    <View style={styles.itemRow}>
                      <View
                        style={[
                          styles.itemTypeDot,
                          { backgroundColor: TYPE_COLOR[card.type] || '#FFFFFF' },
                        ]}
                      />

                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemTitle} numberOfLines={2}>
                          {card.title}
                        </Text>

                        <Text style={styles.itemMeta}>
                          {[formatTime(card.due_date), card.assignee]
                            .filter(Boolean)
                            .join(' · ') || 'Unassigned'}
                        </Text>
                      </View>

                      <Text style={[styles.typeLabel, { color: TYPE_COLOR[card.type] || '#fff' }]}>
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
                <Text style={styles.sectionMeta}>{monthItems.length} scheduled</Text>
              </View>

              {monthItems.length === 0 ? (
                <EmptyState
                  title="No dates yet"
                  message="Cards with due dates will appear here. Add a due date from the Feed add-card form."
                />
              ) : (
                monthItems.map((card) => (
                  <GlassCard key={`month-${card.card_id}`} style={styles.recapCard}>
                    <View style={styles.recapRow}>
                      <Text style={styles.recapDate}>{formatShort(card.due_date)}</Text>

                      <View style={{ flex: 1 }}>
                        <Text style={styles.recapTitle} numberOfLines={1}>
                          {card.title}
                        </Text>

                        <Text style={styles.recapMeta} numberOfLines={1}>
                          {[formatTime(card.due_date), card.assignee]
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
    color: '#fff',
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 40,
    lineHeight: 46,
  },
  sub: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginBottom: 18,
  },
  summaryRow: { flexDirection: 'row', gap: 12, marginBottom: 18 },
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
  weekRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekDay: {
    flex: 1,
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  calendarBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  dayCell: {
    width: '14.2857%',
    minHeight: 74,
    paddingHorizontal: 6,
    paddingVertical: 7,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(255,255,255,0.015)',
  },
  dayCellOtherMonth: {
    backgroundColor: 'rgba(255,255,255,0.005)',
  },
  dayCellToday: {
    backgroundColor: 'rgba(249,115,22,0.12)',
  },
  dayCellSelected: {
    backgroundColor: 'rgba(99,102,241,0.28)',
  },
  dayHeader: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayNumber: {
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  dayNumberOtherMonth: {
    color: 'rgba(255,255,255,0.35)',
  },
  dayNumberSelected: {
    color: '#FFFFFF',
  },
  countBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9999,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  countText: {
    color: '#080910',
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
  },
  dotRow: {
    marginTop: 13,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 9999,
  },
  sectionHeader: {
    marginTop: 22,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 12,
  },
  sectionTitle: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    textTransform: 'capitalize',
  },
  sectionMeta: {
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  emptyMiniCard: {
    marginBottom: 10,
  },
  emptyMiniText: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
  },
  itemCard: { marginBottom: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  itemTypeDot: { width: 10, height: 10, borderRadius: 9999 },
  itemTitle: {
    color: '#fff',
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
  },
  itemMeta: {
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
