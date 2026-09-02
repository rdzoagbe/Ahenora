import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Scale, ChevronRight } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { api, SettlementInfo } from '../api';
import { shouldShowBalance } from '../coParentBalance';
import { logger } from '../logger';

/**
 * "Keigh owes you €62", on the screen people actually open.
 *
 * The balance itself was built long ago — the server works out who is up on the
 * shared expenses, and there is a settle-up button. It lived at the bottom of
 * the spending view, which lives inside the Kitchen tab, below two months of
 * charts. So the one number two separated parents genuinely want from this app
 * was four taps and a scroll away, behind a tab about food.
 *
 * This is not a second balance. It is the same endpoint, read-only, on the
 * Feed, and tapping it goes to the place where it can be settled.
 *
 * Shows nothing at all unless the household is exactly two parents who have
 * actually split something — an empty "€0.00" on every family's home screen
 * would be noise for the many to serve the few.
 */
export function CoParentBalance() {
  const ui = useUI();
  const { t } = useStore();
  const router = useRouter();
  const styles = createStyles(ui);
  const [info, setInfo] = useState<SettlementInfo | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api.getSettlement());
    } catch (e) {
      // A household with one parent, or a server that predates this, simply
      // shows nothing. Never an error on the home screen.
      logger.warn('settlement load failed', e);
      setInfo(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!info || !shouldShowBalance(info)) return null;

  const owed = info.balance > 0.005;
  const owing = info.balance < -0.005;
  const amount = Math.abs(info.balance).toFixed(2);
  const name = info.other_name || '';

  return (
    <PressScale
      testID="feed-coparent-balance"
      accessibilityRole="button"
      onPress={() => router.push('/expenses' as never)}
      style={styles.card}
    >
      <View style={[styles.icon, owing && { backgroundColor: ui.orangeSoft }]}>
        <Scale color={owing ? ui.orangeText : ui.mintText} size={17} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={2}>
          {owed
            ? t('exp_settle_owes_you', { name, amount: `${amount} €` })
            : owing
              ? t('exp_settle_you_owe', { name, amount: `${amount} €` })
              : t('exp_settle_square', { name })}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {t('coparent_balance_sub', { n: info.shared_count ?? 0 })}
        </Text>
      </View>
      <ChevronRight color={ui.muted} size={18} />
    </PressScale>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line,
    paddingVertical: 14, paddingHorizontal: 14, marginBottom: 16,
  },
  icon: {
    width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ui.mint,
  },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 14.5, letterSpacing: -0.2 },
  sub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
});
