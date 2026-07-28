import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Rocket, Check, ChevronRight, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { useUI, UIColors } from './Kit';

const DISMISS_KEY = 'coo_getting_started_done';

interface Props {
  hasMember: boolean;
  hasCard: boolean;
  hasDoc: boolean;
  onAddMember: () => void;
  onAddCard: () => void;
  onAddDoc: () => void;
}

/**
 * A friendly first-run checklist shown on the Feed until a new household has
 * taken its first three actions (or dismisses it). Self-contained: tracks its
 * own dismissed/completed state in AsyncStorage so it never reappears once done.
 */
export function GettingStarted({ hasMember, hasCard, hasDoc, onAddMember, onAddCard, onAddDoc }: Props) {
  const { t } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  // null = still loading the flag; false = show; true = hidden.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(DISMISS_KEY).then((v) => setDismissed(v === '1')).catch(() => setDismissed(false));
  }, []);

  const steps = [
    { key: 'member', labelKey: 'gs_add_member', done: hasMember, onPress: onAddMember },
    { key: 'card', labelKey: 'gs_add_task', done: hasCard, onPress: onAddCard },
    { key: 'doc', labelKey: 'gs_add_doc', done: hasDoc, onPress: onAddDoc },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  // Once all three are done, remember it so the card doesn't flash back later.
  useEffect(() => {
    if (allDone && dismissed === false) {
      AsyncStorage.setItem(DISMISS_KEY, '1').catch(() => {});
    }
  }, [allDone, dismissed]);

  if (dismissed !== false || allDone) return null;

  const dismiss = () => {
    setDismissed(true);
    AsyncStorage.setItem(DISMISS_KEY, '1').catch(() => {});
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.iconTile}><Rocket color={ui.orange} size={18} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t('gs_title')}</Text>
            <Text style={styles.sub}>{doneCount}/{steps.length} {t('gs_done')}</Text>
          </View>
        </View>
        <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="gs-dismiss" onPress={dismiss} style={styles.dismiss}>
          <X color={ui.muted} size={16} />
        </PressScale>
      </View>

      {steps.map((s) => (
        <PressScale
          key={s.key}
          testID={`gs-${s.key}`}
          onPress={s.done ? undefined : s.onPress}
          disabled={s.done}
          style={styles.row}
        >
          <View style={[styles.tick, s.done && styles.tickDone]}>
            {s.done ? <Check color={ui.bg} size={13} /> : null}
          </View>
          <Text style={[styles.rowText, s.done && styles.rowTextDone]}>{t(s.labelKey)}</Text>
          {!s.done ? <ChevronRight color={ui.muted} size={18} /> : null}
        </PressScale>
      ))}
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  card: { borderRadius: 20, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, padding: 16, marginBottom: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  iconTile: { width: 40, height: 40, borderRadius: 12, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, letterSpacing: -0.3 },
  sub: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 1 },
  dismiss: { padding: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: 1, borderTopColor: ui.line },
  tick: { width: 22, height: 22, borderRadius: 99, borderWidth: 1.5, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },
  tickDone: { backgroundColor: ui.mintText, borderColor: ui.mintText },
  rowText: { flex: 1, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  rowTextDone: { color: ui.muted, textDecorationLine: 'line-through' },
});
