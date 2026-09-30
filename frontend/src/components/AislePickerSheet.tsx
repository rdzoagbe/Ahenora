import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { AISLE_ORDER, Aisle, aisleKey } from '../shoppingAisles';

/**
 * "Which aisle?" for one shopping item.
 *
 * The server sorts every item by its name, and it will sometimes be wrong for
 * a particular household — "chips" are crisps in one house and frozen fries in
 * the next. Moving an item here is remembered for the whole household, so the
 * next time anybody adds it, it lands where this household keeps it.
 */
export function AislePickerSheet({
  itemName,
  current,
  onPick,
  onClose,
}: {
  /** The item being moved; null hides the sheet. */
  itemName: string | null;
  current: string | null;
  onPick: (aisle: Aisle) => void;
  onClose: () => void;
}) {
  const ui = useUI();
  const { t } = useStore();
  const insets = useSafeAreaInsets();
  const styles = createStyles(ui);

  return (
    <Modal visible={itemName != null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('close')} />
      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>{t('shop_aisle_pick')}</Text>
            <Text style={styles.sub} numberOfLines={2}>
              {t('shop_aisle_pick_sub', { name: itemName ?? '' })}
            </Text>
          </View>
          <PressScale
            testID="aisle-picker-close"
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={onClose}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        <View style={styles.grid}>
          {AISLE_ORDER.map((aisle) => {
            const on = aisle === current;
            return (
              <PressScale
                key={aisle}
                testID={`aisle-pick-${aisle}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={t(aisleKey(aisle))}
                onPress={() => onPick(aisle)}
                style={[styles.chip, on && styles.chipOn]}
              >
                {on ? <Check color={ui.orangeText} size={14} /> : null}
                <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                  {t(aisleKey(aisle))}
                </Text>
              </PressScale>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (ui: UIColors) =>
  StyleSheet.create({
    backdrop: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.62)',
    },
    panel: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: ui.card,
      borderTopLeftRadius: 26, borderTopRightRadius: 26,
      paddingHorizontal: 18, paddingTop: 10,
      borderWidth: 1, borderColor: ui.line,
    },
    grabber: {
      alignSelf: 'center', width: 40, height: 5, borderRadius: 99,
      backgroundColor: ui.line, marginBottom: 12,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
    title: { fontFamily: 'Figtree_800ExtraBold', fontSize: 18, color: ui.text },
    sub: { fontFamily: 'Figtree_500Medium', fontSize: 13, color: ui.muted, marginTop: 3 },
    iconBtn: {
      width: 34, height: 34, borderRadius: 99, alignItems: 'center', justifyContent: 'center',
      backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line,
    },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 13, paddingVertical: 10, borderRadius: 999,
      backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line,
    },
    chipOn: { backgroundColor: ui.orangeSoft, borderColor: ui.orange },
    chipText: { fontFamily: 'Figtree_600SemiBold', fontSize: 14, color: ui.text },
    chipTextOn: { color: ui.orangeText },
  });
