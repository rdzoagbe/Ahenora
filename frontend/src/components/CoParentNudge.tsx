import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Users, X, ArrowRight } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { useUI, UIColors } from './Kit';

const DISMISS_KEY = 'coo_coparent_nudge_dismissed';

interface Props {
  /** True while the household is still solo (only the current user). */
  visible: boolean;
  onInvite: () => void;
}

/**
 * The growth+retention lever for a family app: a joined co-parent turns a solo
 * user (who churns) into a shared household (which sticks). Shown on the Feed
 * only while the household is solo, and it vanishes the moment someone joins.
 * Dismissible for genuine single parents, who can still invite from Settings.
 */
export function CoParentNudge({ visible, onInvite }: Props) {
  const { t } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  // null = still reading the flag (avoid a flash); false = show; true = hidden.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(DISMISS_KEY).then((v) => setDismissed(v === '1')).catch(() => setDismissed(false));
  }, []);

  if (!visible || dismissed !== false) return null;

  const dismiss = () => {
    setDismissed(true);
    AsyncStorage.setItem(DISMISS_KEY, '1').catch(() => {});
  };

  return (
    <View style={styles.card}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={t('close')}
        testID="cp-nudge-dismiss"
        onPress={dismiss}
        hitSlop={8}
        style={styles.dismiss}
      >
        <X color={ui.muted} size={16} />
      </PressScale>

      <View style={styles.iconTile}><Users color={ui.orange} size={20} /></View>
      <Text style={styles.title}>{t('cp_nudge_title')}</Text>
      <Text style={styles.body}>{t('cp_nudge_body')}</Text>

      <PressScale
        testID="cp-nudge-invite"
        accessibilityRole="button"
        accessibilityLabel={t('cp_nudge_cta')}
        onPress={onInvite}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>{t('cp_nudge_cta')}</Text>
        <ArrowRight color="#fff" size={16} />
      </PressScale>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  card: { borderRadius: 20, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.orangeSoft, padding: 16, marginBottom: 16 },
  dismiss: { position: 'absolute', top: 10, right: 10, padding: 6, zIndex: 1 },
  iconTile: { width: 44, height: 44, borderRadius: 13, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 18, letterSpacing: -0.3 },
  body: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginTop: 5, marginBottom: 14 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: ui.orange, paddingVertical: 13, borderRadius: 14 },
  ctaText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
