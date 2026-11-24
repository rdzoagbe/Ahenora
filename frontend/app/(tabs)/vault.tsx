import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Platform,
  Image,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { pickPicture } from '../../src/pickPicture';
import { Plus, X, Trash2, ChevronRight, ChevronDown, Camera, FileText, CalendarClock, Share2, Image as ImageIcon, Lock, Users, Search } from 'lucide-react-native';

import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast from '../../src/components/AppToast';
import { useToast } from '../../src/hooks/useToast';
import LoadingOverlay from '../../src/components/LoadingOverlay';
import { TabScreen } from '../../src/components/TabScreen';
import { PdfViewer } from '../../src/components/PdfViewer';
import DatePickerSheet from '../../src/components/DatePickerSheet';
import { HtmlDocViewer } from '../../src/components/HtmlDocViewer';
import { ScreenHeader, useUI, UIColors } from '../../src/components/Kit';
import { closeAlerts, expiryPhrase, groupByDrawer, matchesQuery, ownerLine } from '../../src/vaultTop';
import { CATEGORY_STATIC, categoryStyle } from '../../src/documentCategories';

import { useStore } from '../../src/store';

import { api, logEvent, Entitlements, ExpiryAlert, FamilyMember, VaultDoc, VaultVisibility } from '../../src/api';
import { offerUndo } from '../../src/trashUndo';
import { logger } from '../../src/logger';
import { apiErrorText } from '../../src/apiError';
import { refreshOutcome } from '../../src/refreshOutcome';
import { onVaultChanged } from '../../src/vaultChanged';
import { parseDisplayDate } from '../../src/dateDisplay';
import { localDayIso, localeFor } from '../../src/utils/date';
import { SECTION_ART } from '../../src/sectionArt';

// The drawers now live in one module shared with the scan router, so the
// list the model is offered and the list the screen renders cannot drift.
const CATEGORIES = CATEGORY_STATIC;

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


export default function Vault() {
  const { t, lang, user } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [preview, setPreview] = useState<VaultDoc | null>(null);
  const [pdfFailed, setPdfFailed] = useState(false);
  // The document a tapped notification was about. "Roland shared a document
  // with you" used to open the Vault and stop there, leaving the reader to
  // find the thing the notification had just told them about — on a screen
  // that may hold dozens. The push has always carried the id; nothing read it.
  const { docId: notifiedDocId } = useLocalSearchParams<{ docId?: string }>();
  const router = useRouter();
  const openedFromNotification = useRef<string | null>(null);
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
  const [visibility, setVisibility] = useState<VaultVisibility>('private');
  // "These people": the member rows with an account, other than me.
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [chosenIds, setChosenIds] = useState<string[]>([]);
  useEffect(() => { api.familyMembers().then(setMembers).catch(() => setMembers([])); }, []);

  // Flip a document between private and shared. On a legacy document (no
  // owner recorded) this also claims it, which is how documents uploaded
  // before this feature become genuinely private.
  const toggleVisibility = async (doc: VaultDoc) => {
    const next: VaultVisibility = (doc.visibility || 'shared') === 'shared' ? 'private' : 'shared';
    try {
      const updated = await api.setVaultVisibility(doc.doc_id, next);
      setDocs((prev) => prev.map((d) => (d.doc_id === doc.doc_id ? updated : d)));
      setPreview((p) => (p && p.doc_id === doc.doc_id ? updated : p));
      showToast(next === 'private' ? t('vault_now_private') : t('vault_now_shared'), 'success');
    } catch (e: any) {
      const detail = String(e?.message || '').match(/\{.*"detail"\s*:\s*"([^"]+)"/)?.[1];
      showToast(detail || t('vault_could_not_save'), 'error');
    }
  };

  // --- When a document runs out -------------------------------------------
  //
  // Expiry dates arrive from a camera scan reading a passport, and a scan can
  // be wrong in two directions: the wrong date, or a date on a document that
  // has none at all. Until now nothing could correct either, so a misread put
  // a permanent alert on this screen and a recurring push behind it.
  const [expiryFor, setExpiryFor] = useState<VaultDoc | null>(null);

  const saveExpiry = async (doc: VaultDoc, chosen: string | null) => {
    // The picker speaks the display string it shows; the server wants a date.
    const parsed = chosen ? parseDisplayDate(chosen, localeFor(lang)) : null;
    if (chosen && !parsed) { showToast(t('vault_could_not_save'), 'error'); return; }
    // The day, not the moment. toISOString() of local midnight was "the
    // evening before, UTC", and a co-parent in another timezone read the
    // passport as expiring a day early. A bare date is pinned by the server
    // to noon UTC, which is that same day everywhere.
    const iso = parsed ? localDayIso(parsed) : null;
    setExpiryFor(null);
    try {
      await api.setVaultExpiry(doc.doc_id, iso);
      const patch = (d: VaultDoc) => ({ ...d, expiry_date: iso });
      setDocs((prev) => prev.map((d) => (d.doc_id === doc.doc_id ? patch(d) : d)));
      setPreview((p) => (p && p.doc_id === doc.doc_id ? patch(p) : p));
      // The alert list is derived server-side, so it has to be re-read rather
      // than patched — clearing a date must take its alert away with it.
      setExpiryAlerts(await api.vaultExpiryAlerts().catch(() => []));
      showToast(iso ? t('vault_expiry_saved') : t('vault_expiry_cleared'), 'success');
    } catch (e: any) {
      logger.warn('set expiry failed', e);
      showToast(t('vault_could_not_save'), 'error');
    }
  };

  const expiryLabel = (doc: VaultDoc | null) => {
    if (!doc?.expiry_date) return t('vault_no_expiry');
    const when = new Date(doc.expiry_date);
    if (Number.isNaN(when.getTime())) return t('vault_no_expiry');
    return when.toLocaleDateString(localeFor(lang),
      { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Medical');
  const [image, setImage] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string>('image/jpeg');
  const [fileName, setFileName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { toast, showToast } = useToast();
  const [expiryAlerts, setExpiryAlerts] = useState<ExpiryAlert[]>([]);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);

  const load = useCallback(async (): Promise<number | null> => {
    let loaded: number | null = null;
    // Visits, not just saves. vault_added and vault_shared count what people
    // DO here, so "nobody opens the vault" and "people open it and add
    // nothing" were indistinguishable — and a claim about the first was used
    // to argue for promoting it out of the More drawer and into the bar. There
    // was no number to check that against. Now there is.
    logEvent('vault_open');
    try {
      const [vaultRes, expiryRes, entRes] = await Promise.allSettled([api.listVault(), api.vaultExpiryAlerts(), api.getEntitlements()]);
      if (vaultRes.status === 'fulfilled') {
        setDocs(vaultRes.value);
        // Reported, not read back off state: a caller in the same tick sees
        // the OLD count, which is how a refresh says nothing arrived when
        // something did.
        loaded = vaultRes.value.length;
      }
      if (expiryRes.status === 'fulfilled') setExpiryAlerts(expiryRes.value);
      if (entRes.status === 'fulfilled') setEntitlements(entRes.value);
      if (vaultRes.status === 'rejected') {
        logger.warn('Vault load failed:', vaultRes.reason);
        showToast(t('vault_could_not_load'), 'error');
      }
    } catch (e: any) {
      logger.warn('Vault load failed:', e?.message || e);
      showToast(apiErrorText(e, t, 'vault_could_not_load'), 'error');
    } finally {
      setLoading(false);
    }
    return loaded;
  }, [showToast]);

  // Plain function: the manual memo here blocked React Compiler on this screen.
  // Keeps the "before" count without putting docs in a dependency list, which
  // would hand the RefreshControl a new function mid-pull.
  const docsRef = useRef<VaultDoc[]>([]);
  useEffect(() => { docsRef.current = docs; }, [docs]);

  // Open the document a notification was about, once the list it is in has
  // arrived. Guarded by the id rather than a boolean so a second notification
  // about a different document still opens, and so the preview does not
  // reappear after the reader closes it and the list reloads.
  //
  // Not finding it is not an error: a document can be deleted, or its sharing
  // narrowed, between the push and the tap. The reader is then simply left on
  // the Vault, which is where they were going anyway.
  useEffect(() => {
    // The parameter is spent once honoured, and the latch is released only
    // when it is actually gone. Two failures are being avoided at once: the
    // latch alone stopped the preview reappearing on every list reload, but
    // it also meant a SECOND tap on the same notification set the same id,
    // matched the latch and opened nothing — a tap silently doing nothing,
    // which is the complaint this screen was changed to answer. Releasing it
    // inline would have brought the reload problem back. Found in review.
    if (!notifiedDocId) {
      openedFromNotification.current = null;
      return;
    }
    if (loading) return;
    if (openedFromNotification.current === notifiedDocId) return;
    const found = docs.find((d) => d.doc_id === notifiedDocId);
    if (!found) return;
    openedFromNotification.current = notifiedDocId;
    openPreview(found);
    router.setParams({ docId: undefined });
    // openPreview is re-created every render and is not a dependency worth
    // stabilising for: the id latch above is what stops this running twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifiedDocId, loading, docs, router]);

  const handleRefresh = async () => {
    setRefreshing(true);
    const before = { items: docsRef.current.length };
    const loaded = await load();
    setRefreshing(false);
    // And then say so. A spinner that turns and stops is not an answer: on a
    // day when nothing changed it is indistinguishable from a gesture that
    // never fired, which is exactly how this was reported on the Calendar.
    const said = refreshOutcome(before, { items: loaded ?? before.items });
    showToast(t(said.key, said.params), said.key === 'refresh_up_to_date' ? 'info' : 'success');
  };

  useFocusEffect(useCallback(() => { load(); }, [load]));
  // And when a document lands while this screen is already open. The scan
  // sheet files its document after it closes, so this tab can be focused and
  // rendered before that upload commits; without this, the new document
  // appeared only after a restart.
  useEffect(() => onVaultChanged(() => { load(); }), [load]);

  const usedBytes = useMemo(() => {
    // Prefer the server-computed total; fall back to estimating from loaded docs.
    if (entitlements) return entitlements.vault_bytes_used;
    return docs.reduce((sum, d) => sum + (d.image_base64?.length || 0) * 0.75, 0);
  }, [entitlements, docs]);
  const usedMb = usedBytes / (1024 * 1024);
  const limitMb = entitlements ? entitlements.vault_bytes_limit / (1024 * 1024) : 500;
  const usedLabel = usedMb >= 1 ? `${usedMb.toFixed(0)} MB` : `${(usedMb * 1024).toFixed(0)} KB`;
  const storagePct = limitMb > 0 ? Math.min(100, (usedMb / limitMb) * 100) : 0;

  // What was typed in the search box. A search narrows the list the same
  // way a drawer does; the two combine.
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => docs.filter((d) => matchesQuery(d, query)), [docs, query]);
  // The documents in their drawers, in the order the drawers are always
  // shown; a drawer with nothing in it is left out. This replaced a row of
  // filter chips: grouped, the list already answers "only the medical ones".
  const drawers = useMemo(() => groupByDrawer(filtered, CATEGORIES.map((c) => c.key)), [filtered]);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleFold = (key: string) => setFolded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // What is close to running out (or already has), soonest first.
  const close = useMemo(() => closeAlerts(expiryAlerts), [expiryAlerts]);
  const headline = close[0] || null;
  const otherAlerts = close.slice(1, 4);
  const closeIds = useMemo(() => new Set(close.map((a) => a.doc_id)), [close]);

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
    const picked = await pickPicture('library', { where: '/vault', quality: 0.6 });
    if (!picked) return;
    if ('problem' in picked) {
      Alert.alert(t('vault_could_not_open_gallery'), t('vault_please_try_again'));
      return;
    }
    setImage(`data:image/jpeg;base64,${picked.base64}`);
    setMimeType('image/jpeg');
    setFileName(null);
    if (!title.trim() && picked.fileName) setTitle(picked.fileName.replace(/\.[^.]+$/, ''));
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

  const shareable = members.filter((m) => m.has_account && !m.is_me);
  const visibilityPicker = (
    <View>
    <View style={styles.visRow}>
      {(['private', 'shared', 'selected'] as VaultVisibility[]).map((v) => {
        const active = visibility === v;
        return (
          <PressScale
            key={v}
            testID={`vault-visibility-${v}`}
            onPress={() => setVisibility(v)}
            style={[styles.visChip, active && styles.visChipActive]}
          >
            {v === 'private' ? (
              <Lock color={active ? ui.bg : ui.muted} size={14} />
            ) : (
              <Users color={active ? ui.bg : ui.muted} size={14} />
            )}
            <Text style={[styles.visChipText, { color: active ? ui.bg : ui.muted }]}>
              {v === 'private' ? t('vault_private') : v === 'shared' ? t('vault_shared') : t('vault_selected')}
            </Text>
          </PressScale>
        );
      })}
    </View>
    {visibility === 'selected' ? (
      <View style={[styles.visRow, { flexWrap: 'wrap', marginTop: 8 }]}>
        {shareable.map((m) => {
          const on = chosenIds.includes(m.member_id);
          return (
            <PressScale
              key={m.member_id}
              testID={`vault-share-with-${m.member_id}`}
              onPress={() => setChosenIds((prev) => (on ? prev.filter((id) => id !== m.member_id) : [...prev, m.member_id]))}
              style={[styles.visChip, on && styles.visChipActive]}
            >
              <Text style={[styles.visChipText, { color: on ? ui.bg : ui.muted }]}>{m.name}</Text>
            </PressScale>
          );
        })}
      </View>
    ) : null}
    </View>
  );

  const save = async () => {
    if (!title.trim() || !image) return;
    setSaving(true);
    try {
      if (visibility === 'selected' && chosenIds.length === 0) {
        showToast(t('vault_selected_empty'), 'error');
        setSaving(false);
        return;
      }
      const created = await api.createVaultDoc({ title: title.trim(), category, image_base64: image, mime_type: mimeType, file_name: fileName || undefined, visibility, visible_to_members: visibility === 'selected' ? chosenIds : undefined });
      setDocs((prev) => [created, ...prev]);
      setTitle('');
      setImage(null);
      setMimeType('image/jpeg');
      setFileName(null);
      setCategory('Medical');
      setVisibility('private');
      setChosenIds([]);
      setShowAdd(false);
      showToast(t('vault_document_saved'), 'success');
      logEvent('vault_added');
    } catch (e: any) {
      logger.warn('Save vault document failed:', e?.message || e);
      showToast(apiErrorText(e, t, 'vault_could_not_save'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (doc: VaultDoc) => {
    const previous = docs;
    setDocs((prev) => prev.filter((d) => d.doc_id !== doc.doc_id));
    setPreview(null);
    try {
      const res = await api.deleteVaultDoc(doc.doc_id);
      // In Recently deleted for 30 days, where it no longer counts toward the
      // storage; "Annuler" brings it straight back (if it still fits).
      offerUndo(showToast, t, t('vault_document_deleted'), { trashIds: [res?.trash_id] }, load);
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
  // Plain function: a manual useCallback here makes the React Compiler skip
  // the whole screen (same lesson as the kids and settings pages).
  const openDoc = async (doc: VaultDoc) => {
    // Web has no expo-file-system: the whole native path below throws there,
    // which is why opening any document on the web app only ever produced an
    // error toast. Browsers open a blob URL in a new tab instead.
    if (Platform.OS === 'web') {
      try {
        const data = doc.image_base64 || '';
        const match = data.match(/^data:([\w/+.-]+);base64,(.+)$/);
        const mime = doc.mime_type || (match ? match[1] : 'application/octet-stream');
        const binary = atob(match ? match[2] : data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        const opened = window.open(url, '_blank');
        if (!opened) {
          // Popup blocked — fall back to a download so the file still arrives.
          const a = document.createElement('a');
          a.href = url;
          a.download = doc.file_name || doc.title || 'document';
          a.click();
        }
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        logEvent('vault_shared');
      } catch (e: any) {
        logger.warn('Open doc (web) failed:', e?.message || e);
        showToast(t('vault_open_error'), 'error');
      }
      return;
    }
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
  };

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
            eyebrow={t('vault')}
            title={t('vault_family_documents')}
            art={SECTION_ART.vault}
            // What needs renewing, where the painting of a wallet was: the
            // same corner, saying something. With nothing close to running
            // out it says how many documents are kept.
            artNode={
              <View
                testID="vault-tile"
                accessible
                accessibilityRole="text"
                accessibilityLabel={close.length > 0
                  ? `${t('vault_renew_soon')}: ${close.length}`
                  : `${docs.length} ${docs.length === 1 ? t('vault_document') : t('vault_documents')}`}
                style={styles.tile}
              >
                <View style={styles.tileTop}>
                  <Text style={styles.tileLabel} numberOfLines={1}>{t(close.length > 0 ? 'vault_tile_renew' : 'vault_tile_stored')}</Text>
                </View>
                <View style={styles.tileBody}>
                  <Text style={styles.tileNum}>{close.length > 0 ? close.length : docs.length}</Text>
                  <Text style={styles.tileUnit} numberOfLines={1}>{(close.length > 0 ? close.length : docs.length) === 1 ? t('vault_document') : t('vault_documents')}</Text>
                </View>
              </View>
            }
            // showAdd off, or this corner carries TWO Adds side by side: the
            // header's generic quick-add picker and the one that adds a
            // document. On this screen Add means one thing, put a document in
            // the vault, so that is the only Add here.
            showAdd={false}
            right={
              <PressScale
                testID="vault-add"
                onPress={openAdd}
                accessibilityRole="button"
                // Not the generic "Add": a screen reader should hear what it adds.
                accessibilityLabel={t('add_document')}
                style={styles.addBtn}
              >
                <Plus color="#FFFFFF" size={17} />
                <Text style={styles.addBtnText}>{t('vault_add_pill')}</Text>
              </PressScale>
            }
          />

          {docs.length === 0 && !loading ? (
            /* A first visit: one sentence, and one thing to do. */
            <>
              <Text style={styles.intro}>{t('vault_intro')}</Text>
              <PressScale testID="vault-empty-add" accessibilityRole="button" onPress={openAdd} style={styles.firstTarget}>
                <View style={styles.firstIcon}><Camera color={ui.orangeText} size={26} /></View>
                <Text style={styles.firstTitle}>{t('vault_first_photo')}</Text>
                <Text style={styles.firstSub}>{t('vault_or_file')}</Text>
              </PressScale>
              <View style={styles.privacyLine}>
                <Lock color={ui.muted} size={14} />
                <Text style={styles.footText}>{t('vault_you_choose')}</Text>
              </View>
            </>
          ) : (
            <>
              {/* Where is that document? Asked by name first. */}
              <View style={styles.searchBox}>
                <Search color={ui.muted} size={18} />
                <TextInput
                  testID="vault-search"
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('vault_search_docs')}
                  placeholderTextColor={ui.muted}
                  accessibilityLabel={t('vault_search_docs')}
                  returnKeyType="search"
                  autoCorrect={false}
                  style={styles.searchInput}
                />
                {query ? (
                  <PressScale testID="vault-search-clear" accessibilityRole="button" accessibilityLabel={t('close')} onPress={() => setQuery('')} hitSlop={8}>
                    <X color={ui.muted} size={16} />
                  </PressScale>
                ) : null}
              </View>

              {/* What is close to running out, or already has: the soonest
                  leads with one way in, the others sit under it. Only what is
                  close (closeAlerts): a card that expires in four years is not
                  an alert, and nothing appears twice on one screen. */}
              {headline ? (() => {
                const lead = docs.find((d) => d.doc_id === headline.doc_id) || null;
                const phrase = expiryPhrase({ expiry_date: headline.expiry_date }, new Date(), t);
                return (
                  <View style={styles.attention}>
                    <Text style={styles.attentionEyebrow}>{t('vault_renew_soon')}</Text>
                    <PressScale
                      testID="vault-attention"
                      accessibilityRole="button"
                      accessibilityLabel={`${t('vault_needs_attention')}: ${headline.title}${phrase ? `, ${phrase}` : ''}`}
                      disabled={!lead}
                      onPress={() => lead && openPreview(lead)}
                      style={styles.attentionMain}
                    >
                      <View style={styles.attentionIcon}><CalendarClock color={ui.goldText} size={24} /></View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.attentionTitle} numberOfLines={2}>{headline.title}</Text>
                        {phrase ? <Text style={styles.attentionSub} numberOfLines={1}>{phrase}</Text> : null}
                      </View>
                    </PressScale>
                    {lead ? (
                      <PressScale testID="vault-attention-open" accessibilityRole="button" onPress={() => openPreview(lead)} style={styles.attentionBtn}>
                        <Text style={styles.attentionBtnText}>{t('vault_open_doc')}</Text>
                      </PressScale>
                    ) : null}
                    {otherAlerts.map((alert) => {
                      // The alert is where a wrong date is NOTICED, so it is
                      // also where it has to be correctable.
                      const doc = docs.find((d) => d.doc_id === alert.doc_id) || null;
                      const when = expiryPhrase({ expiry_date: alert.expiry_date }, new Date(), t);
                      return (
                        <PressScale
                          key={alert.doc_id}
                          testID={`vault-alert-${alert.doc_id}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${alert.title}${when ? `, ${when}` : ''} — ${t('vault_set_expiry')}`}
                          disabled={!doc}
                          onPress={() => doc && setExpiryFor(doc)}
                          style={styles.alertRow}
                        >
                          <View style={[styles.expiryDot, { backgroundColor: alert.days_left < 0 ? ui.danger : ui.orange }]} />
                          <Text style={styles.alertTitle} numberOfLines={1}>{alert.title}</Text>
                          {when ? <Text style={styles.alertWhen} numberOfLines={1}>{when}</Text> : null}
                          {doc ? <ChevronRight color={ui.goldText} size={14} /> : null}
                        </PressScale>
                      );
                    })}
                  </View>
                );
              })() : null}

              {/* All documents, a drawer at a time */}
              <View style={styles.recentHead} testID="vault-all-documents">
                <Text style={styles.recentTitle}>{t('vault_all_documents')}</Text>
                <Text style={styles.recentTotal}>{filtered.length} {filtered.length === 1 ? t('vault_document') : t('vault_documents')}</Text>
              </View>

              {filtered.length === 0 && !loading ? (
                <Text style={styles.noMatch}>{t('vault_no_match')}</Text>
              ) : (
                <View style={styles.list}>
                  {drawers.map(({ key, items }) => {
                    const cat = catInfo(key);
                    const open = !folded.has(key);
                    // The drawer's name sits on the page, not on a pale tile:
                    // its colour has to be the one for this theme.
                    const tone = categoryStyle(key).tone(ui);
                    return (
                      <View key={key}>
                        <PressScale
                          testID={`vault-drawer-${key}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${t(key.toLowerCase())}, ${items.length}`}
                          onPress={() => toggleFold(key)}
                          style={styles.drawerHead}
                        >
                          <View style={[styles.drawerDot, { backgroundColor: tone }]} />
                          <Text style={[styles.drawerTitle, { color: tone }]} numberOfLines={1}>{t(key.toLowerCase())}</Text>
                          <Text style={styles.drawerCount}>{items.length}</Text>
                          {open ? <ChevronDown color={ui.muted} size={16} /> : <ChevronRight color={ui.muted} size={16} />}
                        </PressScale>
                        {open ? items.map((d, i) => {
                          const isImg = isImageDoc(d);
                          const CatIcon = cat.icon;
                          const now = new Date();
                          // Whose it is, and when it runs out: the two things
                          // a row is read for. Who may see it is the small
                          // mark on the right.
                          const sub = [ownerLine(d, user?.user_id, t), expiryPhrase(d, now, t) || t('vault_no_expiry')]
                            .filter(Boolean).join(' · ');
                          const visibility = d.visibility || 'shared';
                          const soon = closeIds.has(d.doc_id);
                          return (
                            <PressScale
                              key={d.doc_id}
                              testID={`vault-doc-${d.doc_id}`}
                              accessibilityRole="button"
                              accessibilityLabel={`${d.title}, ${sub}, ${visibility === 'private' ? t('vault_private') : visibility === 'selected' ? t('vault_selected') : t('vault_shared')}`}
                              onPress={() => openPreview(d)}
                              style={[styles.listRow, i === items.length - 1 && styles.listRowLast]}
                            >
                              <View style={[styles.listThumb, { backgroundColor: cat.soft }]}>
                                {isImg ? (
                                  <Image source={{ uri: d.image_base64 }} style={styles.listThumbImg} />
                                ) : (
                                  <CatIcon color={cat.tone} size={20} />
                                )}
                              </View>
                              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                                <Text style={styles.listTitle} numberOfLines={1}>{d.title}</Text>
                                <Text style={[styles.listSub, soon && { color: ui.orangeText }]} numberOfLines={1}>{sub}</Text>
                              </View>
                              {visibility === 'private' ? (
                                <Lock color={ui.muted} size={15} />
                              ) : d.visibility === 'selected' ? (
                                <Users color={ui.mintText} size={15} />
                              ) : null}
                              <ChevronRight color={ui.muted} size={16} />
                            </PressScale>
                          );
                        }) : null}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Storage: one quiet line. It turns orange when nearly full. */}
              <View testID="vault-storage" style={styles.foot}>
                <Text style={[styles.footText, storagePct >= 80 && { color: ui.orangeText }]}>
                  {docs.length} {docs.length === 1 ? t('vault_document') : t('vault_documents')} · {usedLabel} {t('vault_of')} {limitMb >= 1024 ? `${(limitMb / 1024).toFixed(0)} GB` : `${limitMb.toFixed(0)} MB`}
                </Text>
              </View>
            </>
          )}


          <View style={{ height: 140 }} />
      </TabScreen>

      <KeyboardAwareBottomSheet visible={showAdd} onClose={closeAdd} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('add_document')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="vault-close" onPress={closeAdd} style={styles.iconBtn}>
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        <Text style={styles.label}>{t('title')}</Text>
        <TextInput testID="vault-title" onSubmitEditing={() => save()} value={title} onChangeText={setTitle} placeholder={t('title')} placeholderTextColor={ui.muted} style={styles.input} returnKeyType="next" />

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

        <Text style={styles.label}>{t('vault_who_can_see')}</Text>
        {visibilityPicker}

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
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_share')} testID="preview-share" onPress={() => shareDoc(preview)} style={styles.previewIconBtn}>
                  <Share2 color="#fff" size={20} />
                </PressScale>
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} testID="preview-delete" onPress={() => confirmRemove(preview)} style={styles.previewIconBtn}>
                  <Trash2 color="#EF4444" size={20} />
                </PressScale>
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="preview-close" onPress={() => setPreview(null)} style={styles.previewIconBtn}>
                  <X color="#fff" size={20} />
                </PressScale>
              </View>
            </View>
            <Text style={styles.previewMeta}>
              {t(preview.category.toLowerCase())} · {updatedLine(preview.created_at, t)}
              {preview.file_name ? ` · ${preview.file_name}` : ''}
              {preview.owner_name ? ` · ${preview.owner_name}` : ''}
            </Text>
            {/* Status and action were one dim pill and unreadable on the
                blurred backdrop: now a legible state line plus a real
                button, each with its own contrast. */}
            <View style={styles.visibilityBlock}>
              <View style={styles.visibilityState}>
                {(preview.visibility || 'shared') === 'private' ? (
                  <Lock color="#FFFFFF" size={16} />
                ) : (
                  <Users color="#FFFFFF" size={16} />
                )}
                <Text style={styles.visibilityStateText}>
                  {(preview.visibility || 'shared') === 'private'
                    ? `${t('vault_private')} · ${t('vault_private_hint')}`
                    : `${t('vault_shared')} · ${t('vault_shared_hint')}`}
                </Text>
              </View>
              <PressScale
                testID="preview-visibility"
                onPress={() => toggleVisibility(preview)}
                accessibilityRole="button"
                style={styles.visibilityBtn}
              >
                {(preview.visibility || 'shared') === 'private' ? (
                  <Users color="#111827" size={17} />
                ) : (
                  <Lock color="#111827" size={17} />
                )}
                <Text style={styles.visibilityBtnText}>
                  {(preview.visibility || 'shared') === 'private'
                    ? t('vault_make_shared')
                    : t('vault_make_private')}
                </Text>
              </PressScale>
            </View>
            {/* When it runs out. Shown on every document, not only ones that
                already carry a date — a passport with no expiry recorded is
                the case the alerts exist for, and there was no way to add
                one. */}
            <View style={styles.expiryBlock}>
              <View style={styles.expiryState}>
                <CalendarClock color="#FFFFFF" size={16} />
                <Text style={styles.expiryStateText}>
                  {t('vault_expires')}: {expiryLabel(preview)}
                </Text>
              </View>
              <PressScale
                testID="preview-expiry"
                accessibilityRole="button"
                accessibilityLabel={t('vault_set_expiry')}
                onPress={() => setExpiryFor(preview)}
                style={styles.expiryBtn}
              >
                <Text style={styles.expiryBtnText}>
                  {preview.expiry_date ? t('vault_change_expiry') : t('vault_set_expiry')}
                </Text>
              </PressScale>
            </View>
            {isImageDoc(preview) ? (
              // The whole page, always. This was a fixed 3:4 box in "cover"
              // mode: a photograph with table around the page still showed
              // the page, and a scan cropped tightly to the page lost its top
              // and bottom — Roland: "I can not open it to see the entire
              // doc." Contain scales the page down to fit whatever shape it
              // is; the link below opens it in the phone's own viewer, which
              // is where pinch-to-zoom lives.
              <View style={styles.previewImgWrap}>
                <Image
                  testID="preview-image"
                  source={{ uri: preview.image_base64 }}
                  resizeMode="contain"
                  style={styles.previewImg}
                />
                <PressScale testID="preview-open-ext" onPress={() => openDoc(preview)} style={styles.previewExternalRow}>
                  <Text style={styles.previewExternalText}>{t('vault_open_external')}</Text>
                </PressScale>
              </View>
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

      {/* Its own clear button is what removes a wrong date — see saveExpiry. */}
      <DatePickerSheet
        visible={!!expiryFor}
        value={expiryFor?.expiry_date
          ? new Date(expiryFor.expiry_date).toLocaleDateString(localeFor(lang),
              { day: 'numeric', month: 'short', year: 'numeric' })
          : null}
        title={t('vault_set_expiry')}
        onChange={(value) => { if (expiryFor) saveExpiry(expiryFor, value); }}
        onClose={() => setExpiryFor(null)}
      />

      <LoadingOverlay visible={loading} label={t('vault_loading')} />
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} action={toast?.action ?? null} />
    </SwipeableTabView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 },
  bellWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },

  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, paddingHorizontal: 14, borderRadius: 16, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, marginTop: 14, marginBottom: 12 },
  searchInput: { flex: 1, fontFamily: 'Figtree_600SemiBold', fontSize: 15, color: ui.text, paddingVertical: 0 },
  attention: { gap: 12, padding: 18, borderRadius: 24, backgroundColor: ui.gold, marginTop: 16 },
  attentionMain: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  attentionIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: ui.card, alignItems: 'center', justifyContent: 'center' },
  attentionSub: { color: ui.goldText, fontFamily: 'Figtree_600SemiBold', fontSize: 13.5, marginTop: 2 },
  attentionBtn: { minHeight: 46, borderRadius: 999, backgroundColor: ui.goldText, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  attentionBtnText: { color: ui.bg, fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  alertTitle: { flex: 1, minWidth: 0, color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 14.5 },
  alertWhen: { color: ui.goldText, fontFamily: 'Figtree_600SemiBold', fontSize: 13, flexShrink: 0 },
  // The header: what needs renewing, and the one Add.
  tile: { width: 66, height: 72, borderRadius: 20, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.card, overflow: 'hidden' },
  tileTop: { height: 22, backgroundColor: ui.orangeDeep, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  tileLabel: { color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 9.5, letterSpacing: 0.4 },
  tileBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tileNum: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 26, lineHeight: 28, letterSpacing: -0.5 },
  tileUnit: { color: ui.muted, fontFamily: 'Figtree_700Bold', fontSize: 10.5 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 16, borderRadius: 9999, backgroundColor: ui.orangeDeep },
  addBtnText: { color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 14 },
  // A first visit.
  intro: { color: ui.muted, fontFamily: 'Figtree_600SemiBold', fontSize: 16, lineHeight: 24, marginTop: 16 },
  firstTarget: { minHeight: 150, marginTop: 16, borderRadius: 24, borderWidth: 2, borderStyle: 'dashed', borderColor: ui.line, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  firstIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  firstTitle: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 17, textAlign: 'center' },
  firstSub: { color: ui.muted, fontFamily: 'Figtree_600SemiBold', fontSize: 13.5 },
  privacyLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18 },
  // The drawers: a dot and a name, then the documents flat on the page.
  drawerHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginTop: 6 },
  drawerDot: { width: 9, height: 9, borderRadius: 9 },
  drawerTitle: { flex: 1, fontFamily: 'Figtree_800ExtraBold', fontSize: 12.5, letterSpacing: 0.5, textTransform: 'uppercase' },
  drawerCount: { color: ui.muted, fontFamily: 'Figtree_700Bold', fontSize: 12.5 },
  listRowLast: { borderBottomWidth: 0 },
  noMatch: { color: ui.muted, fontFamily: 'Figtree_600SemiBold', fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  foot: { alignItems: 'center', marginTop: 22 },
  footText: { color: ui.muted, fontFamily: 'Figtree_600SemiBold', fontSize: 13 },
  attentionEyebrow: { color: ui.goldText, fontFamily: 'Figtree_800ExtraBold', fontSize: 12.5, letterSpacing: 0.6, textTransform: 'uppercase' },
  attentionTitle: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 20, lineHeight: 25, letterSpacing: -0.3 },
  listSub: { color: ui.muted, fontFamily: 'Figtree_600SemiBold', fontSize: 13 },


  recentHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24, marginBottom: 14 },
  recentTitle: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 19, letterSpacing: -0.3 },
  recentTotal: { color: ui.muted, fontFamily: 'Figtree_600SemiBold', fontSize: 14 },

  list: { gap: 2 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: ui.line },
  listThumb: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  listThumbImg: { width: 46, height: 46, resizeMode: 'cover' },
  listTitle: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 15, letterSpacing: -0.2 },
  listMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  listDate: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12 },



  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,9,16,0.5)' },
  sheet: { backgroundColor: ui.card, borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, borderColor: ui.line, padding: 26, paddingBottom: 140 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 24, letterSpacing: -0.4 },
  iconBtn: { padding: 9, borderRadius: 9999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  label: { color: ui.muted, fontFamily: 'Figtree_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Figtree_500Medium', fontSize: 16, color: ui.text, backgroundColor: ui.soft },
  catRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  catBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 9999, borderWidth: 1 },
  catBtnLabel: { fontFamily: 'Figtree_800ExtraBold', fontSize: 12 },
  pickRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  pickOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 16, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  pickOptionText: { color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 14 },
  pick: { marginTop: 12, height: 150, borderRadius: 18, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pickEmpty: { borderStyle: 'dashed' },
  pickFile: { gap: 10, paddingHorizontal: 20 },
  pickFileName: { color: ui.text, fontFamily: 'Figtree_600SemiBold', fontSize: 14, textAlign: 'center' },
  pickImg: { ...StyleSheet.absoluteFill, resizeMode: 'cover' },
  pickText: { color: ui.muted, fontFamily: 'Figtree_600SemiBold', fontSize: 14 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: ui.muted, fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', backgroundColor: ui.orangeDeep },
  saveText: { color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
  previewWrap: { flex: 1, padding: 24, justifyContent: 'center' },
  previewTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  previewTitle: { flex: 1, color: '#fff', fontFamily: 'Figtree_800ExtraBold', fontSize: 24 },
  visRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  visChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 9, paddingHorizontal: 14,
    borderRadius: 999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft,
  },
  visChipActive: { backgroundColor: ui.text, borderColor: ui.text },
  visChipText: { fontFamily: 'Figtree_700Bold', fontSize: 13 },
  expiryBlock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 },
  expiryState: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  expiryStateText: { color: '#FFFFFF', fontFamily: 'Figtree_600SemiBold', fontSize: 13.5, flexShrink: 1 },
  expiryBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.92)' },
  expiryBtnText: { color: '#111827', fontFamily: 'Figtree_700Bold', fontSize: 13 },
  visibilityBlock: { alignSelf: 'stretch', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 4 },
  visibilityState: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
  },
  visibilityStateText: {
    color: '#FFFFFF', fontFamily: 'Figtree_700Bold', fontSize: 14, letterSpacing: -0.1,
  },
  visibilityBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, paddingHorizontal: 22, borderRadius: 14,
    backgroundColor: '#FFFFFF', minWidth: 220,
  },
  visibilityBtnText: {
    color: '#111827', fontFamily: 'Figtree_800ExtraBold', fontSize: 15, letterSpacing: -0.2,
  },
  previewMeta: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Figtree_600SemiBold', fontSize: 13, marginBottom: 14, marginTop: -6 },
  previewPdfWrap: { flex: 1, width: '100%' },
  previewExternalRow: { alignSelf: 'center', marginTop: 10, paddingVertical: 8, paddingHorizontal: 14 },
  previewExternalText: { color: 'rgba(255,255,255,0.75)', fontFamily: 'Figtree_700Bold', fontSize: 13, textDecorationLine: 'underline' },
  previewNote: { color: 'rgba(255,255,255,0.6)', fontFamily: 'Figtree_500Medium', fontSize: 13, textAlign: 'center', marginTop: -4 },
  previewActions: { flexDirection: 'row', gap: 8 },
  previewIconBtn: { padding: 10, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(15,23,42,0.55)' },
  previewImgWrap: { flex: 1, width: '100%', minHeight: 0 },
  previewImg: { flex: 1, width: '100%', minHeight: 200, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  previewFile: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 48, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(15,23,42,0.45)' },
  previewFileName: { color: '#fff', fontFamily: 'Figtree_700Bold', fontSize: 17, textAlign: 'center', paddingHorizontal: 24 },
  previewOpenBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 99, paddingHorizontal: 20, paddingVertical: 12 },
  previewOpenText: { color: '#fff', fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },

  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, backgroundColor: ui.mint },
  clearBtnText: { color: ui.mintText, fontFamily: 'Figtree_700Bold', fontSize: 12 },
  shopInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 6 },
  shopInput: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, fontFamily: 'Figtree_500Medium', fontSize: 14, color: ui.text, backgroundColor: ui.soft },
  shopAddBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: ui.orangeDeep, alignItems: 'center', justifyContent: 'center' },
  shopNumberBadge: { width: 24, height: 24, borderRadius: 99, backgroundColor: ui.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  shopNumberText: { color: ui.orangeText, fontFamily: 'Figtree_800ExtraBold', fontSize: 12 },
  shopHint: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12, textAlign: 'center', paddingTop: 10 },
  shopItemDone: { textDecorationLine: 'line-through', color: ui.muted },
  shopDivider: { marginTop: 8, paddingVertical: 4 },
  shopDividerText: { color: ui.muted, fontFamily: 'Figtree_700Bold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  shopEmpty: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 13, textAlign: 'center', paddingVertical: 14 },
  mealDayLabel: { color: ui.lavenderText, fontFamily: 'Figtree_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 2 },
  mealDayChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  mealDayChipActive: { backgroundColor: ui.lavender, borderColor: ui.lavenderText },
  mealDayChipText: { color: ui.muted, fontFamily: 'Figtree_700Bold', fontSize: 13, textTransform: 'capitalize' },
  mealDayChipTextActive: { color: ui.lavenderText },
  expiryDot: { width: 10, height: 10, borderRadius: 99 },
});
