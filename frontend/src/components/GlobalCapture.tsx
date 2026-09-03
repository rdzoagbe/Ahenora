import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { ListPlus, ScanLine, CalendarPlus, Check, X } from 'lucide-react-native';

import { QuickAddSheet } from './QuickAddSheet';
import { CameraCaptureModal } from './CameraCaptureModal';
import { AddCardModal } from './AddCardModal';
import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { api, CardType } from '../api';
import { logger } from '../logger';
import { selectedCalendarDayAt } from '../calendarSelection';

// Mirrors AddCardModal's internal draft shape (structural) — the object it
// accepts as `initialDraft`.
interface CaptureDraft {
  transcript: string;
  type: CardType;
  title: string;
  description: string;
  assignee: string;
  due_date?: string | null;
  image_base64?: string | null;
  vault_category?: string;
  save_to_vault?: boolean;
  // Carried from the document scan so the sheet can offer the calendar.
  is_event?: boolean;
  expires_on?: string | null;
  location?: string | null;
}

type Primary = 'task' | 'event' | 'scan';

/**
 * The global quick-capture that the centre ➕ opens. It CAPTURES and stays put:
 * the picker chooses an action, the matching surface (manual composer / scan /
 * shopping) opens, the existing API saves it, a toast confirms, and the
 * user is returned exactly where they were. Nothing navigates.
 *
 * It reads `usePathname()` to lead with the primary create for the current tab,
 * and calls `bumpData()` after any save so the visible tab reloads in place.
 */
export function GlobalCapture({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const ui = useUI();
  const { t, bumpData } = useStore();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const styles = createStyles(ui);

  const [showCamera, setShowCamera] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addSource, setAddSource] = useState<'MANUAL' | 'VOICE' | 'CAMERA'>('MANUAL');
  const [draft, setDraft] = useState<CaptureDraft | null>(null);

  const [showShopping, setShowShopping] = useState(false);
  const [shoppingText, setShoppingText] = useState('');
  const [shoppingSaving, setShoppingSaving] = useState(false);

  const [toast, setToast] = useState('');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  }, []);

  // Dismiss the picker first (matches the old sheet's 120ms hand-off), then
  // open the target surface — so the two sheets never animate over each other.
  const afterPicker = useCallback((fn: () => void) => {
    onClose();
    setTimeout(fn, 120);
  }, [onClose]);

  // ── Context → primary action ──────────────────────────────────────────────
  const { primary, primaryTitle, primarySub, primaryIcon, contextKey } = useMemo(() => {
    const p = (pathname || '').toLowerCase();
    const on = (name: string) => p === `/${name}` || p.endsWith(`/${name}`) || p.endsWith(name);
    if (on('calendar')) {
      return {
        primary: 'event' as Primary, primaryTitle: t('qa_event'), primarySub: t('qa_event_sub'),
        primaryIcon: CalendarPlus, contextKey: 'calendar',
      };
    }
    if (on('vault')) {
      return {
        primary: 'scan' as Primary, primaryTitle: t('qa_scan'), primarySub: t('qa_scan_sub'),
        primaryIcon: ScanLine, contextKey: 'vault',
      };
    }
    if (on('kids')) {
      return {
        primary: 'task' as Primary, primaryTitle: t('qa_primary_task'), primarySub: t('qa_task_sub'),
        primaryIcon: ListPlus, contextKey: 'kids',
      };
    }
    if (on('kitchen')) {
      return {
        primary: 'task' as Primary, primaryTitle: t('qa_primary_task'), primarySub: t('qa_task_sub'),
        primaryIcon: ListPlus, contextKey: 'kitchen',
      };
    }
    // Feed / unknown → add a task.
    return {
      primary: 'task' as Primary, primaryTitle: t('qa_primary_task'), primarySub: t('qa_task_sub'),
      primaryIcon: ListPlus, contextKey: 'feed',
    };
  }, [pathname, t]);

  const contextLabel = t('qa_context', { page: t(contextKey) });

  // ── Openers ───────────────────────────────────────────────────────────────
  const openTask = useCallback(() => {
    setDraft(null);
    setAddSource('MANUAL');
    afterPicker(() => setShowAdd(true));
  }, [afterPicker]);

  const openEvent = useCallback(() => {
    // The day the calendar is showing, if it is showing one. This used to be
    // new Date() unconditionally: select the 14th, tap "+", and the sheet
    // opened on today — which is worse than no prefill, because it looks
    // deliberate and gets saved. Falls back to noon today everywhere else.
    const base = selectedCalendarDayAt() || (() => {
      const now = new Date();
      now.setHours(12, 0, 0, 0);
      return now;
    })();
    setDraft({
      type: 'APPOINTMENT',
      title: '',
      description: '',
      assignee: '',
      due_date: base.toISOString(),
      transcript: '',
    });
    setAddSource('MANUAL');
    afterPicker(() => setShowAdd(true));
  }, [afterPicker]);

  const openScan = useCallback(() => {
    afterPicker(() => setShowCamera(true));
  }, [afterPicker]);


  const openShopping = useCallback(() => {
    setShoppingText('');
    afterPicker(() => setShowShopping(true));
  }, [afterPicker]);

  const onPrimary = primary === 'event' ? openEvent : primary === 'scan' ? openScan : openTask;

  // ── Save handlers ─────────────────────────────────────────────────────────
  const onCreated = useCallback(() => {
    bumpData();
    showToast(t('qa_added_toast'));
  }, [bumpData, showToast, t]);

  const addShopping = useCallback(async () => {
    const name = shoppingText.trim();
    if (!name || shoppingSaving) return;
    setShoppingSaving(true);
    try {
      await api.bulkAddShopping([name]);
      bumpData();
      setShowShopping(false);
      setShoppingText('');
      showToast(t('qa_added_toast'));
    } catch (e) {
      // Don't fail silently — the sheet stays open with the text intact, but the
      // user needs to know the tap didn't land so they don't just retry blindly.
      logger.warn('shopping quick add failed', e);
      showToast(t('set_error'));
    } finally {
      setShoppingSaving(false);
    }
  }, [shoppingText, shoppingSaving, bumpData, showToast, t]);

  return (
    <>
      <QuickAddSheet
        visible={visible}
        onClose={onClose}
        contextLabel={contextLabel}
        primaryTitle={primaryTitle}
        primarySub={primarySub}
        primaryIcon={primaryIcon}
        onPrimary={onPrimary}
        onTask={openTask}
        onScan={openScan}
        onShopping={openShopping}
      />

      <CameraCaptureModal
        visible={showCamera}
        onClose={() => setShowCamera(false)}
        onDraft={(d) => {
          // Same mapping the Feed uses (feed.tsx) — pass the modal's vault
          // decision through untouched.
          setDraft({
            transcript: '',
            type: d.type,
            title: d.title,
            description: d.description,
            assignee: d.assignee,
            due_date: d.due_date || null,
            image_base64: d.image_base64 || null,
            vault_category: d.vault_category || '',
            is_event: d.is_event,
            expires_on: d.expires_on || null,
            location: d.location || null,
            save_to_vault: d.save_to_vault !== false,
          });
          setAddSource('CAMERA');
          setShowCamera(false);
          setShowAdd(true);
        }}
      />


      <AddCardModal
        visible={showAdd}
        onClose={() => {
          setShowAdd(false);
          setDraft(null);
        }}
        onCreated={onCreated}
        initialSource={addSource}
        initialDraft={draft}
      />

      {/* Shopping — a tiny inline capture straight onto the shared list. */}
      <Modal visible={showShopping} transparent animationType="slide" onRequestClose={() => setShowShopping(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowShopping(false)} accessibilityLabel={t('close')} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.shopContainer}
        >
          <View style={[styles.shopPanel, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
            <View style={styles.grabber} />
            <View style={styles.shopHeader}>
              <Text style={styles.shopTitle}>{t('qa_shopping_add')}</Text>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={t('close')}
                onPress={() => setShowShopping(false)}
                style={styles.iconBtn}
              >
                <X color={ui.text} size={20} />
              </PressScale>
            </View>
            <View style={styles.shopRow}>
              <TextInput
                testID="quickadd-shopping-input"
                value={shoppingText}
                onChangeText={setShoppingText}
                placeholder={t('qa_shopping_placeholder')}
                placeholderTextColor={ui.muted}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={addShopping}
                style={styles.shopInput}
              />
              <PressScale
                testID="quickadd-shopping-add"
                accessibilityRole="button"
                accessibilityLabel={t('qa_add_btn')}
                onPress={addShopping}
                disabled={!shoppingText.trim() || shoppingSaving}
                style={[styles.shopAddBtn, (!shoppingText.trim() || shoppingSaving) && { opacity: 0.5 }]}
              >
                <Check color="#FFFFFF" size={18} />
                <Text style={styles.shopAddText}>{t('qa_add_btn')}</Text>
              </PressScale>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Confirmation toast — floats, never navigates. */}
      {toast ? (
        <View pointerEvents="none" style={[styles.toastWrap, { bottom: Math.max(insets.bottom, 14) + 96 }]}>
          <View style={styles.toast}>
            <Check color="#FFFFFF" size={16} />
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}
    </>
  );
}

const createStyles = (ui: UIColors) =>
  StyleSheet.create({
    backdrop: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.62)',
    },
    grabber: {
      alignSelf: 'center', width: 40, height: 5, borderRadius: 99,
      backgroundColor: ui.line, marginBottom: 12,
    },
    iconBtn: {
      width: 34, height: 34, borderRadius: 99, alignItems: 'center', justifyContent: 'center',
      backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line,
    },
    shopContainer: { flex: 1, justifyContent: 'flex-end' },
    shopPanel: {
      backgroundColor: ui.card,
      borderTopLeftRadius: 26, borderTopRightRadius: 26,
      paddingHorizontal: 18, paddingTop: 10,
      borderWidth: 1, borderColor: ui.line,
    },
    shopHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
    shopTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: ui.text },
    shopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    shopInput: {
      flex: 1, minWidth: 0,
      borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft,
      borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
      fontFamily: 'Inter_500Medium', fontSize: 15, color: ui.text,
    },
    shopAddBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 7,
      backgroundColor: ui.orange, borderRadius: 14,
      paddingHorizontal: 16, minHeight: 48, justifyContent: 'center',
    },
    shopAddText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: '#FFFFFF' },
    toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    toast: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: ui.orange, borderRadius: 99,
      paddingHorizontal: 18, paddingVertical: 12,
      shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    toastText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: '#FFFFFF' },
  });
