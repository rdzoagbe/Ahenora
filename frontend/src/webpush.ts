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
async function enableWebPush(prompt: boolean): Promise<boolean> {
  if (!supported()) return false;
  try {
    const cfg = await api.getWebPushConfig();
    if (!cfg.enabled || !cfg.vapid_public_key) return false;

    const reg = await readyOrNull();
    if (!reg) return false;                     // worker never registered here
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      if (Notification.permission === 'denied') return false;
      if (Notification.permission === 'default') {
        if (!prompt) return false;                 // never auto-prompt on load
        const decision = await Notification.requestPermission();
        if (decision !== 'granted') return false;
      }
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(cfg.vapid_public_key) as BufferSource,
      });
    }
    await api.webPushSubscribe(sub.toJSON());
    return true;
  } catch (e) {
    logger.warn('web push enable failed', e);
    return false;
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
export type WebPushBlock = 'ok' | 'ios-home-screen' | 'denied' | 'unsupported';

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

/** Turn browser notifications on from a user tap (Settings) — may prompt. */
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
