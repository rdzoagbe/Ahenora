import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BellRing, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { useUI, UIColors } from './Kit';
import { pushPermissionGranted, requestAndRegisterPush } from '../notifications';

const DISMISS_KEY = 'coo_push_prompt_dismissed';

/**
 * The prompt nobody was ever shown.
 *
 * ensurePushRegistered has always run at launch and done the right thing — but
 * it returns immediately unless permission is ALREADY granted, and until now
 * the only place that ever asked was a toggle inside Settings. On Android 13
 * and later notifications are denied until an app requests them, so anyone who
 * never went hunting in Settings was never asked, never granted, and could not
 * be sent anything.
 *
 * Everything followed from that: an empty notification_tokens table, a server
 * that could push to nobody, and the only notifications anyone saw being LOCAL
 * ones — which exist only if the app happened to be open to schedule them.
 * "If I don't open the app I don't get the notification" was the symptom.
 *
 * Shown on the Feed rather than added to onboarding alone, because onboarding
 * only reaches people who arrive NEXT and the households already here are the
 * ones with no notifications. Dismissible: somebody who genuinely does not want
 * them should be able to say so once and not be asked again.
 */
export function NotificationsNudge() {
  const { t, user } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  // null while we are still finding out — avoids the card flashing in and out.
  const [needed, setNeeded] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Web push has its own path and its own constraints (Safari only offers
      // it to a site added to the Home Screen), so this card stays out of it.
      if (Platform.OS === 'web') { if (alive) setNeeded(false); return; }
      const dismissed = await AsyncStorage.getItem(DISMISS_KEY).catch(() => null);
      if (dismissed === '1') { if (alive) setNeeded(false); return; }
      const granted = await pushPermissionGranted();
      if (alive) setNeeded(!granted);
    })();
    return () => { alive = false; };
  }, []);

  if (needed !== true) return null;

  const ask = async () => {
    if (asking) return;
    setAsking(true);
    try {
      // Whether they say yes or no, the card has done its job and goes. The OS
      // will not ask twice, so leaving it up would only nag about something the
      // person can no longer change from here.
      await requestAndRegisterPush(!!user?.is_teen);
      setNeeded(false);
    } finally {
      setAsking(false);
    }
  };

  const dismiss = () => {
    setNeeded(false);
    AsyncStorage.setItem(DISMISS_KEY, '1').catch(() => {});
  };

  return (
    <View style={styles.card}>
      <PressScale
        testID="push-nudge-dismiss"
        accessibilityRole="button"
        accessibilityLabel={t('close')}
        onPress={dismiss}
        hitSlop={8}
        style={styles.dismiss}
      >
        <X color={ui.muted} size={16} />
      </PressScale>

      <View style={styles.iconTile}><BellRing color={ui.orange} size={20} /></View>
      <Text style={styles.title}>{t('push_nudge_title')}</Text>
      <Text style={styles.body}>{t('push_nudge_body')}</Text>
      <PressScale
        testID="push-nudge-enable"
        accessibilityRole="button"
        accessibilityLabel={t('push_nudge_cta')}
        onPress={ask}
        disabled={asking}
        style={[styles.cta, asking && styles.ctaOff]}
      >
        <Text style={styles.ctaText}>{t('push_nudge_cta')}</Text>
      </PressScale>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  card: {
    backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line,
    padding: 18, marginBottom: 14,
  },
  dismiss: { position: 'absolute', top: 12, right: 12, padding: 4, zIndex: 2 },
  iconTile: {
    width: 40, height: 40, borderRadius: 13, alignItems: 'center',
    justifyContent: 'center', backgroundColor: ui.orangeSoft, marginBottom: 12,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 17, color: ui.text, marginBottom: 6 },
  body: { fontFamily: 'Inter_500Medium', fontSize: 14, color: ui.muted, lineHeight: 20 },
  cta: {
    marginTop: 14, backgroundColor: ui.orange, borderRadius: 14, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaOff: { opacity: 0.6 },
  ctaText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#fff' },
});
