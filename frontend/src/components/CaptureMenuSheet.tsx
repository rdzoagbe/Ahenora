import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, ChevronRight, ListPlus, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';

/**
 * What the ＋ on the Feed's capture bar opens.
 *
 * That ＋ used to be a plain View: orange, the size and shape of every primary
 * button in the app, and inert. The two things it looked like it did — add by
 * hand, snap a photo — were two small grey icons at the far end of the same
 * bar, where they read as decoration. So the bar had three controls competing
 * for one job, and the loudest one did nothing.
 *
 * Now the loud one is the button and the two quiet ones live inside it. The
 * bar is left with exactly two affordances: type, or tap ＋.
 *
 * The hint at the foot is the part that must not be dropped. Consolidating the
 * icons makes the bar look more like a button and less like a field, and the
 * field is the capable half — a typed line routes itself to the list, the meal
 * planner or the calendar, which no menu row can do. So the menu says so, at
 * the moment somebody is looking for a way to add.
 */
export function CaptureMenuSheet({
  visible,
  onClose,
  onManual,
  onPhoto,
}: {
  visible: boolean;
  onClose: () => void;
  onManual: () => void;
  onPhoto: () => void;
}) {
  const ui = useUI();
  const { t } = useStore();
  const insets = useSafeAreaInsets();
  const styles = createStyles(ui);

  const rows = [
    {
      key: 'manual',
      icon: ListPlus,
      title: t('feed_capture_menu_manual'),
      sub: t('feed_capture_menu_manual_sub'),
      onPress: onManual,
    },
    {
      key: 'photo',
      icon: Camera,
      title: t('feed_capture_menu_photo'),
      sub: t('feed_capture_menu_photo_sub'),
      onPress: onPhoto,
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('close')} />
      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.eyebrow}>{t('feed_capture_menu_eyebrow')}</Text>
          <PressScale
            testID="capture-menu-close"
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={onClose}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <PressScale
              key={row.key}
              testID={`capture-menu-${row.key}`}
              accessibilityRole="button"
              accessibilityLabel={row.title}
              onPress={row.onPress}
              style={styles.row}
            >
              <View style={styles.rowTile}>
                <Icon color="#FFFFFF" size={23} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{row.title}</Text>
                <Text style={styles.rowSub} numberOfLines={2}>{row.sub}</Text>
              </View>
              <ChevronRight color={ui.muted} size={20} />
            </PressScale>
          );
        })}

        <Text style={styles.hint}>{t('feed_capture_menu_hint')}</Text>
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
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: ui.orangeSoft, borderRadius: 18, padding: 14,
      borderWidth: 1, borderColor: ui.line, marginBottom: 10,
    },
    rowTile: {
      width: 48, height: 48, borderRadius: 14,
      backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center',
    },
    // The text column carries the flex, not the PressScale: PressScale copies
    // layout styles onto its inner Animated.View as well as the Pressable, so a
    // flex put on the row itself is applied twice.
    rowText: { flex: 1, minWidth: 0 },
    rowTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: ui.text },
    rowSub: { fontFamily: 'Inter_500Medium', fontSize: 13, color: ui.muted, marginTop: 2 },
    hint: {
      fontFamily: 'Inter_500Medium', fontSize: 13, color: ui.muted,
      textAlign: 'center', marginTop: 4, lineHeight: 19,
    },
  });
