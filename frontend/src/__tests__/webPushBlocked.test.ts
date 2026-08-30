/**
 * Why the web app cannot turn browser notifications on.
 *
 * Reported by a real co-parent: every notification toggle switched ON in the
 * web app on an iPhone, and not one notification ever arrived. The toggles are
 * stored server-side, so they looked right; what was missing was a push
 * subscription, which Safari refuses to create for a plain tab. The app said
 * nothing, so the switch promised something the browser would never do.
 */
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }), { virtual: true });
jest.mock('../api', () => ({ api: {} }), { virtual: true });
jest.mock('../logger', () => ({ logger: { warn: jest.fn() } }), { virtual: true });

import { webPushBlockedReason } from '../webpush';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126';

function browser(opts: {
  ua: string; push?: boolean; sw?: boolean; standalone?: boolean;
  permission?: NotificationPermission;
}) {
  const nav: any = { userAgent: opts.ua, maxTouchPoints: 0 };
  if (opts.sw ?? opts.push) nav.serviceWorker = {};
  if (opts.standalone) nav.standalone = true;
  (global as any).navigator = nav;

  const win: any = { matchMedia: () => ({ matches: !!opts.standalone }) };
  if (opts.push) win.PushManager = function () {};
  if (opts.push) win.Notification = { permission: opts.permission ?? 'default' };
  (global as any).window = win;
  (global as any).Notification = win.Notification;
}

describe('webPushBlockedReason', () => {
  afterEach(() => {
    delete (global as any).navigator;
    delete (global as any).window;
    delete (global as any).Notification;
  });

  it('names the Home Screen requirement on an iPhone tab', () => {
    // The whole reason this function exists: the person can fix it in two taps,
    // but only if we tell them.
    browser({ ua: IPHONE });
    expect(webPushBlockedReason()).toBe('ios-home-screen');
  });

  it('is satisfied once the same page runs from the Home Screen', () => {
    browser({ ua: IPHONE, push: true, standalone: true });
    expect(webPushBlockedReason()).toBe('ok');
  });

  it('does not blame the Home Screen when a browser simply cannot do push', () => {
    browser({ ua: CHROME });
    expect(webPushBlockedReason()).toBe('unsupported');
  });

  it('reports a refusal as a refusal, not as a missing feature', () => {
    browser({ ua: CHROME, push: true, permission: 'denied' });
    expect(webPushBlockedReason()).toBe('denied');
  });

  it('clears a capable browser that has not been asked yet', () => {
    browser({ ua: CHROME, push: true, permission: 'default' });
    expect(webPushBlockedReason()).toBe('ok');
  });

  it('treats a touch Mac as an iPad, because Safari reports it as one', () => {
    browser({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15' });
    (global as any).navigator.maxTouchPoints = 5;
    expect(webPushBlockedReason()).toBe('ios-home-screen');
  });
});
