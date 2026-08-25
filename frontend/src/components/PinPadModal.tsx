import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { X, Lock } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { PinPad } from './PinPad';
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
      // Treat a thrown onSubmit as a failure, not a frozen pad: without this a
      // rejecting handler would leave busy stuck true and the pad unusable.
      let ok = false;
      try {
        ok = await onSubmit(next);
      } catch {
        ok = false;
      }
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

          {/* The same pad the hand-over sheet uses. It was duplicated here,
              which is how one copy could be fixed and the other left buried
              under Android's keyboard for weeks. */}
          <PinPad
            pin={pin}
            error={err}
            disabled={busy}
            colors={{ text: c.text, muted: c.textMuted, line: c.cardBorder, danger: DANGER }}
            onDigit={pressDigit}
            onBack={back}
          />
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
});
