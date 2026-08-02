import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronRight, Lock, Settings as SettingsIcon, User, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

/**
 * Destinations that don't earn a permanent seat in a five-slot phone bar.
 * A household opens the vault occasionally and settings rarely; putting them
 * here buys back the width the four daily tabs were starving for — and gives
 * everything we add next (expenses, carpool) somewhere to land that isn't
 * another 10px label.
 */
export function MoreSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const ui = useUI();
  const { t } = useStore();
  const router = useRouter();
  const styles = createStyles(ui);

  const go = (path: string) => {
    onClose();
    // Let the sheet finish closing before the route swap, so the panel does
    // not appear to jump across the new screen.
    setTimeout(() => router.navigate(path as never), 120);
  };

  const items = [
    { key: 'vault', icon: Lock, tone: ui.lavenderText, soft: ui.lavender,
      title: t('vault'), sub: t('nav_more_vault_sub'), path: '/(tabs)/vault' },
    { key: 'settings', icon: SettingsIcon, tone: ui.orange, soft: ui.orangeSoft,
      title: t('settings'), sub: t('nav_more_settings_sub'), path: '/(tabs)/settings' },
    { key: 'account', icon: User, tone: ui.mintText, soft: ui.mint,
      title: t('nav_more_account'), sub: t('nav_more_account_sub'), path: '/(tabs)/account' },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('close')} />
      <View style={styles.panel}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.title}>{t('nav_more')}</Text>
          <PressScale
            testID="more-close"
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={onClose}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        {items.map((item) => {
          const Icon = item.icon;
          return (
            <PressScale
              key={item.key}
              testID={`more-${item.key}`}
              accessibilityRole="button"
              onPress={() => go(item.path)}
              style={styles.row}
            >
              <View style={[styles.tile, { backgroundColor: item.soft }]}>
                <Icon color={item.tone} size={19} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{item.sub}</Text>
              </View>
              <ChevronRight color={ui.muted} size={18} />
            </PressScale>
          );
        })}
      </View>
    </Modal>
  );
}

const createStyles = (ui: UIColors) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFill as object, backgroundColor: 'rgba(8,9,16,0.45)' },
    panel: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: ui.bg,
      borderTopLeftRadius: 26, borderTopRightRadius: 26,
      paddingHorizontal: 18, paddingTop: 10, paddingBottom: 34, gap: 8,
    },
    grabber: {
      alignSelf: 'center', width: 42, height: 4, borderRadius: 2,
      backgroundColor: ui.line, marginBottom: 6,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, letterSpacing: -0.3 },
    iconBtn: { padding: 6, borderRadius: 999, backgroundColor: ui.soft },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 13,
      backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line,
      borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14,
    },
    tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
    rowSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 1 },
  });
