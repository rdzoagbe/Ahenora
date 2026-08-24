import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Sparkles, X, ChevronRight } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useUI } from './Kit';
import { useStore } from '../store';

// A gentle, dismissible nudge toward Premium — shown only to free households.
// Not a paywall: it never blocks anything, it just keeps Premium in view for
// someone who has never seen what it offers. Dismissing it snoozes it, so it
// asks once in a while rather than every single open.
const SNOOZE_KEY = 'coo_upgrade_banner_snoozed_until';
const SNOOZE_DAYS = 7;

export function UpgradeBanner() {
  const { t, subscription, user } = useStore();
  const ui = useUI();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [snoozed, setSnoozed] = useState(true);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(SNOOZE_KEY)
      .then((v) => {
        if (!alive) return;
        const until = v ? Number(v) : 0;
        setSnoozed(!!until && until > Date.now());
      })
      .catch(() => { if (alive) setSnoozed(false); })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // Only free households, only once loaded, never for admins (they read as
  // Premium anyway), never while snoozed.
  const isFree = !subscription || subscription.plan === 'village';
  if (!ready || snoozed || !isFree || user?.is_admin) return null;

  const dismiss = () => {
    setSnoozed(true);
    AsyncStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400_000)).catch(() => undefined);
  };

  return (
    <PressScale
      testID="upgrade-banner"
      onPress={() => router.push('/pricing')}
      style={[styles.banner, { backgroundColor: ui.orangeSoft, borderColor: ui.orange }]}
    >
      <View style={[styles.iconWrap, { backgroundColor: ui.orange }]}>
        <Sparkles color="#fff" size={16} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: ui.text }]} numberOfLines={1}>{t('upgrade_banner_title')}</Text>
        <Text style={[styles.sub, { color: ui.muted }]} numberOfLines={1}>{t('upgrade_banner_sub')}</Text>
      </View>
      <ChevronRight color={ui.orangeText} size={18} />
      <PressScale
        testID="upgrade-banner-dismiss"
        accessibilityLabel={t('close')}
        onPress={dismiss}
        style={styles.dismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <X color={ui.muted} size={15} />
      </PressScale>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 10,
    marginBottom: 14,
  },
  iconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 14.5 },
  sub: { fontFamily: 'Inter_500Medium', fontSize: 12.5 },
  dismiss: { padding: 3, marginLeft: 2 },
});
