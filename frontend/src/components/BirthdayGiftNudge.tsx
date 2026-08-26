import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Gift, X, ArrowRight } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { useUI, UIColors } from './Kit';

interface Props {
  /** The soonest upcoming BIRTHDAY card, or null. */
  cardId: string | null;
  title: string;
  /** Whole days until the birthday (0 = today). */
  days: number;
  onOpen: () => void;
}

/**
 * The occasion-driven entry point to the Gift Pot. When a birthday is within a
 * fortnight, this quietly offers to pool for one shared gift. Dismissible per
 * birthday (keyed by card id) so waving it away doesn't nag again for the same
 * one — but a different birthday still surfaces. Mirrors CoParentNudge.
 */
export function BirthdayGiftNudge({ cardId, title, days, onOpen }: Props) {
  const { t } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  // null = still reading the flag; false = show; true = hidden.
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const key = cardId ? `coo_bday_pot_dismissed_${cardId}` : null;

  useEffect(() => {
    if (!key) { setDismissed(true); return; }
    AsyncStorage.getItem(key).then((v) => setDismissed(v === '1')).catch(() => setDismissed(false));
  }, [key]);

  if (!cardId || dismissed !== false) return null;

  const dismiss = () => {
    setDismissed(true);
    if (key) AsyncStorage.setItem(key, '1').catch(() => {});
  };

  const when = days <= 0 ? t('bday_pot_today') : t('bday_pot_in_days', { n: String(days) });

  return (
    <View style={styles.card}>
      <PressScale
        accessibilityRole="button"
        accessibilityLabel={t('close')}
        testID="bday-nudge-dismiss"
        onPress={dismiss}
        hitSlop={8}
        style={styles.dismiss}
      >
        <X color={ui.muted} size={16} />
      </PressScale>

      <View style={styles.topRow}>
        <View style={styles.iconTile}><Gift color={ui.orange} size={20} /></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>🎂 {title}</Text>
          <Text style={styles.when}>{when}</Text>
        </View>
      </View>
      <Text style={styles.body}>{t('bday_pot_body')}</Text>

      <PressScale
        testID="bday-nudge-open"
        accessibilityRole="button"
        accessibilityLabel={t('bday_pot_cta')}
        onPress={onOpen}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>{t('bday_pot_cta')}</Text>
        <ArrowRight color="#fff" size={16} />
      </PressScale>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  card: { borderRadius: 20, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.orangeSoft, padding: 16, marginBottom: 16 },
  dismiss: { position: 'absolute', top: 10, right: 10, padding: 6, zIndex: 1 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingRight: 20 },
  iconTile: { width: 44, height: 44, borderRadius: 13, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 16, letterSpacing: -0.3 },
  when: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 12.5, marginTop: 2 },
  body: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginTop: 10, marginBottom: 14 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: ui.orange, paddingVertical: 13, borderRadius: 14 },
  ctaText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
