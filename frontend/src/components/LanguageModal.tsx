import React from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Check } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { Lang, useStore } from '../store';
import { UI } from './Kit';

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
  const { t, lang, setLang } = useStore();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />
      <View style={styles.center}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.heading}>{t('language')}</Text>
            <PressScale testID="close-lang" onPress={onClose} style={styles.closeBtn}>
              <X color={UI.text} size={18} />
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
                style={[styles.row, selected && styles.rowSelected]}
              >
                <View>
                  <Text style={styles.native}>{o.native}</Text>
                  <Text style={styles.label}>{o.label}</Text>
                </View>
                {selected ? <Check color="#10B981" size={18} /> : null}
              </PressScale>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: UI.card,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: UI.line,
    padding: 22,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  heading: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 26, color: UI.text },
  closeBtn: { padding: 8, borderRadius: 9999, borderWidth: 1, borderColor: UI.line },
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
  rowSelected: {
    borderColor: UI.mintText,
    backgroundColor: UI.mint,
  },
  native: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: UI.text },
  label: { fontFamily: 'Inter_400Regular', fontSize: 12, color: UI.muted, marginTop: 2 },
});
