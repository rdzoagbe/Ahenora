import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { api, Card } from './api';
import { logger } from './logger';
import { targetForNotification } from './notificationRouting';
export { targetForNotification } from './notificationRouting';

const REMINDER_IDS_KEY = 'coo_scheduled_card_reminder_ids';
const EXPO_GO_ANDROID_MESSAGE =
  'Notifications are disabled in Expo Go on Android. Use a development build to test notifications.';

let notificationHandlerConfigured = false;

function isExpoGoAndroid() {
  return Platform.OS === 'android' && Constants.appOwnership === 'expo';
}

/**
 * What build and runtime this install is actually on. Sent along with the push
 * token so the backend can report OTA adoption — "who is on 1.0.3 / runtime
 * 2.0.0 yet" — without a separate telemetry ping. The runtime is what gates
 * whether a device can even receive an over-the-air update, so it is the number
 * that answers "did everyone get it". expo-updates is imported lazily because
 * it is a no-op on web, where there is no runtime to report.
 */
export async function appVersionInfo(): Promise<{ appVersion: string; runtimeVersion: string }> {
  const appVersion = Constants.expoConfig?.version || '';
  let runtimeVersion = '';
  try {
    const Updates = await import('expo-updates');
    runtimeVersion = (Updates.runtimeVersion as string) || '';
  } catch {
    // Web or a build without expo-updates — no runtime to report.
  }
  return { appVersion, runtimeVersion };
}

async function getNotificationsModule(): Promise<any | null> {
  if (isExpoGoAndroid()) return null;

  const Notifications = await import('expo-notifications');

  if (!notificationHandlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        // The daily tip is deliberately silent on its LOW channel; keep it
        // silent in the foreground too, so it never chimes while the app is open.
        const silent = notification?.request?.content?.data?.type === 'daily_tip';
        return {
          shouldPlaySound: !silent,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        };
      },
    });
    notificationHandlerConfigured = true;
  }

  return Notifications;
}

export async function configureNotificationChannels() {
  if (Platform.OS !== 'android') return;

  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  await Notifications.setNotificationChannelAsync('card-reminders', {
    name: 'Card reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#F59E0B',
  });

  await Notifications.setNotificationChannelAsync('daily-tips', {
    name: 'Daily tips',
    importance: Notifications.AndroidImportance.LOW,
    vibrationPattern: [0],
    sound: null,
  });

  await Notifications.setNotificationChannelAsync('household-alerts', {
    name: 'Household alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#F59E0B',
  });
}

export async function ensureNotificationPermissions() {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return false;

  await configureNotificationChannels();

  const existing = await Notifications.getPermissionsAsync();
  let finalStatus = existing.status;

  if (existing.status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  return finalStatus === 'granted';
}

export async function registerForPushNotificationsAsync(): Promise<{
  granted: boolean;
  expoPushToken?: string;
  error?: string;
}> {
  if (isExpoGoAndroid()) {
    return { granted: false, error: EXPO_GO_ANDROID_MESSAGE };
  }

  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return { granted: false, error: EXPO_GO_ANDROID_MESSAGE };
  }

  const granted = await ensureNotificationPermissions();

  if (!granted) {
    return { granted: false, error: 'Notification permission was not granted.' };
  }

  try {
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;

    if (!projectId) {
      return {
        granted: true,
        error: 'Notifications are enabled locally. Remote push alerts need an EAS projectId.',
      };
    }

    const token = await Notifications.getExpoPushTokenAsync({ projectId });

    return {
      granted: true,
      expoPushToken: token.data,
    };
  } catch (e: any) {
    return {
      granted: true,
      error: e?.message || String(e),
    };
  }
}

async function getReminderMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(REMINDER_IDS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function setReminderMap(map: Record<string, string>) {
  await AsyncStorage.setItem(REMINDER_IDS_KEY, JSON.stringify(map));
}

// Serialise each reminder set's read→cancel→reschedule cycle. A screen's
// `load()` can fire one of these before the previous run finished (a
// re-entrant focus effect, or a pay-then-reload). Two overlapping runs each
// read the same id map, cancel the same ids, then schedule fresh
// notifications — and whichever run's ids the last write doesn't keep are
// orphaned on the device (never in the map, so never cancelled): duplicate
// reminders now, and a slow leak toward the OS's scheduled-notification cap.
// Chaining on a per-key promise makes the whole cycle atomic. `.then(run, run)`
// runs the next job whether the previous settled or threw, so one failure
// never wedges the chain.
const scheduleLocks: Record<string, Promise<unknown>> = {};
function withScheduleLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (scheduleLocks[key] ?? Promise.resolve()).then(fn, fn);
  scheduleLocks[key] = run.catch(() => undefined);
  return run;
}

async function cancelAllCardRemindersUnlocked() {
  const map = await getReminderMap();
  const Notifications = await getNotificationsModule();

  if (Notifications) {
    await Promise.all(
      Object.values(map).map((identifier) =>
        Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined)
      )
    );
  }

  await setReminderMap({});
}

export async function cancelAllCardReminderNotifications() {
  return withScheduleLock('cards', cancelAllCardRemindersUnlocked);
}

export async function syncCardReminderNotifications(cards: Card[], enabled: boolean, reminderLabel?: string) {
  return withScheduleLock('cards', () => syncCardReminderNotificationsUnlocked(cards, enabled, reminderLabel));
}

async function syncCardReminderNotificationsUnlocked(cards: Card[], enabled: boolean, reminderLabel?: string) {
  // Card reminders are now sent by the SERVER (backend send_due_card_reminders),
  // so this no longer schedules anything on-device — that would double every
  // reminder (a local notification and a push for the same card) and could only
  // ever reach the one person who opened the app, never the co-parent. All this
  // does now is clear any local reminders a previous build had already queued,
  // so an updated device stops firing the old on-device copies. The signature
  // and callers stay put; the arguments are intentionally unused.
  await cancelAllCardRemindersUnlocked();
  return { scheduled: 0, retired: true as const };
}

const ALLOWANCE_IDS_KEY = 'coo_scheduled_allowance_reminder_ids';

async function getAllowanceMap(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(ALLOWANCE_IDS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * A heads-up the day before each child's pocket money is due.
 *
 * Pocket money is easy to forget — it is not a task with a card, just a date
 * that quietly comes around. This schedules one local notification per child,
 * a day before the next payment is due, so the parent is reminded to hand it
 * over. Cancel-and-reschedule like the card reminders, so a changed amount or
 * frequency never leaves a stale reminder behind. The message strings are
 * built by the caller (which has the translator); this only schedules.
 */
/**
 * Sent by the server now (see DAILY_PUSH_JOBS): a day's warning before pocket
 * money falls due. Scheduled here it only existed for someone who had opened
 * the Kids tab, and it went stale the moment a payment moved the due date.
 * Kept to cancel what an older build left behind: ([], false).
 */
export async function syncAllowanceReminders(
  items: { id: string; fireAt: number; title: string; body: string }[],
  enabled: boolean,
): Promise<{ scheduled: number }> {
  return withScheduleLock('allowance', () => syncAllowanceRemindersUnlocked(items, enabled));
}

async function syncAllowanceRemindersUnlocked(
  items: { id: string; fireAt: number; title: string; body: string }[],
  enabled: boolean,
): Promise<{ scheduled: number }> {
  const Notifications = await getNotificationsModule();
  const map = await getAllowanceMap();

  if (Notifications) {
    await Promise.all(Object.values(map).map((id) =>
      Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  }
  await AsyncStorage.setItem(ALLOWANCE_IDS_KEY, JSON.stringify({})).catch(() => undefined);

  if (!enabled || !Notifications) return { scheduled: 0 };
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return { scheduled: 0 };
  await configureNotificationChannels();

  const next: Record<string, string> = {};
  const now = Date.now();
  for (const item of items) {
    // Skip anything already in the past or under a minute away — a reminder for
    // a moment that has passed is noise.
    if (item.fireAt <= now + 60 * 1000) continue;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: item.title,
        body: item.body,
        sound: true,
        data: { type: 'allowance_reminder', allowance_id: item.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(item.fireAt),
        channelId: 'card-reminders',
      } as any,
    });
    next[item.id] = id;
  }
  await AsyncStorage.setItem(ALLOWANCE_IDS_KEY, JSON.stringify(next)).catch(() => undefined);
  return { scheduled: Object.keys(next).length };
}

const NOTIF_ASKED_KEY = 'coo_notif_permission_asked';

/**
 * Requests notification permission a single time (e.g. on first feed load
 * after this feature ships). If the user declines, we never ask again from
 * here — they can still enable it via Settings.
 */
export async function ensureAskedNotificationPermissionOnce() {
  try {
    // Web has its own path: the browser prompt belongs on a real tap (the
    // Settings toggle), and registration there means a Web Push subscription,
    // not an Expo token. Auto-prompting here granted permission and then
    // registered nothing — a browser that agreed to notifications and never
    // got one. Leave web alone.
    if (Platform.OS === 'web') return;
    const asked = await AsyncStorage.getItem(NOTIF_ASKED_KEY);
    if (asked) { await ensurePushRegistered(); return; }
    await AsyncStorage.setItem(NOTIF_ASKED_KEY, '1');
    const Notifications = await getNotificationsModule();
    if (!Notifications) return;
    const current = await Notifications.getPermissionsAsync();
    if (current.status !== 'granted') {
      await Notifications.requestPermissionsAsync();
    }
    // Whether it was already granted or just granted, register the device now —
    // asking permission and then never sending the token is how a family grants
    // notifications and still hears nothing.
    await ensurePushRegistered();
  } catch {
    // Permission prompts must never break the feed.
  }
}

/**
 * Register this device's Expo push token with the server so the household can
 * actually reach it. This used to happen in exactly ONE place — turning on the
 * "new card alerts" toggle in Settings — so a family that never opened that
 * screen had no registered device at all, and every server push (a task
 * assigned, a message, a co-parent's note) reached nobody. It runs on login and
 * on every app launch now.
 *
 * It does not prompt: the once-per-install ask above handles that, and if
 * permission is not granted there is simply nothing to register. Re-registering
 * each launch also refreshes a rotated Expo token, which otherwise goes stale
 * and silently stops routing to the phone.
 */
/**
 * Ask for notification permission, and register the device if it is given.
 *
 * ensurePushRegistered already runs at launch and does the right thing — but it
 * returns immediately unless permission has ALREADY been granted, and until now
 * the only place in the whole app that ever ASKED was the Settings screen. On
 * Android 13 and later notifications are denied until an app requests them, so
 * anybody who never went into Settings and found the toggle was never asked,
 * never granted, and could never be sent anything.
 *
 * That is why notification_tokens is all but empty, why the server can push to
 * nobody, and why the only notifications anyone saw were LOCAL ones — which
 * exist only if the app was open to schedule them. "If I don't open the app I
 * don't get the notification" is exactly that.
 *
 * Returns whether permission ended up granted, so a caller can say something
 * true afterwards rather than assuming.
 */
export async function requestAndRegisterPush(isTeen = false): Promise<boolean> {
  try {
    const reg = await registerForPushNotificationsAsync();
    if (!reg.expoPushToken) {
      if (reg.error) logger.warn('push permission not usable', reg.error);
      return false;
    }
    const { appVersion, runtimeVersion } = await appVersionInfo();
    // A teen's session is refused by the parent route, same as at launch.
    const register = isTeen ? api.registerTeenNotificationToken : api.registerNotificationToken;
    await register(reg.expoPushToken, Platform.OS, appVersion, runtimeVersion);
    return true;
  } catch (e) {
    logger.warn('requestAndRegisterPush failed', e);
    return false;
  }
}

/** Has this device already been asked, and said yes? Never prompts. */
export async function pushPermissionGranted(): Promise<boolean> {
  if (Platform.OS === 'web') return true;   // web push has its own path
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return true;        // nothing to ask for; stay quiet
    const perm = await Notifications.getPermissionsAsync();
    return perm.status === 'granted';
  } catch {
    return true;
  }
}

export async function ensurePushRegistered(isTeen = false): Promise<void> {
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return;
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') return;
    const reg = await registerForPushNotificationsAsync();
    if (!reg.expoPushToken) {
      if (reg.error) logger.warn('push token unavailable', reg.error);
      return;
    }
    const { appVersion, runtimeVersion } = await appVersionInfo();
    // A teen's session is refused by the parent register route, so route them
    // to the teen endpoint — otherwise they'd never get a token or a push.
    const register = isTeen ? api.registerTeenNotificationToken : api.registerNotificationToken;
    await register(reg.expoPushToken, Platform.OS, appVersion, runtimeVersion);
  } catch (e) {
    logger.warn('ensurePushRegistered failed', e);
  }
}

/**
 * On logout: deactivate this device's server-side token (so the next household
 * — or nobody — on a shared/resold phone stops getting the last user's pushes)
 * and cancel every locally-scheduled notification (digests, dinner, recap,
 * calendar) so they don't keep firing with the old household's data. Best
 * effort; must be called while still authenticated (before api.logout()).
 */
export async function deactivatePushOnLogout(): Promise<void> {
  try {
    const Notifications = await getNotificationsModule();
    if (Notifications) {
      const perm = await Notifications.getPermissionsAsync();
      if (perm.status === 'granted') {
        const reg = await registerForPushNotificationsAsync();
        if (reg.expoPushToken) {
          await api.unregisterNotificationToken(reg.expoPushToken).catch(() => undefined);
        }
      }
      await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
    }
  } catch (e) {
    logger.warn('deactivatePushOnLogout failed', e);
  }
}

// True once the cold-start notification tap has been routed, so re-running this
// (which happens on every user refresh) never re-navigates to the same tap.
let coldStartRouted = false;

/**
 * Wire up notification taps. Calls `onTarget` with a route both for a tap while
 * the app is running AND for a cold start where tapping the notification is what
 * launched the app (getLastNotificationResponseAsync). Returns a cleanup fn.
 */
export async function attachNotificationRouting(
  onTarget: (t: { pathname: string; params?: Record<string, string> }) => void,
): Promise<() => void> {
  try {
    const Notifications = await getNotificationsModule();
    if (!Notifications) return () => undefined;
    // Consume the cold-start tap exactly once per app run. getLastNotification-
    // ResponseAsync keeps returning that same tap for the whole session, and
    // this routine re-runs whenever the user object changes (every refreshUser);
    // without this guard, opening a notification and then doing anything that
    // refreshes the user would yank you back to that conversation again and
    // again. The live listener below still routes taps that happen while open.
    if (!coldStartRouted) {
      coldStartRouted = true;
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last) {
          const t = targetForNotification(last.notification.request.content.data);
          if (t) onTarget(t);
        }
      } catch { /* cold-start lookup is best-effort */ }
    }
    const sub = Notifications.addNotificationResponseReceivedListener((response: any) => {
      const t = targetForNotification(response.notification.request.content.data);
      if (t) onTarget(t);
    });
    return () => { try { sub.remove(); } catch { /* already gone */ } };
  } catch (e) {
    logger.warn('attachNotificationRouting failed', e);
    return () => undefined;
  }
}

const DIGEST_ID_KEY = 'coo_morning_digest_id';

/**
 * Cancels every still-scheduled notification whose data.type is in `types`.
 * The single-id bookkeeping below only tracks the LAST schedule, so two callers
 * racing (a Feed mount + focus effect, or two quick opens) can each schedule
 * one and orphan the other — the orphans then all fire together the next
 * morning. Sweeping by type clears any such strays so at most one survives.
 */
async function cancelScheduledByType(Notifications: any, types: string[]) {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      (all || [])
        .filter((n: any) => types.includes(n?.content?.data?.type))
        .map((n: any) =>
          Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined))
    );
  } catch {
    // Best effort — a device that can't list scheduled notifications still gets
    // the single-id cancel below.
  }
}

// Serializes digest scheduling so two concurrent callers can't both cancel the
// same tracked id and then both schedule — the exact race that produced
// duplicate morning notifications.
let digestScheduleLock: Promise<unknown> = Promise.resolve();

/**
 * The CONTENT digest now comes from the server (send_daily_local_pushes), which
 * knows the agenda at 07:30 rather than whenever the app was last opened. What
 * is left here is the quiet-day tip: a silent, low-priority nudge with no agenda
 * in it, which needs no push token and loses nothing if a day is skipped.
 *
 * Passing a non-null `digest` still works and is still cancelled correctly, but
 * the app passes null — two 07:30 notifications is how an app gets muted.
 */
export function syncMorningDigest(
  enabled: boolean,
  digest: { title: string; body: string } | null,
  quietTip?: { title: string; body: string } | null
) {
  const run = digestScheduleLock.then(() => syncMorningDigestImpl(enabled, digest, quietTip));
  digestScheduleLock = run.then(() => undefined, () => undefined);
  return run;
}

async function syncMorningDigestImpl(
  enabled: boolean,
  digest: { title: string; body: string } | null,
  quietTip?: { title: string; body: string } | null
) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return { scheduled: false };

  const previous = await AsyncStorage.getItem(DIGEST_ID_KEY).catch(() => null);
  if (previous) {
    await Notifications.cancelScheduledNotificationAsync(previous).catch(() => undefined);
    await AsyncStorage.removeItem(DIGEST_ID_KEY).catch(() => undefined);
  }
  // Clear any orphans a prior race left behind, so exactly one digest fires.
  await cancelScheduledByType(Notifications, ['morning_digest', 'daily_tip']);

  // With items due: normal digest. With nothing due: a SILENT rotating tip on
  // the low-priority channel — no sound, no vibration, just a gentle presence
  // in the tray that keeps quiet-day users coming back.
  const content = digest ?? quietTip ?? null;
  if (!enabled || !content) return { scheduled: false };
  const quiet = !digest;

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return { scheduled: false };

  await configureNotificationChannels();

  const at = new Date();
  at.setDate(at.getDate() + 1);
  at.setHours(7, 30, 0, 0);

  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      sound: !quiet,
      data: { type: quiet ? 'daily_tip' : 'morning_digest' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: quiet ? 'daily-tips' : 'card-reminders',
    } as any,
  });
  await AsyncStorage.setItem(DIGEST_ID_KEY, identifier).catch(() => undefined);
  return { scheduled: true };
}

const DINNER_ID_KEY = 'coo_dinner_reminder_id';

/**
 * Sent by the server now (see DAILY_PUSH_JOBS). Kept so the app can CANCEL what
 * an older build scheduled: this was a one-shot local notification, written only
 * while somebody had the Feed open, so it never existed for anyone who did not
 * open that screen. Called with (false, null).
 */
export async function syncDinnerReminder(
  enabled: boolean,
  content: { title: string; body: string } | null
) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return { scheduled: false };

  const previous = await AsyncStorage.getItem(DINNER_ID_KEY).catch(() => null);
  if (previous) {
    await Notifications.cancelScheduledNotificationAsync(previous).catch(() => undefined);
    await AsyncStorage.removeItem(DINNER_ID_KEY).catch(() => undefined);
  }
  await cancelScheduledByType(Notifications, ['dinner_reminder']);

  if (!enabled || !content) return { scheduled: false };

  // It's about *tonight* — skip if 17:30 has already passed today.
  const at = new Date();
  at.setHours(17, 30, 0, 0);
  if (at.getTime() <= Date.now()) return { scheduled: false };

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return { scheduled: false };

  await configureNotificationChannels();

  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      sound: true,
      data: { type: 'dinner_reminder' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: 'card-reminders',
    } as any,
  });
  await AsyncStorage.setItem(DINNER_ID_KEY, identifier).catch(() => undefined);
  return { scheduled: true };
}

const RECAP_ID_KEY = 'coo_sunday_recap_id';

/**
 * Sent by the server now (see DAILY_PUSH_JOBS). Kept to cancel what an older
 * build scheduled — see syncDinnerReminder for why. Called with (false, null).
 */
export async function syncSundayRecap(
  enabled: boolean,
  content: { title: string; body: string } | null
) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return { scheduled: false };

  const previous = await AsyncStorage.getItem(RECAP_ID_KEY).catch(() => null);
  if (previous) {
    await Notifications.cancelScheduledNotificationAsync(previous).catch(() => undefined);
    await AsyncStorage.removeItem(RECAP_ID_KEY).catch(() => undefined);
  }
  await cancelScheduledByType(Notifications, ['sunday_recap']);

  if (!enabled || !content) return { scheduled: false };

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return { scheduled: false };

  await configureNotificationChannels();

  // The next Sunday at 18:00 local (today if it's Sunday and 18:00 is still ahead).
  const at = new Date();
  at.setHours(18, 0, 0, 0);
  let add = (7 - at.getDay()) % 7;
  if (add === 0 && at.getTime() <= Date.now()) add = 7;
  at.setDate(at.getDate() + add);

  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      sound: true,
      data: { type: 'sunday_recap' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: 'card-reminders',
    } as any,
  });
  await AsyncStorage.setItem(RECAP_ID_KEY, identifier).catch(() => undefined);
  return { scheduled: true };
}

const CAL_NIGHTLY_ID_KEY = 'coo_calendar_nightly_id';

/**
 * Sent by the server now (see DAILY_PUSH_JOBS). It used to be rescheduled on
 * each Calendar open, which meant it only existed for someone who opened that
 * tab that day. Kept to cancel what an older build left behind: (false, null).
 */
export async function syncCalendarNightly(
  enabled: boolean,
  content: { title: string; body: string } | null
) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return { scheduled: false };

  const previous = await AsyncStorage.getItem(CAL_NIGHTLY_ID_KEY).catch(() => null);
  if (previous) {
    await Notifications.cancelScheduledNotificationAsync(previous).catch(() => undefined);
    await AsyncStorage.removeItem(CAL_NIGHTLY_ID_KEY).catch(() => undefined);
  }
  await cancelScheduledByType(Notifications, ['calendar_nightly']);

  if (!enabled || !content) return { scheduled: false };

  const at = new Date();
  at.setHours(20, 15, 0, 0);
  if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return { scheduled: false };

  await configureNotificationChannels();

  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      sound: true,
      data: { type: 'calendar_nightly' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: 'card-reminders',
    } as any,
  });
  await AsyncStorage.setItem(CAL_NIGHTLY_ID_KEY, identifier).catch(() => undefined);
  return { scheduled: true };
}

export async function sendTestScheduledReminderNotification() {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return false;

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return false;

  await configureNotificationChannels();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Ahenora reminder test',
      body: 'This reminder was scheduled 5 seconds ago.',
      sound: true,
      data: { type: 'scheduled_reminder_test' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
      channelId: 'card-reminders',
    } as any,
  });

  return true;
}

export async function sendLocalNotification(title: string, body: string) {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return false;

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return false;

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      data: { type: 'local_test' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 1,
      channelId: 'household-alerts',
    } as any,
  });

  return true;
}
