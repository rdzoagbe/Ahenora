import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, RefreshCw, User, X } from 'lucide-react-native';

import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import { PressScale } from '../../src/components/PressScale';
import { logger } from '../../src/logger';
import { TabScreen } from '../../src/components/TabScreen';
import { Card as KitCard, IconTile, ScreenHeader, UI, useUI, UIColors } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { api, CalendarImportResult, Card } from '../../src/api';

WebBrowser.maybeCompleteAuthSession();

const TYPE_COLOR: Record<string, string> = {
  SIGN_SLIP: UI.orange,
  RSVP: UI.lavenderText,
  TASK: UI.mintText,
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

function cleanText(value?: string | null) {
  return (value || '').replace(/Ãƒâ€šÃ‚Â·/g, '-').replace(/Â/g, '').trim();
}

function timeParts(value?: string | null) {
  if (!value) return { time: '', ampm: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { time: '', ampm: '' };
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return { time: `${h}:${String(m).padStart(2, '0')}`, ampm };
}

function buildMonthDays(baseDate: Date) {
  const first = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const last = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  const leading = first.getDay();
  const total = leading + last.getDate();
  const trailing = Math.ceil(total / 7) * 7 - total;
  const days: { date: Date; inMonth: boolean }[] = [];

  for (let i = leading; i > 0; i -= 1) {
    days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 1 - i), inMonth: false });
  }
  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth(), day), inMonth: true });
  }
  for (let i = 1; i <= trailing; i += 1) {
    days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, i), inMonth: false });
  }
  return days;
}

function groupByDay(cards: Card[], selectedDay: string | null) {
  const groups: Record<string, Card[]> = {};
  cards.forEach((card) => {
    const key = cardDateKey(card);
    if (!key) return;
    if (selectedDay && key !== selectedDay) return;
    groups[key] = groups[key] || [];
    groups[key].push(card);
  });

  return Object.keys(groups)
    .sort()
    .map((day) => ({
      day,
      items: groups[day].sort((a, b) => new Date(a.due_date || '').getTime() - new Date(b.due_date || '').getTime()),
    }));
}

export default function Calendar() {
  const { t, lang } = useStore();
  const { width: windowWidth } = useWindowDimensions();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<CalendarImportResult | null>(null);
  const [calendarSyncStatus, setCalendarSyncStatus] = useState<string | null>(null);
  const [activeMonth, setActiveMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(dateKey(new Date()));
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const handledCalendarResponseRef = useRef(false);

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  const [calendarRequest, calendarResponse, promptCalendarAsync] = Google.useAuthRequest({
    androidClientId,
    webClientId,
    scopes: ['openid', 'profile', 'email', GOOGLE_CALENDAR_SCOPE],
  });

  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const calendarContentWidth = Math.max(280, windowWidth - 84);
  const daySize = Math.max(40, Math.min(52, Math.floor(calendarContentWidth / 7)));
  const gridWidth = daySize * 7;

  const load = useCallback(async () => {
    try {
      const result = await api.listCards();
      setCards(result.filter((card) => card.status === 'OPEN' && card.due_date));
    } catch (e) {
      logger.warn('calendar load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const importCalendar = async () => {
      if (!calendarResponse || handledCalendarResponseRef.current) return;
      if (calendarResponse.type !== 'success') {
        if (calendarResponse.type === 'error') Alert.alert('Calendar sync failed', 'Google Calendar permission was not granted.');
        return;
      }
      handledCalendarResponseRef.current = true;
      const accessToken = calendarResponse.authentication?.accessToken || calendarResponse.params?.access_token;
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
        Alert.alert('Calendar synced', `${result.imported} events imported. ${result.contacts_found} people found.`);
      } catch (e: any) {
        logger.warn('calendar sync failed', e);
        Alert.alert('Calendar sync failed', e?.message || 'Please try again.');
      } finally {
        setSyncing(false);
        handledCalendarResponseRef.current = false;
      }
    };
    importCalendar();
  }, [calendarResponse, load]);

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

  const groups = useMemo(() => groupByDay(cards, selectedDay), [cards, selectedDay]);

  const locale = lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US';
  const monthTitle = activeMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  const formatDayFull = (day: string) => {
    const date = new Date(`${day}T00:00:00`);
    const today = startOfLocalDay(new Date());
    const diffDays = Math.round((startOfLocalDay(date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const full = date.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });
    if (diffDays === 0) return `${lang === 'fr' ? "Aujourd'hui" : lang === 'es' ? 'Hoy' : 'Today'} · ${full}`;
    if (diffDays === 1) return `${lang === 'fr' ? 'Demain' : lang === 'es' ? 'Mañana' : 'Tomorrow'} · ${full}`;
    return full;
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const syncCalendar = async () => {
    setSyncResult(null);

    if (Platform.OS !== 'web') {
      if (!webClientId) {
        Alert.alert('Google Calendar not configured', 'Missing Google web client ID.');
        setCalendarSyncStatus('Google web client ID is missing.');
        return;
      }

      try {
        setSyncing(true);
        setCalendarSyncStatus('Opening native Google Calendar permission...');

        GoogleSignin.configure({ webClientId, scopes: ['profile', 'email', GOOGLE_CALENDAR_SCOPE], offlineAccess: false });
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

        const googleSigninAny = GoogleSignin as any;
        let currentUser: any = null;

        try {
          if (typeof googleSigninAny.getCurrentUser === 'function') currentUser = await googleSigninAny.getCurrentUser();
        } catch {}

        if (!currentUser) {
          try {
            if (typeof googleSigninAny.signInSilently === 'function') currentUser = await googleSigninAny.signInSilently();
          } catch {}
        }

        if (!currentUser) currentUser = await GoogleSignin.signIn();

        if (typeof googleSigninAny.addScopes === 'function') {
          await googleSigninAny.addScopes({ scopes: [GOOGLE_CALENDAR_SCOPE] });
        }

        let tokens: { accessToken?: string | null; idToken?: string | null } = {};

        try {
          tokens = await GoogleSignin.getTokens();
        } catch {
          try { await GoogleSignin.signOut(); } catch {}

          GoogleSignin.configure({ webClientId, scopes: ['profile', 'email', GOOGLE_CALENDAR_SCOPE], offlineAccess: false });
          await GoogleSignin.signIn();

          if (typeof googleSigninAny.addScopes === 'function') {
            await googleSigninAny.addScopes({ scopes: [GOOGLE_CALENDAR_SCOPE] });
          }

          tokens = await GoogleSignin.getTokens();
        }

        if (!tokens.accessToken) {
          setCalendarSyncStatus('Google connected, but no Calendar access token was returned.');
          Alert.alert('Calendar sync failed', 'Google connected, but no Calendar access token was returned.');
          return;
        }

        setCalendarSyncStatus('Importing Google Calendar events...');
        const result = await api.importGoogleCalendar(tokens.accessToken, 30);
        setSyncResult(result);
        await load();
        setCalendarSyncStatus(`${result.imported} events imported. ${result.contacts_found} people found.`);
        Alert.alert('Calendar synced', `${result.imported} events imported. ${result.contacts_found} people found.`);
      } catch (e: any) {
        logger.warn('native google calendar sync failed', e);
        const message = e?.message || e?.code || 'Native Google Calendar permission failed.';
        setCalendarSyncStatus(`Calendar sync failed: ${message}`);
        Alert.alert('Calendar sync failed', message);
      } finally {
        setSyncing(false);
      }

      return;
    }

    if (!webClientId || !androidClientId) {
      Alert.alert('Google Calendar not configured', 'Missing Google OAuth client IDs.');
      setCalendarSyncStatus('Google OAuth client IDs are missing.');
      return;
    }

    if (!calendarRequest) {
      Alert.alert('Google Calendar not ready', 'Please try again in a moment.');
      setCalendarSyncStatus('Google Calendar connection is preparing. Try again in a few seconds.');
      return;
    }

    try {
      setCalendarSyncStatus('Opening Google Calendar connection...');
      handledCalendarResponseRef.current = false;

      const result = (await promptCalendarAsync()) as any;
      const accessToken = result?.authentication?.accessToken || result?.params?.access_token || result?.params?.accessToken;

      if (!accessToken) {
        logger.warn('calendar auth returned no access token', result);
        setCalendarSyncStatus('Google connected, but no calendar access token was returned.');
        Alert.alert('Calendar sync failed', 'Google connected, but no calendar access token was returned.');
        return;
      }

      setSyncing(true);
      setCalendarSyncStatus('Importing Google Calendar events...');

      const importResult = await api.importGoogleCalendar(accessToken, 30);
      setSyncResult(importResult);
      await load();

      setCalendarSyncStatus(`${importResult.imported} events imported. ${importResult.contacts_found} people found.`);
      Alert.alert('Calendar synced', `${importResult.imported} events imported. ${importResult.contacts_found} people found.`);
    } catch (e: any) {
      /* calendar sync error — alert shown to user */
      const message = e?.message || 'Please try again.';
      setCalendarSyncStatus(`Calendar sync failed: ${message}`);
      Alert.alert('Calendar sync failed', message);
    } finally {
      setSyncing(false);
    }
  };

  const shiftMonth = (amount: number) => {
    setActiveMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
    setSelectedDay(null);
  };

  const onSelectDay = (key: string, date: Date) => {
    setSelectedDay(key);
    if (date.getMonth() !== activeMonth.getMonth() || date.getFullYear() !== activeMonth.getFullYear()) {
      setActiveMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  };

  const syncDisabled = syncing || (Platform.OS === 'web' && !calendarRequest);
  const totalSelectedEvents = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <SwipeableTabView style={styles.container}>
      <TabScreen
        tab="Calendar"
        refreshing={refreshing}
        onRefresh={handleRefresh}
        scrollViewProps={{ contentContainerStyle: styles.scroll }}
      >
          <ScreenHeader
            eyebrow="Family Calendar"
            title={monthTitle}
            titleSize={30}
            right={
              <PressScale testID="sync-google-calendar" onPress={syncCalendar} disabled={syncDisabled} style={[styles.syncBtn, syncDisabled && { opacity: 0.55 }]}>
                {syncing ? <ActivityIndicator color="#FFFFFF" size="small" /> : <RefreshCw color="#FFFFFF" size={16} />}
                <Text style={styles.syncText}>{syncing ? 'Syncing' : 'Sync'}</Text>
              </PressScale>
            }
          />

          {/* Connection banner (tap to sync — keeps the sync card visible & functional) */}
          <PressScale testID="calendar-sync-card-button" onPress={syncCalendar} disabled={syncDisabled} style={styles.bannerGap}>
            <KitCard style={styles.banner}>
              <View testID="calendar-sync-card" style={styles.bannerInner}>
                <IconTile bg={ui.orangeSoft} size={40} radius={13}><CalendarDays color={ui.orange} size={20} /></IconTile>
                <Text style={styles.bannerText} numberOfLines={2}>
                  {calendarSyncStatus || (syncResult ? `${syncResult.imported} events imported · ${syncResult.contacts_found} people found.` : 'Connected to Google Calendar. We only read titles & times.')}
                </Text>
              </View>
            </KitCard>
          </PressScale>

          {/* Month grid */}
          <KitCard style={styles.calCard}>
            <View style={styles.monthHeader}>
              <PressScale testID="prev-month" onPress={() => shiftMonth(-1)} style={styles.monthNav}>
                <ChevronLeft color={ui.text} size={20} />
              </PressScale>
              <Text style={styles.monthTitle}>{monthTitle}</Text>
              <PressScale testID="next-month" onPress={() => shiftMonth(1)} style={styles.monthNav}>
                <ChevronRight color={ui.text} size={20} />
              </PressScale>
            </View>

            <View style={[styles.weekHeader, { width: gridWidth }]}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                <Text key={`${day}-${index}`} style={[styles.weekLabel, { width: daySize }]}>{day}</Text>
              ))}
            </View>

            <View style={[styles.monthGrid, { width: gridWidth }]}>
              {monthDays.map(({ date, inMonth }) => {
                const key = dateKey(date);
                const count = countsByDay[key] || 0;
                const isToday = key === dateKey(new Date());
                const selected = selectedDay === key;
                return (
                  <PressScale
                    key={key}
                    testID={`calendar-day-${key}`}
                    onPress={() => onSelectDay(key, date)}
                    style={[styles.dayCell, { width: daySize, height: daySize + 8 }, selected && styles.dayCellSelected]}
                  >
                    <Text
                      style={[
                        styles.dayNumber,
                        { color: selected ? '#FFFFFF' : !inMonth ? ui.line : isToday ? ui.orange : ui.text },
                      ]}
                    >
                      {date.getDate()}
                    </Text>
                    {count > 0 ? (
                      <View style={[styles.dayDot, { backgroundColor: selected ? '#FFFFFF' : ui.orange }]} />
                    ) : (
                      <View style={styles.dayDotSpacer} />
                    )}
                  </PressScale>
                );
              })}
            </View>
          </KitCard>

          {/* Day events */}
          <View style={styles.dayHead}>
            <Text style={styles.dayHeadTitle}>{selectedDay ? formatDayFull(selectedDay) : t('upcoming')}</Text>
            {selectedDay ? <Text style={styles.dayHeadCount}>{totalSelectedEvents} event{totalSelectedEvents === 1 ? '' : 's'}</Text> : null}
          </View>

          {loading ? (
            <ActivityIndicator color={ui.orange} style={{ marginTop: 30 }} />
          ) : groups.length === 0 ? (
            <KitCard style={styles.empty}>
              <Text style={styles.emptyText}>{selectedDay ? 'No events on this date.' : t('no_events')}</Text>
            </KitCard>
          ) : (
            <KitCard style={styles.timelineCard}>
              {groups.flatMap((group) => group.items).map((card, index, arr) => {
                const color = TYPE_COLOR[card.type] || ui.mintText;
                const isGoogle = card.source === 'CALENDAR' || card.external_source === 'google_calendar';
                const { time, ampm } = timeParts(card.due_date);
                const sub = cleanText(card.description) || cleanText(card.assignee) || (isGoogle ? 'Google Calendar' : 'Family');
                return (
                  <PressScale key={card.card_id} testID={`calendar-card-${card.card_id}`} onPress={() => setSelectedCard(card)} style={[styles.eventRow, index < arr.length - 1 && styles.eventRowBorder]}>
                    <View style={styles.timeBlock}>
                      <Text style={styles.timeText}>{time}</Text>
                      <Text style={styles.ampmText}>{ampm}</Text>
                    </View>
                    <View style={[styles.eventBar, { backgroundColor: color }]} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.eventTitle} numberOfLines={1}>{cleanText(card.title)}</Text>
                      <Text style={styles.eventSub} numberOfLines={1}>{sub}</Text>
                    </View>
                  </PressScale>
                );
              })}
            </KitCard>
          )}

          <View style={{ height: 110 }} />
      </TabScreen>

      <KeyboardAwareBottomSheet visible={!!selectedCard} onClose={() => setSelectedCard(null)} contentStyle={styles.detailSheet}>
        {selectedCard ? (
          <>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>{cleanText(selectedCard.title)}</Text>
              <PressScale onPress={() => setSelectedCard(null)} style={styles.closeBtn}>
                <X color={ui.text} size={20} />
              </PressScale>
            </View>
            <View style={styles.detailMetaRow}>
              <Clock color={ui.muted} size={17} />
              <Text style={styles.detailMetaText}>{formatDateTime(selectedCard.due_date)}</Text>
            </View>
            <View style={styles.detailMetaRow}>
              <User color={ui.muted} size={17} />
              <Text style={styles.detailMetaText}>{cleanText(selectedCard.assignee) || 'Unassigned'}</Text>
            </View>
            <Text style={[styles.detailDescription, !selectedCard.description && { color: ui.muted }]}>
              {selectedCard.description ? cleanText(selectedCard.description) : 'No additional details.'}
            </Text>
          </>
        ) : null}
      </KeyboardAwareBottomSheet>
    </SwipeableTabView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: ui.orange, borderRadius: 99, paddingHorizontal: 18, paddingVertical: 11 },
  syncText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  bannerGap: { marginTop: 18 },
  banner: { padding: 14 },
  bannerInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bannerText: { flex: 1, color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },

  calCard: { marginTop: 16, padding: 16, alignItems: 'center' },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginBottom: 14 },
  monthNav: { width: 40, height: 40, borderRadius: 99, borderWidth: 1, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },
  monthTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 18, letterSpacing: -0.2 },
  weekHeader: { flexDirection: 'row', alignSelf: 'center', marginBottom: 6 },
  weekLabel: { textAlign: 'center', fontFamily: 'Inter_700Bold', fontSize: 12, color: ui.muted },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'center' },
  dayCell: { alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  dayCellSelected: { backgroundColor: ui.orange },
  dayNumber: { fontFamily: 'Inter_700Bold', fontSize: 15.5, includeFontPadding: false, textAlign: 'center' },
  dayDot: { marginTop: 5, width: 5, height: 5, borderRadius: 99 },
  dayDotSpacer: { marginTop: 5, width: 5, height: 5 },

  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 12 },
  dayHeadTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, letterSpacing: -0.3, flex: 1 },
  dayHeadCount: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  empty: { paddingVertical: 30, alignItems: 'center' },
  emptyText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 16 },

  timelineCard: { paddingHorizontal: 16 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  eventRowBorder: { borderBottomWidth: 1, borderBottomColor: ui.line },
  timeBlock: { width: 50, alignItems: 'flex-start' },
  timeText: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15, lineHeight: 18 },
  ampmText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  eventBar: { width: 4, alignSelf: 'stretch', borderRadius: 99, minHeight: 34 },
  eventTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15, lineHeight: 20 },
  eventSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },

  detailSheet: { backgroundColor: ui.card, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, borderColor: ui.line, padding: 24, paddingBottom: 110 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  detailTitle: { flex: 1, color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  closeBtn: { width: 42, height: 42, borderRadius: 9999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center' },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  detailMetaText: { flex: 1, color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 21 },
  detailDescription: { marginTop: 20, color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 24 },
});
