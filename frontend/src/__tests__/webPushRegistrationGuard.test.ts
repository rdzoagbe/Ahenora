/**
 * The web app must not report a developer error as a push failure.
 *
 * Found in the live device-error log, not in a test: every web session was
 * writing "You must provide `notification.vapidPublicKey` in `app.json`" into
 * the admin error list — Roland's own account, repeatedly, over days.
 *
 * getExpoPushTokenAsync is native-only. On web it throws that message, and two
 * callers in notifications.ts hand it straight to reportPushFailure. So the one
 * place a founder looks to find out whether the app is healthy was filling up
 * with a message about a config key the app does not need — browser push is a
 * Web Push subscription handled by webpush.ts, which gets its VAPID key from
 * the server.
 *
 * The Settings toggle had already been guarded for exactly this reason. The
 * guard now lives at the source instead, so the two unguarded callers and
 * whatever calls it next are covered too.
 *
 * What matters here is not that the call is skipped — it is that nothing is
 * REPORTED. An error log that cries wolf hides the failure you needed to see.
 */
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }), { virtual: true });

const reportPushFailure = jest.fn();
jest.mock('../api', () => ({
  api: {},
  reportPushFailure,
}), { virtual: true });
jest.mock('../logger', () => ({ logger: { warn: jest.fn(), info: jest.fn() } }), { virtual: true });
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}), { virtual: true });
jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'p' } } } }), { virtual: true });

// If the guard is missing, THIS is what gets called and throws the developer
// error — so the mock stands in for the native module and records the attempt.
const getExpoPushTokenAsync = jest.fn(async () => {
  throw new Error(
    'You must provide `notification.vapidPublicKey` in `app.json` to use push notifications on web.');
});
jest.mock('expo-notifications', () => ({
  getExpoPushTokenAsync,
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
}), { virtual: true });

import { registerForPushNotificationsAsync } from '../notifications';

describe('push registration on web', () => {
  beforeEach(() => {
    reportPushFailure.mockClear();
    getExpoPushTokenAsync.mockClear();
  });

  it('never asks Expo for a token', () => {
    // The call that cannot work is simply not made.
    return registerForPushNotificationsAsync().then(() => {
      expect(getExpoPushTokenAsync).not.toHaveBeenCalled();
    });
  });

  it('writes nothing to the device-error log', async () => {
    // The whole point. This log is where a real push failure would be seen,
    // and it was full of a message about a key the app does not use.
    await registerForPushNotificationsAsync();
    expect(reportPushFailure).not.toHaveBeenCalled();
  });

  it('does not hand back an error for the UI to show', async () => {
    // It used to be rendered verbatim, so a parent read a sentence about
    // app.json.
    const reg = await registerForPushNotificationsAsync();
    expect(reg.error).toBeUndefined();
  });

  it('does not claim web push is broken', async () => {
    // Nothing is wrong on web — browser push has its own path. Reporting
    // granted:false here would make the app say notifications are off while
    // webpush.ts had them on.
    const reg = await registerForPushNotificationsAsync();
    expect(reg.granted).toBe(true);
  });

  it('returns no Expo token, which is what callers key off', async () => {
    // Every caller treats a missing token as "not registered by this path",
    // which is exactly right on web.
    const reg = await registerForPushNotificationsAsync();
    expect(reg.expoPushToken).toBeUndefined();
  });
});
