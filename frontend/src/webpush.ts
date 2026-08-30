// Web Push on the web app — browser notifications that arrive with the tab
// closed. Native (Android) keeps using Expo push; this is the web-only path.
// Everything no-ops off-web or where the browser lacks the APIs, so it's safe to
// call from shared code.
import { Platform } from 'react-native';
import { api } from './api';
import { logger } from './logger';

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normal);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function supported(): boolean {
  return Platform.OS === 'web'
    && typeof navigator !== 'undefined' && 'serviceWorker' in navigator
    && typeof window !== 'undefined' && 'PushManager' in window && 'Notification' in window;
}

/**
 * `navigator.serviceWorker.ready` never rejects — if nothing ever registers in
 * this scope it simply hangs, which once froze the whole Settings screen. Race
 * it against a timeout so every caller is guaranteed to return.
 */
async function readyOrNull(ms = 5000): Promise<ServiceWorkerRegistration | null> {
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  } catch {
    return null;
  }
}

/**
 * Subscribe this browser to push. When `prompt` is false we only proceed if the
 * user has already granted permission (a quiet re-subscribe for a returning
 * user); when true we ask — so the Settings toggle can request it on a real tap,
 * which is what browsers require. Returns whether a subscription is now active.
 */
async function enableWebPush(prompt: boolean): Promise<WebPushBlock> {
  if (!supported()) return webPushBlockedReason();
  try {
    const cfg = await api.getWebPushConfig();
    if (!cfg.enabled || !cfg.vapid_public_key) return 'unconfigured';

    const reg = await readyOrNull();
    if (!reg) return 'no-worker';               // worker never registered here
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (Notification.permission === 'denied') return 'denied';
      if (Notification.permission === 'default') {
        if (!prompt) return 'not-asked';           // never auto-prompt on load
        const decision = await Notification.requestPermission();
        // 'default' here means the prompt was dismissed rather than refused —
        // reporting that as success is how the toggle came to say "reminders
        // are on" over no subscription at all.
        if (decision === 'denied') return 'denied';
        if (decision !== 'granted') return 'dismissed';
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(cfg.vapid_public_key) as BufferSource,
      });
    }
    await api.webPushSubscribe(sub.toJSON());
    return 'ok';
  } catch (e) {
    logger.warn('web push enable failed', e);
    return 'failed';
  }
}

/**
 * Why browser notifications cannot be turned on here — or 'ok' if they can.
 *
 * This exists because of a real report: a co-parent on an iPhone had every
 * notification toggle switched ON in the web app and never received a single
 * notification. The toggles are stored server-side and looked correct; what was
 * missing was a push SUBSCRIPTION, which Safari on iOS refuses to create unless
 * the site has been added to the Home Screen. `supported()` returned false and
 * we said nothing, so the UI promised something the browser would never deliver.
 *
 * 'ios-home-screen' is the actionable one: the person can fix it in two taps,
 * but only if we tell them.
 */
export type WebPushBlock =
  | 'ok'
  | 'ios-home-screen'   // Safari on a plain iPhone tab: fixable in two taps
  | 'denied'            // the browser was asked and said no
  | 'dismissed'         // the prompt was closed without an answer
  | 'not-asked'         // capable, but nobody has asked yet
  | 'unconfigured'      // the server has no VAPID keys
  | 'no-worker'         // the service worker never registered in this scope
  | 'failed'            // subscribe threw
  | 'unsupported';      // this browser cannot do push at all

export function webPushBlockedReason(): WebPushBlock {
  if (Platform.OS !== 'web') return 'ok';           // native has its own path
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  if (supported()) {
    return typeof Notification !== 'undefined' && Notification.permission === 'denied'
      ? 'denied' : 'ok';
  }
  // iOS and iPadOS: every browser is Safari underneath, and none of them expose
  // PushManager to a plain tab. Added to the Home Screen, the same page does.
  const ua = navigator.userAgent || '';
  const isApple = /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
  const standalone = (navigator as any).standalone === true
    || (typeof window.matchMedia === 'function'
        && window.matchMedia('(display-mode: standalone)').matches);
  if (isApple && !standalone) return 'ios-home-screen';
  return 'unsupported';
}

/** Quiet re-subscribe on sign-in — only if permission is already granted. */
export const setupWebPush = () => enableWebPush(false);

/**
 * Turn browser notifications on from a user tap (Settings) — may prompt.
 * Returns WHY it could not, rather than a bare false: every one of these
 * reasons used to surface to the user as "Reminder alerts are on".
 */
export const requestWebPush = () => enableWebPush(true);

/** Drop this browser's subscription — on sign-out. */
export async function teardownWebPush(): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await readyOrNull();
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.webPushUnsubscribe(sub.endpoint).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
  } catch (e) {
    logger.warn('web push teardown failed', e);
  }
}
