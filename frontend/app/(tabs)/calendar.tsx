import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
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

type CalendarCell = {
  key: string;
  date: Date;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  items: Card[];
};

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function parseDueDate(value?: string | null) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function getCardKey(card: Card) {
  const due = parseDueDate(card.due_date);

  if (!due) return null;

  return getLocalDateKey(due);
}

function groupCardsByDate(cards: Card[]) {
  const grouped: Record<string, Card[]> = {};

  cards.forEach((card) => {
    const key = getCardKey(card);

    if (!key) return;

    grouped[key] = grouped[key] || [];
    grouped[key].push(card);
  });

  Object.values(grouped).forEach((items) => {
    items.sort((a, b) => {
      const left = parseDueDate(a.due_date)?.getTime() || 0;
      const right = parseDueDate(b.due_date)?.getTime() || 0;

      return left - right;
    });
  });

  return grouped;
}

function buildCalendarCells(monthDate: Date, grouped: Record<string, Card[]>): CalendarCell[] {
  const firstDayOfMonth = getMonthStart(monthDate);
  const firstWeekdayIndex = firstDayOfMonth.getDay();

  const firstVisibleDate = new Date(firstDayOfMonth);
  firstVisibleDate.setDate(firstDayOfMonth.getDate() - firstWeekdayIndex);

  const todayKey = getLocalDateKey(new Date());

  return Array.from({ length: 42 }, (_, index) => {
    const cellDate = new Date(firstVisibleDate);
    cellDate.setDate(firstVisibleDate.getDate() + index);

    const key = getLocalDateKey(cellDate);

    return {
      key,
      date: cellDate,
      dayNumber: cellDate.getDate(),
      isCurrentMonth: cellDate.getMonth() === monthDate.getMonth(),
      isToday: key === todayKey,
      items: grouped[key] || [],
    };
  });
}

function formatTime(value?: string | null) {
  const date = parseDueDate(value);

  if (!date) return '';

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(value?: string | null) {
  const date = parseDueDate(value);

  if (!date) return '';

  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function CalendarScreen() {
  const { t, lang } = useStore();
  const { width } = useWindowDimensions();

  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [monthDate, setMonthDate] = useState(() => getMonthStart(new Date()));
  const [selectedDateKey, setSelectedDateKey] = useState(() => getLocalDateKey(new Date()));

  const horizontalPadding = 40;
  const calendarBorder = 2;
  const cellSize = Math.floor((width - horizontalPadding - calendarBorder) / 7);

  const load = useCallback(async () => {
    try {
      setErrorMessage(null);

      const result = await api.listCards();

      setCards(result.filter((card) => card.status === 'OPEN' && Boolean(card.due_date)));
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

  const grouped = useMemo(() => groupCardsByDate(cards), [cards]);

  const cells = useMemo(() => buildCalendarCells(monthDate, grouped), [monthDate, grouped]);

  const selectedItems = grouped[selectedDateKey] || [];

  const monthItems = useMemo(() => {
    return cards
      .filter((card) => {
        const due = parseDueDate(card.due_date);

        if (!due) return false;

        return (
          due.getFullYear() === monthDate.getFullYear() &&
          due.getMonth() === monthDate.getMonth()
        );
      })
      .sort((a, b) => {
        const left = parseDueDate(a.due_date)?.getTime() || 0;
        const right = parseDueDate(b.due_date)?.getTime() || 0;

        return left - right;
      });
  }, [cards, monthDate]);

  const locale = lang === 'es' ? 'es-ES' : 'en-US';

  const monthLabel = monthDate.toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });

  const selectedLabel = new Date(`${selectedDateKey}T12:00:00`).toLocaleDateString(locale, {
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
                {WEEKDAYS.map((weekday) => (
                  <View key={weekday} style={{ width: cellSize }}>
                    <Text style={styles.weekDay}>{weekday}</Text>
                  </View>
                ))}
              </View>

              <View style={[styles.calendarGrid, { width: cellSize * 7 }]}>
                {cells.map((cell) => {
                  const selected = cell.key === selectedDateKey;

                  return (
                    <Pressable
                      key={cell.key}
                      testID={`calendar-day-${cell.key}`}
                      onPress={() => setSelectedDateKey(cell.key)}
                      style={[
                        styles.dateCell,
                        {
                          width: cellSize,
                          height: Math.max(70, cellSize + 18),
                        },
                        !cell.isCurrentMonth && styles.dateCellOtherMonth,
                        cell.isToday && styles.dateCellToday,
                        selected && styles.dateCellSelected,
                      ]}
                    >
                      <View style={styles.dateTopRow}>
                        <Text
                          style={[
                            styles.dateNumber,
                            !cell.isCurrentMonth && styles.dateNumberOtherMonth,
                            selected && styles.dateNumberSelected,
                          ]}
                        >
                          {String(cell.dayNumber)}
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
                              styles.itemDot,
                              { backgroundColor: TYPE_COLOR[item.type] || '#FFFFFF' },
                            ]}
                          />
                        ))}
                      </View>
                    </Pressable>
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
                      <Text style={styles.recapDate}>{formatShortDate(card.due_date)}</Text>

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
    color: '#FFFFFF',
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '400',
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
  },
  sub: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    marginBottom: 18,
    fontFamily: 'Inter_400Regular',
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
    color: '#FFFFFF',
    fontSize: 30,
    lineHeight: 34,
    marginTop: 8,
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'Inter_400Regular',
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
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
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  weekRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    marginBottom: 8,
  },
  weekDay: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  calendarGrid: {
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderLeftWidth: 1,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 18,
    overflow: 'hidden',
  },
  dateCell: {
    paddingHorizontal: 6,
    paddingVertical: 7,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  dateCellOtherMonth: {
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  dateCellToday: {
    backgroundColor: 'rgba(249,115,22,0.18)',
  },
  dateCellSelected: {
    backgroundColor: 'rgba(99,102,241,0.32)',
  },
  dateTopRow: {
    minHeight: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateNumber: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 20,
  },
  dateNumberOtherMonth: {
    color: 'rgba(255,255,255,0.42)',
  },
  dateNumberSelected: {
    color: '#FFFFFF',
  },
  countBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9999,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: {
    color: '#080910',
    fontSize: 10,
    fontWeight: '900',
  },
  dotRow: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  itemDot: {
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
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  sectionMeta: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
  },
  emptyMiniCard: {
    marginBottom: 10,
  },
  emptyMiniText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
  },
  itemCard: { marginBottom: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  itemTypeDot: { width: 10, height: 10, borderRadius: 9999 },
  itemTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  itemMeta: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  typeLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  recapCard: { marginBottom: 8 },
  recapRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  recapDate: {
    width: 82,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '700',
  },
  recapTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  recapMeta: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    marginTop: 2,
  },
});
