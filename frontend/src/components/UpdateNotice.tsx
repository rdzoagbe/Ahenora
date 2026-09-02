import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { RefreshCw, Sparkles, Store } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { api } from '../api';
import { WHATS_NEW } from '../whatsNew';
import { logger } from '../logger';

/**
 * Telling people an update happened.
 *
 * Updates used to arrive in silence. Over-the-air ones download in the
 * background and apply on the NEXT launch, so from the outside a fix that
 * shipped looks exactly like a fix that did not — you close the app, reopen
 * it, and the old screen is still there. And an install whose runtime is too
 * old cannot receive them at all, so it waits forever for something that will
 * never come. Neither state said anything.
 *
 * Three things can be true, and only one is ever shown:
 *
 *   1. STORE   — this build cannot be updated over the air. Only a store
 *                install moves it, so that is what it asks for.
 *   2. RELAUNCH— a new bundle is downloaded and waiting. One tap applies it.
 *   3. WHATS_NEW — the version changed since last launch. Say what changed and
 *                where to find it, once.
 *
 * Ranked in that order because each is more urgent than the one below it, and
 * shown one at a time: three stacked notices is a nag bar, and people learn to
 * dismiss those without reading. Every one is dismissible, and none of them
 * interrupts — they sit at the top of the screen, not over the work.
 */

const SEEN_VERSION_KEY = 'coo_seen_app_version';
/**
 * The staged update this device has already been told about.
 *
 * Dismissal used to live in component state, so it lasted exactly as long as
 * the screen did. A staged update stays staged until the app actually
 * relaunches — so anyone who closed the banner instead of tapping Relaunch was
 * shown the same notice about the same update every single time they opened
 * the app, which reads as "it keeps saying there's an update when there isn't".
 * There was one; it just had not been applied, and saying so on a loop is how a
 * banner teaches people to ignore banners.
 *
 * Keyed by the update's own id, so this silences THAT update and nothing else:
 * the next one published still gets its say.
 */
const DISMISSED_UPDATE_KEY = 'coo_dismissed_update_id';

type Notice = 'store' | 'relaunch' | 'whatsNew' | null;

/** "2.0.0" < "10.0.0" — compared as numbers, not strings. */
function isBelow(version: string, minimum: string): boolean {
  const a = version.split('.').map((n) => parseInt(n, 10) || 0);
  const b = minimum.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

export function UpdateNotice() {
  const ui = useUI();
  const { t } = useStore();
  const insets = useSafeAreaInsets();
  const styles = createStyles(ui);

  const { isUpdatePending, downloadedUpdate } = Updates.useUpdates();
  const [notice, setNotice] = useState<Notice>(null);
  const [dismissed, setDismissed] = useState(false);
  const [mutedUpdateId, setMutedUpdateId] = useState<string | null>(null);
  const pendingUpdateId = downloadedUpdate?.updateId ?? null;
  const [storeUrl, setStoreUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const version = Constants.expoConfig?.version || '';

  // Which of the three, decided once on mount. The store check needs the
  // server's opinion; the "what's new" check needs what this device saw last.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Only native builds can be stranded — the web app reloads itself and
        // has its own banner for that.
        if (Platform.OS !== 'web' && Updates.isEnabled) {
          const info = await api.appVersionInfo().catch(() => null);
          const runtime = Updates.runtimeVersion || '';
          if (!cancelled && info?.min_runtime && runtime && isBelow(runtime, info.min_runtime)) {
            setStoreUrl(info.android_store_url || null);
            setNotice('store');
            return;
          }
        }

        const seen = await AsyncStorage.getItem(SEEN_VERSION_KEY).catch(() => null);
        if (cancelled) return;
        // A first run records the version without announcing it: "what's new"
        // to somebody who has never seen the old one is just noise.
        if (!seen) {
          await AsyncStorage.setItem(SEEN_VERSION_KEY, version).catch(() => undefined);
          return;
        }
        if (seen !== version && WHATS_NEW[version]?.length) setNotice('whatsNew');
      } catch (e) {
        logger.warn('update notice check failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [version]);

  // Which staged update this device has already declined, read once. Null while
  // it loads, which is why the banner waits for it below rather than flashing
  // up and disappearing.
  const [muteLoaded, setMuteLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DISMISSED_UPDATE_KEY)
      .then((value) => { if (!cancelled) setMutedUpdateId(value); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setMuteLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // A staged update outranks "what's new" — applying it is the useful action,
  // and the notes it would show are for the version about to be replaced.
  // A staged update the person has already waved away is not news the second
  // time. Anything without an id (a rollback directive) can still speak, since
  // there is nothing to remember it by.
  const relaunchMuted = !!pendingUpdateId && pendingUpdateId === mutedUpdateId;
  const shown: Notice = notice === 'store'
    ? 'store'
    : (isUpdatePending && !relaunchMuted ? 'relaunch' : notice);

  const dismiss = useCallback(async () => {
    setDismissed(true);
    if (shown === 'whatsNew') {
      await AsyncStorage.setItem(SEEN_VERSION_KEY, version).catch(() => undefined);
    }
    if (shown === 'relaunch' && pendingUpdateId) {
      setMutedUpdateId(pendingUpdateId);
      await AsyncStorage.setItem(DISMISSED_UPDATE_KEY, pendingUpdateId).catch(() => undefined);
    }
  }, [shown, version, pendingUpdateId]);

  const act = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (shown === 'store' && storeUrl) { await Linking.openURL(storeUrl); return; }
      if (shown === 'relaunch') { await Updates.reloadAsync(); return; }
      await dismiss();
    } catch (e) {
      logger.warn('update notice action failed', e);
    } finally {
      setBusy(false);
    }
  }, [busy, shown, storeUrl, dismiss]);

  // Waiting on the muted id rather than rendering without it: showing the
  // banner and then yanking it away is worse than a beat of nothing.
  if (!shown || dismissed || !muteLoaded) return null;

  const copy = {
    store: { title: t('update_store_title'), body: t('update_store_body'), cta: t('update_store_cta'), Icon: Store },
    relaunch: { title: t('update_relaunch_title'), body: t('update_relaunch_body'), cta: t('update_relaunch_cta'), Icon: RefreshCw },
    whatsNew: { title: t('update_whats_new_title', { version }), body: '', cta: t('update_whats_new_cta'), Icon: Sparkles },
  }[shown];

  return (
    // Below the status bar, not under it. Without the inset this sat over the
    // clock and the notch, which is both unreadable and reads as a system
    // notification rather than something the app is saying.
    <View style={[styles.wrap, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.head}>
          <copy.Icon color={ui.orangeText} size={17} />
          <Text style={styles.title} numberOfLines={2}>{copy.title}</Text>
          <PressScale
            testID="update-notice-dismiss"
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={dismiss}
            hitSlop={10}
            style={styles.x}
          >
            <Text style={styles.xText}>✕</Text>
          </PressScale>
        </View>

        {shown === 'whatsNew' ? (
          // Written for a parent, not a changelog: what changed and which tab
          // to look on. A list of fixes nobody can act on is not news.
          <View style={styles.list}>
            {(WHATS_NEW[version] || []).map((key) => (
              <Text key={key} style={styles.item}>• {t(key)}</Text>
            ))}
          </View>
        ) : (
          <Text style={styles.body}>{copy.body}</Text>
        )}

        <PressScale
          testID="update-notice-action"
          accessibilityRole="button"
          onPress={act}
          disabled={busy}
          style={styles.btn}
        >
          <Text style={styles.btnText}>{copy.cta}</Text>
        </PressScale>
      </View>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 12, zIndex: 999 },
  // A card belonging to the app, not a toast laid over it: the app's own card
  // background and border, its corner radius, and a shadow so it reads as
  // sitting ON the page rather than floating above the operating system.
  card: {
    width: '100%', maxWidth: 620,
    backgroundColor: ui.card, borderWidth: 1, borderColor: ui.orange,
    borderRadius: 20, padding: 16, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  // Reads at arm's length. The old 13-14px Medium in accent-on-accent was
  // technically legible and practically not, which is what "unclear to read"
  // meant: body copy goes to the normal ink, and only the heading stays accent.
  title: { flex: 1, minWidth: 0, color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 16, lineHeight: 22 },
  body: { color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 14.5, lineHeight: 21 },
  list: { gap: 7 },
  item: { color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 14.5, lineHeight: 21 },
  btn: { alignSelf: 'flex-start', backgroundColor: ui.orangeDeep, borderRadius: 999, paddingVertical: 11, paddingHorizontal: 18, marginTop: 4 },
  btnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  x: { padding: 4 },
  xText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 15 },
});
