import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as ImagePicker from 'expo-image-picker';
import { X, Sparkles, Camera, Image as ImageIcon, FileScan } from 'lucide-react-native';
import { PressScale } from './PressScale';
import { useStore } from '../store';
import { api, CardType } from '../api';

interface Draft {
  type: CardType;
  title: string;
  description: string;
  assignee: string;
  due_date?: string | null;
  image_base64?: string | null;
  vault_category?: string;
  save_to_vault?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onDraft: (d: Draft & { transcript: string }) => void;
}

type Phase = 'idle' | 'scanning' | 'error';

export function CameraCaptureModal({ visible, onClose, onDraft }: Props) {
  const { t, theme } = useStore();
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setPhase('idle');
      setPreview(null);
      setErr(null);
    }
  }, [visible]);

  const pick = async (source: 'camera' | 'library') => {
    setErr(null);

    try {
      if (Platform.OS !== 'web') {
        if (source === 'camera') {
          const p = await ImagePicker.requestCameraPermissionsAsync();
          if (!p.granted) throw new Error('Camera permission denied');
        } else {
          const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!p.granted) throw new Error('Gallery permission denied');
        }
      }

      const res =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              base64: true,
              quality: 0.55,
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
            })
          : await ImagePicker.launchImageLibraryAsync({
              base64: true,
              quality: 0.55,
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
            });

      if (res.canceled || !res.assets?.[0]) return;

      const asset = res.assets[0];
      const imageBase64 = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;

      setPreview(imageBase64);
      setPhase('scanning');

      try {
        const draft = await api.visionExtract(imageBase64);

        onDraft({
          transcript: '',
          type: draft.type,
          title: draft.title,
          description: draft.description || '',
          assignee: draft.assignee || '',
          due_date: draft.due_date || null,
          image_base64: imageBase64,
          vault_category: draft.vault_category || 'School',
          save_to_vault: draft.save_to_vault !== false,
        });
      } catch (e: any) {
        setErr(e?.message || 'Vision extraction failed');
        setPhase('error');
      }
    } catch (e: any) {
      setErr(e?.message || 'Could not open camera');
      setPhase('error');
    }
  };

  const scanning = phase === 'scanning';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <BlurView intensity={50} tint={theme.mode === 'light' ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
      <View style={[styles.backdrop, { backgroundColor: theme.mode === 'light' ? 'rgba(255,255,255,0.48)' : 'rgba(8,9,16,0.6)' }]} />
      <View style={styles.center}>
        <View style={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}> 
          <View style={styles.header}>
            <View style={[styles.badge, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}> 
              <Sparkles color={theme.colors.accent} size={12} />
              <Text style={[styles.badgeText, { color: theme.colors.text }]}>Quick action</Text>
            </View>
            <PressScale testID="cam-close" onPress={onClose} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder }]} disabled={scanning}>
              <X color={theme.colors.text} size={18} />
            </PressScale>
          </View>

          <View style={[styles.heroIcon, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
            <FileScan color={theme.colors.accent} size={28} />
          </View>

          <Text style={[styles.heading, { color: theme.colors.text }]}>Smart scan</Text>
          <Text style={[styles.sub, { color: theme.colors.textMuted }]}>Scan a school letter, bill, appointment card, or note. Household COO will create a draft first so you can review before saving.</Text>

          <View style={[styles.stage, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}> 
            {preview ? (
              <Image source={{ uri: preview }} style={styles.preview} />
            ) : (
              <View style={styles.emptyStage}>
                <Camera color={theme.colors.textSoft} size={36} />
                <Text style={[styles.emptyStageText, { color: theme.colors.textMuted }]}>Take a photo or choose from gallery</Text>
              </View>
            )}
            {scanning && (
              <View style={[styles.overlay, { backgroundColor: theme.mode === 'light' ? 'rgba(255,255,255,0.84)' : 'rgba(8,9,16,0.76)' }]}> 
                <ActivityIndicator color={theme.colors.text} size="large" />
                <Text style={[styles.overlayText, { color: theme.colors.text }]}>{t('scanning')}</Text>
              </View>
            )}
          </View>

          {phase === 'error' && (
            <View style={[styles.errorBox, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
              <Text style={styles.errText}>{err}</Text>
              <Text style={[styles.errHelp, { color: theme.colors.textMuted }]}>You can still use Manual from Quick Actions.</Text>
            </View>
          )}

          <View style={styles.controls}>
            <PressScale
              testID="cam-take"
              onPress={() => pick('camera')}
              style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
              disabled={scanning}
            >
              <Camera color={theme.colors.primaryText} size={16} />
              <Text style={[styles.primaryText, { color: theme.colors.primaryText }]}>{t('scan_flyer')}</Text>
            </PressScale>
            <PressScale
              testID="cam-library"
              onPress={() => pick('library')}
              style={[styles.secondaryBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
              disabled={scanning}
            >
              <ImageIcon color={theme.colors.text} size={16} />
              <Text style={[styles.secondaryText, { color: theme.colors.text }]}>{t('choose_photo')}</Text>
            </PressScale>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
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
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  heading: { fontFamily: 'Inter_800ExtraBold', fontSize: 30, lineHeight: 36, letterSpacing: -0.5 },
  sub: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 18 },
  stage: {
    height: 210,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    marginBottom: 14,
  },
  preview: { width: '100%', height: '100%', resizeMode: 'cover' },
  emptyStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 10 },
  emptyStageText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: { fontFamily: 'Inter_700Bold', fontSize: 13, marginTop: 12 },
  errorBox: { borderWidth: 1, borderRadius: 18, padding: 12, marginBottom: 12 },
  errText: { color: '#F97316', fontFamily: 'Inter_700Bold', fontSize: 13, lineHeight: 19 },
  errHelp: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 18, marginTop: 4 },
  controls: { gap: 10 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 9999,
  },
  primaryText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    paddingVertical: 14,
    borderRadius: 9999,
  },
  secondaryText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
});
