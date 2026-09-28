/**
 * Before anyone moves DOWN a plan, they see exactly what changes.
 *
 * A family moving from Family to Duo with children in the app would otherwise
 * find the children's side gone the morning the renewal lands, with no idea
 * why. This says it first, in a list, and says the other thing that matters
 * just as much: nothing is deleted, and it all comes back if they move up.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Minus, X } from 'lucide-react-native';

import type { Plan } from '../api';
import { lossesFor } from '../planChange';
import { useStore } from '../store';
import KeyboardAwareBottomSheet from './KeyboardAwareBottomSheet';
import { useUI } from './Kit';
import { PressScale } from './PressScale';

export { PLAN_RANK, lossesFor } from '../planChange';

type Props = {
  visible: boolean;
  from: Plan;
  to: Plan;
  hasChildren: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function PlanChangeSheet({ visible, from, to, hasChildren, busy, onConfirm, onClose }: Props) {
  const { t } = useStore();
  const ui = useUI();
  const fromName = t(`plan_${from}`);
  const toName = t(`plan_${to}`);
  const losses = lossesFor(from, to, hasChildren);

  return (
    <KeyboardAwareBottomSheet visible={visible} onClose={onClose}
      contentStyle={[styles.sheet, { backgroundColor: ui.card, borderColor: ui.line }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: ui.text }]}>{t('chg_title_down', { plan: toName })}</Text>
        <PressScale testID="plan-change-close" accessibilityRole="button" accessibilityLabel={t('close')}
          onPress={onClose} style={[styles.iconBtn, { borderColor: ui.line }]}>
          <X color={ui.text} size={18} />
        </PressScale>
      </View>

      {losses.length ? (
        <>
          <Text style={[styles.intro, { color: ui.muted }]}>
            {t('chg_intro', { from: fromName, to: toName })}
          </Text>
          <View style={styles.list}>
            {losses.map((key) => (
              <View key={key} style={styles.row} testID={`plan-change-loss-${key}`}>
                <View style={[styles.dot, { backgroundColor: ui.dangerSoft }]}>
                  <Minus color={ui.danger} size={12} />
                </View>
                <Text style={[styles.rowText, { color: ui.text }]}>{t(key)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <View style={[styles.note, { backgroundColor: ui.soft }]}>
        <Text style={[styles.noteText, { color: ui.text }]}>{t('chg_nothing_deleted')}</Text>
        <Text style={[styles.noteText, { color: ui.muted }]}>
          {t('chg_when_renewal', { from: fromName, to: toName })}
        </Text>
      </View>

      <PressScale testID="plan-change-keep" accessibilityRole="button" onPress={onClose}
        style={[styles.primary, { backgroundColor: ui.text }]}>
        <Text style={[styles.primaryText, { color: ui.bg }]}>{t('chg_keep', { plan: fromName })}</Text>
      </PressScale>
      <PressScale testID="plan-change-confirm" accessibilityRole="button" disabled={busy}
        onPress={onConfirm} style={[styles.secondary, { borderColor: ui.line, opacity: busy ? 0.6 : 1 }]}>
        <Text style={[styles.secondaryText, { color: ui.text }]}>{t('chg_confirm', { plan: toName })}</Text>
      </PressScale>
    </KeyboardAwareBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 20, paddingBottom: 28 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  title: { flex: 1, fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 24 },
  iconBtn: { width: 36, height: 36, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  intro: { fontFamily: 'Figtree_400Regular', fontSize: 14, lineHeight: 20, marginBottom: 12 },
  list: { gap: 10, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 20, height: 20, borderRadius: 999, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  rowText: { flex: 1, fontFamily: 'Figtree_500Medium', fontSize: 14, lineHeight: 20 },
  note: { borderRadius: 14, padding: 14, gap: 6, marginBottom: 18 },
  noteText: { fontFamily: 'Figtree_400Regular', fontSize: 13, lineHeight: 19 },
  primary: { height: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'Figtree_700Bold', fontSize: 15 },
  secondary: { height: 50, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  secondaryText: { fontFamily: 'Figtree_600SemiBold', fontSize: 15 },
});
