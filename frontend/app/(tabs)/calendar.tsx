import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { CalendarDays, RefreshCw, ShieldCheck, Users } from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { PressScale } from '../../src/components/PressScale';
import { useStore } from '../../src/store';
import { api, CalendarImportResult, Card } from '../../src/api';

WebBrowser.maybeCompleteAuthSession();

const TYPE_COLOR: Record<string, string> = {
  SIGN_SLIP: '#F97316',
  RSVP: '#6366F1',
  TASK: '#10B981',
};

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';

function startOfLocalDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(date: Date) {
  const d = startOfLocalDay(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cardDateKey(card: Card) {
  if (!card.due_date) return '';
  return dateKey(new Date(card.due_date));
}

function groupByDay(cards: Card[]) {
  const groups: Record<string, Card[]> = {};

  cards.forEach((card) => {
    if (!card.due_date) return;

    const key = cardDateKey(card);
    groups[key] = groups[key] || [];
    groups[key].push(card);
  });

  return Object.keys(groups)
    .sort()
    .map((day) => ({
      day,
      items: groups[day].sort(
        (a, b) => new Date(a.due_date || '').getTime() - new Date(b.due_date || '').getTime()
      ),
    }));
}

function buildMonthDays(baseDate: Date) {
  const first = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const last = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  const leading = first.getDay();
  const total = leading + last.getDate();
  const trailing = Math.ceil(total / 7) * 7 - total;

  const days: Array<{ date: Date; inMonth: boolean }> = [];

  for (let i = leading; i > 0; i -= 1) {
    days.push({
      date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 1 - i),
      inMonth: false,
    });
  }

  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push({
      date: new Date(baseDate.getFullYear(), baseDate.getMonth(), day),
      inMonth: true,
    });
  }

  for (let i = 1; i <= trailing; i += 1) {
    days.push({
      date: new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, i),
      inMonth: false,
    });
  }

  return days;
}

export default function CalendarScreen() {
  const { t, lang } = useStore();

  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<CalendarImportResult | null>(null);
  const [activeMonth, setActiveMonth] = useState(() => new Date());

  const handledCalendarResponseRef = useRef(false);

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  const [calendarRequest, calendarResponse, promptCalendarAsync] = Google.useAuthRequest({
    androidClientId,
    webClientId,
    scopes: ['openid', 'profile', 'email', GOOGLE_CALENDAR_SCOPE],
  });

  const load = useCallback(async () => {
    try {
      const result = await api.listCards();
      setCards(result.filter((card) => card.status === 'OPEN' && card.due_date));
    } catch (e) {
      console.log('calendar load failed', e);
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

  useEffect(() => {
    const importCalendar = async () => {
      if (!calendarResponse || handledCalendarResponseRef.current) return;

      if (calendarResponse.type !== 'success') {
        if (calendarResponse.type === 'error') {
          Alert.alert('Calendar sync failed', 'Google Calendar permission was not granted.');
        }
        return;
      }

      handledCalendarResponseRef.current = true;

      const accessToken =
        calendarResponse.authentication?.accessToken ||
        calendarResponse.params?.access_token;

      if (!accessToken) {
        Alert.alert('Calendar sync failed', 'Google did not return a calendar access token.');
        handledCalendarResponseRef.current = false;
        return;
      }

      setSyncing(true);

      try {
        const result = await api.importGoogleCalendar(accessToken, 30);
        setSyncResult(result);
        await load();

        Alert.alert(
          'Calendar synced',
          `${result.imported} events imported. ${result.contacts_found} people found.`
        );
      } catch (e: any) {
        console.log('calendar sync failed', e);
        Alert.alert('Calendar sync failed', e?.message || 'Please try again.');
      } finally {
        setSyncing(false);
        handledCalendarResponseRef.current = false;
      }
    };

    importCalendar();
  }, [calendarResponse, load]);

  const groups = useMemo(() => groupByDay(cards), [cards]);
  const monthDays = useMemo(() => buildMonthDays(activeMonth), [activeMonth]);

  const countsByDay = useMemo(() => {
    const counts: Record<string, number> = {};

    cards.forEach((card) => {
      const key = cardDateKey(card);
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });

    return counts;
  }, [cards]);

  const monthTitle = activeMonth.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    month: 'long',
    year: 'numeric',
  });

  const formatDay = (day: string) => {
    const date = new Date(`${day}T00:00:00`);
    const today = startOfLocalDay(new Date());
    const diffDays = Math.round(
      (startOfLocalDay(date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) return lang === 'es' ? 'Hoy' : 'Today';
    if (diffDays === 1) return lang === 'es' ? 'Mañana' : 'Tomorrow';

    return date.toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  };

  const syncCalendar = async () => {
    if (!webClientId || !androidClientId) {
      Alert.alert('Google Calendar not configured', 'Missing Google OAuth client IDs.');
      return;
    }

    if (!calendarRequest) {
      Alert.alert('Google Calendar not ready', 'Please try again in a moment.');
      return;
    }

    setSyncResult(null);
    handledCalendarResponseRef.current = false;
    await promptCalendarAsync();
  };

  const shiftMonth = (amount: number) => {
    setActiveMonth(
      (current) => new Date(current.getFullYear(), current.getMonth() + amount, 1)
    );
  };

  return (
    <View style={styles.container}>
      <AmbientBackground />

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('calendar')}</Text>
              <Text style={styles.sub}>{t('upcoming')}</Text>
            </View>

            <PressScale
              testID="sync-google-calendar"
              onPress={syncCalendar}
              disabled={syncing || !calendarRequest}
              style={[styles.syncBtn, (syncing || !calendarRequest) && { opacity: 0.55 }]}
            >
              {syncing ? (
                <ActivityIndicator color="#080910" size="small" />
              ) : (
                <RefreshCw color="#080910" size={15} />
              )}
              <Text style={styles.syncText}>{syncing ? 'Syncing' : 'Sync'}</Text>
            </PressScale>
          </View>

          <GlassCard style={{ marginBottom: 16 }}>
            <View style={styles.privacyRow}>
              <ShieldCheck color="#34D399" size={14} />
              <Text style={styles.privacyText}>
                Calendar sync is read-only. Household COO imports reminders and suggests invitees;
                it does not edit your Google Calendar.
              </Text>
            </View>
          </GlassCard>

          {syncResult ? (
            <GlassCard style={{ marginBottom: 16 }}>
              <View style={styles.syncSummaryRow}>
                <CalendarDays color="#F97316" size={18} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.syncSummaryTitle}>Google Calendar imported</Text>
                  <Text style={styles.syncSummaryText}>
                    {syncResult.imported} events imported · {syncResult.skipped} skipped ·{' '}
                    {syncResult.contacts_found} people found
                  </Text>
                </View>
              </View>

              {syncResult.contacts.length > 0 ? (
                <View style={styles.contactsPreview}>
                  <Users color="rgba(255,255,255,0.55)" size={13} />
                  <Text style={styles.contactsPreviewText} numberOfLines={2}>
                    {syncResult.contacts.slice(0, 3).map((c) => c.email).join(', ')}
                  </Text>
                </View>
              ) : null}
            </GlassCard>
          ) : null}

          <GlassCard style={{ marginBottom: 18 }}>
            <View style={styles.monthHeader}>
              <PressScale testID="prev-month" onPress={() => shiftMonth(-1)} style={styles.monthNav}>
                <Text style={styles.monthNavText}>‹</Text>
              </PressScale>

              <Text style={styles.monthTitle}>{monthTitle}</Text>

              <PressScale testID="next-month" onPress={() => shiftMonth(1)} style={styles.monthNav}>
                <Text style={styles.monthNavText}>›</Text>
              </PressScale>
            </View>

            <View style={styles.weekHeader}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                <Text key={`${day}-${index}`} style={styles.weekLabel}>
                  {day}
                </Text>
              ))}
            </View>

            <View style={styles.monthGrid}>
              {monthDays.map(({ date, inMonth }) => {
                const key = dateKey(date);
                const count = countsByDay[key] || 0;
                const isToday = key === dateKey(new Date());

                return (
                  <View
                    key={key}
                    style={[
                      styles.dayCell,
                      !inMonth && styles.dayCellMuted,
                      isToday && styles.dayCellToday,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNumber,
                        !inMonth && styles.dayNumberMuted,
                        isToday && styles.dayNumberToday,
                      ]}
                    >
                      {date.getDate()}
                    </Text>

                    {count > 0 ? (
                      <View style={styles.dayCount}>
                        <Text style={styles.dayCountText}>{count}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </GlassCard>

          {loading ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
          ) : groups.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t('no_events')}</Text>
            </View>
          ) : (
            groups.map((group) => (
              <View key={group.day} style={{ marginBottom: 18 }}>
                <Text style={styles.dayLabel}>{formatDay(group.day)}</Text>

                {group.items.map((card) => {
                  const color = TYPE_COLOR[card.type] || '#10B981';
                  const isGoogle = card.source === 'CALENDAR' || card.external_source === 'google_calendar';

                  return (
                    <GlassCard key={card.card_id} style={{ marginTop: 10 }}>
                      <View style={styles.row}>
                        <View style={[styles.dot, { backgroundColor: color }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.itemTitle} numberOfLines={2}>
                            {card.title}
                          </Text>
                          <Text style={styles.meta} numberOfLines={1}>
                            {card.assignee || 'Unassigned'}
                            {isGoogle ? ' · Google Calendar' : ''}
                          </Text>
                        </View>

                        <Text style={[styles.typeLabel, { color }]}>
                          {card.type === 'SIGN_SLIP'
                            ? t('sign_slip')
                            : card.type === 'RSVP'
                            ? t('rsvp')
                            : t('task')}
                        </Text>
                      </View>
                    </GlassCard>
                  );
                })}
              </View>
            ))
          )}

          <View style={{ height: 220 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080910' },
  scroll: { paddingHorizontal: 20, paddingTop: 14 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
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
    marginTop: 2,
  },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: '#fff',
    borderRadius: 9999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  syncText: {
    color: '#080910',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  privacyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  privacyText: {
    flex: 1,
    color: 'rgba(255,255,255,0.62)',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  syncSummaryRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  syncSummaryTitle: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  syncSummaryText: {
    color: 'rgba(255,255,255,0.58)',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 3,
  },
  contactsPreview: { flexDirection: 'row', gap: 7, alignItems: 'center', marginTop: 12 },
  contactsPreviewText: {
    flex: 1,
    color: 'rgba(255,255,255,0.48)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  monthTitle: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    textTransform: 'capitalize',
  },
  monthNav: {
    width: 34,
    height: 34,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthNavText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 22,
    lineHeight: 24,
  },
  weekHeader: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  dayCellMuted: { opacity: 0.3 },
  dayCellToday: {
    backgroundColor: 'rgba(249,115,22,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.45)',
  },
  dayNumber: {
    color: 'rgba(255,255,255,0.82)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  dayNumberMuted: { color: 'rgba(255,255,255,0.45)' },
  dayNumberToday: { color: '#fff' },
  dayCount: {
    marginTop: 3,
    minWidth: 16,
    height: 16,
    borderRadius: 9999,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  dayCountText: {
    color: '#080910',
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
  },
  dayLabel: {
    fontFamily: 'Inter_600SemiBold',
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    letterSpacing: 0.3,
  },
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
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyText: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: 'rgba(255,255,255,0.5)',
    fontSize: 20,
  },
});
