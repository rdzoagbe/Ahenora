import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { CalendarDays, Car, CheckCircle2, ChevronLeft, ChevronRight, Clock, ExternalLink, Eye, Lock, MapPin, Plus, RefreshCw, Trash2, User, Users, Video, X } from 'lucide-react-native';

import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import { PressScale } from '../../src/components/PressScale';
import { logger } from '../../src/logger';
import { TabScreen } from '../../src/components/TabScreen';
import { Card as KitCard, IconTile, ScreenHeader, UI, useUI, UIColors } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { api, logEvent, CalendarImportResult, Card, Carpool } from '../../src/api';
import { usePremiumGate, LockBadge, PremiumPreviewBanner } from '../../src/components/PremiumGate';
import { sendLocalNotification, syncCalendarNightly } from '../../src/notifications';
import { cleanText, openExternal, parseDescription } from '../../src/eventDescription';

WebBrowser.maybeCompleteAuthSession();

const TYPE_COLOR: Record<string, string> = {
  SIGN_SLIP: UI.orange,
  RSVP: UI.lavenderText,
  TASK: UI.mintText,
  BIRTHDAY: UI.goldText,
  SCHOOL: UI.lavenderText,
  APPOINTMENT: UI.orange,
  VACATION: UI.mintText,
};

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';

// Microsoft/Outlook import via expo-auth-session (public-client PKCE, no secret).
// Client ID is public (ships in the app, like the Google IDs); env override wins.
const MS_CLIENT_ID =
  process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID?.trim() || 'd9a47680-a27e-4b02-8013-bd946c099f9e';
const MS_DISCOVERY = {
  authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
};
const MS_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'Calendars.Read', 'User.Read'];

// Silent auto-sync: don't re-pull Google more than once every 6h, and remember
// which upcoming items we've already surfaced so "new on your agenda" only fires
// for genuinely new events (never on an idempotent re-import).
const AUTOSYNC_AT_KEY = 'coo_cal_autosync_at';
const CAL_SEEN_KEY = 'coo_cal_seen_ids';
const AUTOSYNC_MIN_GAP_MS = 6 * 60 * 60 * 1000;

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
  const { isLocked, promptUpgrade } = usePremiumGate();
  const carpoolLocked = isLocked('carpool');
  const { width: windowWidth } = useWindowDimensions();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<CalendarImportResult | null>(null);
  // Lets the user back out of a sync that is taking too long. The in-flight
  // request is allowed to finish server-side (the import is an idempotent
  // upsert, so a late completion is harmless), but once cancelled its result
  // is ignored and the screen is handed straight back — no more staring at a
  // spinner with no way out.
  const syncCancelledRef = useRef(false);
  const [calendarSyncStatus, setCalendarSyncStatus] = useState<string | null>(null);
  const cancelSync = useCallback(() => {
    syncCancelledRef.current = true;
    setSyncing(false);
    setCalendarSyncStatus(null);
    logEvent('calendar_import_cancelled');
  }, []);
  const [activeMonth, setActiveMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(dateKey(new Date()));
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [carpools, setCarpools] = useState<Carpool[]>([]);
  const [childNames, setChildNames] = useState<Set<string>>(new Set());
  const [coparentViewOpen, setCoparentViewOpen] = useState(false);
  const [shareDir, setShareDir] = useState<'out' | 'in'>('out');
  const [sharedOut, setSharedOut] = useState<Card[] | null>(null);
  const [sharedIn, setSharedIn] = useState<Card[] | null>(null);
  const [makingPrivate, setMakingPrivate] = useState<string | null>(null);
  const handledCalendarResponseRef = useRef(false);

  const webClientId =
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ||
    '243255248169-cei972lc7kmfig6tmjb6l2nlmgqkjf22.apps.googleusercontent.com';
  const androidClientId =
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim() ||
    '243255248169-n4l7es5ecr3j85v00dia2icp9kjo7umh.apps.googleusercontent.com';

  const [calendarRequest, calendarResponse, promptCalendarAsync] = Google.useAuthRequest({
    androidClientId,
    webClientId,
    scopes: ['openid', 'profile', 'email', GOOGLE_CALENDAR_SCOPE],
  });

  const msRedirectUri = useMemo(() => AuthSession.makeRedirectUri({ scheme: 'householdcoo', path: 'auth' }), []);
  const [msRequest, msResponse, msPromptAsync] = AuthSession.useAuthRequest(
    { clientId: MS_CLIENT_ID, scopes: MS_SCOPES, redirectUri: msRedirectUri, usePKCE: true },
    MS_DISCOVERY,
  );
  const handledMsResponseRef = useRef(false);

  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const calendarContentWidth = Math.max(280, windowWidth - 84);
  const daySize = Math.max(40, Math.min(52, Math.floor(calendarContentWidth / 7)));
  const gridWidth = daySize * 7;

  // One sentence for every sync outcome. "0 events imported" alone reads as
  // "nothing happened" when a meeting actually moved — say what changed.
  const syncSummary = useCallback((r: CalendarImportResult) => {
    const parts = [`${r.imported} ${t('cal_events_imported')}`];
    if (r.updated) parts.push(`${r.updated} ${t('cal_events_updated')}`);
    if (r.removed) parts.push(`${r.removed} ${t('cal_events_removed')}`);
    parts.push(`${r.contacts_found} ${t('cal_people_found')}`);
    return `${parts.join(' · ')}.`;
  }, [t]);

  const load = useCallback(async () => {
    logEvent('calendar_open');
    try {
      const [cardsRes, carpoolRes, membersRes] = await Promise.allSettled([api.listCards(), api.listCarpools(), api.familyMembers()]);
      if (cardsRes.status === 'fulfilled') setCards(cardsRes.value.filter((card) => card.status === 'OPEN' && card.due_date));
      if (carpoolRes.status === 'fulfilled') setCarpools(carpoolRes.value);
      if (membersRes.status === 'fulfilled') {
        setChildNames(new Set(
          membersRes.value
            .filter((m) => /^child$/i.test(m.role) && m.name)
            .map((m) => m.name.trim().toLowerCase()),
        ));
      }
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

  const openCoparentView = useCallback(async () => {
    setCoparentViewOpen(true);
    setShareDir('out');
    setSharedOut(null);
    setSharedIn(null);
    // Load both directions up front: the toggle is instant, and the second
    // list is small. A failed fetch shows the empty state, not an error.
    api.sharedWithCoparent('out').then(setSharedOut).catch(() => setSharedOut([]));
    api.sharedWithCoparent('in').then(setSharedIn).catch(() => setSharedIn([]));
  }, []);

  /**
   * Pull a shared item back to private, from the reassurance view itself.
   *
   * Only ever offered on your own items (the "they see of you" side), so the
   * server's owner check always passes; the list updates in place so the item
   * visibly leaves the co-parent's view the moment you tap.
   */
  const makePrivateFromView = useCallback(async (card: Card) => {
    setMakingPrivate(card.card_id);
    try {
      await api.updateCard(card.card_id, { shared: false });
      setSharedOut((prev) => (prev ? prev.filter((c) => c.card_id !== card.card_id) : prev));
      await load();
    } catch (e) {
      logger.warn('make private failed', e);
    } finally {
      setMakingPrivate(null);
    }
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    const importCalendar = async () => {
      if (!calendarResponse || handledCalendarResponseRef.current) return;
      if (calendarResponse.type !== 'success') {
        if (calendarResponse.type === 'error') Alert.alert(t('cal_calendar_sync_failed'), t('cal_permission_not_granted'));
        return;
      }
      handledCalendarResponseRef.current = true;
      const accessToken = calendarResponse.authentication?.accessToken || calendarResponse.params?.access_token;
      if (!accessToken) {
        Alert.alert(t('cal_calendar_sync_failed'), t('cal_google_no_access_token'));
        handledCalendarResponseRef.current = false;
        return;
      }
      syncCancelledRef.current = false;
      setSyncing(true);
      try {
        const result = await api.importGoogleCalendar(accessToken, 30);
        if (syncCancelledRef.current) return;
        setSyncResult(result);
        await load();
        Alert.alert(t('cal_calendar_synced'), syncSummary(result));
      } catch (e: any) {
        logger.warn('calendar sync failed', e);
        Alert.alert(t('cal_calendar_sync_failed'), e?.message || t('cal_please_try_again'));
      } finally {
        setSyncing(false);
        handledCalendarResponseRef.current = false;
      }
    };
    importCalendar();
  }, [calendarResponse, load]);

  // Silent auto-sync — runs once when the calendar opens (native only). If the
  // user has connected Google before, it quietly refreshes tokens and re-imports
  // WITHOUT any popup or button tap, then notifies only about genuinely new
  // upcoming items. If they've never connected, it stays completely silent (no
  // sign-in prompt). Throttled to at most once every 6 hours.
  const autoSyncedRef = useRef(false);
  const autoSyncCalendar = useCallback(async () => {
    if (Platform.OS === 'web') return;
    if (autoSyncedRef.current) return;
    autoSyncedRef.current = true;
    try {
      const lastRaw = await AsyncStorage.getItem(AUTOSYNC_AT_KEY).catch(() => null);
      if (Date.now() - Number(lastRaw || 0) < AUTOSYNC_MIN_GAP_MS) return;
      if (!webClientId) return;

      GoogleSignin.configure({ webClientId, scopes: ['profile', 'email', GOOGLE_CALENDAR_SCOPE], offlineAccess: false });
      const g = GoogleSignin as any;

      let currentUser: any = null;
      try { if (typeof g.getCurrentUser === 'function') currentUser = await g.getCurrentUser(); } catch {}
      if (!currentUser) {
        try { if (typeof g.signInSilently === 'function') currentUser = await g.signInSilently(); } catch {}
      }
      if (!currentUser) return; // never connected — never prompt in auto mode

      let tokens: { accessToken?: string | null } = {};
      try { tokens = await GoogleSignin.getTokens(); } catch { return; }
      if (!tokens.accessToken) return;

      const result = await api.importGoogleCalendar(tokens.accessToken, 30);
      await AsyncStorage.setItem(AUTOSYNC_AT_KEY, String(Date.now())).catch(() => undefined);
      setSyncResult(result);

      const list = await api.listCards();
      const open = list.filter((card) => card.status === 'OPEN' && card.due_date);
      setCards(open);

      // Diff upcoming items against what we've already surfaced.
      const todayStart = startOfLocalDay(new Date()).getTime();
      const upcoming = open.filter((c) => new Date(c.due_date as string).getTime() >= todayStart);
      const seenRaw = await AsyncStorage.getItem(CAL_SEEN_KEY).catch(() => null);
      let seen: string[] = [];
      try { seen = seenRaw ? JSON.parse(seenRaw) : []; } catch { seen = []; }
      const seenSet = new Set(seen);
      const fresh = upcoming.filter((c) => !seenSet.has(c.card_id));
      await AsyncStorage.setItem(CAL_SEEN_KEY, JSON.stringify(upcoming.map((c) => c.card_id).slice(0, 300))).catch(() => undefined);

      // Only buzz once we have a baseline (don't notify on the first-ever sync).
      if (seen.length > 0 && fresh.length > 0) {
        const title = t('cal_new_agenda_title');
        const body = fresh.length === 1
          ? (fresh[0].title || t('cal_new_agenda_generic'))
          : t('cal_new_agenda_count', { count: fresh.length });
        await sendLocalNotification(title, body);
      }
    } catch (e) {
      logger.warn('calendar auto-sync skipped', e);
    }
  }, [webClientId, t]);

  useEffect(() => { autoSyncCalendar(); }, [autoSyncCalendar]);

  // Nightly agenda reminder (~20:15 local) with tomorrow's plan. Rescheduled
  // whenever the agenda changes so the body stays current.
  useEffect(() => {
    const tomorrow = startOfLocalDay(new Date());
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = dateKey(tomorrow);
    const count = cards.filter((c) => cardDateKey(c) === tomorrowKey).length;
    const content = count > 0
      ? { title: t('cal_nightly_title'), body: t('cal_nightly_body', { count }) }
      : null;
    syncCalendarNightly(true, content).catch(() => undefined);
  }, [cards, t]);

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
        Alert.alert(t('cal_google_not_configured'), t('cal_missing_web_client_id'));
        setCalendarSyncStatus(t('cal_web_client_id_missing'));
        return;
      }

      try {
        syncCancelledRef.current = false;
        setSyncing(true);
        setCalendarSyncStatus(t('cal_opening_native_permission'));

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
          setCalendarSyncStatus(t('cal_connected_no_access_token'));
          Alert.alert(t('cal_calendar_sync_failed'), t('cal_connected_no_access_token'));
          return;
        }

        setCalendarSyncStatus(t('cal_importing_events'));
        const result = await api.importGoogleCalendar(tokens.accessToken, 30);
        if (syncCancelledRef.current) return;
        setSyncResult(result);
        await load();
        setCalendarSyncStatus(syncSummary(result));
        Alert.alert(t('cal_calendar_synced'), syncSummary(result));
      } catch (e: any) {
        // User cancelled the Google chooser — not an error, say nothing scary.
        const code = e?.code || '';
        if (code === 'SIGN_IN_CANCELLED' || code === '-5' || code === '12501') {
          setCalendarSyncStatus(null);
          return;
        }
        logger.warn('native google calendar sync failed', e);
        const message = e?.message || e?.code || t('cal_native_permission_failed');
        setCalendarSyncStatus(`${t('cal_calendar_sync_failed')}: ${message}`);
        Alert.alert(t('cal_calendar_sync_failed'), message);
      } finally {
        setSyncing(false);
      }

      return;
    }

    if (!webClientId || !androidClientId) {
      Alert.alert(t('cal_google_not_configured'), t('cal_missing_oauth_client_ids'));
      setCalendarSyncStatus(t('cal_oauth_client_ids_missing'));
      return;
    }

    if (!calendarRequest) {
      Alert.alert(t('cal_google_not_ready'), t('cal_try_again_moment'));
      setCalendarSyncStatus(t('cal_connection_preparing'));
      return;
    }

    try {
      setCalendarSyncStatus(t('cal_opening_connection'));
      handledCalendarResponseRef.current = false;

      const result = (await promptCalendarAsync()) as any;
      const accessToken = result?.authentication?.accessToken || result?.params?.access_token || result?.params?.accessToken;

      if (!accessToken) {
        logger.warn('calendar auth returned no access token', result);
        setCalendarSyncStatus(t('cal_connected_no_access_token'));
        Alert.alert(t('cal_calendar_sync_failed'), t('cal_connected_no_access_token'));
        return;
      }

      syncCancelledRef.current = false;
      setSyncing(true);
      setCalendarSyncStatus(t('cal_importing_events'));

      const importResult = await api.importGoogleCalendar(accessToken, 30);
      if (syncCancelledRef.current) return;
      setSyncResult(importResult);
      await load();

      setCalendarSyncStatus(syncSummary(importResult));
      Alert.alert(t('cal_calendar_synced'), syncSummary(importResult));
    } catch (e: any) {
      logger.warn('calendar sync failed', e);
      const message = e?.message || t('cal_please_try_again');
      setCalendarSyncStatus(`${t('cal_calendar_sync_failed')}: ${message}`);
      Alert.alert(t('cal_calendar_sync_failed'), message);
    } finally {
      setSyncing(false);
    }
  };

  // Microsoft/Outlook: exchange the PKCE code for a token, then import via Graph.
  useEffect(() => {
    const importMs = async () => {
      if (!msResponse || handledMsResponseRef.current) return;
      if (msResponse.type !== 'success') {
        if (msResponse.type === 'error') Alert.alert(t('cal_calendar_sync_failed'), t('cal_permission_not_granted'));
        return;
      }
      const code = msResponse.params?.code;
      if (!code || !msRequest) return;
      handledMsResponseRef.current = true;
      syncCancelledRef.current = false;
      setSyncing(true);
      try {
        const tokenResult = await AuthSession.exchangeCodeAsync(
          {
            clientId: MS_CLIENT_ID,
            code,
            redirectUri: msRedirectUri,
            extraParams: msRequest.codeVerifier ? { code_verifier: msRequest.codeVerifier } : {},
          },
          MS_DISCOVERY,
        );
        const accessToken = tokenResult.accessToken;
        if (!accessToken) {
          Alert.alert(t('cal_calendar_sync_failed'), t('cal_google_no_access_token'));
          return;
        }
        const result = await api.importMicrosoftCalendar(accessToken, 30);
        if (syncCancelledRef.current) return;
        setSyncResult(result);
        await load();
        Alert.alert(t('cal_calendar_synced'), syncSummary(result));
      } catch (e: any) {
        logger.warn('microsoft calendar sync failed', e);
        Alert.alert(t('cal_calendar_sync_failed'), e?.message || t('cal_please_try_again'));
      } finally {
        setSyncing(false);
        handledMsResponseRef.current = false;
      }
    };
    importMs();
  }, [msResponse, load]);

  const syncMicrosoft = async () => {
    setSyncResult(null);
    if (!msRequest) {
      Alert.alert(t('cal_google_not_ready'), t('cal_try_again_moment'));
      return;
    }
    await msPromptAsync();
  };

  // "Import calendar" → pick a provider. Google keeps its existing flow; Outlook
  // runs the Microsoft PKCE flow; Both runs Google then Outlook.
  const openImportPicker = () => {
    Alert.alert(
      t('cal_import_title'),
      t('cal_import_subtitle'),
      [
        { text: t('cal_import_google'), onPress: () => { syncCalendar(); } },
        { text: t('cal_import_outlook'), onPress: () => { syncMicrosoft(); } },
        { text: t('cal_import_both'), onPress: async () => { await syncCalendar(); await syncMicrosoft(); } },
        { text: t('cal_cancel'), style: 'cancel' },
      ],
    );
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
            eyebrow={t('cal_family_calendar')}
            title={monthTitle}
            titleSize={30}
            right={
              syncing ? (
                // While a sync is in flight the button becomes the way out.
                <PressScale testID="cancel-calendar-sync" onPress={cancelSync} style={[styles.syncBtn, { backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line }]}>
                  <ActivityIndicator color={ui.orangeText} size="small" />
                  <Text style={[styles.syncText, { color: ui.orangeText }]}>{t('cal_cancel')}</Text>
                </PressScale>
              ) : (
                <PressScale testID="sync-google-calendar" onPress={openImportPicker} disabled={syncDisabled} style={[styles.syncBtn, syncDisabled && { opacity: 0.55 }]}>
                  <RefreshCw color="#FFFFFF" size={16} />
                  <Text style={styles.syncText}>{t('cal_import')}</Text>
                </PressScale>
              )
            }
          />

          {/* Connection banner (tap to sync — keeps the sync card visible & functional) */}
          <PressScale testID="calendar-sync-card-button" onPress={openImportPicker} disabled={syncDisabled} style={styles.bannerGap}>
            <KitCard style={styles.banner}>
              <View testID="calendar-sync-card" style={styles.bannerInner}>
                <IconTile bg={ui.orangeSoft} size={40} radius={13}><CalendarDays color={ui.orange} size={20} /></IconTile>
                <Text style={styles.bannerText} numberOfLines={2}>
                  {calendarSyncStatus || (syncResult ? syncSummary(syncResult) : t('cal_connected_read_only'))}
                </Text>
              </View>
            </KitCard>
          </PressScale>

          {/* Two-way sharing view: what you share with each other */}
          <PressScale testID="calendar-coparent-view" onPress={openCoparentView} style={styles.coparentLink}>
            <Lock color={ui.muted} size={14} />
            <Text style={styles.coparentLinkText}>{t('cal_share_view_link')}</Text>
          </PressScale>

          {/* Month grid */}
          <KitCard style={styles.calCard}>
            <View style={styles.monthHeader}>
              <PressScale testID="prev-month" accessibilityRole="button" accessibilityLabel={t('a11y_prev_month')} onPress={() => shiftMonth(-1)} style={styles.monthNav}>
                <ChevronLeft color={ui.text} size={20} />
              </PressScale>
              <Text style={styles.monthTitle}>{monthTitle}</Text>
              <PressScale testID="next-month" accessibilityRole="button" accessibilityLabel={t('a11y_next_month')} onPress={() => shiftMonth(1)} style={styles.monthNav}>
                <ChevronRight color={ui.text} size={20} />
              </PressScale>
            </View>

            <View style={[styles.weekHeader, { width: gridWidth }]}>
              {['day_sunday', 'day_monday', 'day_tuesday', 'day_wednesday', 'day_thursday', 'day_friday', 'day_saturday'].map((k) => t(k).charAt(0).toUpperCase()).map((day, index) => (
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
                        { color: selected ? '#FFFFFF' : !inMonth ? ui.muted : isToday ? ui.orangeText : ui.text },
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
            {selectedDay ? <Text style={styles.dayHeadCount}>{totalSelectedEvents} {totalSelectedEvents === 1 ? t('cal_event') : t('cal_events')}</Text> : null}
          </View>

          {loading ? (
            <ActivityIndicator color={ui.orange} style={{ marginTop: 30 }} />
          ) : groups.length === 0 ? (
            <KitCard style={styles.empty}>
              <View style={styles.emptyIcon}>
                <CalendarDays color={ui.muted} size={26} />
              </View>
              <Text style={styles.emptyText}>{selectedDay ? t('cal_no_events_date') : t('no_events')}</Text>
              <Text style={styles.emptyHint}>{t('cal_empty_hint')}</Text>
              <PressScale
                testID="calendar-empty-sync"
                onPress={openImportPicker}
                disabled={syncDisabled}
                style={[styles.emptySyncBtn, syncDisabled && { opacity: 0.55 }]}
              >
                <RefreshCw color={ui.orange} size={15} />
                <Text style={styles.emptySyncText}>{syncing ? t('cal_syncing') : t('cal_import')}</Text>
              </PressScale>
            </KitCard>
          ) : (
            <KitCard style={styles.timelineCard}>
              {groups.flatMap((group) => group.items).map((card, index, arr) => {
                const color = TYPE_COLOR[card.type] || ui.mintText;
                const isGoogle = card.source === 'CALENDAR' || card.external_source === 'google_calendar';
                const { time, ampm } = timeParts(card.due_date);
                const sub = cleanText(card.description) || cleanText(card.assignee) || (isGoogle ? t('cal_google_calendar') : t('cal_family'));
                return (
                  <PressScale key={card.card_id} testID={`calendar-card-${card.card_id}`} onPress={() => setSelectedCard(card)} style={[styles.eventRow, index < arr.length - 1 && styles.eventRowBorder]}>
                    <View style={styles.timeBlock}>
                      <Text style={styles.timeText}>{time}</Text>
                      <Text style={styles.ampmText}>{ampm}</Text>
                    </View>
                    <View style={[styles.eventBar, { backgroundColor: color }]} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {card.source === 'CALENDAR' ? <CalendarDays color={ui.muted} size={12} /> : null}
                        <Text style={[styles.eventTitle, { flexShrink: 1 }]} numberOfLines={1}>{cleanText(card.title)}</Text>
                      </View>
                      <Text style={styles.eventSub} numberOfLines={1}>{sub}</Text>
                    </View>
                  </PressScale>
                );
              })}
            </KitCard>
          )}

          {/* Carpool Coordinator */}
          {!carpoolLocked ? <View style={{ marginTop: 18 }}><PremiumPreviewBanner /></View> : null}
          {carpoolLocked ? (
            <View style={styles.carpoolSection}>
              <View style={styles.carpoolHeader}>
                <Car color={ui.orange} size={18} />
                <Text style={styles.carpoolTitle}>{t('cal_carpool_schedule')}</Text>
                <LockBadge onPress={() => promptUpgrade('carpool')} />
              </View>
              <KitCard style={{ paddingHorizontal: 14 }}>
                <PressScale onPress={() => promptUpgrade('carpool')} style={styles.carpoolRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.carpoolName}>{t('cal_coordinate_carpools')}</Text>
                    <Text style={styles.carpoolSub}>{t('cal_carpool_upsell')}</Text>
                  </View>
                </PressScale>
              </KitCard>
            </View>
          ) : carpools.length > 0 ? (
            <View style={styles.carpoolSection}>
              <View style={styles.carpoolHeader}>
                <Car color={ui.orange} size={18} />
                <Text style={styles.carpoolTitle}>{t('cal_carpool_schedule')}</Text>
              </View>
              <KitCard style={{ paddingHorizontal: 14 }}>
                {carpools.map((cp) => (
                  <View key={cp.carpool_id} style={styles.carpoolRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.carpoolName}>{cp.title}</Text>
                      <Text style={styles.carpoolSub}>{cp.day_of_week} · {cp.time} · {cp.driver_name}{cp.pickup_kids.length > 0 ? ` · ${cp.pickup_kids.join(', ')}` : ''}</Text>
                    </View>
                    <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} onPress={async () => {
                      setCarpools((prev) => prev.filter((c) => c.carpool_id !== cp.carpool_id));
                      try { await api.deleteCarpool(cp.carpool_id); } catch { load(); }
                    }} hitSlop={12} style={{ padding: 4 }}>
                      <Trash2 color={ui.muted} size={15} />
                    </PressScale>
                  </View>
                ))}
              </KitCard>
            </View>
          ) : null}

          <View style={{ height: 120 }} />
      </TabScreen>

      <KeyboardAwareBottomSheet visible={!!selectedCard} onClose={() => setSelectedCard(null)} contentStyle={styles.detailSheet}>
        {selectedCard ? (
          <>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>{cleanText(selectedCard.title)}</Text>
              <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setSelectedCard(null)} style={styles.closeBtn}>
                <X color={ui.text} size={20} />
              </PressScale>
            </View>
            <View style={styles.detailMetaRow}>
              <Clock color={ui.muted} size={17} />
              <Text style={styles.detailMetaText}>{formatDateTime(selectedCard.due_date)}</Text>
            </View>
            <View style={styles.detailMetaRow}>
              <User color={ui.muted} size={17} />
              <Text style={styles.detailMetaText}>{cleanText(selectedCard.assignee) || t('cal_unassigned')}</Text>
            </View>
            {(() => {
              const parts = parseDescription(selectedCard.description, t);
              const hasContent = parts.text || parts.location || parts.people || parts.links.length > 0;
              if (!hasContent) return <Text style={[styles.detailDescription, { color: ui.muted }]}>{t('cal_no_additional_details')}</Text>;
              return (
                <View style={styles.detailBody}>
                  {parts.text ? <Text style={styles.detailDescription}>{parts.text}</Text> : null}
                  {parts.location ? (
                    <Pressable
                      onPress={() => {
                        const q = encodeURIComponent(parts.location!);
                        openExternal(Platform.OS === 'ios' ? `maps:?q=${q}` : `geo:0,0?q=${q}`, t);
                      }}
                      style={styles.detailChip}
                    >
                      <MapPin color={ui.orange} size={16} />
                      <Text style={styles.detailChipText} numberOfLines={2}>{parts.location}</Text>
                      <ExternalLink color={ui.muted} size={13} />
                    </Pressable>
                  ) : null}
                  {parts.links.map((link, i) => (
                    <Pressable key={i} onPress={() => openExternal(link.url, t)} style={styles.detailChip}>
                      {link.isVideo ? <Video color={ui.orange} size={16} /> : <ExternalLink color={ui.orange} size={16} />}
                      <Text style={styles.detailChipText}>{link.label}</Text>
                      <ExternalLink color={ui.muted} size={13} />
                    </Pressable>
                  ))}
                  {parts.people ? (
                    <View style={styles.detailMetaRow}>
                      <Users color={ui.muted} size={17} />
                      <Text style={styles.detailMetaText}>{parts.people}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })()}
            {selectedCard.shared ? (
              <View style={styles.sharedBadge}>
                <Users color={ui.mintText} size={16} />
                <Text style={styles.sharedBadgeText}>{t('cal_shared_with_coparent')}</Text>
              </View>
            ) : (() => {
              const assigneeLower = selectedCard.assignee?.trim().toLowerCase();
              const isChildItem = !!assigneeLower && childNames.has(assigneeLower);
              const doShare = () => {
                const id = selectedCard.card_id;
                Alert.alert(
                  t('cal_share_q'),
                  t('cal_share_body'),
                  [
                    { text: t('cal_cancel'), style: 'cancel' },
                    {
                      text: t('cal_share_action'),
                      onPress: async () => {
                        try {
                          await api.shareCard(id);
                          setCards((prev) => prev.map((c) => (c.card_id === id ? { ...c, shared: true } : c)));
                          setSelectedCard((prev) => (prev && prev.card_id === id ? { ...prev, shared: true } : prev));
                        } catch {
                          Alert.alert(t('cal_error'), t('cal_could_not_update'));
                        }
                      },
                    },
                  ],
                );
              };
              // A gentle nudge only for items that look like they're about a
              // child — personal items are never suggested for sharing.
              if (isChildItem) {
                return (
                  <View style={styles.shareNudge}>
                    <Text style={styles.shareNudgeText}>
                      {t('cal_share_child_nudge', { name: cleanText(selectedCard.assignee) })}
                    </Text>
                    <PressScale testID="calendar-share-card" onPress={doShare} style={styles.shareNudgeBtn}>
                      <Users color="#FFFFFF" size={18} />
                      <Text style={styles.shareNudgeBtnText}>{t('cal_share_action')}</Text>
                    </PressScale>
                  </View>
                );
              }
              return (
                <PressScale testID="calendar-share-card" onPress={doShare} style={styles.shareBtn}>
                  <Users color={ui.orange} size={18} />
                  <Text style={styles.shareBtnText}>{t('cal_share_with_coparent')}</Text>
                </PressScale>
              );
            })()}
            <PressScale
              testID="calendar-complete-card"
              onPress={() => {
                Alert.alert(
                  t('cal_mark_as_done_q'),
                  `"${cleanText(selectedCard.title)}" ${t('cal_move_to_history')}`,
                  [
                    { text: t('cal_cancel'), style: 'cancel' },
                    {
                      text: t('cal_done'),
                      onPress: async () => {
                        try {
                          await api.updateCard(selectedCard.card_id, { status: 'DONE' });
                          setCards((prev) => prev.filter((c) => c.card_id !== selectedCard.card_id));
                          setSelectedCard(null);
                        } catch {
                          Alert.alert(t('cal_error'), t('cal_could_not_update'));
                        }
                      },
                    },
                  ],
                );
              }}
              style={styles.completeBtn}
            >
              <CheckCircle2 color="#FFFFFF" size={18} />
              <Text style={styles.completeBtnText}>{t('cal_mark_as_done')}</Text>
            </PressScale>
          </>
        ) : null}
      </KeyboardAwareBottomSheet>

      {/* "What you share with each other" — a two-way, mutual view. The `out`
          side is your own shared items (what they see of you) with an inline
          way to pull each back private; the `in` side is what they've shared
          with you, read-only. Private items never appear in either. */}
      <KeyboardAwareBottomSheet visible={coparentViewOpen} onClose={() => setCoparentViewOpen(false)} contentStyle={styles.detailSheet}>
        {(() => {
          const items = shareDir === 'out' ? sharedOut : sharedIn;
          return (
        <>
        <View style={styles.detailHeader}>
          <View style={styles.coparentTitleWrap}>
            <Eye color={ui.orange} size={20} />
            <Text style={styles.detailTitle}>{t('cal_share_view_title')}</Text>
          </View>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setCoparentViewOpen(false)} style={styles.closeBtn}>
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        <View style={styles.shareSeg}>
          <PressScale
            testID="share-dir-out"
            accessibilityRole="button"
            onPress={() => setShareDir('out')}
            style={[styles.shareSegBtn, shareDir === 'out' && styles.shareSegOn]}
          >
            <Text style={[styles.shareSegText, shareDir === 'out' && styles.shareSegTextOn]}>{t('cal_share_out')}</Text>
          </PressScale>
          <PressScale
            testID="share-dir-in"
            accessibilityRole="button"
            onPress={() => setShareDir('in')}
            style={[styles.shareSegBtn, shareDir === 'in' && styles.shareSegOn]}
          >
            <Text style={[styles.shareSegText, shareDir === 'in' && styles.shareSegTextOn]}>{t('cal_share_in')}</Text>
          </PressScale>
        </View>

        <View style={styles.shareRule}>
          <Lock color={ui.orangeText} size={15} />
          <Text style={styles.shareRuleText}>{t('cal_share_rule')}</Text>
        </View>

        {items === null ? (
          <ActivityIndicator color={ui.orange} size="small" style={{ marginTop: 24 }} />
        ) : items.length === 0 ? (
          <View style={styles.coparentEmpty}>
            <Lock color={ui.muted} size={26} />
            <Text style={styles.coparentEmptyText}>
              {shareDir === 'out' ? t('cal_share_out_empty') : t('cal_share_in_empty')}
            </Text>
          </View>
        ) : (
          <View style={styles.coparentList}>
            {items.map((c, i) => (
              <View key={c.card_id} style={[styles.coparentRow, i < items.length - 1 && styles.coparentRowBorder]}>
                <Users color={ui.mintText} size={17} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.coparentRowTitle} numberOfLines={1}>{cleanText(c.title)}</Text>
                  <Text style={styles.coparentRowMeta} numberOfLines={1}>
                    {shareDir === 'in' && c.shared_by_name
                      ? t('cal_share_by', { name: c.shared_by_name }) + (c.due_date ? ' · ' + formatDateTime(c.due_date) : '')
                      : (c.due_date ? formatDateTime(c.due_date) : t('cal_share_no_date'))}
                  </Text>
                </View>
                {shareDir === 'out' ? (
                  <PressScale
                    testID={`share-make-private-${c.card_id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('cal_share_make_private')}
                    disabled={makingPrivate === c.card_id}
                    onPress={() => makePrivateFromView(c)}
                    style={styles.makePrivateBtn}
                  >
                    <Text style={styles.makePrivateText}>
                      {makingPrivate === c.card_id ? t('cal_share_making_private') : t('cal_share_make_private')}
                    </Text>
                  </PressScale>
                ) : (
                  <View style={styles.shareTag}>
                    <Text style={styles.shareTagText}>{t('cal_share_tag_shared')}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
        </>
          );
        })()}
      </KeyboardAwareBottomSheet>
    </SwipeableTabView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: ui.orangeDeep, borderRadius: 99, paddingHorizontal: 18, paddingVertical: 11 },
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
  dayCellSelected: { backgroundColor: ui.orangeDeep },
  dayNumber: { fontFamily: 'Inter_700Bold', fontSize: 15.5, includeFontPadding: false, textAlign: 'center' },
  dayDot: { marginTop: 5, width: 5, height: 5, borderRadius: 99 },
  dayDotSpacer: { marginTop: 5, width: 5, height: 5 },

  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 12 },
  dayHeadTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, letterSpacing: -0.3, flex: 1 },
  dayHeadCount: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  empty: { paddingVertical: 34, paddingHorizontal: 24, alignItems: 'center' },
  emptyIcon: { width: 54, height: 54, borderRadius: 16, backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyText: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, textAlign: 'center' },
  emptyHint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  emptySyncBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 16, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 99, borderWidth: 1, borderColor: ui.orange + '55', backgroundColor: ui.orangeSoft },
  emptySyncText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

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
  detailBody: { marginTop: 16, gap: 10 },
  detailDescription: { color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 24 },
  detailChip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  detailChipText: { flex: 1, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20 },
  completeBtn: { marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 54, borderRadius: 99, backgroundColor: ui.orangeDeep },
  completeBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 16 },
  shareBtn: { marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50, borderRadius: 99, borderWidth: 1.5, borderColor: ui.orange + '66', backgroundColor: ui.orangeSoft },
  shareBtnText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  sharedBadge: { marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 99, backgroundColor: ui.mintText + '1E' },
  sharedBadgeText: { color: ui.mintText, fontFamily: 'Inter_700Bold', fontSize: 14 },
  shareNudge: { marginTop: 20, padding: 14, borderRadius: 18, borderWidth: 1.5, borderColor: ui.orange + '55', backgroundColor: ui.orangeSoft, gap: 12 },
  shareNudgeText: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20 },
  shareNudgeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 99, backgroundColor: ui.orangeDeep },
  shareNudgeBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  coparentLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 6 },
  coparentLinkText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  coparentTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  coparentSubtitle: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 4 },
  coparentEmpty: { alignItems: 'center', gap: 12, paddingVertical: 34 },
  coparentEmptyText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 },
  coparentList: { marginTop: 12 },
  coparentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  coparentRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ui.line },
  coparentRowTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  coparentRowMeta: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },

  shareSeg: { flexDirection: 'row', backgroundColor: ui.soft, borderRadius: 14, borderWidth: 1, borderColor: ui.line, padding: 4, gap: 4, marginTop: 14 },
  shareSegBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  shareSegOn: { backgroundColor: ui.card },
  shareSegText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  shareSegTextOn: { color: ui.text },
  shareRule: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: ui.orangeSoft, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11, marginTop: 14 },
  shareRuleText: { flex: 1, color: ui.orangeText, fontFamily: 'Inter_600SemiBold', fontSize: 12.5, lineHeight: 18 },
  makePrivateBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  makePrivateText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
  shareTag: { backgroundColor: ui.mint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  shareTagText: { color: ui.mintText, fontFamily: 'Inter_800ExtraBold', fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },

  carpoolSection: { marginTop: 24 },
  carpoolHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  carpoolTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  carpoolRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: ui.line },
  carpoolName: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  carpoolSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
});
