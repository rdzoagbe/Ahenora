import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Check } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { Lang, useStore } from '../store';

interface Props {
  visible: boolean;
  onClose: () => void;
}

const OPTIONS: { code: Lang; label: string; native: string }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'de', label: 'German', native: 'Deutsch' },
];

export function LanguageModal({ visible, onClose }: Props) {
  const { t, lang, setLang, theme } = useStore();
  const c = theme.colors;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={40} tint={theme.mode === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />
      <View style={styles.center}>
        <View style={[styles.sheet, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <View style={styles.header}>
            <Text style={[styles.heading, { color: c.text }]}>{t('language')}</Text>
            <PressScale testID="close-lang" onPress={onClose} style={[styles.closeBtn, { borderColor: c.cardBorder }]}>
              <X color={c.text} size={18} />
            </PressScale>
          </View>
          {OPTIONS.map((o) => {
            const selected = lang === o.code;
            return (
              <PressScale
                key={o.code}
                testID={`lang-${o.code}`}
                onPress={async () => {
                  await setLang(o.code);
                  onClose();
                }}
                style={[
                  styles.row,
                  selected && { borderColor: c.success, backgroundColor: theme.mode === 'dark' ? 'rgba(34,197,94,0.12)' : '#DFF7EC' },
                ]}
              >
                <View>
                  <Text style={[styles.native, { color: c.text }]}>{o.native}</Text>
                  <Text style={[styles.label, { color: c.textMuted }]}>{o.label}</Text>
                </View>
                {selected ? <Check color={c.success} size={18} /> : null}
              </PressScale>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heading: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 26 },
  closeBtn: { padding: 8, borderRadius: 9999, borderWidth: 1 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: 8,
  },
  native: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  label: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
});
