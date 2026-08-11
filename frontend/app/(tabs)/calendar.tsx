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
import { AddCardModal } from '../../src/components/AddCardModal';
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

// Morning auto-sync: at most once a day, and only on the first open from 7am
// local onwards, so the calendar is already pulled in when someone looks in
// the morning. A true 7am-while-closed fetch is not possible — the app keeps
// no server-side calendar credentials (offlineAccess: false) and mobile OSes
// do not grant reliable scheduled background execution — so this fires on the
// first morning open instead, which is when a person actually looks. The seen
// set remembers which upcoming items were already surfaced so "new on your
// agenda" only fires for genuinely new events, never on an idempotent re-pull.
const AUTOSYNC_DAY_KEY = 'coo_cal_autosync_day';   // YYYY-MM-DD of the last morning pull
const CAL_SEEN_KEY = 'coo_cal_seen_ids';
const MORNING_HOUR = 7;

function localDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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
  // Shown after the morning auto-pull: a quiet, dismissible note that the day
  // came in on its own, with a nudge to the Import button to double-check.
  const [morningNotice, setMorningNotice] = useState(false);
  // Lets the user back out of a sync that is taking too long. The in-flight
  // request is allowed to finish server-side (the import is an idempotent
  // upsert, so a late completion is harmless), but once cancelled its result
  // is ignored and the screen is handed straight back — no more staring at a
  // spinner with no way out.
  // A generation counter, not a flag. With a single boolean, kicking off a
  // second import reset it — so the import the user had just CANCELLED
  // sailed through its own check, announced 'synced', and cleared the
  // spinner while the new one was still running. Each run keeps its own
  // number and only acts if it is still the current one.
  const syncGenRef = useRef(0);
  const [calendarSyncStatus, setCalendarSyncStatus] = useState<string | null>(null);
  const cancelSync = useCallback(() => {
    syncGenRef.current += 1;
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
  const [importPickerOpen, setImportPickerOpen] = useState(false);
  const [shareCounts, setShareCounts] = useState<{ shared_out: number; shared_in: number; private: number } | null>(null);
  // Collapsed by default. The panel is above the calendar now, and a family
  // sharing twenty items would otherwise bury the month grid under a list.
  const [shareExpanded, setShareExpanded] = useState(false);
  const [shareDir, setShareDir] = useState<'out' | 'in'>('out');
  const [sharedOut, setSharedOut] = useState<Card[] | null>(null);
  const [sharedIn, setSharedIn] = useState<Card[] | null>(null);
  const [makingPrivate, setMakingPrivate] = useState<string | null>(null);
  // Month vs week. Month is the grid; week is a 7-day strip of the selected
  // week — the span busy parents actually scan.
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month');
  // Add an event to the day the calendar is already on, instead of leaving for
  // the Feed to capture it — the gesture everyone expects here.
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<{ transcript: string; type: Card['type']; title: string; description: string; assignee: string; due_date: string } | null>(null);
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
      const [cardsRes, carpoolRes, membersRes, sharedRes] = await Promise.allSettled([
        api.listCards(), api.listCarpools(), api.familyMembers(),
        // The banner's number has to come from the same place the panel's
        // does. Counting `cards` looked equivalent and was not: /api/cards
        // returns the whole family's shared items, so a co-parent's items
        // inflated a figure that claims to describe yours — and it dropped
        // undated ones, which the panel shows. Two numbers for one idea,
        // disagreeing one tap apart, on a privacy control.
        api.sharingSummary(),
      ]);
      if (sharedRes.status === 'fulfilled') setShareCounts(sharedRes.value);
      // Both directions, loaded with the screen. The panel is on the page now,
      // not behind a tap, so its data has to arrive with everything else.
      // Deliberately NOT cleared to null first: that would flash a spinner
      // above the calendar on every visit and every pull-to-refresh, which is
      // worse than briefly showing the previous — correct — list.
      api.sharedWithCoparent('out').then(setSharedOut).catch(() => setSharedOut([]));
      api.sharedWithCoparent('in').then(setSharedIn).catch(() => setSharedIn([]));
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
      // Non-queueable on purpose: offline this must fail loudly rather than
      // hide the row while the co-parent can still see the item.
      await api.unshareCard(card.card_id);
      setShareCounts((c) => (c ? { ...c, shared_out: Math.max(0, c.shared_out - 1), private: c.private + 1 } : c));
      setSharedOut((prev) => (prev ? prev.filter((c) => c.card_id !== card.card_id) : prev));
      await load();
    } catch (e) {
      logger.warn('make private failed', e);
      // Failing quietly leaves the item visible to the co-parent while the row
      // suggests otherwise — the one outcome this panel must never produce.
      Alert.alert(t('cal_error'), t('cal_could_not_update'));
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
      const myGen = ++syncGenRef.current;
      setSyncing(true);
      try {
        const result = await api.importGoogleCalendar(accessToken, 30);
        if (myGen !== syncGenRef.current) return;
        setSyncResult(result);
        await load();
        Alert.alert(t('cal_calendar_synced'), syncSummary(result));
      } catch (e: any) {
        logger.warn('calendar sync failed', e);
        Alert.alert(t('cal_calendar_sync_failed'), e?.message || t('cal_please_try_again'));
      } finally {
        // Only the run that is still current may take the spinner down;
        // a superseded or cancelled one clearing it stranded the user
        // with no Cancel button while an import was still going.
        if (myGen === syncGenRef.current) setSyncing(false);
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
      // Morning only, once a day. Before 7am we leave it for later; after,
      // the first open of the day does the pull and nothing else does.
      const now = new Date();
      if (now.getHours() < MORNING_HOUR) return;
      const today = localDayKey(now);
      const lastDay = await AsyncStorage.getItem(AUTOSYNC_DAY_KEY).catch(() => null);
      if (lastDay === today) return;
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
      await AsyncStorage.setItem(AUTOSYNC_DAY_KEY, today).catch(() => undefined);
      setSyncResult(result);
      // Say plainly that it happened, and point at the button to double-check.
      setMorningNotice(true);

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
      ? { title: t('cal_nightly_title'),
          body: count === 1 ? t('cal_nightly_body_one') : t('cal_nightly_body', { count }) }
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

  // The seven days of the week the selection sits in, Sunday first.
  const weekDays = useMemo(() => {
    const anchor = selectedDay ? new Date(`${selectedDay}T00:00:00`) : new Date();
    const start = new Date(anchor);
    start.setDate(anchor.getDate() - anchor.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [selectedDay]);

  const shiftWeek = (amount: number) => {
    const anchor = selectedDay ? new Date(`${selectedDay}T00:00:00`) : new Date();
    anchor.setDate(anchor.getDate() + amount * 7);
    setSelectedDay(dateKey(anchor));
    setActiveMonth(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  };

  const openAddEvent = () => {
    const base = selectedDay ? new Date(`${selectedDay}T12:00:00`) : new Date();
    if (!selectedDay) base.setHours(12, 0, 0, 0);
    setAddDraft({ transcript: '', type: 'APPOINTMENT', title: '', description: '', assignee: '', due_date: base.toISOString() });
    setAddOpen(true);
  };

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

  /**
   * The same moment, short enough to sit beside a tag without truncating.
   *
   * The sharing rows carry an icon, a title, a "Shared" tag and an action, so
   * the long form ("Saturday, August 8 at 03:00 PM") had nowhere to go and
   * ellipsized away the time — the one part a co-parent actually reads.
   */
  const formatDateTimeShort = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
      + ' · ' + date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  };

  const syncCalendar = async () => {
    setSyncResult(null);
    // Claimed once for the whole call so every branch — and every finally —
    // is talking about the same run.
    const myGen = ++syncGenRef.current;

    if (Platform.OS !== 'web') {
      if (!webClientId) {
        Alert.alert(t('cal_google_not_configured'), t('cal_missing_web_client_id'));
        setCalendarSyncStatus(t('cal_web_client_id_missing'));
        return;
      }

      try {
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
        if (myGen !== syncGenRef.current) return;
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
        // Only the run that is still current may take the spinner down;
        // a superseded or cancelled one clearing it stranded the user
        // with no Cancel button while an import was still going.
        if (myGen === syncGenRef.current) setSyncing(false);
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
      // Claim the response before prompting. promptCalendarAsync also pushes a
      // new calendarResponse into state, which fires the import effect above —
      // and this handler already imports below with its own status and cancel
      // handling. Leaving the ref false let both run, importing the same events
      // twice. Marking it handled keeps this path the single importer.
      handledCalendarResponseRef.current = true;

      const result = (await promptCalendarAsync()) as any;
      const accessToken = result?.authentication?.accessToken || result?.params?.access_token || result?.params?.accessToken;

      if (!accessToken) {
        logger.warn('calendar auth returned no access token', result);
        setCalendarSyncStatus(t('cal_connected_no_access_token'));
        Alert.alert(t('cal_calendar_sync_failed'), t('cal_connected_no_access_token'));
        return;
      }

      setSyncing(true);
      setCalendarSyncStatus(t('cal_importing_events'));

      const importResult = await api.importGoogleCalendar(accessToken, 30);
      if (myGen !== syncGenRef.current) return;
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
      // Only the run that is still current may take the spinner down;
      // a superseded or cancelled one clearing it stranded the user
      // with no Cancel button while an import was still going.
      if (myGen === syncGenRef.current) setSyncing(false);
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
      const myGen = ++syncGenRef.current;
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
        if (myGen !== syncGenRef.current) return;
        setSyncResult(result);
        await load();
        Alert.alert(t('cal_calendar_synced'), syncSummary(result));
      } catch (e: any) {
        logger.warn('microsoft calendar sync failed', e);
        Alert.alert(t('cal_calendar_sync_failed'), e?.message || t('cal_please_try_again'));
      } finally {
        // Only the run that is still current may take the spinner down;
        // a superseded or cancelled one clearing it stranded the user
        // with no Cancel button while an import was still going.
        if (myGen === syncGenRef.current) setSyncing(false);
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
  /**
   * Where to import from — as a sheet, not a system alert.
   *
   * Android's Alert renders at most three buttons and silently drops the rest,
   * so the "Cancel" written below the three sources never appeared: tapping
   * Import opened a dialog offering Google, Outlook and Both with no way out
   * except to pick one. A sheet has room for every option plus a way to leave,
   * and it looks like the rest of the app rather than a grey OS dialog.
   */
  const openImportPicker = () => setImportPickerOpen(true);

  const chooseImport = (which: 'google' | 'outlook' | 'both') => {
    setImportPickerOpen(false);
    if (which === 'google') { syncCalendar(); return; }
    if (which === 'outlook') { syncMicrosoft(); return; }
    (async () => { await syncCalendar(); await syncMicrosoft(); })();
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
              // Compact icon button — the labelled "Import from Google or Outlook"
              // card below is the primary entry, so the header stays uncluttered
              // and the month title keeps its room (incl. longer languages).
              syncing ? (
                <PressScale testID="cancel-calendar-sync" onPress={cancelSync} accessibilityRole="button" accessibilityLabel={t('cal_cancel')} style={[styles.syncIconBtn, { backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line }]}>
                  <ActivityIndicator color={ui.orangeText} size="small" />
                </PressScale>
              ) : (
                <PressScale testID="sync-google-calendar" onPress={openImportPicker} disabled={syncDisabled} accessibilityRole="button" accessibilityLabel={t('cal_import')} style={[styles.syncIconBtn, syncDisabled && { opacity: 0.55 }]}>
                  <RefreshCw color="#FFFFFF" size={18} />
                </PressScale>
              )
            }
          />

          {/* Morning auto-import notice — dismissible; also clears if they tap Import. */}
          {morningNotice ? (
            <View testID="calendar-morning-notice" style={styles.morningNotice}>
              <CalendarDays color={ui.mintText} size={18} />
              <Text style={styles.morningNoticeText}>{t('cal_morning_imported')}</Text>
              <PressScale
                testID="calendar-morning-dismiss"
                accessibilityRole="button"
                accessibilityLabel={t('close')}
                onPress={() => setMorningNotice(false)}
                hitSlop={10}
                style={styles.morningDismiss}
              >
                <X color={ui.muted} size={16} />
              </PressScale>
            </View>
          ) : null}

          {/* Connection banner (tap to sync — keeps the sync card visible & functional) */}
          <PressScale testID="calendar-sync-card-button" onPress={() => { setMorningNotice(false); openImportPicker(); }} disabled={syncDisabled} style={[styles.bannerGap, syncDisabled && { opacity: 0.55 }]}>
            <KitCard style={styles.banner}>
              <View testID="calendar-sync-card" style={styles.bannerInner}>
                <IconTile bg={ui.orangeSoft} size={40} radius={13}><CalendarDays color={ui.orange} size={20} /></IconTile>
                <Text style={styles.bannerText} numberOfLines={2}>
                  {calendarSyncStatus || (syncResult ? syncSummary(syncResult) : t('cal_connected_read_only'))}
                </Text>
                {/* Same card, same tappability, same signal as the sharing row
                    below it — without this the two are indistinguishable and
                    only one of them advertises that it does something. */}
                <ChevronRight color={ui.muted} size={18} />
              </View>
            </KitCard>
          </PressScale>

          {/* "What you share with each other" — a two-way, mutual view, and
              the first thing on the page rather than something behind a tap.
              It was a card that opened a sheet, which meant the one control
              that answers "can my co-parent see this?" was invisible until
              you went looking. Privacy you cannot find is privacy you do not
              trust, so it lives here now, above the calendar it describes.
              The `out` side is your own shared items with an inline way to
              pull each back private; the `in` side is what they have shared
              with you, read-only. Private items appear in neither. */}
          <KitCard style={[styles.bannerGap, styles.sharePanel]}>
            {(() => {
              const items = shareDir === 'out' ? sharedOut : sharedIn;
              // Everything of yours the co-parent cannot see. Counted from the
              // agenda already in hand, so the panel states both halves of the
              // rule: what they see, and how much stays yours.
              const privateCount = shareCounts?.private ?? 0;
              // Inline, this list sits between the header and the calendar, so
              // an unbounded map would push the month grid off the bottom of a
              // phone. Show a handful and offer the rest.
              const shown = shareExpanded ? items : items?.slice(0, 3) ?? null;
              const hidden = (items?.length ?? 0) - (shown?.length ?? 0);
              return (
              <>
            <View style={styles.shareHead}>
              <Eye color={ui.orange} size={18} />
              <Text style={styles.shareTitle}>{t('cal_share_view_title')}</Text>
            </View>

            <View style={styles.shareSeg}>
              <PressScale
                testID="share-dir-out"
                accessibilityRole="button"
                onPress={() => { setShareDir('out'); setShareExpanded(false); }}
                style={[styles.shareSegBtn, shareDir === 'out' && styles.shareSegOn]}
              >
                <Text style={[styles.shareSegText, shareDir === 'out' && styles.shareSegTextOn]}>{t('cal_share_out')}</Text>
              </PressScale>
              <PressScale
                testID="share-dir-in"
                accessibilityRole="button"
                onPress={() => { setShareDir('in'); setShareExpanded(false); }}
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
              <>
              <Text style={styles.shareCountLabel}>
                {shareDir === 'out'
                  ? (items.length === 1 ? t('cal_share_count_out_one') : t('cal_share_count_out', { n: items.length }))
                  : (items.length === 1 ? t('cal_share_count_in_one') : t('cal_share_count_in', { n: items.length }))}
              </Text>
              <View style={styles.coparentList}>
                {(shown ?? []).map((c, i) => (
                  <View key={c.card_id} style={[styles.coparentRow, i < (shown ?? []).length - 1 && styles.coparentRowBorder]}>
                    <Users color={ui.mintText} size={17} />
                    {/* minWidth:0 lets this column actually shrink, so a long title
                        ellipsizes instead of squeezing itself down to one letter. */}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.coparentRowTitle} numberOfLines={1}>{cleanText(c.title)}</Text>
                      {/* The "Shared" tag rides on the meta line rather than as a
                          third column: it still says plainly why the item is
                          visible, without stealing width from the title. */}
                      <View style={styles.shareMetaRow}>
                        {shareDir === 'out' ? (
                          <View style={styles.shareTag}>
                            <Text style={styles.shareTagText}>{t('cal_share_tag_shared')}</Text>
                          </View>
                        ) : null}
                        <Text style={styles.coparentRowMeta} numberOfLines={1}>
                          {shareDir === 'in' && c.shared_by_name
                            ? t('cal_share_by', { name: c.shared_by_name }) + (c.due_date ? ' · ' + formatDateTimeShort(c.due_date) : '')
                            : (c.due_date ? formatDateTimeShort(c.due_date) : t('cal_share_no_date'))}
                        </Text>
                      </View>
                    </View>
                    {shareDir === 'out' ? (
                      <PressScale
                        testID={`share-make-private-${c.card_id}`}
                        accessibilityRole="button"
                        accessibilityLabel={t('cal_share_make_private')}
                        disabled={makingPrivate === c.card_id}
                        onPress={() => makePrivateFromView(c)}
                        hitSlop={10}
                        style={styles.makePrivateBtn}
                      >
                        <Text style={styles.makePrivateText}>
                          {makingPrivate === c.card_id ? t('cal_share_making_private') : t('cal_share_make_private')}
                        </Text>
                      </PressScale>
                    ) : null}
                  </View>
                ))}
              </View>
              </>
            )}

            {/* The other half of the promise: how much stays yours. Stated only on
                your own side — what the co-parent keeps private is not yours to count. */}
            {shareDir === 'out' && items !== null && privateCount > 0 ? (
              <Text style={styles.sharePrivateNote}>
                {privateCount === 1 ? t('cal_share_private_note_one') : t('cal_share_private_note', { n: privateCount })}
              </Text>
            ) : null}
              {hidden > 0 ? (
                <PressScale
                  testID="share-show-all"
                  accessibilityRole="button"
                  onPress={() => setShareExpanded(true)}
                  style={styles.shareMoreBtn}
                >
                  <Text style={styles.shareMoreText}>{t('cal_share_show_all', { n: hidden })}</Text>
                </PressScale>
              ) : null}
              </>
              );
            })()}
          </KitCard>

          {/* Month / Week */}
          <KitCard style={styles.calCard}>
            <View style={styles.monthHeader}>
              <PressScale testID="prev-month" accessibilityRole="button" accessibilityLabel={t('a11y_prev_month')} onPress={() => (viewMode === 'week' ? shiftWeek(-1) : shiftMonth(-1))} style={styles.monthNav}>
                <ChevronLeft color={ui.text} size={20} />
              </PressScale>
              <Text style={styles.monthTitle}>{monthTitle}</Text>
              <PressScale testID="next-month" accessibilityRole="button" accessibilityLabel={t('a11y_next_month')} onPress={() => (viewMode === 'week' ? shiftWeek(1) : shiftMonth(1))} style={styles.monthNav}>
                <ChevronRight color={ui.text} size={20} />
              </PressScale>
            </View>

            <View style={styles.viewToggle}>
              <PressScale testID="cal-view-month" onPress={() => setViewMode('month')} style={[styles.viewToggleBtn, viewMode === 'month' && styles.viewToggleOn]}>
                <Text style={[styles.viewToggleText, viewMode === 'month' && styles.viewToggleTextOn]}>{t('cal_view_month')}</Text>
              </PressScale>
              <PressScale testID="cal-view-week" onPress={() => setViewMode('week')} style={[styles.viewToggleBtn, viewMode === 'week' && styles.viewToggleOn]}>
                <Text style={[styles.viewToggleText, viewMode === 'week' && styles.viewToggleTextOn]}>{t('cal_view_week')}</Text>
              </PressScale>
            </View>

            {viewMode === 'month' ? (
              <>
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
              </>
            ) : (
              <View style={[styles.weekStrip, { width: gridWidth }]}>
                {weekDays.map((date) => {
                  const key = dateKey(date);
                  const count = countsByDay[key] || 0;
                  const isToday = key === dateKey(new Date());
                  const selected = selectedDay === key;
                  return (
                    <PressScale
                      key={key}
                      testID={`calendar-day-${key}`}
                      onPress={() => onSelectDay(key, date)}
                      style={[styles.weekDayCell, { width: daySize + 2 }, selected && styles.dayCellSelected]}
                    >
                      <Text style={[styles.weekDayLabel, { color: selected ? '#FFFFFF' : ui.muted }]}>
                        {date.toLocaleDateString(locale, { weekday: 'short' }).charAt(0).toUpperCase()}
                      </Text>
                      <Text style={[styles.dayNumber, { color: selected ? '#FFFFFF' : isToday ? ui.orangeText : ui.text }]}>
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
            )}
          </KitCard>

          {/* Day events */}
          <View style={styles.dayHead}>
            <Text style={[styles.dayHeadTitle, { flex: 1 }]} numberOfLines={1}>{selectedDay ? formatDayFull(selectedDay) : t('upcoming')}</Text>
            <View style={styles.dayHeadRight}>
              {selectedDay ? <Text style={styles.dayHeadCount}>{totalSelectedEvents} {totalSelectedEvents === 1 ? t('cal_event') : t('cal_events')}</Text> : null}
              <PressScale testID="calendar-add-event" onPress={openAddEvent} style={styles.addEventBtn}>
                <Plus color={ui.orangeText} size={15} />
                <Text style={styles.addEventText}>{t('cal_add_event')}</Text>
              </PressScale>
            </View>
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

      {/* Where to import from. Every option plus a way out — the alert this
          replaces could only ever show three buttons on Android, which is
          exactly how many sources there are, so "Cancel" was dropped. */}
      <KeyboardAwareBottomSheet visible={importPickerOpen} onClose={() => setImportPickerOpen(false)} contentStyle={styles.detailSheet}>
        <View style={styles.detailHeader}>
          <Text style={styles.detailTitle}>{t('cal_import_title')}</Text>
          <PressScale
            testID="import-picker-close"
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={() => setImportPickerOpen(false)}
            style={styles.closeBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        <Text style={styles.importPickerSub}>{t('cal_import_subtitle')}</Text>

        {([
          { key: 'google' as const, label: t('cal_import_google'), testID: 'import-google' },
          { key: 'outlook' as const, label: t('cal_import_outlook'), testID: 'import-outlook' },
          { key: 'both' as const, label: t('cal_import_both'), testID: 'import-both' },
        ]).map((opt) => (
          <PressScale
            key={opt.key}
            testID={opt.testID}
            accessibilityRole="button"
            onPress={() => chooseImport(opt.key)}
            style={styles.importOption}
          >
            <IconTile bg={ui.orangeSoft} size={38} radius={12}>
              <CalendarDays color={ui.orange} size={18} />
            </IconTile>
            <Text style={styles.importOptionText}>{opt.label}</Text>
            <ChevronRight color={ui.muted} size={18} />
          </PressScale>
        ))}

        <PressScale
          testID="import-picker-cancel"
          accessibilityRole="button"
          onPress={() => setImportPickerOpen(false)}
          style={styles.importCancel}
        >
          <Text style={styles.importCancelText}>{t('cal_cancel')}</Text>
        </PressScale>
      </KeyboardAwareBottomSheet>

      <AddCardModal
        visible={addOpen}
        onClose={() => { setAddOpen(false); setAddDraft(null); }}
        onCreated={() => { logEvent('card_created'); load(); }}
        initialSource="MANUAL"
        initialDraft={addDraft}
      />

    </SwipeableTabView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  syncIconBtn: { width: 40, height: 40, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.orangeDeep },

  morningNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16,
    backgroundColor: ui.mint, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 13,
  },
  morningNoticeText: { flex: 1, color: ui.mintText, fontFamily: 'Inter_600SemiBold', fontSize: 12.5, lineHeight: 17 },
  morningDismiss: { padding: 2 },
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
  viewToggle: { flexDirection: 'row', gap: 6, alignSelf: 'center', marginBottom: 12, backgroundColor: ui.soft, borderRadius: 10, padding: 3 },
  viewToggleBtn: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 8 },
  viewToggleOn: { backgroundColor: ui.card },
  viewToggleText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: ui.muted },
  viewToggleTextOn: { color: ui.text },
  weekStrip: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'center', paddingVertical: 2 },
  weekDayCell: { alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 8, borderRadius: 14 },
  weekDayLabel: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  dayHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addEventBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ui.orangeSoft, borderRadius: 9999, paddingHorizontal: 11, paddingVertical: 6 },
  addEventText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
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
  sharedBadge: { marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 99, backgroundColor: ui.mint },
  sharedBadgeText: { color: ui.mintText, fontFamily: 'Inter_700Bold', fontSize: 14 },
  shareNudge: { marginTop: 20, padding: 14, borderRadius: 18, borderWidth: 1.5, borderColor: ui.orange + '55', backgroundColor: ui.orangeSoft, gap: 12 },
  shareNudgeText: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20 },
  shareNudgeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: 99, backgroundColor: ui.orangeDeep },
  shareNudgeBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  coparentLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 6 },
  importPickerSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13.5, lineHeight: 20, marginTop: 4 },
  importOption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: ui.line },
  importOptionText: { flex: 1, color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  importCancel: { marginTop: 16, alignItems: 'center', paddingVertical: 13, borderRadius: 999, backgroundColor: ui.soft },
  importCancelText: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  coparentLinkTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  coparentLinkSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  coparentTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 },
  coparentSubtitle: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 4 },
  coparentEmpty: { alignItems: 'center', gap: 12, paddingVertical: 34 },
  coparentEmptyText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 },
  coparentList: { marginTop: 12 },
  coparentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  coparentRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: ui.line },
  coparentRowTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  coparentRowMeta: { flex: 1, minWidth: 0, color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5 },

  sharePanel: { padding: 16 },
  shareHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shareTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  shareMoreBtn: { alignItems: 'center', paddingVertical: 11, marginTop: 4 },
  shareMoreText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 13 },
  shareSeg: { flexDirection: 'row', backgroundColor: ui.soft, borderRadius: 14, borderWidth: 1, borderColor: ui.line, padding: 4, gap: 4, marginTop: 14 },
  shareSegBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10 },
  // The design's central mechanic is knowing which way you are facing. This
  // was `ui.card` on a `ui.soft` track: 1.15:1 in light, and INVERTED in
  // dark, where card is darker than soft — so the unselected half read as
  // the raised one. Brand fill plus a real border survives both themes.
  shareSegOn: { backgroundColor: ui.orangeSoft, borderWidth: 1.5, borderColor: ui.orange },
  shareSegText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  shareSegTextOn: { color: ui.text },
  shareRule: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: ui.orangeSoft, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11, marginTop: 14 },
  shareRuleText: { flex: 1, color: ui.orangeText, fontFamily: 'Inter_600SemiBold', fontSize: 12.5, lineHeight: 18 },
  makePrivateBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: ui.orange },
  makePrivateText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
  shareTag: { backgroundColor: ui.mint, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  shareTagText: { color: ui.mintText, fontFamily: 'Inter_800ExtraBold', fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' },
  shareMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 },
  shareCountLabel: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 16 },
  sharePrivateNote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 18, textAlign: 'center', marginTop: 14, paddingHorizontal: 8 },

  carpoolSection: { marginTop: 24 },
  carpoolHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  carpoolTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  carpoolRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: ui.line },
  carpoolName: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  carpoolSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
});
