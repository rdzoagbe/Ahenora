import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Lock, Delete } from 'lucide-react-native';
import { PressScale } from './PressScale';

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
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />
      <View style={styles.center}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={styles.badge}>
              <Lock color="#fff" size={12} />
              <Text style={styles.badgeText}>{mode === 'set' ? 'Set PIN' : 'Enter PIN'}</Text>
            </View>
            <PressScale testID="pin-close" onPress={onClose} style={styles.closeBtn}>
              <X color="#fff" size={18} />
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
              <Delete color="rgba(255,255,255,0.7)" size={22} />
            </PressScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.6)' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: 'rgba(20,22,32,0.96)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 24,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 9999,
  },
  badgeText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.4 },
  closeBtn: { padding: 8, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  heading: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: '#fff', fontSize: 26, marginTop: 16,
  },
  sub: { color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  dotsRow: { flexDirection: 'row', gap: 16, justifyContent: 'center', marginTop: 22, marginBottom: 10 },
  dot: {
    width: 14, height: 14, borderRadius: 9999,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
  },
  dotFilled: { backgroundColor: '#fff', borderColor: '#fff' },
  dotErr: { borderColor: '#EF4444' },
  errText: { color: '#EF4444', textAlign: 'center', fontFamily: 'Inter_500Medium', fontSize: 12, marginBottom: 4 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  key: {
    width: '33.333%',
    aspectRatio: 1.6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 26 },
});
