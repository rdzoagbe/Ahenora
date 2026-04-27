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
  const { t } = useStore();
  const [type, setType] = useState<CardType>('TASK');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [assignee, setAssignee] = useState('');
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [reminderMins, setReminderMins] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [suggestedAssignee, setSuggestedAssignee] = useState<string>('');
  const [suggestLoading, setSuggestLoading] = useState(false);

  // Auto-assign suggestion: when title is long enough and assignee is empty
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
      <BlurView intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.backdrop} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.heading}>{t('add_card')}</Text>
              <PressScale testID="close-add-card" onPress={onClose} style={styles.closeBtn}>
                <X color="#fff" size={18} />
              </PressScale>
            </View>

            <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
              {initialDraft?.transcript ? (
                <View style={styles.transcriptBox}>
                  <Text style={styles.transcriptLabel}>{t('transcript')}</Text>
                  <Text style={styles.transcriptText} numberOfLines={3}>
                    &ldquo;{initialDraft.transcript}&rdquo;
                  </Text>
                </View>
              ) : null}

              <Text style={styles.label}>{t('choose_type')}</Text>
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
                          borderColor: active ? typ.color : 'rgba(255,255,255,0.1)',
                          backgroundColor: active ? typ.color + '22' : 'rgba(255,255,255,0.03)',
                        },
                      ]}
                    >
                      <Icon color={active ? typ.color : 'rgba(255,255,255,0.6)'} size={18} />
                      <Text
                        style={[
                          styles.typeLabel,
                          { color: active ? typ.color : 'rgba(255,255,255,0.7)' },
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

              <Text style={styles.label}>{t('title')}</Text>
              <TextInput
                testID="input-title"
                value={title}
                onChangeText={setTitle}
                placeholder={t('title')}
                placeholderTextColor="rgba(255,255,255,0.3)"
                style={styles.input}
              />

              <Text style={styles.label}>{t('description')}</Text>
              <TextInput
                testID="input-description"
                value={desc}
                onChangeText={setDesc}
                placeholder={t('description')}
                placeholderTextColor="rgba(255,255,255,0.3)"
                multiline
                style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
              />

              <Text style={styles.label}>{t('assignee')}</Text>
              <TextInput
                testID="input-assignee"
                value={assignee}
                onChangeText={setAssignee}
                placeholder={t('assignee')}
                placeholderTextColor="rgba(255,255,255,0.3)"
                style={styles.input}
              />
              {suggestedAssignee || suggestLoading ? (
                <View style={styles.suggestRow}>
                  <Sparkles color="rgba(99,102,241,0.9)" size={11} />
                  {suggestLoading ? (
                    <Text style={styles.suggestText}>AI is thinking...</Text>
                  ) : (
                    <>
                      <Text style={styles.suggestText}>Suggested:</Text>
                      <PressScale
                        testID={`suggest-${suggestedAssignee}`}
                        onPress={() => setAssignee(suggestedAssignee)}
                        style={styles.suggestChip}
                      >
                        <Text style={styles.suggestChipText}>{suggestedAssignee}</Text>
                      </PressScale>
                    </>
                  )}
                </View>
              ) : null}

              <View style={styles.rowHeader}>
                <Repeat color="rgba(255,255,255,0.55)" size={12} />
                <Text style={styles.label}>{t('recurrence')}</Text>
              </View>
              <View style={styles.pillRow}>
                {RECURRENCES.map((r) => {
                  const active = recurrence === r;
                  return (
                    <PressScale
                      key={r}
                      testID={`rec-${r}`}
                      onPress={() => setRecurrence(r)}
                      style={[styles.pill, active && styles.pillActive]}
                    >
                      <Text style={[styles.pillText, active && styles.pillTextActive]}>
                        {t(`rec_${r}`)}
                      </Text>
                    </PressScale>
                  );
                })}
              </View>

              <View style={styles.rowHeader}>
                <Bell color="rgba(255,255,255,0.55)" size={12} />
                <Text style={styles.label}>{t('reminder')}</Text>
              </View>
              <View style={styles.pillRow}>
                {REMINDERS.map((rem) => {
                  const active = reminderMins === rem.mins;
                  return (
                    <PressScale
                      key={rem.mins}
                      testID={`rem-${rem.mins}`}
                      onPress={() => setReminderMins(rem.mins)}
                      style={[styles.pill, active && styles.pillActive]}
                    >
                      <Text style={[styles.pillText, active && styles.pillTextActive]}>
                        {t(rem.key)}
                      </Text>
                    </PressScale>
                  );
                })}
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <PressScale testID="cancel-add-card" onPress={onClose} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>{t('cancel')}</Text>
              </PressScale>
              <PressScale
                testID="save-add-card"
                onPress={handleSave}
                disabled={saving || !title.trim()}
                style={[styles.saveBtn, (!title.trim() || saving) && { opacity: 0.5 }]}
              >
                <Text style={styles.saveText}>{saving ? '...' : t('save')}</Text>
              </PressScale>
            </View>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.6)' },
  container: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: 'rgba(20,22,32,0.95)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 24,
    paddingBottom: 34,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  heading: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 26,
    color: '#fff',
  },
  closeBtn: {
    padding: 8,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  transcriptBox: {
    backgroundColor: 'rgba(99,102,241,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.3)',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  transcriptLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  transcriptText: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 15,
    color: '#fff',
    lineHeight: 21,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
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
  typeLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
  },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  pillActive: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderColor: '#fff',
  },
  pillText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  pillTextActive: { color: '#080910' },
  footer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_500Medium', fontSize: 15 },
  saveBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveText: { color: '#080910', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
