import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Platform,
  Image,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Plus, X, Lock, Trash2, Stethoscope, BookOpen, Shield, Scale } from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { PressScale } from '../../src/components/PressScale';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast, { ToastTone } from '../../src/components/AppToast';
import EmptyState from '../../src/components/EmptyState';
import ErrorState from '../../src/components/ErrorState';
import LoadingOverlay from '../../src/components/LoadingOverlay';

import { useStore } from '../../src/store';
import { api, VaultDoc } from '../../src/api';
import { logger } from '../../src/logger';

const CATEGORIES = [
  { key: 'Medical', icon: Stethoscope, tone: '#F97316' },
  { key: 'School', icon: BookOpen, tone: '#6366F1' },
  { key: 'Insurance', icon: Shield, tone: '#10B981' },
  { key: 'Legal', icon: Scale, tone: '#EAB308' },
];

type ToastState = {
  message: string;
  tone: ToastTone;
};

export default function VaultScreen() {
  const { t } = useStore();

  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState<VaultDoc | null>(null);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Medical');
  const [image, setImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2300);
  }, []);

  const load = useCallback(async () => {
    try {
      setErrorMessage(null);

      const res = await api.listVault();
      setDocs(res);
    } catch (e: any) {
      logger.warn('Vault load failed:', e?.message || e);
      setErrorMessage(e?.message || 'Could not load vault.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setTitle('');
    setCategory('Medical');
    setImage(null);
    setShowAdd(true);
  };

  const closeAdd = () => {
    setShowAdd(false);
  };

  const pickImage = async () => {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!perm.granted) {
        Alert.alert('Permission needed', 'Gallery access is required.');
        return;
      }
    }

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.6,
    });

    if (!res.canceled && res.assets?.[0]) {
      const asset = res.assets[0];
      const imageValue = asset.base64
        ? `data:image/jpeg;base64,${asset.base64}`
        : asset.uri;

      setImage(imageValue);
    }
  };

  const save = async () => {
    if (!title.trim() || !image) return;

    setSaving(true);

    try {
      const created = await api.createVaultDoc({
        title: title.trim(),
        category,
        image_base64: image,
      });

      setDocs((prev) => [created, ...prev]);
      setTitle('');
      setImage(null);
      setCategory('Medical');
      setShowAdd(false);

      showToast('Document saved.', 'success');
    } catch (e: any) {
      logger.warn('Save vault document failed:', e?.message || e);
      showToast(e?.message || 'Could not save document.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (doc: VaultDoc) => {
    const previous = docs;

    setDocs((prev) => prev.filter((d) => d.doc_id !== doc.doc_id));
    setPreview(null);

    try {
      await api.deleteVaultDoc(doc.doc_id);
      showToast('Document deleted.', 'success');
    } catch (e: any) {
      logger.warn('Delete vault document failed:', e?.message || e);
      setDocs(previous);
      showToast('Could not delete document.', 'error');
      load();
    }
  };

  const showBlockingError = !loading && Boolean(errorMessage) && docs.length === 0;

  return (
    <View style={styles.container}>
      <AmbientBackground />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('vault')}</Text>

              <View style={styles.subRow}>
                <Lock color="rgba(255,255,255,0.45)" size={11} />
                <Text style={styles.sub}>End-to-end · Family only</Text>
              </View>
            </View>

            <PressScale testID="vault-add" onPress={openAdd} style={styles.addBtn}>
              <Plus color="#080910" size={18} />
            </PressScale>
          </View>

          {showBlockingError ? (
            <ErrorState
              title="Vault unavailable"
              message={errorMessage || 'Could not load vault.'}
              onRetry={load}
            />
          ) : docs.length === 0 && !loading ? (
            <EmptyState
              title={t('no_docs')}
              message="Store school slips, insurance papers, IDs, and household documents."
              actionLabel={t('add_document')}
              onAction={openAdd}
            />
          ) : (
            <View style={styles.grid}>
              {docs.map((d) => {
                const cat = CATEGORIES.find((c) => c.key === d.category) || CATEGORIES[0];
                const Icon = cat.icon;

                return (
                  <PressScale
                    key={d.doc_id}
                    testID={`vault-doc-${d.doc_id}`}
                    onPress={() => setPreview(d)}
                    style={styles.tile}
                  >
                    <Image source={{ uri: d.image_base64 }} style={styles.tileImg} />
                    <View style={styles.tileOverlay} />

                    <View style={styles.tileTop}>
                      <View style={[styles.catPill, { borderColor: `${cat.tone}88` }]}>
                        <Icon color={cat.tone} size={11} />
                        <Text style={[styles.catText, { color: cat.tone }]}>
                          {t(d.category.toLowerCase())}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.tileTitle} numberOfLines={2}>
                      {d.title}
                    </Text>
                  </PressScale>
                );
              })}
            </View>
          )}

          <View style={{ height: 220 }} />
        </ScrollView>
      </SafeAreaView>

      <KeyboardAwareBottomSheet
        visible={showAdd}
        onClose={closeAdd}
        contentStyle={styles.sheet}
      >
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('add_document')}</Text>

          <PressScale testID="vault-close" onPress={closeAdd} style={styles.iconBtn}>
            <X color="#fff" size={18} />
          </PressScale>
        </View>

        <Text style={styles.label}>{t('title')}</Text>
        <TextInput
          testID="vault-title"
          value={title}
          onChangeText={setTitle}
          placeholder={t('title')}
          placeholderTextColor="rgba(255,255,255,0.3)"
          style={styles.input}
          returnKeyType="next"
        />

        <Text style={styles.label}>{t('doc_category')}</Text>
        <View style={styles.catRow}>
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = category === c.key;

            return (
              <PressScale
                key={c.key}
                testID={`vault-cat-${c.key}`}
                onPress={() => setCategory(c.key)}
                style={[
                  styles.catBtn,
                  {
                    borderColor: active ? c.tone : 'rgba(255,255,255,0.1)',
                    backgroundColor: active ? `${c.tone}22` : 'transparent',
                  },
                ]}
              >
                <Icon color={active ? c.tone : 'rgba(255,255,255,0.6)'} size={14} />
                <Text style={[styles.catBtnLabel, { color: active ? c.tone : 'rgba(255,255,255,0.7)' }]}>
                  {t(c.key.toLowerCase())}
                </Text>
              </PressScale>
            );
          })}
        </View>

        <PressScale testID="vault-pick" onPress={pickImage} style={styles.pick}>
          {image ? (
            <Image source={{ uri: image }} style={styles.pickImg} />
          ) : (
            <Text style={styles.pickText}>Tap to pick document image</Text>
          )}
        </PressScale>

        <View style={styles.sheetFooter}>
          <PressScale testID="vault-cancel" onPress={closeAdd} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>

          <PressScale
            testID="vault-save"
            onPress={save}
            disabled={saving || !title.trim() || !image}
            style={[styles.saveBtn, (!title.trim() || !image || saving) && { opacity: 0.5 }]}
          >
            <Text style={styles.saveText}>{saving ? '...' : t('save')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.backdrop} />

        {preview ? (
          <View style={styles.previewWrap}>
            <View style={styles.previewTop}>
              <Text style={styles.previewTitle}>{preview.title}</Text>

              <View style={styles.previewActions}>
                <PressScale testID="preview-delete" onPress={() => remove(preview)} style={styles.iconBtn}>
                  <Trash2 color="#EF4444" size={18} />
                </PressScale>

                <PressScale testID="preview-close" onPress={() => setPreview(null)} style={styles.iconBtn}>
                  <X color="#fff" size={18} />
                </PressScale>
              </View>
            </View>

            <Image source={{ uri: preview.image_base64 }} style={styles.previewImg} />
          </View>
        ) : null}
      </Modal>

      <LoadingOverlay visible={loading} label="Loading vault..." />

      <AppToast
        visible={Boolean(toast)}
        message={toast?.message || null}
        tone={toast?.tone || 'info'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080910' },
  safeArea: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24 },
  title: { fontFamily: 'PlayfairDisplay_400Regular_Italic', color: '#fff', fontSize: 40, lineHeight: 46 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  sub: { fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  addBtn: {
    width: 44, height: 44, borderRadius: 9999, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' },
  tile: {
    width: '48%',
    aspectRatio: 0.85,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.03)',
    justifyContent: 'space-between',
    padding: 12,
  },
  tileImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  tileOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.55)' },
  tileTop: { flexDirection: 'row' },
  catPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderRadius: 9999, backgroundColor: 'rgba(8,9,16,0.6)',
  },
  catText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.4 },
  tileTitle: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.5)' },
  sheet: {
    backgroundColor: 'rgba(20,22,32,0.98)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 24,
    paddingBottom: 130,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sheetTitle: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 26, color: '#fff' },
  iconBtn: { padding: 8, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  label: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', fontFamily: 'Inter_400Regular', fontSize: 15,
  },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9999, borderWidth: 1,
  },
  catBtnLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  pick: {
    marginTop: 16, height: 140, borderRadius: 16, borderWidth: 1, borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)',
  },
  pickImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  pickText: { color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter_400Regular', fontSize: 13 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  cancelText: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_500Medium', fontSize: 15 },
  saveBtn: { flex: 1, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: '#080910', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  previewWrap: { flex: 1, padding: 24, justifyContent: 'center' },
  previewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  previewTitle: { flex: 1, color: '#fff', fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 24 },
  previewActions: { flexDirection: 'row', gap: 8 },
  previewImg: {
    width: '100%', aspectRatio: 0.75, borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
});
