import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ListPlus, ScanLine, Mic, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

/**
 * The sheet the centre ➕ opens. Three ways to capture, and nothing else — the
 * ➕ *creates*, it never navigates to a place (that is what the tabs and the
 * Household hub are for). Keeping that line clean is what stops the button from
 * turning into a second, messier menu.
 *
 * Each row lands on the screen where that capture already lives, so this is a
 * shortcut to a habit, not a new surface to maintain.
 */
export function QuickAddSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const ui = useUI();
  const { t } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = createStyles(ui);

  const go = (path: string) => {
    onClose();
    setTimeout(() => router.navigate(path as never), 120);
  };

  const actions = [
    { key: 'task', icon: ListPlus, title: t('qa_task'), sub: t('qa_task_sub'), path: '/(tabs)/feed' },
    { key: 'scan', icon: ScanLine, title: t('qa_scan'), sub: t('qa_scan_sub'), path: '/(tabs)/kitchen' },
    { key: 'voice', icon: Mic, title: t('qa_voice'), sub: t('qa_voice_sub'), path: '/(tabs)/feed' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('close')} />
      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.title}>{t('qa_title')}</Text>
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

        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <PressScale
              key={a.key}
              testID={`quickadd-${a.key}`}
              accessibilityRole="button"
              onPress={() => go(a.path)}
              style={styles.row}
            >
              <View style={[styles.tile, { backgroundColor: ui.orangeSoft }]}>
                <Icon color={ui.orange} size={20} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowTitle}>{a.title}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{a.sub}</Text>
              </View>
            </PressScale>
          );
        })}
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
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    title: { fontFamily: 'Inter_800ExtraBold', fontSize: 19, color: ui.text },
    iconBtn: {
      width: 34, height: 34, borderRadius: 99, alignItems: 'center', justifyContent: 'center',
      backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      paddingVertical: 13, borderTopWidth: 1, borderTopColor: ui.line,
    },
    tile: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, color: ui.text },
    rowSub: { fontFamily: 'Inter_500Medium', fontSize: 13, color: ui.muted, marginTop: 1 },
  });
