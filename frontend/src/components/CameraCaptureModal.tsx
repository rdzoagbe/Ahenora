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
import { X, Sparkles, Camera, Image as ImageIcon } from 'lucide-react-native';
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
  const { t } = useStore();
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

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />
      <View style={styles.center}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.badge}>
              <Sparkles color="#fff" size={12} />
              <Text style={styles.badgeText}>Gemini Vision</Text>
            </View>
            <PressScale testID="cam-close" onPress={onClose} style={styles.iconBtn}>
              <X color="#fff" size={18} />
            </PressScale>
          </View>

          <Text style={styles.heading}>{t('scan_flyer')}</Text>
          <Text style={styles.sub}>Snap a photo — AI turns it into a Smart Card and saves it to Vault.</Text>

          <View style={styles.stage}>
            {preview ? (
              <Image source={{ uri: preview }} style={styles.preview} />
            ) : (
              <View style={styles.emptyStage}>
                <Camera color="rgba(255,255,255,0.5)" size={36} />
              </View>
            )}
            {phase === 'scanning' && (
              <View style={styles.overlay}>
                <ActivityIndicator color="#fff" size="large" />
                <Text style={styles.overlayText}>{t('scanning')}</Text>
              </View>
            )}
          </View>

          {phase === 'error' && <Text style={styles.errText}>{err}</Text>}

          <View style={styles.controls}>
            <PressScale
              testID="cam-take"
              onPress={() => pick('camera')}
              style={styles.primaryBtn}
              disabled={phase === 'scanning'}
            >
              <Camera color="#080910" size={16} />
              <Text style={styles.primaryText}>{t('scan_flyer')}</Text>
            </PressScale>
            <PressScale
              testID="cam-library"
              onPress={() => pick('library')}
              style={styles.secondaryBtn}
              disabled={phase === 'scanning'}
            >
              <ImageIcon color="#fff" size={16} />
              <Text style={styles.secondaryText}>{t('choose_photo')}</Text>
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
    maxWidth: 400,
    backgroundColor: 'rgba(20,22,32,0.96)',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 26,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 9999,
  },
  badgeText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.4 },
  iconBtn: { padding: 8, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  heading: { fontFamily: 'PlayfairDisplay_400Regular_Italic', color: '#fff', fontSize: 30, lineHeight: 36 },
  sub: { fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4, marginBottom: 18 },
  stage: {
    height: 200,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  preview: { width: '100%', height: '100%', resizeMode: 'cover' },
  emptyStage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(8,9,16,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 12 },
  errText: { color: '#F97316', fontFamily: 'Inter_400Regular', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  controls: { gap: 10 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#fff', paddingVertical: 14, borderRadius: 9999,
  },
  primaryText: { color: '#080910', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 14, borderRadius: 9999,
  },
  secondaryText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 14 },
});
