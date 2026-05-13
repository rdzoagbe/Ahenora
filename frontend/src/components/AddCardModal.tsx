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
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
} from 'react-native';
import { X, FileSignature, Mail, ListTodo, Repeat, Bell, Sparkles } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { PressScale } from './PressScale';
import { useStore } from '../store';
import { api, CardType, Recurrence } from '../api';

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

const TYPES: { key: CardType; color: string; icon: any }[] = [
  { key: 'SIGN_SLIP', color: '#F97316', icon: FileSignature },
  { key: 'RSVP', color: '#6366F1', icon: Mail },
  { key: 'TASK', color: '#10B981', icon: ListTodo },
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
  const [type, setType] = useState<CardType>('TASK');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [assignee, setAssignee] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [reminderMins, setReminderMins] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [suggestedAssignee, setSuggestedAssignee] = useState<string>('');
  const [suggestLoading, setSuggestLoading] = useState(false);

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

      let vaultSaved = false;

      if (
        initialSource === 'CAMERA' &&
        initialDraft?.image_base64 &&
        initialDraft.save_to_vault !== false
      ) {
        await api.createVaultDoc({
          title: title.trim() || initialDraft.title || 'Scanned document',
          category: initialDraft.vault_category || 'School',
          image_base64: initialDraft.image_base64,
        });
        vaultSaved = true;
      }

      onCreated();
      onClose();

      if (vaultSaved) {
        Alert.alert('Saved', 'Card created and scanned document saved to Vault.');
      }
    } catch (e: any) {
      console.log('create card error', e);
      Alert.alert('Save failed', e?.message || 'Could not save this card.');
    } finally {
      setSaving(false);
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
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}> 
            <View style={styles.header}>
              <Text style={[styles.heading, { color: theme.colors.text }]}>{t('add_card')}</Text>
              <PressScale testID="close-add-card" onPress={onClose} style={[styles.closeBtn, { borderColor: theme.colors.cardBorder }]}> 
                <X color={theme.colors.text} size={18} />
              </PressScale>
            </View>

            <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
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
                      >
                        {typ.key === 'SIGN_SLIP'
                          ? t('sign_slip')
                          : typ.key === 'RSVP'
                          ? t('rsvp')
                          : t('task')}
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
              <TextInput
                testID="input-assignee"
                value={assignee}
                onChangeText={setAssignee}
                placeholder={t('assignee')}
                placeholderTextColor={theme.colors.textSoft}
                style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
              />
              {suggestedAssignee || suggestLoading ? (
                <View style={styles.suggestRow}>
                  <Sparkles color={theme.colors.accent} size={11} />
                  {suggestLoading ? (
                    <Text style={[styles.suggestText, { color: theme.colors.textMuted }]}>AI is thinking...</Text>
                  ) : (
                    <>
                      <Text style={[styles.suggestText, { color: theme.colors.textMuted }]}>Suggested:</Text>
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

            <View style={styles.footer}>
              <PressScale testID="cancel-add-card" onPress={onClose} style={[styles.cancelBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}> 
                <Text style={[styles.cancelText, { color: theme.colors.text }]}>{t('cancel')}</Text>
              </PressScale>
              <PressScale
                testID="save-add-card"
                onPress={handleSave}
                disabled={saving || !title.trim()}
                style={[styles.saveBtn, { backgroundColor: theme.colors.primary }, (!title.trim() || saving) && { opacity: 0.5 }]}
              >
                <Text style={[styles.saveText, { color: theme.colors.primaryText }]}>{saving ? '...' : t('save')}</Text>
              </PressScale>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  container: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    padding: 24,
    paddingBottom: 34,
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
  typeRow: { flexDirection: 'row', gap: 10 },
  typeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    gap: 8,
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
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  saveBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
