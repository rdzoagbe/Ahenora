import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { MicOff, Sparkles, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { CardType } from '../api';

interface Draft {
  transcript: string;
  type: CardType;
  title: string;
  description: string;
  assignee: string;
  due_date?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onDraft: (draft: Draft) => void;
}

/**
 * Voice capture is intentionally parked for the first Play Store testing build.
 * This avoids shipping an unfinished microphone/transcription flow and removes
 * the deprecated expo-av runtime warning from the Android test path.
 */
export function VoiceCaptureModal({ visible, onClose }: Props) {
  const { theme } = useStore();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />

      <View style={styles.center}>
        <View style={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}> 
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}> 
              <Sparkles color={theme.colors.accent} size={12} />
              <Text style={[styles.badgeText, { color: theme.colors.text }]}>Voice capture</Text>
            </View>

            <PressScale testID="voice-close" onPress={onClose} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder }]}> 
              <X color={theme.colors.text} size={18} />
            </PressScale>
          </View>

          <View style={[styles.iconHero, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
            <MicOff color={theme.colors.textMuted} size={34} />
          </View>

          <Text style={[styles.heading, { color: theme.colors.text }]}>Voice is coming soon</Text>
          <Text style={[styles.sub, { color: theme.colors.textMuted }]}>We have parked voice transcription for the first Play Store testing release so testers only see stable features. Use Manual or Scan for now.</Text>

          <PressScale testID="voice-coming-soon-close" onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.colors.primary }]}> 
            <Text style={[styles.closeText, { color: theme.colors.primaryText }]}>Got it</Text>
          </PressScale>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.54)' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 9999,
  },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.2 },
  iconBtn: { padding: 8, borderRadius: 9999, borderWidth: 1 },
  iconHero: {
    width: 86,
    height: 86,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  heading: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  sub: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 23, marginTop: 10, marginBottom: 22 },
  closeBtn: { minHeight: 52, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
