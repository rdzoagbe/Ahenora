import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Lock, Delete } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';

interface Props {
  visible: boolean;
  mode: 'set' | 'verify';
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<boolean>;
}

export function PinPadModal({ visible, mode, title, subtitle, onClose, onSubmit }: Props) {
  const { theme, t } = useStore();
  const c = theme.colors;
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setPin('');
      setErr(null);
      setBusy(false);
    }
  }, [visible]);

  const pressDigit = async (d: string) => {
    if (busy) return;
    setErr(null);
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      setBusy(true);
      const ok = await onSubmit(next);
      if (!ok) {
        setErr(mode === 'verify' ? t('pin_wrong') : t('pin_could_not_save'));
        setPin('');
        setBusy(false);
      }
    }
  };

  const back = () => {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
  };

  // The shared danger token clears AA in both themes (light #C81E1E 5.74:1,
  // dark #F87171 6.13:1 on the sheet); the old hardcoded #DC2626 failed at
  // 3.51:1 in dark. This modal was missed by the danger-token migration.
  const DANGER = c.danger;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={50} tint={theme.mode === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />
      <View style={styles.center}>
        <View style={[styles.sheet, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
          <View style={styles.headerRow}>
            <View style={[styles.badge, { backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}>
              <Lock color={c.text} size={12} />
              <Text style={[styles.badgeText, { color: c.text }]}>{mode === 'set' ? t('pin_set') : t('pin_enter')}</Text>
            </View>
            <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="pin-close" onPress={onClose} style={[styles.closeBtn, { borderColor: c.cardBorder }]}>
              <X color={c.text} size={18} />
            </PressScale>
          </View>

          <Text style={[styles.heading, { color: c.text }]}>{title}</Text>
          {subtitle ? <Text style={[styles.sub, { color: c.textMuted }]}>{subtitle}</Text> : null}

          <View style={styles.dotsRow}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  { borderColor: c.cardBorder },
                  i < pin.length && { backgroundColor: c.text, borderColor: c.text },
                  err ? { borderColor: DANGER } : undefined,
                ]}
              />
            ))}
          </View>

          {err ? <Text style={[styles.errText, { color: DANGER }]}>{err}</Text> : null}

          <View style={styles.pad}>
            {['1','2','3','4','5','6','7','8','9'].map((d) => (
              <PressScale key={d} testID={`pin-${d}`} onPress={() => pressDigit(d)} style={styles.key}>
                <Text style={[styles.keyText, { color: c.text }]}>{d}</Text>
              </PressScale>
            ))}
            <View style={styles.key} />
            <PressScale testID="pin-0" onPress={() => pressDigit('0')} style={styles.key}>
              <Text style={[styles.keyText, { color: c.text }]}>0</Text>
            </PressScale>
            <PressScale testID="pin-back" onPress={back} style={styles.key}>
              <Delete color={c.textMuted} size={22} />
            </PressScale>
          </View>
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
    maxWidth: 360,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 9999,
  },
  badgeText: { fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.4 },
  closeBtn: { padding: 8, borderRadius: 9999, borderWidth: 1 },
  heading: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 26, marginTop: 16,
  },
  sub: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  dotsRow: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 22, marginBottom: 10 },
  dot: {
    width: 14, height: 14, borderRadius: 9999,
    borderWidth: 1.5,
  },
  errText: { textAlign: 'center', fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 4 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  key: {
    width: '33.333%',
    aspectRatio: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { fontFamily: 'Inter_500Medium', fontSize: 26 },
});
