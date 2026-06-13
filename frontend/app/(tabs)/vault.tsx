import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Plus, X, Trash2, Stethoscope, BookOpen, Shield, Scale, Bell, Folder, MoreVertical, FileText } from 'lucide-react-native';

import { PressScale } from '../../src/components/PressScale';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast, { ToastTone } from '../../src/components/AppToast';
import LoadingOverlay from '../../src/components/LoadingOverlay';
import { Badge, Card, IconTile, ProgressBar, ScreenHeader, UI } from '../../src/components/Kit';

import { useStore } from '../../src/store';
import { api, VaultDoc } from '../../src/api';
import { logger } from '../../src/logger';

const CATEGORIES = [
  { key: 'Medical', icon: Stethoscope, tone: UI.orange, soft: UI.orangeSoft },
  { key: 'School', icon: BookOpen, tone: UI.lavenderText, soft: UI.lavender },
  { key: 'Insurance', icon: Shield, tone: UI.mintText, soft: UI.mint },
  { key: 'Legal', icon: Scale, tone: UI.goldText, soft: UI.gold },
];

function catInfo(key: string) {
  return CATEGORIES.find((c) => c.key === key) || CATEGORIES[0];
}

function updatedLine(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `Updated ${d.toLocaleDateString([], { month: 'short', day: '2-digit' })}`;
}

type ToastState = { message: string; tone: ToastTone };

export default function VaultScreen() {
  const { t } = useStore();
  const router = useRouter();

  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState<VaultDoc | null>(null);
  const [filter, setFilter] = useState<string>('All');

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
      const res = await api.listVault();
      setDocs(res);
    } catch (e: any) {
      logger.warn('Vault load failed:', e?.message || e);
      showToast(e?.message || 'Could not load vault.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  const usedMb = useMemo(() => {
    const bytes = docs.reduce((sum, d) => sum + (d.image_base64?.length || 0) * 0.75, 0);
    return bytes / (1024 * 1024);
  }, [docs]);
  const usedLabel = usedMb >= 1 ? `${usedMb.toFixed(0)} MB` : `${(usedMb * 1024).toFixed(0)} KB`;
  const storagePct = Math.min(100, (usedMb / 500) * 100);

  const filtered = useMemo(() => (filter === 'All' ? docs : docs.filter((d) => d.category === filter)), [docs, filter]);

  const openAdd = () => {
    setTitle('');
    setCategory('Medical');
    setImage(null);
    setShowAdd(true);
  };
  const closeAdd = () => setShowAdd(false);

  const pickImage = async () => {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Gallery access is required.');
        return;
      }
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6 });
    if (!res.canceled && res.assets?.[0]) {
      const asset = res.assets[0];
      const imageValue = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
      setImage(imageValue);
    }
  };

  const save = async () => {
    if (!title.trim() || !image) return;
    setSaving(true);
    try {
      const created = await api.createVaultDoc({ title: title.trim(), category, image_base64: image });
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

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ScreenHeader
            eyebrow="Secure Storage"
            title={t('vault')}
            right={
              <PressScale onPress={() => router.navigate('/(tabs)/feed')} style={styles.bellWrap}>
                <Bell color={UI.text} size={24} />
              </PressScale>
            }
          />

          {/* Category filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll}>
            {['All', ...CATEGORIES.map((c) => c.key)].map((key) => {
              const active = filter === key;
              return (
                <PressScale key={key} testID={`vault-filter-${key}`} onPress={() => setFilter(key)} style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{key === 'All' ? 'All' : t(key.toLowerCase())}</Text>
                </PressScale>
              );
            })}
          </ScrollView>

          {/* Storage summary */}
          <Card style={styles.storageCard}>
            <IconTile bg={UI.orangeSoft} size={52} radius={16}>
              <Folder color={UI.orange} size={24} />
            </IconTile>
            <View style={{ flex: 1 }}>
              <Text style={styles.storageText}>{docs.length} document{docs.length === 1 ? '' : 's'} · {usedLabel} used</Text>
              <View style={{ marginTop: 10 }}>
                <ProgressBar pct={storagePct} />
              </View>
            </View>
          </Card>

          {/* Recent documents */}
          <View style={styles.recentHead}>
            <Text style={styles.recentTitle}>Recent documents</Text>
            <Text style={styles.recentTotal}>{filtered.length} total</Text>
          </View>

          {filtered.length === 0 && !loading ? (
            <Card style={styles.emptyCard}>
              <IconTile bg={UI.soft} size={52} radius={16}><FileText color={UI.muted} size={24} /></IconTile>
              <Text style={styles.emptyTitle}>{filter === 'All' ? t('no_docs') : `No ${filter.toLowerCase()} documents`}</Text>
              <Text style={styles.emptySub}>Store school slips, insurance papers, IDs, and household documents.</Text>
              <PressScale testID="vault-empty-add" onPress={openAdd} style={styles.emptyBtn}>
                <Plus color="#FFFFFF" size={18} />
                <Text style={styles.emptyBtnText}>{t('add_document')}</Text>
              </PressScale>
            </Card>
          ) : (
            <View style={styles.grid}>
              {filtered.map((d) => {
                const cat = catInfo(d.category);
                return (
                  <PressScale key={d.doc_id} testID={`vault-doc-${d.doc_id}`} onPress={() => setPreview(d)} style={styles.tile}>
                    <View style={styles.thumbWrap}>
                      <Image source={{ uri: d.image_base64 }} style={styles.thumbImg} />
                      <View style={styles.moreBtn}>
                        <MoreVertical color={UI.muted} size={16} />
                      </View>
                    </View>
                    <View style={styles.tileBody}>
                      <Badge label={d.category.toUpperCase()} bg={cat.soft} color={cat.tone} />
                      <Text style={styles.tileTitle} numberOfLines={2}>{d.title}</Text>
                      <Text style={styles.tileDate}>{updatedLine(d.created_at)}</Text>
                    </View>
                  </PressScale>
                );
              })}
            </View>
          )}
          <View style={{ height: 140 }} />
        </ScrollView>
      </SafeAreaView>

      <PressScale style={styles.fab} onPress={openAdd} testID="vault-add">
        <Plus color="#FFFFFF" size={28} />
      </PressScale>

      <KeyboardAwareBottomSheet visible={showAdd} onClose={closeAdd} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('add_document')}</Text>
          <PressScale testID="vault-close" onPress={closeAdd} style={styles.iconBtn}>
            <X color={UI.text} size={20} />
          </PressScale>
        </View>

        <Text style={styles.label}>{t('title')}</Text>
        <TextInput testID="vault-title" value={title} onChangeText={setTitle} placeholder={t('title')} placeholderTextColor={UI.muted} style={styles.input} returnKeyType="next" />

        <Text style={styles.label}>{t('doc_category')}</Text>
        <View style={styles.catRow}>
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = category === c.key;
            return (
              <PressScale key={c.key} testID={`vault-cat-${c.key}`} onPress={() => setCategory(c.key)} style={[styles.catBtn, { borderColor: active ? c.tone : UI.line, backgroundColor: active ? c.soft : UI.soft }]}>
                <Icon color={active ? c.tone : UI.muted} size={15} />
                <Text style={[styles.catBtnLabel, { color: active ? c.tone : UI.muted }]}>{t(c.key.toLowerCase())}</Text>
              </PressScale>
            );
          })}
        </View>

        <PressScale testID="vault-pick" onPress={pickImage} style={styles.pick}>
          {image ? <Image source={{ uri: image }} style={styles.pickImg} /> : <Text style={styles.pickText}>Tap to pick document image</Text>}
        </PressScale>

        <View style={styles.sheetFooter}>
          <PressScale testID="vault-cancel" onPress={closeAdd} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>
          <PressScale testID="vault-save" onPress={save} disabled={saving || !title.trim() || !image} style={[styles.saveBtn, (!title.trim() || !image || saving) && { opacity: 0.5 }]}>
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
                <PressScale testID="preview-delete" onPress={() => remove(preview)} style={styles.previewIconBtn}>
                  <Trash2 color="#EF4444" size={20} />
                </PressScale>
                <PressScale testID="preview-close" onPress={() => setPreview(null)} style={styles.previewIconBtn}>
                  <X color="#fff" size={20} />
                </PressScale>
              </View>
            </View>
            <Image source={{ uri: preview.image_base64 }} style={styles.previewImg} />
          </View>
        ) : null}
      </Modal>

      <LoadingOverlay visible={loading} label="Loading vault..." />
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 },
  bellWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },

  chipScroll: { marginTop: 18, marginHorizontal: -20 },
  chipRow: { gap: 9, paddingHorizontal: 20 },
  chip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 99, backgroundColor: UI.card, borderWidth: 1, borderColor: UI.line },
  chipActive: { backgroundColor: UI.text, borderColor: UI.text },
  chipText: { color: UI.muted, fontFamily: 'Inter_700Bold', fontSize: 14 },
  chipTextActive: { color: '#FFFFFF' },

  storageCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginTop: 16 },
  storageText: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },

  recentHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 14 },
  recentTitle: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, letterSpacing: -0.3 },
  recentTotal: { color: UI.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'space-between' },
  tile: { width: '48%', borderRadius: 20, backgroundColor: UI.card, borderWidth: 1, borderColor: UI.line, overflow: 'hidden', shadowColor: '#000000', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 2, marginBottom: 2 },
  thumbWrap: { height: 132, backgroundColor: UI.soft, alignItems: 'center', justifyContent: 'center' },
  thumbImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  moreBtn: { position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  tileBody: { padding: 12, gap: 7 },
  tileTitle: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15, lineHeight: 19 },
  tileDate: { color: UI.muted, fontFamily: 'Inter_500Medium', fontSize: 12 },

  emptyCard: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 22, gap: 10 },
  emptyTitle: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, textAlign: 'center' },
  emptySub: { color: UI.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  emptyBtn: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: UI.orange, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 99 },
  emptyBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  fab: { position: 'absolute', right: 22, bottom: 102, width: 61, height: 61, borderRadius: 999, backgroundColor: UI.orange, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 7 },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.5)' },
  sheet: { backgroundColor: UI.card, borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, borderColor: UI.line, padding: 26, paddingBottom: 140 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24, letterSpacing: -0.4 },
  iconBtn: { padding: 9, borderRadius: 9999, borderWidth: 1, borderColor: UI.line, backgroundColor: UI.soft },
  label: { color: UI.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: UI.line, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Inter_500Medium', fontSize: 16, color: UI.text, backgroundColor: UI.soft },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  catBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 9999, borderWidth: 1 },
  catBtnLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  pick: { marginTop: 18, height: 150, borderRadius: 18, borderWidth: 1, borderColor: UI.line, borderStyle: 'dashed', backgroundColor: UI.soft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pickImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  pickText: { color: UI.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: UI.line, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: UI.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', backgroundColor: UI.orange },
  saveText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  previewWrap: { flex: 1, padding: 24, justifyContent: 'center' },
  previewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  previewTitle: { flex: 1, color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 24 },
  previewActions: { flexDirection: 'row', gap: 8 },
  previewIconBtn: { padding: 10, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(15,23,42,0.55)' },
  previewImg: { width: '100%', aspectRatio: 0.75, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
});
