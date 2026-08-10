import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { RefreshCw } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

/**
 * "There's a new update — refresh your page."
 *
 * The native apps pull updates over the air and restart into them. The web app
 * cannot: a browser tab keeps running whatever JavaScript it loaded until
 * somebody reloads it, so an iOS user who leaves the app open on a home-screen
 * shortcut can sit on a build from days ago and never know. Every fix we ship
 * is invisible to them until they happen to reload for unrelated reasons.
 *
 * Detection needs no build step and no server support. Expo's web export names
 * the entry bundle after a hash of its contents — `entry-<hash>.js` — so the
 * filename changes if and only if the code changed. This reads the filename the
 * page is currently running, re-fetches the deployed index.html past the cache,
 * and compares. Different hash, different deploy.
 */

const POLL_MS = 5 * 60 * 1000;
const ENTRY_RE = /entry-([a-z0-9]+)\.js/i;

/** The entry bundle this tab is running, taken from its own <script> tags. */
function runningEntry(): { hash: string; base: string } | null {
  if (typeof document === 'undefined') return null;
  const srcs = Array.from(document.getElementsByTagName('script'))
    .map((s) => s.getAttribute('src') || '');
  const src = srcs.find((s) => ENTRY_RE.test(s));
  if (!src) return null;
  const hash = src.match(ENTRY_RE)?.[1];
  if (!hash) return null;
  // Everything before /_expo/ is where the app is served from, so the check
  // works under a sub-path (this app lives at /Ahenora/app) without
  // hardcoding it.
  const base = src.split('/_expo/')[0] || '';
  return { hash, base };
}

export function useWebUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  // Captured once: comparing against a moving value would never report a diff.
  const runningRef = useRef<ReturnType<typeof runningEntry>>(null);
  if (runningRef.current === null) runningRef.current = runningEntry();

  const check = useCallback(async () => {
    const running = runningRef.current;
    if (!running) return;
    try {
      // Cache-busted and no-store: the whole point is to see past the copy the
      // browser is holding, which is the same copy that is out of date.
      const res = await fetch(`${running.base}/index.html?_=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const html = await res.text();
      const deployed = html.match(ENTRY_RE)?.[1];
      if (deployed && deployed !== running.hash) setAvailable(true);
    } catch {
      // Offline, or the host is briefly unreachable mid-deploy. Staying quiet
      // is right: a failed check is not evidence of a new version.
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || __DEV__ || !runningRef.current) return;
    let cancelled = false;
    const run = () => { if (!cancelled && !available) check(); };

    // A tab coming back to the foreground is the moment a stale build is most
    // likely and the user is most willing to reload.
    const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) run(); };
    const timer = setInterval(run, POLL_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    run();

    return () => {
      cancelled = true;
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check, available]);

  return available;
}

export function WebUpdateBanner() {
  const ui = useUI();
  const { t } = useStore();
  const available = useWebUpdateAvailable();
  const [dismissed, setDismissed] = useState(false);
  const styles = createStyles(ui);

  if (Platform.OS !== 'web' || !available || dismissed) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        <RefreshCw color={ui.orangeText} size={16} />
        <Text style={styles.text} numberOfLines={2}>{t('web_update_available')}</Text>
        <PressScale
          testID="web-update-refresh"
          accessibilityRole="button"
          accessibilityLabel={t('web_update_refresh')}
          onPress={() => {
            if (typeof window !== 'undefined') window.location.reload();
          }}
          style={styles.btn}
        >
          <Text style={styles.btnText}>{t('web_update_refresh')}</Text>
        </PressScale>
        <PressScale
          testID="web-update-dismiss"
          accessibilityRole="button"
          accessibilityLabel={t('close')}
          onPress={() => setDismissed(true)}
          hitSlop={10}
          style={styles.dismiss}
        >
          <Text style={styles.dismissText}>✕</Text>
        </PressScale>
      </View>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  // Pinned to the top so it is seen without covering the tab bar, and
  // box-none so it never swallows a tap meant for the page behind it.
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 10, paddingHorizontal: 12, zIndex: 1000 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    maxWidth: 620, width: '100%',
    backgroundColor: ui.orangeSoft, borderWidth: 1, borderColor: ui.orange,
    borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14,
  },
  text: { flex: 1, minWidth: 0, color: ui.orangeText, fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18 },
  btn: { backgroundColor: ui.orangeDeep, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14 },
  btnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
  dismiss: { padding: 2 },
  dismissText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 13 },
});
