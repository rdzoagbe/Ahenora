import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronRight, Lock, Settings as SettingsIcon, Smile, User, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { HandOverSheet } from './HandOverSheet';

/**
 * Destinations that don't earn a permanent seat in a five-slot phone bar.
 * A household opens the vault occasionally and settings rarely; putting them
 * here buys back the width the four daily tabs were starving for — and gives
 * everything we add next (expenses, carpool) somewhere to land that isn't
 * another 10px label.
 *
 * Destinations, though — not tools. Search briefly lived here as well as in
 * the feed header, which bought nothing: from any other tab it is two taps
 * either way, More then Search or Feed then the search icon. Duplication
 * dressed up as coverage, making this list longer for every parent who opens
 * it looking for the vault.
 */
export function MoreSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [handOver, setHandOver] = useState(false);
  const ui = useUI();
  const { t } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = createStyles(ui);

  const go = (path: string) => {
    onClose();
    // Let the sheet finish closing before the route swap, so the panel does
    // not appear to jump across the new screen.
    setTimeout(() => router.navigate(path as never), 120);
  };

  const items = [
    { key: 'kid', icon: Smile, tone: ui.mintText, soft: ui.mint,
      title: t('kid_hand_over'), sub: t('kid_hand_over_sub'), path: '' },
    { key: 'vault', icon: Lock, tone: ui.lavenderText, soft: ui.lavender,
      title: t('vault'), sub: t('nav_more_vault_sub'), path: '/(tabs)/vault' },
    { key: 'settings', icon: SettingsIcon, tone: ui.orange, soft: ui.orangeSoft,
      title: t('settings'), sub: t('nav_more_settings_sub'), path: '/(tabs)/settings' },
    { key: 'account', icon: User, tone: ui.mintText, soft: ui.mint,
      title: t('nav_more_account'), sub: t('nav_more_account_sub'), path: '/(tabs)/account' },
  ];

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('close')} />
      {/* The bottom pad clears the phone's own navigation bar: without it
          the last row sat underneath Android's gesture bar and read as a
          half-drawn sheet. */}
      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.title}>{t('nav_household')}</Text>
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
              onPress={() => {
                // The hand-over is a sheet, not a destination: it has to sit
                // above this panel rather than replace the screen behind it.
                if (!item.path) { onClose(); setTimeout(() => setHandOver(true), 160); return; }
                go(item.path);
              }}
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
      <HandOverSheet visible={handOver} onClose={() => setHandOver(false)} />
    </>
  );
}

const createStyles = (ui: UIColors) =>
  StyleSheet.create({
    // Heavier than the app's other scrims on purpose: in dark mode the sheet
    // and the page behind it are nearly the same value, and the panel has to
    // read as a layer above the screen rather than part of it.
    // Spelled out rather than spreading StyleSheet.absoluteFill: that constant
    // is an opaque registered style, so spreading it yields nothing — the
    // scrim had no position and no size, which is why the screen behind the
    // sheet never dimmed and tapping outside never closed it.
    backdrop: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.62)',
    },
    panel: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: ui.card,
      borderTopLeftRadius: 26, borderTopRightRadius: 26,
      borderTopWidth: 1, borderColor: ui.line,
      paddingHorizontal: 18, paddingTop: 12, gap: 10,
      shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 28,
      shadowOffset: { width: 0, height: -8 }, elevation: 24,
    },
    grabber: {
      alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
      backgroundColor: ui.muted, opacity: 0.5, marginBottom: 8,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 21, letterSpacing: -0.4 },
    iconBtn: { padding: 6, borderRadius: 999, backgroundColor: ui.soft },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line,
      borderRadius: 16, paddingVertical: 15, paddingHorizontal: 14,
    },
    tile: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
    rowTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 16 },
    rowSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  });
