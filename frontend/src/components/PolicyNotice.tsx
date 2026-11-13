/**
 * A change to the privacy policy, said once in the app.
 *
 * The policy promises: "We will announce material changes in the app before
 * they take effect". Roland chose, on 2026-11-10, to announce the Recently
 * deleted bin this way (deleted things are now kept up to 30 days). The card
 * shows on Home until it is acknowledged on this device; reading the policy
 * does not count as acknowledging it.
 *
 * For the next change, announce first (runbooks/privacy-changes.md has the
 * rule and the EU guidance it rests on):
 *   1. at least 30 days before the change, ship a new notice: a new
 *      POLICY_NOTICE_ID (any value not used before; the date it ships is
 *      fine) and its own wording (policy_notice_* in i18n) saying what will
 *      change, ON WHICH DATE, its likely effect, and what people can do;
 *   2. on that date, ship the change and the updated policy together;
 *   3. record both dates in runbooks/privacy-changes.md.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { ShieldCheck } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

/** The privacy policy's "updated" date this notice announces. */
export const POLICY_NOTICE_ID = '2026-11-10';
export const POLICY_NOTICE_KEY = 'coo_policy_notice_seen';

export default function PolicyNotice() {
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const { t } = useStore();
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(POLICY_NOTICE_KEY)
      .then((seen) => { if (live && seen !== POLICY_NOTICE_ID) setShow(true); })
      // Storage that cannot be read: say it rather than stay silent.
      .catch(() => { if (live) setShow(true); });
    return () => { live = false; };
  }, []);

  if (!show) return null;

  const acknowledge = () => {
    setShow(false);
    AsyncStorage.setItem(POLICY_NOTICE_KEY, POLICY_NOTICE_ID).catch(() => undefined);
  };

  return (
    <View style={styles.card} testID="policy-notice" accessibilityRole="summary">
      <View style={styles.head}>
        <ShieldCheck color={ui.orange} size={18} />
        <Text style={styles.title} accessibilityRole="header">{t('policy_notice_title')}</Text>
      </View>
      <Text style={styles.body}>{t('policy_notice_body')}</Text>
      <View style={styles.actions}>
        <PressScale testID="policy-notice-read" accessibilityRole="link"
          onPress={() => router.push('/privacy' as never)} style={styles.ghost}>
          <Text style={styles.ghostText}>{t('policy_notice_read')}</Text>
        </PressScale>
        <PressScale testID="policy-notice-ok" accessibilityRole="button" onPress={acknowledge} style={styles.primary}>
          <Text style={styles.primaryText}>{t('policy_notice_ok')}</Text>
        </PressScale>
      </View>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  card: {
    backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line,
    padding: 14, gap: 8, marginBottom: 14,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
  body: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 13.5, lineHeight: 19 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 2 },
  ghost: {
    height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: ui.line,
    backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center',
  },
  ghostText: { color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 13 },
  primary: {
    height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: ui.orangeDeep,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontFamily: 'Figtree_800ExtraBold', fontSize: 13 },
});
