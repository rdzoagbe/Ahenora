/**
 * The notification a signed-out phone can still get.
 *
 * The reported symptom: no morning notifications, no error, nothing — the
 * session had expired overnight. A signed-out device has no session, so the
 * server cannot (and must not) push household content to it. What it CAN have
 * is a local, content-free notification left behind on the way out.
 */

process.env.EXPO_PUBLIC_BACKEND_URL = 'https://test-backend.example.com';
// react-native defines this globally at runtime; the logger reads it.
(global as any).__DEV__ = false;

const mockAsyncStorage = {
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: mockAsyncStorage,
}));

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { appOwnership: 'standalone', expoConfig: { version: '1.0.0', extra: {} } },
}));

const mockNotifications: any = {
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('sched-1'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  AndroidImportance: { HIGH: 4, LOW: 2 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
};
jest.mock('expo-notifications', () => mockNotifications, { virtual: true });

import { scheduleSignedOutReminder, cancelSignedOutReminder } from '../notifications';
import { SUPPORTED_LANGS, translate } from '../i18n';

const COPY = { title: 'You are signed out', body: 'Reminders are paused.' };

describe('scheduleSignedOutReminder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    mockNotifications.scheduleNotificationAsync.mockResolvedValue('sched-1');
  });

  it('schedules one notification and remembers its id', async () => {
    const res = await scheduleSignedOutReminder(COPY);

    expect(res).toEqual({ scheduled: true });
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
      'coo_signed_out_reminder_id',
      'sched-1'
    );
  });

  it('carries no household content — only the copy it was handed', async () => {
    // The whole reason this is allowed to reach a signed-out device.
    await scheduleSignedOutReminder(COPY);

    const arg = mockNotifications.scheduleNotificationAsync.mock.calls[0][0];
    expect(arg.content.title).toBe(COPY.title);
    expect(arg.content.body).toBe(COPY.body);
    expect(arg.content.data).toEqual({ type: 'signed_out' });
    // No card, no name, no household id anywhere in the payload.
    expect(Object.keys(arg.content.data)).toEqual(['type']);
  });

  it('fires at the next 08:00, in the future', async () => {
    await scheduleSignedOutReminder(COPY);

    const { date } = mockNotifications.scheduleNotificationAsync.mock.calls[0][0].trigger;
    expect(date.getHours()).toBe(8);
    expect(date.getMinutes()).toBe(0);
    expect(date.getTime()).toBeGreaterThan(Date.now());
    // ...and never further out than tomorrow morning.
    expect(date.getTime() - Date.now()).toBeLessThan(24 * 60 * 60 * 1000 + 1000);
  });

  it('does nothing when notification permission was never granted', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ status: 'denied' });

    expect(await scheduleSignedOutReminder(COPY)).toEqual({ scheduled: false });
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('replaces a previous reminder rather than stacking a second one', async () => {
    mockAsyncStorage.getItem.mockResolvedValue('old-id');

    await scheduleSignedOutReminder(COPY);

    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('old-id');
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('never throws — a failed schedule must not break signing out', async () => {
    mockNotifications.scheduleNotificationAsync.mockRejectedValue(new Error('no'));

    await expect(scheduleSignedOutReminder(COPY)).resolves.toEqual({ scheduled: false });
  });
});

describe('cancelSignedOutReminder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.getItem.mockResolvedValue(null);
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
  });

  it('cancels the tracked reminder and forgets its id', async () => {
    mockAsyncStorage.getItem.mockResolvedValue('sched-1');

    await cancelSignedOutReminder();

    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('sched-1');
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('coo_signed_out_reminder_id');
  });

  it('sweeps orphans whose id was lost, and leaves other types alone', async () => {
    // A sign-out that raced a sign-in, or a wiped storage key: the tray must
    // not keep telling somebody they are signed out once they are back in.
    mockNotifications.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'orphan', content: { data: { type: 'signed_out' } } },
      { identifier: 'digest', content: { data: { type: 'morning_digest' } } },
    ]);

    await cancelSignedOutReminder();

    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('orphan');
    expect(mockNotifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('digest');
  });

  it('never throws when there is nothing to cancel', async () => {
    await expect(cancelSignedOutReminder()).resolves.toBeUndefined();
  });
});

describe('the copy', () => {
  it('exists in every supported language and names no household detail', () => {
    for (const lang of SUPPORTED_LANGS) {
      const title = translate(lang, 'notif_signed_out_title');
      const body = translate(lang, 'notif_signed_out_body');
      expect(title).not.toBe('notif_signed_out_title');
      expect(body).not.toBe('notif_signed_out_body');
      expect(title.length).toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(0);
    }
  });
});
