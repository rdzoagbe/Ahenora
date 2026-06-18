import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Lock, Delete } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { UI } from './Kit';

interface Props {
  visible: boolean;
  mode: 'set' | 'verify';
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<boolean>; // returns true on success
}

export function PinPadModal({ visible, mode, title, subtitle, onClose, onSubmit }: Props) {
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
        setErr(mode === 'verify' ? 'Wrong PIN' : 'Could not save');
        setPin('');
        setBusy(false);
      }
    }
  };

  const back = () => {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView intensity={50} tint="light" style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />
      <View style={styles.center}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={styles.badge}>
              <Lock color={UI.text} size={12} />
              <Text style={styles.badgeText}>{mode === 'set' ? 'Set PIN' : 'Enter PIN'}</Text>
            </View>
            <PressScale testID="pin-close" onPress={onClose} style={styles.closeBtn}>
              <X color={UI.text} size={18} />
            </PressScale>
          </View>

          <Text style={styles.heading}>{title}</Text>
          {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}

          <View style={styles.dotsRow}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[
                  styles.dot,
                  i < pin.length && styles.dotFilled,
                  err && styles.dotErr,
                ]}
              />
            ))}
          </View>

          {err ? <Text style={styles.errText}>{err}</Text> : null}

          <View style={styles.pad}>
            {['1','2','3','4','5','6','7','8','9'].map((d) => (
              <PressScale
                key={d}
                testID={`pin-${d}`}
                onPress={() => pressDigit(d)}
                style={styles.key}
              >
                <Text style={styles.keyText}>{d}</Text>
              </PressScale>
            ))}
            <View style={styles.key} />
            <PressScale testID="pin-0" onPress={() => pressDigit('0')} style={styles.key}>
              <Text style={styles.keyText}>0</Text>
            </PressScale>
            <PressScale testID="pin-back" onPress={back} style={styles.key}>
              <Delete color={UI.muted} size={22} />
            </PressScale>
          </View>
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
    maxWidth: 360,
    backgroundColor: UI.card,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: UI.line,
    padding: 24,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: UI.soft,
    borderWidth: 1, borderColor: UI.line,
    borderRadius: 9999,
  },
  badgeText: { color: UI.text, fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.4 },
  closeBtn: { padding: 8, borderRadius: 9999, borderWidth: 1, borderColor: UI.line },
  heading: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: UI.text, fontSize: 26, marginTop: 16,
  },
  sub: { color: UI.muted, fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  dotsRow: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 22, marginBottom: 10 },
  dot: {
    width: 14, height: 14, borderRadius: 9999,
    borderWidth: 1.5, borderColor: UI.line,
  },
  dotFilled: { backgroundColor: UI.text, borderColor: UI.text },
  dotErr: { borderColor: UI.danger },
  errText: { color: UI.danger, textAlign: 'center', fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 4 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  key: {
    width: '33.333%',
    aspectRatio: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { color: UI.text, fontFamily: 'Inter_500Medium', fontSize: 26 },
});
