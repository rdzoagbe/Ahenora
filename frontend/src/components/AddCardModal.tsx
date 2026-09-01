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
import { CalendarClock, X, FileSignature, Mail, ListTodo, Repeat, Bell, Sparkles, Cake, School, Stethoscope, Plane, Check } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressScale } from './PressScale';
import DateTimePickerSheet from './DateTimePickerSheet';
import { useUI } from './Kit';
import { toLocalDateInput, toLocalTimeInput } from '../utils/date';
import { useStore } from '../store';
import { detectDateTime } from '../dateParse';
import { Card, api, CardType, FamilyMember, Recurrence } from '../api';
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
  /** Set by the document scan: this is something happening at a time. */
  is_event?: boolean;
  /** When the document itself stops being valid, not when to act on it. */
  expires_on?: string | null;
  /** Where it happens, when the document says so. */
  location?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
  initialSource?: 'MANUAL' | 'VOICE' | 'CAMERA';
  initialDraft?: VoiceDraft | null;
  /**
   * The card being edited, or null to create a new one. Editing reuses this
   * screen rather than getting one of its own: every field a card has already
   * lives here, and a second copy would drift from this one the first time
   * either changed. Until now a card could not be corrected at all - a typo in
   * a title, a date that moved, the wrong person - short of deleting it and
   * starting again, which took its history with it.
   */
  editCard?: Card | null;
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

// yearly was missing, so a birthday added by hand fired once and never came
// back. The server has always understood it — calendar import creates yearly
// cards — but there was no way to choose it, and PATCH refused it, which is
// why an imported birthday could not even be edited.
const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];
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
  editCard = null,
}: Props) {
  const { t, theme, lang } = useStore();
  const ui = useUI();
  const insets = useSafeAreaInsets();
  const [type, setType] = useState<CardType>('TASK');
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [assignee, setAssignee] = useState('');
  // Shared unless you say otherwise. The old default was private, which meant
  // the + button produced something nobody else could see or be told about.
  const [shared, setShared] = useState(true);
  // Set when picking a person flips a "Just me" card to shared, so the change
  // is announced rather than silently applied behind the toggle.
  const [sharedByAssignee, setSharedByAssignee] = useState(false);
  const [recurrence, setRecurrence] = useState<Recurrence>('none');
  const [reminderMins, setReminderMins] = useState<number>(15);
  // A task without a date is a note. The picker existed but nothing wired
  // it in — manually created cards could never appear on the calendar or
  // remind anyone.
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [showDuePicker, setShowDuePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggestedAssignee, setSuggestedAssignee] = useState<string>('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  // Smart layer (Phase 2), all additive: a typed-date → Calendar suggestion
  // and a vault/appointment "save as a note" escape.
  const [dateSuggest, setDateSuggest] = useState<{ date: Date; label: string } | null>(null);
  // The exact title text a suggestion was dismissed for — so the same chip
  // does not pop straight back up for text the user already declined.
  const [dismissedFor, setDismissedFor] = useState<string>('');
  // Mirrors whether this draft is headed for the Vault. Seeded from the scan
  // draft so existing behaviour is unchanged; the "save as note" button can
  // flip it off to redirect a mis-routed scan.
  const [saveToVault, setSaveToVault] = useState(false);

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
      setSharedByAssignee(false);
      if (editCard) {
        // Editing: every field starts from the card as it stands, including
        // whether it is shared, so saving without touching anything changes
        // nothing.
        setType((editCard.type as CardType) || 'TASK');
        setTitle(editCard.title || '');
        setDesc(editCard.description || '');
        setAssignee(editCard.assignee || '');
        setDueDate(editCard.due_date || null);
        setShared(editCard.shared !== false);
        // Recurrence and the reminder are part of the card too. They were being
        // reset to the create-defaults ('none' / 15 min) below, so editing only
        // a title silently stopped a weekly chore recurring and changed its
        // reminder — the opposite of "saving without touching anything changes
        // nothing." Load them from the card, and let the defaults apply to new
        // cards only.
        setRecurrence(editCard.recurrence || 'none');
        setReminderMins(editCard.reminder_minutes ?? 15);
        setSaveToVault(false);
      } else if (initialDraft) {
        setType(initialDraft.type);
        setTitle(initialDraft.title);
        setDesc(initialDraft.description || '');
        setAssignee(initialDraft.assignee || '');
        setDueDate(initialDraft.due_date || null);
        // A scan draft that came with a vault category and image is the only
        // thing that lands in the Vault — mirror the same condition handleSave
        // used to compute inline, so nothing about the vault path changes.
        setSaveToVault(
          initialSource === 'CAMERA' &&
          !!initialDraft.image_base64 &&
          !!initialDraft.vault_category &&
          initialDraft.save_to_vault !== false,
        );
      } else {
        setType('TASK');
        setTitle('');
        setDesc('');
        setAssignee('');
        setSaveToVault(false);
      }
      if (!editCard) setShared(true);
      setDateSuggest(null);
      setDismissedFor('');
      // Defaults for a NEW card only — an edit already loaded these from the
      // card above, and resetting them here is what wiped a recurring card's
      // schedule. Default to a 15-minute reminder rather than none: a dated
      // event with no reminder is the "I never got a heads-up" complaint. It
      // only fires when the card has a due date, and the picker still offers
      // None for anyone who wants silence.
      if (!editCard) {
        setRecurrence('none');
        setReminderMins(15);
      }
    }
  }, [visible, initialDraft, initialSource, editCard]);

  // Watch the title for a clear date/time cue. Conservative by design — it
  // returns null on ordinary text, so the chip stays hidden for most cards.
  useEffect(() => {
    const trimmed = title.trim();
    if (!trimmed) { setDateSuggest(null); return; }
    setDateSuggest(detectDateTime(trimmed, lang));
  }, [title, lang]);

  const showDateChip =
    !!dateSuggest && type !== 'APPOINTMENT' && title.trim() !== dismissedFor;

  const acceptDateSuggestion = () => {
    if (!dateSuggest) return;
    setType('APPOINTMENT');
    setDueDate(dateSuggest.date.toISOString());
  };

  // A scanned document the model read as something happening at a time, with a
  // date to go with it. The server decides this (`is_event`) so the rule lives
  // in one place and is tested; the sheet only asks whether this is that case
  // and whether we are creating rather than editing.
  const stagesAsEvent = !editCard && !!initialDraft?.is_event && !!dueDate;

  // Where this card will land, for the one-line destination hint.
  const destKey =
    stagesAsEvent || type === 'APPOINTMENT'
      ? 'add_dest_calendar'
      : saveToVault ? 'add_dest_vault' : 'add_dest_feed';

  const handleSave = async () => {
    if (!title.trim()) return;

    setSaving(true);

    try {
      if (editCard) {
        // Only the fields this screen owns. Status, stars and the card's
        // history are none of its business.
        await api.updateCard(editCard.card_id, {
          type,
          title: title.trim(),
          description: desc.trim(),
          assignee: assignee.trim(),
          due_date: dueDate,
          recurrence,
          reminder_minutes: reminderMins,
          shared,
        } as any);
      } else if (stagesAsEvent) {
        // A scanned appointment does not become a card here. It becomes a
        // CANDIDATE, so the keep-or-share decision is made in one place — the
        // calendar's review list — rather than being asked once in this sheet
        // and again in that one. Nothing lands on the calendar unseen.
        await api.stageScannedEvent({
          title: title.trim(),
          description: desc.trim(),
          due_date: dueDate!,
          type,
          location: initialDraft?.location || null,
          reminder_minutes: reminderMins,
        });
      } else {
        await api.createCard({
          type,
          title: title.trim(),
          description: desc.trim(),
          assignee: assignee.trim(),
          due_date: dueDate,
          source: initialSource,
          image_base64: initialDraft?.image_base64 || null,
          recurrence,
          reminder_minutes: reminderMins,
          shared,
        } as any);
      }
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
      saveToVault &&
      initialSource === 'CAMERA' &&
      !!initialDraft?.image_base64 &&
      !!initialDraft?.vault_category;

    onCreated();
    onClose();
    setSaving(false);

    if (wantsVault) {
      try {
        await api.createVaultDoc({
          title: title.trim() || initialDraft!.title || t('addcard_scanned_document'),
          // No fallback drawer. "School" used to be the default here, which
          // is how a gas bill was filed with the permission slips; the
          // capture sheet now asks, and nothing reaches the vault without
          // an answer.
          category: initialDraft!.vault_category!,
          image_base64: initialDraft!.image_base64!,
          // When the document itself stops being valid — a passport, a policy.
          // /api/vault/expiry-alerts has existed for a while with nothing
          // writing this, so it could only ever report "nothing expiring".
          expiry_date: initialDraft?.expires_on || null,
        });
        // One message covering both halves, because both happened: the paper
        // is filed and the appointment is waiting to be confirmed. Saying only
        // "saved to vault" would hide the half the person has to act on.
        Alert.alert(
          t('addcard_saved_title'),
          stagesAsEvent
            ? t('addcard_saved_vault_and_event_message')
            : t('addcard_saved_vault_message'),
        );
      } catch (e: any) {
        // Card already saved; only the vault copy failed — inform, don't retry.
        logger.warn('vault save error', e);
        Alert.alert(t('addcard_card_saved_title'), t('addcard_vault_failed_message'));
      }
    } else if (stagesAsEvent) {
      // Staged but not filed — a letter worth an appointment but not worth
      // keeping. The person still has to be told where the event went, or it
      // looks like the scan did nothing.
      Alert.alert(t('addcard_saved_title'), t('addcard_saved_event_message'));
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
              <Text style={[styles.heading, { color: theme.colors.text }]}>{editCard ? t('addcard_edit_title') : t('add_card')}</Text>
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
                      onPress={() => {
                        setType(typ.key);
                        // A birthday that happens once is not a birthday. The
                        // chip existed and the card still fired a single time,
                        // because yearly could not be chosen — so picking the
                        // type now implies the repeat, and leaving BIRTHDAY
                        // takes it back rather than stranding "yearly" on a
                        // dentist appointment.
                        if (typ.key === 'BIRTHDAY') setRecurrence('yearly');
                        else if (recurrence === 'yearly') setRecurrence('none');
                      }}
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

              {showDateChip && dateSuggest ? (
                <View style={[styles.dateChip, { backgroundColor: ui.mint, borderColor: ui.mintText + '55' }]}>
                  <CalendarClock color={ui.mintText} size={15} />
                  <Text style={[styles.dateChipText, { color: ui.mintText }]} numberOfLines={2}>
                    {t('add_date_suggest', { when: dateSuggest.label })}
                  </Text>
                  <PressScale
                    testID="date-suggest-add"
                    accessibilityRole="button"
                    accessibilityLabel={t('add_date_suggest_cta')}
                    onPress={acceptDateSuggestion}
                    style={[styles.dateChipCta, { backgroundColor: ui.mintText }]}
                  >
                    <Text style={styles.dateChipCtaText}>{t('add_date_suggest_cta')}</Text>
                  </PressScale>
                  <PressScale
                    testID="date-suggest-dismiss"
                    accessibilityRole="button"
                    accessibilityLabel={t('close')}
                    onPress={() => setDismissedFor(title.trim())}
                    style={styles.dateChipX}
                  >
                    <X color={ui.mintText} size={15} />
                  </PressScale>
                </View>
              ) : null}

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
                        onPress={() => {
                          const next = active ? '' : m.name;
                          setAssignee(next);
                          // Handing someone a job and keeping it invisible to
                          // them is a contradiction. Rather than the server
                          // quietly overriding the choice, the toggle moves
                          // here, in front of the person making it.
                          if (next && !shared) { setShared(true); setSharedByAssignee(true); }
                          if (!next) setSharedByAssignee(false);
                        }}
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
                        <Text style={[styles.suggestChipText, { color: theme.colors.accentInk }]}>{suggestedAssignee}</Text>
                      </PressScale>
                    </>
                  )}
                </View>
              ) : null}

              <Text style={[styles.label, { color: theme.colors.textMuted }]}>{t('addcard_who_sees')}</Text>
              <View style={styles.pillRow}>
                <PressScale
                  testID="share-everyone"
                  onPress={() => { setShared(true); setSharedByAssignee(false); }}
                  style={[styles.pill, { borderColor: theme.colors.cardBorder, backgroundColor: shared ? theme.colors.primary : theme.colors.bgSoft }]}
                >
                  <Text style={[styles.pillText, { color: shared ? theme.colors.primaryText : theme.colors.textMuted }]}>
                    {t('addcard_share_everyone')}
                  </Text>
                </PressScale>
                <PressScale
                  testID="share-just-me"
                  onPress={() => { setShared(false); setSharedByAssignee(false); }}
                  style={[styles.pill, { borderColor: theme.colors.cardBorder, backgroundColor: !shared ? theme.colors.primary : theme.colors.bgSoft }]}
                >
                  <Text style={[styles.pillText, { color: !shared ? theme.colors.primaryText : theme.colors.textMuted }]}>
                    {t('addcard_share_just_me')}
                  </Text>
                </PressScale>
              </View>
              <Text style={[styles.suggestText, { color: theme.colors.textMuted, marginTop: -4, marginBottom: 4 }]}>
                {(() => {
                  if (!shared) return t('addcard_share_just_me_hint');
                  const who = assignee.trim();
                  if (!who) return t('addcard_share_everyone_hint');
                  if (sharedByAssignee) return t('addcard_share_switched');
                  // Naming yourself back to yourself reads as nonsense
                  // ("between you, Roland and the other parent"). When the task
                  // is yours, the set is simply you and the other parent.
                  const me = (members.find((m) => m.is_me)?.name || '').trim();
                  if (me && who.toLowerCase() === me.toLowerCase()) {
                    return t('addcard_share_assigned_self_hint');
                  }
                  return t('addcard_share_assigned_hint').replace('{name}', who);
                })()}
              </Text>

              <View style={styles.rowHeader}>
                <CalendarClock color={theme.colors.textMuted} size={12} />
                <Text style={[styles.label, { color: theme.colors.textMuted }]}>{t('due_label')}</Text>
              </View>
              <View style={styles.pillRow}>
                <PressScale
                  testID="open-due-picker"
                  onPress={() => setShowDuePicker(true)}
                  style={[styles.pill, { borderColor: theme.colors.cardBorder, backgroundColor: dueDate ? theme.colors.primary : theme.colors.bgSoft }]}
                >
                  <Text style={[styles.pillText, { color: dueDate ? theme.colors.primaryText : theme.colors.textMuted }]}>
                    {dueDate ? `${toLocalDateInput(dueDate)} · ${toLocalTimeInput(dueDate)}` : t('no_due')}
                  </Text>
                </PressScale>
                {dueDate ? (
                  <PressScale
                    testID="clear-due"
                    onPress={() => setDueDate(null)}
                    accessibilityLabel={t('dt_clear')}
                    style={[styles.pill, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
                  >
                    <Text style={[styles.pillText, { color: theme.colors.textMuted }]}>✕</Text>
                  </PressScale>
                ) : null}
              </View>

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
              {(type === 'APPOINTMENT' || saveToVault) ? (
                <PressScale
                  testID="save-as-note"
                  accessibilityRole="button"
                  onPress={() => { setType('TASK'); setSaveToVault(false); }}
                  style={styles.noteBtn}
                >
                  <Text style={[styles.noteText, { color: theme.colors.textMuted }]}>{t('add_save_as_note')}</Text>
                </PressScale>
              ) : null}
              <View style={styles.destRow}>
                <Text testID="dest-hint" style={[styles.destText, { color: theme.colors.textSoft }]} numberOfLines={1}>
                  {t(destKey)}
                </Text>
              </View>
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
      <DateTimePickerSheet
        visible={showDuePicker}
        value={dueDate}
        onChange={setDueDate}
        onClose={() => setShowDuePicker(false)}
      />
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
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dateChipText: { flex: 1, minWidth: 0, fontFamily: 'Inter_700Bold', fontSize: 13 },
  dateChipCta: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9999,
  },
  dateChipCtaText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, color: '#FFFFFF' },
  dateChipX: { padding: 4 },
  destRow: { alignItems: 'center', marginBottom: 2 },
  destText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  noteBtn: { alignItems: 'center', paddingVertical: 6 },
  noteText: { fontFamily: 'Inter_700Bold', fontSize: 13, textDecorationLine: 'underline' },
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
