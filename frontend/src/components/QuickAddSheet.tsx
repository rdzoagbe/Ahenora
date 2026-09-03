import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ListPlus, ScanLine, ShoppingCart, ChevronRight, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

type IconType = typeof ListPlus;

/**
 * The context-first picker the centre ➕ opens. It *captures* — it never
 * navigates to a place (that is what the tabs and the Household hub are for).
 *
 * It leads with the primary create for the page you're on (passed in as
 * `primaryTitle`/`primarySub`/`onPrimary`), then keeps the universal capture
 * row — Task · Scan · Speak · Shopping — one tap away everywhere. The actual
 * capture surfaces and the "stay put + confirm" behaviour live in
 * `GlobalCapture`, which owns this picker; here we only present the choices.
 */
export function QuickAddSheet({
  visible,
  onClose,
  primaryTitle,
  primarySub,
  contextLabel,
  primaryIcon,
  onPrimary,
  onTask,
  onScan,
  onShopping,
}: {
  visible: boolean;
  onClose: () => void;
  primaryTitle: string;
  primarySub: string;
  contextLabel: string;
  primaryIcon?: IconType;
  onPrimary: () => void;
  onTask: () => void;
  onScan: () => void;
  onShopping: () => void;
}) {
  const ui = useUI();
  const { t } = useStore();
  const insets = useSafeAreaInsets();
  const styles = createStyles(ui);

  const PrimaryIcon = primaryIcon ?? ListPlus;

  const universal: { key: string; icon: IconType; label: string; onPress: () => void }[] = [
    { key: 'task', icon: ListPlus, label: t('qa_row_task'), onPress: onTask },
    { key: 'scan', icon: ScanLine, label: t('qa_row_scan'), onPress: onScan },
    { key: 'shopping', icon: ShoppingCart, label: t('qa_row_shopping'), onPress: onShopping },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('close')} />
      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{contextLabel}</Text>
          <PressScale
            testID="quickadd-close"
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={onClose}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        {/* Primary tile: the create the current page is about. */}
        <PressScale
          testID="quickadd-primary"
          accessibilityRole="button"
          accessibilityLabel={primaryTitle}
          onPress={onPrimary}
          style={styles.primary}
        >
          <View style={[styles.primaryTile, { backgroundColor: ui.orange }]}>
            <PrimaryIcon color="#FFFFFF" size={24} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.primaryTitle}>{primaryTitle}</Text>
            <Text style={styles.primarySub} numberOfLines={1}>{primarySub}</Text>
          </View>
          <ChevronRight color={ui.muted} size={20} />
        </PressScale>

        {/* Divider: — or capture anything — */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{t('qa_or_capture')}</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Universal capture row, on every page. */}
        <View style={styles.row}>
          {universal.map((a) => {
            const Icon = a.icon;
            return (
              <PressScale
                key={a.key}
                testID={`quickadd-${a.key}`}
                accessibilityRole="button"
                accessibilityLabel={a.label}
                onPress={a.onPress}
                style={styles.rowItem}
              >
                <View style={[styles.rowTile, { backgroundColor: ui.orangeSoft }]}>
                  <Icon color={ui.orange} size={22} />
                </View>
                <Text style={styles.rowLabel} numberOfLines={1}>{a.label}</Text>
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
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    eyebrow: {
      fontFamily: 'Inter_700Bold', fontSize: 13, color: ui.muted,
      textTransform: 'uppercase', letterSpacing: 0.6,
    },
    iconBtn: {
      width: 34, height: 34, borderRadius: 99, alignItems: 'center', justifyContent: 'center',
      backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line,
    },
    primary: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: ui.orangeSoft, borderRadius: 18, padding: 16,
      borderWidth: 1, borderColor: ui.line,
    },
    primaryTile: { width: 52, height: 52, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    primaryTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: ui.text },
    primarySub: { fontFamily: 'Inter_500Medium', fontSize: 13, color: ui.muted, marginTop: 2 },
    divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
    dividerLine: { flex: 1, height: 1, backgroundColor: ui.line },
    dividerText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: ui.muted },
    row: { flexDirection: 'row', gap: 10 },
    rowItem: { flex: 1, alignItems: 'center', gap: 8 },
    rowTile: { width: '100%', height: 56, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    rowLabel: { fontFamily: 'Inter_700Bold', fontSize: 13, color: ui.text },
  });
