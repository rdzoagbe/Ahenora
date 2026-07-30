import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Keyboard,
  Alert,
} from 'react-native';
import { X, FileSignature, Mail, ListTodo, Repeat, Bell, Sparkles, Cake, School, Stethoscope, Plane, Check } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressScale } from './PressScale';
import { useStore } from '../store';
import { api, CardType, FamilyMember, Recurrence } from '../api';
import { logger } from '../logger';

interface VoiceDraft {
  transcript: string;
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
  onCreated: () => void;
  initialSource?: 'MANUAL' | 'VOICE' | 'CAMERA';
  initialDraft?: VoiceDraft | null;
}

const TYPES: { key: CardType; labelKey: string; color: string; icon: any }[] = [
  { key: 'TASK', labelKey: 'task', color: '#10B981', icon: ListTodo },
  { key: 'SIGN_SLIP', labelKey: 'sign_slip', color: '#F97316', icon: FileSignature },
  { key: 'RSVP', labelKey: 'rsvp', color: '#6366F1', icon: Mail },
  { key: 'BIRTHDAY', labelKey: 'type_birthday', color: '#EAB308', icon: Cake },
  { key: 'SCHOOL', labelKey: 'type_school', color: '#8B5CF6', icon: School },
  { key: 'APPOINTMENT', labelKey: 'type_appointment', color: '#F97316', icon: Stethoscope },
  { key: 'VACATION', labelKey: 'type_vacation', color: '#14B8A6', icon: Plane },
];

const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];
const REMINDERS: { mins: number; key: string }[] = [
  { mins: 0, key: 'rem_none' },
  { mins: 15, key: 'rem_15' },
  { mins: 60, key: 'rem_60' },
  { mins: 1440, key: 'rem_1440' },
];

export function AddCardModal({
  visible,
  onClose,
  onCreated,
  initialSource = 'MANUAL',
  initialDraft = null,
}: Props) {
  const { t, theme } = useStore();
  const insets = useSafeAreaInsets();
  const [type, setType] = useState<CardType>('TASK');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [assignee, setAssignee] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [reminderMins, setReminderMins] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [suggestedAssignee, setSuggestedAssignee] = useState<string>('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [members, setMembers] = useState<FamilyMember[]>([]);

  useEffect(() => {
    if (!visible) return;
    api.familyMembers().then(setMembers).catch(() => setMembers([]));
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (assignee.trim()) { setSuggestedAssignee(''); return; }
    const trimmed = title.trim();
    if (trimmed.length < 8) { setSuggestedAssignee(''); return; }
    setSuggestLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await api.aiAssign(trimmed, desc, type);
        if (res.assignee) setSuggestedAssignee(res.assignee);
        else setSuggestedAssignee('');
      } catch {
        setSuggestedAssignee('');
      } finally {
        setSuggestLoading(false);
      }
    }, 700);
    return () => clearTimeout(handle);
  }, [title, desc, type, assignee, visible]);

  useEffect(() => {
    if (visible) {
      if (initialDraft) {
        setType(initialDraft.type);
        setTitle(initialDraft.title);
        setDesc(initialDraft.description || '');
        setAssignee(initialDraft.assignee || '');
      } else {
        setType('TASK');
        setTitle('');
        setDesc('');
        setAssignee('');
      }
      setRecurrence('none');
      setReminderMins(0);
    }
  }, [visible, initialDraft]);

  const handleSave = async () => {
    if (!title.trim()) return;

    setSaving(true);

    try {
      await api.createCard({
        type,
        title: title.trim(),
        description: desc.trim(),
        assignee: assignee.trim(),
        due_date: initialDraft?.due_date || null,
        source: initialSource,
        image_base64: initialDraft?.image_base64 || null,
        recurrence,
        reminder_minutes: reminderMins,
      } as any);
    } catch (e: any) {
      // The card wasn't created — safe to let the user retry.
      logger.warn('create card error', e);
      Alert.alert(t('addcard_save_failed_title'), e?.message || t('addcard_save_failed_message'));
      setSaving(false);
      return;
    }

    // The card is created. Close the modal FIRST so a failed vault save can
    // never lead the user to tap Save again and create a duplicate card.
    const wantsVault =
      initialSource === 'CAMERA' &&
      !!initialDraft?.image_base64 &&
      initialDraft?.save_to_vault !== false;

    onCreated();
    onClose();
    setSaving(false);

    if (wantsVault) {
      try {
        await api.createVaultDoc({
          title: title.trim() || initialDraft!.title || t('addcard_scanned_document'),
          category: initialDraft!.vault_category || 'School',
          image_base64: initialDraft!.image_base64!,
        });
        Alert.alert(t('addcard_saved_title'), t('addcard_saved_vault_message'));
      } catch (e: any) {
        // Card already saved; only the vault copy failed — inform, don't retry.
        logger.warn('vault save error', e);
        Alert.alert(t('addcard_card_saved_title'), t('addcard_vault_failed_message'));
      }
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <BlurView intensity={50} tint={theme.mode === 'light' ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
      <View style={[styles.backdrop, { backgroundColor: theme.mode === 'light' ? 'rgba(255,255,255,0.46)' : 'rgba(8,9,16,0.6)' }]} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        {/* Keyboard dismissal must not wrap the sheet: a Touchable around a
            ScrollView claims the JS responder on touch start, and on Android
            that blocks the native scroller — the form froze once it grew
            taller than the screen. Underlay tap + drag-to-dismiss instead. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow, paddingBottom: 16 + Math.max(insets.bottom, 14) }]}> 
            <View style={styles.header}>
              <Text style={[styles.heading, { color: theme.colors.text }]}>{t('add_card')}</Text>
              <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-add-card" onPress={onClose} style={[styles.closeBtn, { borderColor: theme.colors.cardBorder }]}> 
                <X color={theme.colors.text} size={18} />
              </PressScale>
            </View>

            <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
              {initialDraft?.transcript ? (
                <View style={[styles.transcriptBox, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}> 
                  <Text style={[styles.transcriptLabel, { color: theme.colors.textMuted }]}>{t('transcript')}</Text>
                  <Text style={[styles.transcriptText, { color: theme.colors.text }]} numberOfLines={3}>
                    &ldquo;{initialDraft.transcript}&rdquo;
                  </Text>
                </View>
              ) : null}

              <Text style={[styles.label, { color: theme.colors.textMuted }]}>{t('choose_type')}</Text>
              <View style={styles.typeRow}>
                {TYPES.map((typ) => {
                  const Icon = typ.icon;
                  const active = type === typ.key;
                  return (
                    <PressScale
                      key={typ.key}
                      testID={`type-${typ.key}`}
                      onPress={() => setType(typ.key)}
                      style={[
                        styles.typeBtn,
                        {
                          borderColor: active ? typ.color : theme.colors.cardBorder,
                          backgroundColor: active ? typ.color + '22' : theme.colors.bgSoft,
                        },
                      ]}
                    >
                      <Icon color={active ? typ.color : theme.colors.textMuted} size={18} />
                      <Text
                        style={[
                          styles.typeLabel,
                          { color: active ? typ.color : theme.colors.textMuted },
                        ]}
                        numberOfLines={1}
                      >
                        {t(typ.labelKey)}
                      </Text>
                    </PressScale>
                  );
                })}
              </View>

              <Text style={[styles.label, { color: theme.colors.textMuted }]}>{t('title')}</Text>
              <TextInput
                testID="input-title"
                value={title}
                onChangeText={setTitle}
                placeholder={t('title')}
                placeholderTextColor={theme.colors.textSoft}
                style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
              />

              <Text style={[styles.label, { color: theme.colors.textMuted }]}>{t('description')}</Text>
              <TextInput
                testID="input-description"
                value={desc}
                onChangeText={setDesc}
                placeholder={t('description')}
                placeholderTextColor={theme.colors.textSoft}
                multiline
                style={[styles.input, { minHeight: 72, textAlignVertical: 'top', color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
              />

              <Text style={[styles.label, { color: theme.colors.textMuted }]}>{t('assignee')}</Text>
              {members.length > 0 ? (
                <View style={styles.pillRow}>
                  {members.map((m) => {
                    const active = assignee.trim().toLowerCase() === m.name.trim().toLowerCase();
                    return (
                      <PressScale
                        key={m.member_id}
                        testID={`assign-${m.member_id}`}
                        onPress={() => setAssignee(active ? '' : m.name)}
                        style={[styles.pill, { borderColor: theme.colors.cardBorder, backgroundColor: active ? theme.colors.primary : theme.colors.bgSoft }]}
                      >
                        <Text style={[styles.pillText, { color: active ? theme.colors.primaryText : theme.colors.textMuted }]}>{m.name}</Text>
                      </PressScale>
                    );
                  })}
                </View>
              ) : (
                <TextInput
                  testID="input-assignee"
                  value={assignee}
                  onChangeText={setAssignee}
                  placeholder={t('assignee')}
                  placeholderTextColor={theme.colors.textSoft}
                  style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
                />
              )}
              {suggestedAssignee || suggestLoading ? (
                <View style={styles.suggestRow}>
                  <Sparkles color={theme.colors.accent} size={11} />
                  {suggestLoading ? (
                    <Text style={[styles.suggestText, { color: theme.colors.textMuted }]}>{t('addcard_ai_thinking')}</Text>
                  ) : (
                    <>
                      <Text style={[styles.suggestText, { color: theme.colors.textMuted }]}>{t('addcard_suggested')}</Text>
                      <PressScale
                        testID={`suggest-${suggestedAssignee}`}
                        onPress={() => setAssignee(suggestedAssignee)}
                        style={[styles.suggestChip, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.accentSoft }]}
                      >
                        <Text style={[styles.suggestChipText, { color: theme.colors.accent }]}>{suggestedAssignee}</Text>
                      </PressScale>
                    </>
                  )}
                </View>
              ) : null}

              <View style={styles.rowHeader}>
                <Repeat color={theme.colors.textMuted} size={12} />
                <Text style={[styles.label, { color: theme.colors.textMuted }]}>{t('recurrence')}</Text>
              </View>
              <View style={styles.pillRow}>
                {RECURRENCES.map((r) => {
                  const active = recurrence === r;
                  return (
                    <PressScale
                      key={r}
                      testID={`rec-${r}`}
                      onPress={() => setRecurrence(r)}
                      style={[styles.pill, { borderColor: theme.colors.cardBorder, backgroundColor: active ? theme.colors.primary : theme.colors.bgSoft }]}
                    >
                      <Text style={[styles.pillText, { color: active ? theme.colors.primaryText : theme.colors.textMuted }]}>
                        {t(`rec_${r}`)}
                      </Text>
                    </PressScale>
                  );
                })}
              </View>

              <View style={styles.rowHeader}>
                <Bell color={theme.colors.textMuted} size={12} />
                <Text style={[styles.label, { color: theme.colors.textMuted }]}>{t('reminder')}</Text>
              </View>
              <View style={styles.pillRow}>
                {REMINDERS.map((rem) => {
                  const active = reminderMins === rem.mins;
                  return (
                    <PressScale
                      key={rem.mins}
                      testID={`rem-${rem.mins}`}
                      onPress={() => setReminderMins(rem.mins)}
                      style={[styles.pill, { borderColor: theme.colors.cardBorder, backgroundColor: active ? theme.colors.primary : theme.colors.bgSoft }]}
                    >
                      <Text style={[styles.pillText, { color: active ? theme.colors.primaryText : theme.colors.textMuted }]}>
                        {t(rem.key)}
                      </Text>
                    </PressScale>
                  );
                })}
              </View>
            </ScrollView>

            {/* Stacked full-width buttons — mirrors the proven "Mark as done"
                pattern (no flex-pair rows, whose labels failed to paint on some
                Android renderers via PressScale's style duplication). */}
            <View style={styles.footer}>
              <PressScale
                testID="save-add-card"
                onPress={handleSave}
                disabled={saving || !title.trim()}
                style={[styles.saveBtn, (!title.trim() || saving) && { opacity: 0.5 }]}
              >
                <Check color="#FFFFFF" size={18} />
                <Text style={styles.saveText}>{saving ? '...' : t('save')}</Text>
              </PressScale>
              <PressScale testID="cancel-add-card" onPress={onClose} style={[styles.cancelBtn, { borderColor: theme.colors.cardBorder }]}>
                <Text style={[styles.cancelText, { color: theme.colors.textMuted }]}>{t('cancel')}</Text>
              </PressScale>
            </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill },
  container: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    padding: 24,
    // Bottom padding set inline from the safe-area inset (nav bar height).
    // Never taller than the screen: the middle scrolls, the footer stays
    // visible on every phone size.
    maxHeight: '88%',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: -10 },
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  heading: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 26,
    letterSpacing: -0.3,
  },
  closeBtn: {
    padding: 8,
    borderRadius: 9999,
    borderWidth: 1,
  },
  transcriptBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  transcriptLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  transcriptText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 21,
  },
  label: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 8,
  },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  typeBtn: {
    flexBasis: '30%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 6,
    gap: 6,
  },
  typeLabel: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 2,
  },
  suggestText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  suggestChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9999,
    borderWidth: 1,
  },
  suggestChipText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 12,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9999,
    borderWidth: 1,
  },
  pillText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  footer: {
    marginTop: 16,
    gap: 10,
  },
  cancelBtn: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  saveBtn: {
    minHeight: 54,
    borderRadius: 99,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: '#F97316',
  },
  saveText: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: '#FFFFFF' },
});
