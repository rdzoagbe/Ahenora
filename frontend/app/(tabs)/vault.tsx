import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Platform,
  Pressable,
  Image,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Plus, X, Trash2, Stethoscope, BookOpen, Shield, Scale, Bell, Folder, ChevronRight, FileText, AlertTriangle, Share2, Image as ImageIcon } from 'lucide-react-native';

import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast, { ToastTone } from '../../src/components/AppToast';
import LoadingOverlay from '../../src/components/LoadingOverlay';
import { TabScreen } from '../../src/components/TabScreen';
import { PdfViewer } from '../../src/components/PdfViewer';
import { HtmlDocViewer } from '../../src/components/HtmlDocViewer';
import { Badge, Card, IconTile, ProgressBar, ScreenHeader, UI, useUI, UIColors } from '../../src/components/Kit';

import { useStore } from '../../src/store';

import { api, logEvent, Entitlements, ExpiryAlert, VaultDoc } from '../../src/api';
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

function isPdfDoc(doc: { mime_type?: string; image_base64?: string }) {
  if (doc.mime_type) return doc.mime_type === 'application/pdf';
  return !!doc.image_base64 && doc.image_base64.startsWith('data:application/pdf');
}

function isImageDoc(doc: { mime_type?: string; image_base64?: string }) {
  const mime = doc.mime_type;
  if (mime) return mime.startsWith('image/');
  // Legacy docs saved before mime tracking are always images.
  return !doc.image_base64 || doc.image_base64.startsWith('data:image') || !doc.image_base64.startsWith('data:');
}

function updatedLine(iso: string, t: (k: string) => string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${t('vault_updated')} ${d.toLocaleDateString([], { month: 'short', day: '2-digit' })}`;
}

type ToastState = { message: string; tone: ToastTone };

export default function Vault() {
  const { t } = useStore();
  const router = useRouter();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState<VaultDoc | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  const [docHtml, setDocHtml] = useState<string | null>(null);
  const [docRendering, setDocRendering] = useState(false);
  const openPreview = (d: VaultDoc) => {
    setPdfFailed(false);
    setDocHtml(null);
    setPreview(d);
    // Images and PDFs render from the bytes the app already has. Everything
    // else (Word/Excel/…) is converted to readable HTML by the backend.
    if (!isImageDoc(d) && !isPdfDoc(d)) {
      setDocRendering(true);
      api.renderVaultDoc(d.doc_id)
        .then((r) => { if (r.kind === 'html' && r.html) setDocHtml(r.html); })
        .catch(() => undefined)
        .finally(() => setDocRendering(false));
    }
  };
  const [filter, setFilter] = useState<string>('All');

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Medical');
  const [image, setImage] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [fileName, setFileName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2300);
  }, []);

  const load = useCallback(async () => {
    try {
      const [vaultRes, expiryRes, entRes] = await Promise.allSettled([api.listVault(), api.vaultExpiryAlerts(), api.getEntitlements()]);
      if (vaultRes.status === 'fulfilled') setDocs(vaultRes.value);
      if (expiryRes.status === 'fulfilled') setExpiryAlerts(expiryRes.value);
      if (entRes.status === 'fulfilled') setEntitlements(entRes.value);
      if (vaultRes.status === 'rejected') {
        logger.warn('Vault load failed:', vaultRes.reason);
        showToast(t('vault_could_not_load'), 'error');
      }
    } catch (e: any) {
      logger.warn('Vault load failed:', e?.message || e);
      showToast(e?.message || t('vault_could_not_load'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const usedBytes = useMemo(() => {
    // Prefer the server-computed total; fall back to estimating from loaded docs.
    if (entitlements) return entitlements.vault_bytes_used;
    return docs.reduce((sum, d) => sum + (d.image_base64?.length || 0) * 0.75, 0);
  }, [entitlements, docs]);
  const usedMb = usedBytes / (1024 * 1024);
  const limitMb = entitlements ? entitlements.vault_bytes_limit / (1024 * 1024) : 500;
  const usedLabel = usedMb >= 1 ? `${usedMb.toFixed(0)} MB` : `${(usedMb * 1024).toFixed(0)} KB`;
  const storagePct = limitMb > 0 ? Math.min(100, (usedMb / limitMb) * 100) : 0;

  const filtered = useMemo(() => (filter === 'All' ? docs : docs.filter((d) => d.category === filter)), [docs, filter]);

  const openAdd = () => {
    setTitle('');
    setCategory('Medical');
    setImage(null);
    setMimeType('image/jpeg');
    setFileName(null);
    setShowAdd(true);
  };
  const closeAdd = () => setShowAdd(false);

  const pickImage = async () => {
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('vault_permission_needed'), t('vault_gallery_access_required'));
          return;
        }
      }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6 });
      if (!res.canceled && res.assets?.[0]) {
        const asset = res.assets[0];
        const imageValue = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
        setImage(imageValue);
        setMimeType('image/jpeg');
        setFileName(null);
        if (!title.trim() && asset.fileName) setTitle(asset.fileName.replace(/\.[^.]+$/, ''));
      }
    } catch (e: any) {
      logger.warn('pickImage failed:', e?.message || e);
      Alert.alert(t('vault_could_not_open_gallery'), t('vault_please_try_again'));
    }
  };

  const pickDocument = async () => {
    // expo-document-picker is a native module bundled from the next build on;
    // older binaries fall back to a friendly nudge instead of crashing.
    let DocumentPicker: any;
    try {
      DocumentPicker = require('expo-document-picker');
    } catch {
      showToast(t('vault_files_update_needed'), 'info');
      return;
    }
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const mime = asset.mimeType || 'application/octet-stream';
      // PDFs and non-image files can be large; guard against oversized picks.
      if (asset.size && asset.size > 8 * 1024 * 1024) {
        Alert.alert(t('vault_file_too_large'), t('vault_file_too_large_msg'));
        return;
      }
      const FS = require('expo-file-system/legacy');
      const b64 = await FS.readAsStringAsync(asset.uri, { encoding: FS.EncodingType.Base64 });
      setImage(`data:${mime};base64,${b64}`);
      setMimeType(mime);
      setFileName(asset.name || null);
      if (!title.trim() && asset.name) setTitle(asset.name.replace(/\.[^.]+$/, ''));
    } catch (e: any) {
      logger.warn('pickDocument failed:', e?.message || e);
      Alert.alert(t('vault_could_not_open_files'), t('vault_please_try_again'));
    }
  };

  const save = async () => {
    if (!title.trim() || !image) return;
    setSaving(true);
    try {
      const created = await api.createVaultDoc({ title: title.trim(), category, image_base64: image, mime_type: mimeType, file_name: fileName || undefined });
      setDocs((prev) => [created, ...prev]);
      setTitle('');
      setImage(null);
      setMimeType('image/jpeg');
      setFileName(null);
      setCategory('Medical');
      setShowAdd(false);
      showToast(t('vault_document_saved'), 'success');
      logEvent('vault_added');
    } catch (e: any) {
      logger.warn('Save vault document failed:', e?.message || e);
      showToast(e?.message || t('vault_could_not_save'), 'error');
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
      showToast(t('vault_document_deleted'), 'success');
    } catch (e: any) {
      logger.warn('Delete vault document failed:', e?.message || e);
      setDocs(previous);
      showToast(t('vault_could_not_delete'), 'error');
      load();
    }
  };

  const shareDoc = useCallback(async (doc: VaultDoc) => {
    // expo-sharing ships with newer app builds only; older binaries get a
    // friendly nudge instead of a crash.
    let Sharing: any;
    try {
      Sharing = require('expo-sharing');
      if (!(await Sharing.isAvailableAsync())) throw new Error('unavailable');
    } catch {
      showToast(t('vault_share_update_needed'), 'info');
      return;
    }
    try {
      const FS = require('expo-file-system/legacy');
      const data = doc.image_base64 || '';
      const match = data.match(/^data:([\w/+.-]+);base64,(.+)$/);
      const mime = doc.mime_type || (match ? match[1] : 'image/jpeg');
      const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };
      const ext = EXT[mime] || 'bin';
      const safeId = String(doc.doc_id || "doc").replace(/[^A-Za-z0-9_-]/g, "_");
      const fileUri = `${FS.cacheDirectory}${safeId}.${ext}`;
      await FS.writeAsStringAsync(fileUri, match ? match[2] : data, { encoding: FS.EncodingType.Base64 });
      await Sharing.shareAsync(fileUri, { mimeType: mime, dialogTitle: doc.title });
      logEvent('vault_shared');
    } catch (e: any) {
      logger.warn('Share doc failed:', e?.message || e);
      showToast(t('vault_share_error'), 'error');
    }
  }, [showToast, t]);

  // Open a document for *reading* (not sharing): PDFs/files launch in the
  // phone's viewer. On Android we fire a VIEW intent so it opens directly;
  // elsewhere (and on older builds) we fall back to the share/quick-look sheet.
  const openDoc = useCallback(async (doc: VaultDoc) => {
    try {
      const FS = require('expo-file-system/legacy');
      const data = doc.image_base64 || '';
      const match = data.match(/^data:([\w/+.-]+);base64,(.+)$/);
      const mime = doc.mime_type || (match ? match[1] : 'application/octet-stream');
      const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };
      const ext = EXT[mime] || 'bin';
      const safeId = String(doc.doc_id || "doc").replace(/[^A-Za-z0-9_-]/g, "_");
      const fileUri = `${FS.cacheDirectory}${safeId}.${ext}`;
      await FS.writeAsStringAsync(fileUri, match ? match[2] : data, { encoding: FS.EncodingType.Base64 });

      if (Platform.OS === 'android') {
        try {
          const IntentLauncher = require('expo-intent-launcher');
          const contentUri = await FS.getContentUriAsync(fileUri);
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
            type: mime,
          });
          logEvent('vault_shared');
          return;
        } catch {
          // No viewer / module unavailable — fall through to the share sheet.
        }
      }

      let Sharing: any;
      try {
        Sharing = require('expo-sharing');
        if (!(await Sharing.isAvailableAsync())) throw new Error('unavailable');
      } catch {
        showToast(t('vault_no_pdf_viewer'), 'info');
        return;
      }
      await Sharing.shareAsync(fileUri, { mimeType: mime, dialogTitle: doc.title });
      logEvent('vault_shared');
    } catch (e: any) {
      logger.warn('Open doc failed:', e?.message || e);
      showToast(t('vault_open_error'), 'error');
    }
  }, [showToast, t]);

  const confirmRemove = (doc: VaultDoc) => {
    Alert.alert(
      t('vault_delete_document_title'),
      `"${doc.title}" ${t('vault_delete_doc_message')}`,
      [
        { text: t('vault_cancel'), style: 'cancel' },
        { text: t('vault_delete'), style: 'destructive', onPress: () => remove(doc) },
      ],
    );
  };


  return (
    <SwipeableTabView style={styles.container}>
      <TabScreen
        tab="Vault"
        refreshing={refreshing}
        onRefresh={handleRefresh}
        scrollViewProps={{ contentContainerStyle: styles.scroll, keyboardShouldPersistTaps: 'handled' }}
      >
          <ScreenHeader
            eyebrow={t('vault_secure_storage')}
            title={t('vault')}
            right={
              <PressScale onPress={() => router.navigate('/(tabs)/feed')} style={styles.bellWrap}>
                <Bell color={ui.text} size={24} />
              </PressScale>
            }
          />

          {/* Category filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.chipScroll}>
            {['All', ...CATEGORIES.map((c) => c.key)].map((key) => {
              const active = filter === key;
              return (
                <PressScale key={key} testID={`vault-filter-${key}`} onPress={() => setFilter(key)} style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{key === 'All' ? t('vault_all') : t(key.toLowerCase())}</Text>
                </PressScale>
              );
            })}
          </ScrollView>

          {/* Storage summary */}
          <Card style={styles.storageCard}>
            <IconTile bg={ui.orangeSoft} size={52} radius={16}>
              <Folder color={ui.orange} size={24} />
            </IconTile>
            <View style={{ flex: 1 }}>
              <Text style={styles.storageText}>{docs.length} {docs.length === 1 ? t('vault_document') : t('vault_documents')} · {usedLabel} {t('vault_of')} {limitMb >= 1024 ? `${(limitMb / 1024).toFixed(0)} GB` : `${limitMb.toFixed(0)} MB`}</Text>
              <View style={{ marginTop: 10 }}>
                <ProgressBar pct={storagePct} />
              </View>
            </View>
          </Card>

          {/* Recent documents */}
          <View style={styles.recentHead}>
            <Text style={styles.recentTitle}>{t('vault_recent_documents')}</Text>
            <Text style={styles.recentTotal}>{filtered.length} {t('vault_total')}</Text>
          </View>

          {filtered.length === 0 && !loading ? (
            <Card style={styles.emptyCard}>
              <IconTile bg={ui.soft} size={52} radius={16}><FileText color={ui.muted} size={24} /></IconTile>
              <Text style={styles.emptyTitle}>{filter === 'All' ? t('no_docs') : `${t('vault_no')} ${t(filter.toLowerCase())} ${t('vault_documents')}`}</Text>
              <Text style={styles.emptySub}>{t('vault_empty_sub')}</Text>
              <PressScale testID="vault-empty-add" onPress={openAdd} style={styles.emptyBtn}>
                <Plus color="#FFFFFF" size={18} />
                <Text style={styles.emptyBtnText}>{t('add_document')}</Text>
              </PressScale>
            </Card>
          ) : (
            <View style={styles.list}>
              {filtered.map((d) => {
                const cat = catInfo(d.category);
                const isImg = isImageDoc(d);
                return (
                  <PressScale key={d.doc_id} testID={`vault-doc-${d.doc_id}`} onPress={() => openPreview(d)} style={styles.listRow}>
                    <View style={[styles.listThumb, { backgroundColor: cat.soft }]}>
                      {isImg ? (
                        <Image source={{ uri: d.image_base64 }} style={styles.listThumbImg} />
                      ) : (
                        <FileText color={cat.tone} size={22} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
                      <Text style={styles.listTitle} numberOfLines={1}>{d.title}</Text>
                      <View style={styles.listMeta}>
                        <Badge label={d.category.toUpperCase()} bg={cat.soft} color={cat.tone} />
                        <Text style={styles.listDate}>{updatedLine(d.created_at, t)}</Text>
                      </View>
                    </View>
                    <ChevronRight color={ui.muted} size={18} />
                  </PressScale>
                );
              })}
            </View>
          )}
          {/* Document Expiry Alerts */}
          {expiryAlerts.length > 0 ? (
            <>
              <View style={styles.recentHead}>
                <View style={styles.shopHeaderLeft}>
                  <AlertTriangle color="#DC2626" size={20} />
                  <Text style={styles.recentTitle}>{t('vault_expiry_alerts')}</Text>
                </View>
                <Text style={styles.recentTotal}>{expiryAlerts.length} {expiryAlerts.length === 1 ? t('vault_alert') : t('vault_alerts')}</Text>
              </View>
              <View style={styles.shopCard}>
                {expiryAlerts.slice(0, 6).map((alert) => (
                  <View key={alert.doc_id} style={styles.shopRow}>
                    <View style={[styles.expiryDot, { backgroundColor: alert.status === 'expired' ? '#DC2626' : alert.status === 'urgent' ? '#F59E0B' : ui.mintText }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.shopItemText}>{alert.title}</Text>
                      <Text style={styles.shopCat}>
                        {alert.status === 'expired' ? `${t('vault_expired')} ${Math.abs(alert.days_left)} ${t('vault_days_ago')}` : `${alert.days_left} ${t('vault_days_left')}`} · {alert.category}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <View style={{ height: 140 }} />
      </TabScreen>

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={openAdd}
        testID="vault-add"
      >
        <Plus color="#FFFFFF" size={28} />
      </Pressable>

      <KeyboardAwareBottomSheet visible={showAdd} onClose={closeAdd} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('add_document')}</Text>
          <PressScale testID="vault-close" onPress={closeAdd} style={styles.iconBtn}>
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        <Text style={styles.label}>{t('title')}</Text>
        <TextInput testID="vault-title" value={title} onChangeText={setTitle} placeholder={t('title')} placeholderTextColor={ui.muted} style={styles.input} returnKeyType="next" />

        <Text style={styles.label}>{t('doc_category')}</Text>
        <View style={styles.catRow}>
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const active = category === c.key;
            return (
              <PressScale key={c.key} testID={`vault-cat-${c.key}`} onPress={() => setCategory(c.key)} style={[styles.catBtn, { borderColor: active ? c.tone : ui.line, backgroundColor: active ? c.soft : ui.soft }]}>
                <Icon color={active ? c.tone : ui.muted} size={15} />
                <Text style={[styles.catBtnLabel, { color: active ? c.tone : ui.muted }]}>{t(c.key.toLowerCase())}</Text>
              </PressScale>
            );
          })}
        </View>

        <View style={styles.pickRow}>
          <PressScale testID="vault-pick-photo" onPress={pickImage} style={styles.pickOption}>
            <ImageIcon color={ui.orange} size={20} />
            <Text style={styles.pickOptionText}>{t('vault_pick_photo')}</Text>
          </PressScale>
          <PressScale testID="vault-pick-file" onPress={pickDocument} style={styles.pickOption}>
            <FileText color={ui.lavenderText} size={20} />
            <Text style={styles.pickOptionText}>{t('vault_pick_file')}</Text>
          </PressScale>
        </View>

        {image ? (
          isImageDoc({ mime_type: mimeType, image_base64: image }) ? (
            <View style={styles.pick}>
              <Image source={{ uri: image }} style={styles.pickImg} />
            </View>
          ) : (
            <View style={[styles.pick, styles.pickFile]}>
              <FileText color={ui.lavenderText} size={34} />
              <Text style={styles.pickFileName} numberOfLines={1}>{fileName || t('vault_file_selected')}</Text>
            </View>
          )
        ) : (
          <View style={[styles.pick, styles.pickEmpty]}>
            <Text style={styles.pickText}>{t('vault_pick_document_image')}</Text>
          </View>
        )}

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
                <PressScale testID="preview-share" onPress={() => shareDoc(preview)} style={styles.previewIconBtn}>
                  <Share2 color="#fff" size={20} />
                </PressScale>
                <PressScale testID="preview-delete" onPress={() => confirmRemove(preview)} style={styles.previewIconBtn}>
                  <Trash2 color="#EF4444" size={20} />
                </PressScale>
                <PressScale testID="preview-close" onPress={() => setPreview(null)} style={styles.previewIconBtn}>
                  <X color="#fff" size={20} />
                </PressScale>
              </View>
            </View>
            <Text style={styles.previewMeta}>
              {t(preview.category.toLowerCase())} · {updatedLine(preview.created_at, t)}
              {preview.file_name ? ` · ${preview.file_name}` : ''}
            </Text>
            {isImageDoc(preview) ? (
              <Image source={{ uri: preview.image_base64 }} style={styles.previewImg} />
            ) : isPdfDoc(preview) && !pdfFailed ? (
              <View style={styles.previewPdfWrap}>
                <PdfViewer base64={preview.image_base64} onError={() => setPdfFailed(true)} />
                <PressScale testID="preview-open-ext" onPress={() => openDoc(preview)} style={styles.previewExternalRow}>
                  <Text style={styles.previewExternalText}>{t('vault_open_external')}</Text>
                </PressScale>
              </View>
            ) : docHtml ? (
              <View style={styles.previewPdfWrap}>
                <HtmlDocViewer html={docHtml} />
                <PressScale testID="preview-open-ext" onPress={() => openDoc(preview)} style={styles.previewExternalRow}>
                  <Text style={styles.previewExternalText}>{t('vault_open_external')}</Text>
                </PressScale>
              </View>
            ) : docRendering ? (
              <View style={styles.previewFile}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.previewFileName}>{t('vault_loading')}</Text>
              </View>
            ) : (
              <View style={styles.previewFile}>
                <FileText color="#fff" size={64} />
                <Text style={styles.previewFileName} numberOfLines={2}>{preview.file_name || preview.title}</Text>
                <Text style={styles.previewNote}>{t('vault_no_inapp_view')}</Text>
                <PressScale testID="preview-open" onPress={() => openDoc(preview)} style={styles.previewOpenBtn}>
                  <FileText color="#fff" size={18} />
                  <Text style={styles.previewOpenText}>{t('vault_open_file')}</Text>
                </PressScale>
              </View>
            )}
          </View>
        ) : null}
      </Modal>

      <LoadingOverlay visible={loading} label={t('vault_loading')} />
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} />
    </SwipeableTabView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 },
  bellWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },

  chipScroll: { marginTop: 18, marginHorizontal: -20 },
  chipRow: { gap: 9, paddingHorizontal: 20 },
  chip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 99, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line },
  chipActive: { backgroundColor: ui.text, borderColor: ui.text },
  chipText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 14 },
  chipTextActive: { color: ui.bg },

  storageCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginTop: 16 },
  storageText: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },

  recentHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 14 },
  recentTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, letterSpacing: -0.3 },
  recentTotal: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  list: { gap: 10 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingVertical: 11, paddingHorizontal: 12 },
  listThumb: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  listThumbImg: { width: 46, height: 46, resizeMode: 'cover' },
  listTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15, letterSpacing: -0.2 },
  listMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listDate: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12 },

  emptyCard: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 22, gap: 10 },
  emptyTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, textAlign: 'center' },
  emptySub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  emptyBtn: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: ui.orange, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 99 },
  emptyBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  fab: { position: 'absolute', right: 22, bottom: 102, width: 61, height: 61, borderRadius: 999, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 7, zIndex: 30 },
  fabPressed: { backgroundColor: '#D9530F', transform: [{ scale: 0.96 }] },

  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.5)' },
  sheet: { backgroundColor: ui.card, borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, borderColor: ui.line, padding: 26, paddingBottom: 140 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24, letterSpacing: -0.4 },
  iconBtn: { padding: 9, borderRadius: 9999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  label: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Inter_500Medium', fontSize: 16, color: ui.text, backgroundColor: ui.soft },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  catBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 9999, borderWidth: 1 },
  catBtnLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  pickRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  pickOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 16, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  pickOptionText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  pick: { marginTop: 12, height: 150, borderRadius: 18, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pickEmpty: { borderStyle: 'dashed' },
  pickFile: { gap: 10, paddingHorizontal: 20 },
  pickFileName: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center' },
  pickImg: { ...StyleSheet.absoluteFillObject, resizeMode: 'cover' },
  pickText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', backgroundColor: ui.orange },
  saveText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  previewWrap: { flex: 1, padding: 24, justifyContent: 'center' },
  previewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  previewTitle: { flex: 1, color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 24 },
  previewMeta: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 14, marginTop: -6 },
  previewPdfWrap: { flex: 1, width: '100%' },
  previewExternalRow: { alignSelf: 'center', marginTop: 10, paddingVertical: 8, paddingHorizontal: 14 },
  previewExternalText: { color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_700Bold', fontSize: 13, textDecorationLine: 'underline' },
  previewNote: { color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', marginTop: -4 },
  previewActions: { flexDirection: 'row', gap: 8 },
  previewIconBtn: { padding: 10, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(15,23,42,0.55)' },
  previewImg: { width: '100%', aspectRatio: 0.75, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  previewFile: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(15,23,42,0.45)' },
  previewFileName: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 17, textAlign: 'center', paddingHorizontal: 24 },
  previewOpenBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 99, paddingHorizontal: 20, paddingVertical: 12 },
  previewOpenText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },

  shopHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: ui.mint },
  clearBtnText: { color: ui.mintText, fontFamily: 'Inter_700Bold', fontSize: 12 },
  shopCard: { borderRadius: 20, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, padding: 14, gap: 4 },
  shopInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  shopInput: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'Inter_500Medium', fontSize: 14, color: ui.text, backgroundColor: ui.soft },
  shopAddBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center' },
  shopRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: ui.line },
  shopNumberBadge: { width: 24, height: 24, borderRadius: 99, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  shopNumberText: { color: ui.orange, fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  shopHint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center', paddingTop: 10 },
  shopItemText: { flex: 1, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  shopItemDone: { textDecorationLine: 'line-through', color: ui.muted },
  shopCat: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12 },
  shopDivider: { marginTop: 8, paddingVertical: 4 },
  shopDividerText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  shopEmpty: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, textAlign: 'center', paddingVertical: 14 },
  mealDayLabel: { color: ui.lavenderText, fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 2 },
  mealDayChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  mealDayChipActive: { backgroundColor: ui.lavender, borderColor: ui.lavenderText },
  mealDayChipText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13, textTransform: 'capitalize' },
  mealDayChipTextActive: { color: ui.lavenderText },
  expiryDot: { width: 10, height: 10, borderRadius: 99 },
});
