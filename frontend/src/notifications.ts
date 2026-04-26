import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { Card } from './api';

const REMINDER_IDS_KEY = 'coo_scheduled_card_reminder_ids';
const EXPO_GO_ANDROID_MESSAGE =
  'Notifications are disabled in Expo Go on Android. Use a development build to test notifications.';

let notificationHandlerConfigured = false;

function isExpoGoAndroid() {
  return Platform.OS === 'android' && Constants.appOwnership === 'expo';
}

async function getNotificationsModule(): Promise<any | null> {
  if (isExpoGoAndroid()) return null;

  const Notifications = await import('expo-notifications');

  if (!notificationHandlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
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

export async function cancelAllCardReminderNotifications() {
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

export async function syncCardReminderNotifications(cards: Card[], enabled: boolean) {
  if (!enabled) {
    await cancelAllCardReminderNotifications();
    return { scheduled: 0 };
  }

  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return { scheduled: 0, skipped: true, reason: 'expo_go_android_not_supported' };
  }

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') {
    return { scheduled: 0, skipped: true, reason: 'permission_not_granted' };
  }

  await configureNotificationChannels();
  await cancelAllCardReminderNotifications();

  const nextMap: Record<string, string> = {};
  const now = Date.now();

  for (const card of cards) {
    if (card.status !== 'OPEN') continue;
    if (!card.due_date) continue;

    const reminderMinutes = card.reminder_minutes ?? 0;
    if (reminderMinutes <= 0) continue;

    const due = new Date(card.due_date).getTime();
    if (!Number.isFinite(due)) continue;

    const triggerAt = due - reminderMinutes * 60 * 1000;
    if (triggerAt <= now + 30 * 1000) continue;

    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Household COO reminder',
        body: card.title,
        sound: true,
        data: {
          type: 'card_reminder',
          card_id: card.card_id,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(triggerAt),
        channelId: 'card-reminders',
      } as any,
    });

    nextMap[card.card_id] = identifier;
  }

  await setReminderMap(nextMap);

  return { scheduled: Object.keys(nextMap).length };
}

export async function sendTestScheduledReminderNotification() {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return false;

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return false;

  await configureNotificationChannels();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Household COO reminder test',
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
