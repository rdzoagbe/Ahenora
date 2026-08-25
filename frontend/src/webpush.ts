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

    const reg = await navigator.serviceWorker.ready;
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

/** Quiet re-subscribe on sign-in — only if permission is already granted. */
export const setupWebPush = () => enableWebPush(false);

/** Turn browser notifications on from a user tap (Settings) — may prompt. */
export const requestWebPush = () => enableWebPush(true);

/** Drop this browser's subscription — on sign-out. */
export async function teardownWebPush(): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.webPushUnsubscribe(sub.endpoint).catch(() => undefined);
      await sub.unsubscribe().catch(() => undefined);
    }
  } catch (e) {
    logger.warn('web push teardown failed', e);
  }
}
