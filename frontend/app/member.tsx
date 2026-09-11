import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from '../src/components/KeyboardAwareScrollView';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, Eye, KeyRound, MessageCircle, Pencil, Shield, Star, Trash2 } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { PersonAvatar, AvatarPicker } from '../src/components/PersonAvatar';
import { PinPadModal } from '../src/components/PinPadModal';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { api, FamilyMember, MemberRecord, StarTransaction } from '../src/api';
import { localeFor } from '../src/utils/date';
import { logger } from '../src/logger';

type Kind = 'parent' | 'teen' | 'kid' | 'helper' | 'member';

function kindOf(role: string): Kind {
  const r = (role || '').toLowerCase();
  if (r === 'parent' || r === 'co-parent') return 'parent';
  if (r === 'teen') return 'teen';
  if (r === 'child') return 'kid';
  if (r === 'helper') return 'helper';
  return 'member';
}

/**
 * A single family member's profile, opened from the Family Hub. What it holds
 * depends on who they are:
 *   • a parent / co-parent → the shared grown-ups conversation;
 *   • a teen → a Chat / Stars toggle (their own private thread + their stars);
 *   • a kid → their stars and a quick way to award more;
 *   • a helper or named family member → who they are (no chat: the server
 *     refuses family chat to a helper, so we never offer a door that 403s).
 * The Hub passes the chat `thread` key (the adults thread for parents, the
 * teen's own thread for a teen); an empty key means "no conversation here".
 */
/**
 * The record, in the order a person would be asked for it.
 *
 * A table rather than markup so the screen and the server cannot drift on what
 * a record contains: every care field the backend defines appears here exactly
 * once, and childRecord.test.ts fails if one is added there and forgotten here.
 * The identifiers are deliberately NOT in this table — they are rendered apart,
 * because they are the half a helper does not get.
 */
/** The text fields only — never `private_hidden` or `can_edit`, which say who
 *  may read the record rather than forming part of it. */
type RecordTextField = Exclude<keyof MemberRecord, 'private_hidden' | 'can_edit'>;

const RECORD_GROUPS: {
  key: string;
  title: string;
  fields: [RecordTextField, string, string?][];
}[] = [
  {
    key: 'care',
    title: 'rec_care',
    fields: [
      ['allergies', 'rec_allergies', 'rec_ph_allergies'],
      ['conditions', 'rec_conditions'],
      ['medications', 'rec_medications'],
      ['blood_group', 'rec_blood'],
      ['doctor_name', 'rec_doctor'],
      ['doctor_phone', 'rec_doctor_phone'],
      ['dentist_name', 'rec_dentist'],
      ['dentist_phone', 'rec_dentist_phone'],
      ['emergency_name', 'rec_emergency'],
      ['emergency_phone', 'rec_emergency_phone'],
    ],
  },
  {
    key: 'school',
    title: 'rec_school',
    fields: [['school_name', 'rec_school_name'], ['teacher_name', 'rec_teacher']],
  },
  {
    key: 'sizes',
    title: 'rec_sizes',
    fields: [['clothes_size', 'rec_clothes'], ['shoe_size', 'rec_shoe']],
  },
];

/**
 * One fact. Saved when the field loses focus, not on every keystroke — an
 * allergy typed a letter at a time would otherwise be written sixteen times,
 * and half of those writes would be a half-typed allergy.
 */
function RecordField({ testID, label, value, placeholder, editable, saving, onSave }: {
  testID: string;
  label: string;
  value: string;
  placeholder?: string;
  editable: boolean;
  saving: boolean;
  onSave: (next: string) => void;
}) {
  const ui = useUI();
  const { t } = useStore();
  const styles = createStyles(ui);
  const [draft, setDraft] = useState(value);
  // Follow the server when it answers, unless this field is the one being
  // edited — otherwise a save elsewhere would yank the text from under them.
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(value); }, [value, focused]);

  return (
    <View style={styles.recField}>
      <Text style={styles.recLabel}>{label}</Text>
      {editable ? (
        <TextInput
          testID={testID}
          value={draft}
          onChangeText={setDraft}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); onSave(draft.trim()); }}
          placeholder={placeholder}
          placeholderTextColor={ui.muted}
          style={styles.recInput}
          maxLength={400}
        />
      ) : (
        <Text testID={testID} style={[styles.recValue, !value && { color: ui.muted }]}>
          {value || t('rec_empty')}
        </Text>
      )}
      {saving ? <ActivityIndicator color={ui.muted} size="small" style={styles.recSpin} /> : null}
    </View>
  );
}

export default function MemberProfile() {
  const ui = useUI();
  const router = useRouter();
  const { t, lang } = useStore();
  const styles = createStyles(ui);
  const params = useLocalSearchParams<{ id?: string; name?: string; role?: string; thread?: string }>();

  const id = String(params.id || '');
  const name = String(params.name || '');
  const role = String(params.role || '');
  const thread = String(params.thread || '');
  const kind = kindOf(role);
  const canChat = Boolean(thread) && (kind === 'parent' || kind === 'teen');
  const showsStars = kind === 'teen' || kind === 'kid';

  const [member, setMember] = useState<FamilyMember | null>(null);
  const [history, setHistory] = useState<StarTransaction[]>([]);
  const [busy, setBusy] = useState(false);
  // Rename happens in place: a whole screen for one text field is the kind of
  // detour this redesign exists to remove.
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const [savingName, setSavingName] = useState(false);
  const [displayName, setDisplayName] = useState(name);
  const [pinOpen, setPinOpen] = useState(false);

  // Loads for EVERY kind, not just the ones with stars: is_me and is_founder
  // live on this row, and they decide whether Remove may be offered at all. When
  // it only ran for kids and teens, both flags were undefined on a grown-up's
  // page — the one place this screen is actually opened from — so Remove was
  // shown on your own row and on the founder's, where the server then refused it.
  const loadMember = useCallback(async () => {
    if (!id) return;
    try {
      const members = await api.familyMembers();
      setMember(members.find((m) => m.member_id === id) || null);
      if (!showsStars) return;
      const h = await api.memberStarHistory(id).catch(() => [] as StarTransaction[]);
      setHistory(h.slice(0, 6));
    } catch (e) {
      logger.warn('member load failed', e);
    }
  }, [id, showsStars]);

  useEffect(() => { loadMember(); }, [loadMember]);

  const giveStars = useCallback(async (delta: number) => {
    if (!id || busy) return;
    setBusy(true);
    try {
      await api.adjustMemberStars(id, { delta, reason: t('kids_parent_added_stars') });
      await loadMember();
    } catch (e) {
      logger.warn('give stars failed', e);
    } finally {
      setBusy(false);
    }
  }, [id, busy, loadMember, t]);

  // The picture is one PATCH away and there are five choices, so it saves on
  // tap rather than behind a Save button. Optimistic: the row you just tapped
  // has to look chosen immediately or the tap reads as ignored.
  /**
   * The child record — what a carer, a co-parent or a school would ask for.
   *
   * Loaded on its own rather than folded into /family/members, because that
   * list is fetched by every screen and by helpers, and a child's health
   * information has no business riding along with it. Who may see which half
   * is decided on the server; this screen renders what it is given.
   */
  const [record, setRecord] = useState<MemberRecord | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.getMemberRecord(id)
      .then((r) => { if (!cancelled) setRecord(r); })
      .catch((e) => logger.warn('member record load failed', e));
    return () => { cancelled = true; };
  }, [id]);

  // Saved on blur, one field at a time — the PATCH carries only what changed,
  // so two parents editing different halves from two phones do not overwrite
  // each other. An unchanged field is not sent at all.
  const saveField = useCallback(async (field: RecordTextField, next: string) => {
    if (!record || (record[field] ?? '') === next) return;
    setRecord((prev) => (prev ? { ...prev, [field]: next } : prev));
    setSavingField(field);
    try {
      setRecord(await api.updateMemberRecord(id, { [field]: next }));
    } catch (e) {
      logger.warn('member record save failed', e);
      setRecord((prev) => (prev ? { ...prev, [field]: record[field] ?? '' } : prev));
      Alert.alert(t('rec_title'), t('rec_save_failed'));
    } finally {
      setSavingField(null);
    }
  }, [id, record, t]);

  // What this reader actually gets rows for. An editor gets every field,
  // because a blank is how a parent knows there is something to fill in.
  const visibleGroups = useMemo(() => {
    if (!record) return [];
    if (record.can_edit) return RECORD_GROUPS;
    return RECORD_GROUPS
      .map((g) => ({ ...g, fields: g.fields.filter(([f]) => (record[f] ?? '').trim()) }))
      .filter((g) => g.fields.length > 0);
  }, [record]);

  const [avatar, setAvatar] = useState<string | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  useEffect(() => { setAvatar(member?.avatar ?? null); }, [member?.avatar]);

  const saveAvatar = async (next: string | null) => {
    if (!id || savingAvatar || next === avatar) return;
    const previous = avatar;
    setAvatar(next);
    setSavingAvatar(true);
    try {
      // The API takes a string; '' is how you clear it back to the letter.
      await api.updateFamilyMember(id, { avatar: next ?? '' });
    } catch (e: any) {
      setAvatar(previous);
      Alert.alert(t('set_remove_member_error'), e?.message || t('set_please_try_again'));
    } finally {
      setSavingAvatar(false);
    }
  };

  const saveName = async () => {
    const next = nameDraft.trim();
    if (!next || next === displayName) { setRenaming(false); return; }
    setSavingName(true);
    try {
      await api.updateFamilyMember(id, { name: next });
      setDisplayName(next);
      setRenaming(false);
    } catch (e: any) {
      Alert.alert(t('set_remove_member_error'), e?.message || t('set_please_try_again'));
    } finally {
      setSavingName(false);
    }
  };

  const removeMember = useCallback(() => {
    Alert.alert(
      `${t('set_remove')} ${displayName}?`,
      kind === 'kid' ? t('set_remove_member_msg') : t('set_remove_coparent_msg'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('set_remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteFamilyMember(id);
              router.back();
            } catch (e: any) {
              Alert.alert(t('set_remove_member_error'), e?.message || t('set_please_try_again'));
            }
          },
        },
      ],
    );
  }, [id, displayName, kind, router, t]);

  // A conversation always opens as its own screen — one door, whether you got
  // here from the Hub or from the person's page.
  const openConversation = useCallback(() => {
    router.push({
      pathname: '/conversation',
      params: { thread, title: displayName, adults: kind === 'parent' ? '1' : '0' },
    });
  }, [router, thread, displayName, kind]);

  const roleLabel = useMemo(() => {
    // The founder is the Owner, not a co-parent — matching the roster badge.
    // Opening your own profile used to badge you "Co-parent", which is wrong for
    // the person who created the household.
    if (kind === 'parent') return member?.is_founder ? t('hub_role_owner') : t('hub_role_coparent');
    if (kind === 'teen') return t('hub_role_teen');
    if (kind === 'kid') return t('hub_role_kid');
    if (kind === 'helper') return t('hub_role_helper');
    return role; // a named family member keeps their own label (Grandma, Nanny…)
  }, [kind, role, t, member?.is_founder]);

  const badgeTone = kind === 'teen'
    ? { bg: ui.lavender, fg: ui.lavenderText }
    : kind === 'kid'
      ? { bg: ui.mint, fg: ui.mintText }
      : kind === 'parent'
        ? { bg: ui.orangeSoft, fg: ui.orangeText }
        : { bg: ui.soft, fg: ui.muted };

  const stars = member?.stars ?? 0;
  const weekEarned = member?.week_earned ?? 0;
  const weeklyTarget = member?.weekly_target ?? 0;

  const renderStars = () => (
    <>
      <View style={styles.starCard}>
        <View style={styles.starBig}>
          <Star color={ui.mintText} size={30} fill={ui.mintText} />
          <Text style={styles.starBigNum}>{stars}</Text>
        </View>
        <Text style={styles.starLbl}>
          {weeklyTarget > 0
            ? t('hub_stars_week', { earned: weekEarned, target: weeklyTarget })
            : t('hub_stars_saved')}
        </Text>
      </View>

      <Text style={styles.sec}>{t('hub_give_stars')}</Text>
      <View style={styles.giveRow}>
        {[1, 3, 5].map((n) => (
          <PressScale
            key={n}
            testID={`member-give-${n}`}
            disabled={busy}
            onPress={() => giveStars(n)}
            style={[styles.giveBtn, busy && { opacity: 0.5 }]}
          >
            <Star color="#fff" size={15} fill="#fff" />
            <Text style={styles.giveBtnText}>+{n}</Text>
          </PressScale>
        ))}
      </View>

      {history.length > 0 ? (
        <>
          <Text style={styles.sec}>{t('hub_recent_stars')}</Text>
          {history.map((h) => (
            <View key={h.transaction_id} style={styles.histRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.histReason} numberOfLines={1}>{h.reason || t('hub_stars_adjustment')}</Text>
                {h.created_at ? (
                  <Text style={styles.histDate}>
                    {new Date(h.created_at).toLocaleDateString(localeFor(lang), { month: 'short', day: 'numeric' })}
                  </Text>
                ) : null}
              </View>
              <Text style={[styles.histDelta, { color: h.delta >= 0 ? ui.mintText : ui.orangeText }]}>
                {h.delta >= 0 ? '+' : ''}{h.delta}★
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {kind === 'kid' ? (
        <Text style={styles.footNote}>{t('hub_kid_tools_hint')}</Text>
      ) : null}
    </>
  );

  const renderInfo = () => (
    <>
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>{t('hub_role_on_team', { role: roleLabel })}</Text>
        <Text style={styles.infoBody}>
          {kind === 'helper' ? t('hub_helper_access') : t('hub_member_access')}
        </Text>
      </View>
      {kind === 'helper' ? (
        <Text style={styles.footNote}>{t('hub_helper_no_chat')}</Text>
      ) : null}
    </>
  );

  // The web build prerenders this route with no query string, so every value
  // taken from params — the name, the role, the thread — differs between that
  // HTML and the first client render. React then discards the whole tree and
  // logs a hydration error. Render the same empty shell both sides start from,
  // and read the params on the next tick. Native mounts immediately, so this
  // costs nothing there.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <PressScale testID="member-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/kids'))} style={styles.backBtn} accessibilityLabel={t('back')}>
          <ChevronLeft color={ui.text} size={22} />
        </PressScale>
        <View style={styles.headMid}>
          <Text style={styles.headName} numberOfLines={1}>{displayName}</Text>
          <View style={[styles.headBadge, { backgroundColor: badgeTone.bg }]}>
            <Text style={[styles.headBadgeText, { color: badgeTone.fg }]}>{roleLabel}</Text>
          </View>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* The conversation is a door, not the page: it opens as its own screen,
            the same one the Hub opens, so there is a single chat surface. Not on
            your OWN profile — you cannot message yourself, and offering
            "Message Roland" to Roland reads as a bug. */}
        {canChat && !member?.is_me ? (
          <>
            <Text style={styles.sec}>{t('hub_conversation')}</Text>
            <PressScale testID="member-open-chat" onPress={openConversation} style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: ui.orangeSoft }]}>
                <MessageCircle color={ui.orangeText} size={18} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowTitle}>{t('hub_message_name', { name: displayName })}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  {kind === 'parent' ? t('chat_empty_adults') : t('chat_empty_teen')}
                </Text>
              </View>
              <ChevronRight color={ui.muted} size={18} />
            </PressScale>
          </>
        ) : null}

        {showsStars ? renderStars() : null}
        {kind === 'helper' || kind === 'member' ? renderInfo() : null}

        {/* Key facts — what a family IS, as opposed to what it is doing.
            Above Manage, because this is the half a parent comes back for. */}
        {record ? (
          <>
            <Text style={styles.sec}>{t('rec_title')}</Text>
            <Text style={styles.recSub}>{t('rec_sub')}</Text>

            {!record.can_edit ? (
              <View style={styles.recNote}>
                <Eye color={ui.muted} size={15} />
                <Text style={styles.recNoteText}>{t('rec_helper_note')}</Text>
              </View>
            ) : null}

            {/* A reader sees what is filled in; an editor sees the blanks.
                A carer opening this wants the allergy, and ten rows of
                "Nothing recorded yet" is where the one line that matters goes
                to hide. A parent needs the blanks — they are the invitation to
                fill them. */}
            {visibleGroups.length === 0 ? (
              <View style={styles.recCard}>
                <Text style={styles.recEmptyAll}>{t('rec_empty')}</Text>
              </View>
            ) : visibleGroups.map((group) => (
              <View key={group.key} style={styles.recCard}>
                <Text style={styles.recGroup}>{t(group.title)}</Text>
                {group.fields.map(([field, label, placeholder]) => (
                  <RecordField
                    key={field}
                    testID={`record-${field}`}
                    label={t(label)}
                    placeholder={placeholder ? t(placeholder) : ''}
                    value={record[field] ?? ''}
                    editable={record.can_edit}
                    saving={savingField === field}
                    onSave={(next) => saveField(field, next)}
                  />
                ))}
              </View>
            ))}

            {/* The identifiers, and the fact of them.
                A helper is told the drawer exists and is not theirs, rather
                than shown nothing — silence would send them asking a parent
                for a number that is already recorded here. */}
            <View style={styles.recCard}>
              <View style={styles.recGroupRow}>
                <Text style={styles.recGroup}>{t('rec_ids')}</Text>
                {record.private_hidden ? (
                  <View style={styles.recLock}>
                    <Shield color={ui.muted} size={12} />
                    <Text style={styles.recLockText}>{t('rec_hidden')}</Text>
                  </View>
                ) : null}
              </View>
              {record.private_hidden ? null : (
                <>
                  <RecordField
                    testID="record-medical_number"
                    label={t('rec_medical_number')}
                    value={record.medical_number ?? ''}
                    editable={record.can_edit}
                    saving={savingField === 'medical_number'}
                    onSave={(next) => saveField('medical_number', next)}
                  />
                  <RecordField
                    testID="record-insurance_policy"
                    label={t('rec_policy')}
                    value={record.insurance_policy ?? ''}
                    editable={record.can_edit}
                    saving={savingField === 'insurance_policy'}
                    onSave={(next) => saveField('insurance_policy', next)}
                  />
                </>
              )}
            </View>
          </>
        ) : null}

        {/* Manage — the reason Settings no longer needs a members section. */}
        <Text style={styles.sec}>{t('hub_manage')}</Text>

        <View style={styles.pictureBox}>
          <View style={styles.pictureHead}>
            <PersonAvatar name={displayName} avatar={avatar} size={40} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rowTitle}>{t('hub_picture')}</Text>
              <Text style={styles.rowSub} numberOfLines={2}>{t('hub_picture_sub')}</Text>
            </View>
          </View>
          <AvatarPicker name={displayName} value={avatar} onPick={saveAvatar} busy={savingAvatar} />
        </View>

        {renaming ? (
          <View style={styles.renameBox}>
            <TextInput
              testID="member-rename-input" returnKeyType="done" onSubmitEditing={() => saveName()}
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder={displayName}
              placeholderTextColor={ui.muted}
              style={styles.renameInput}
              autoFocus
              maxLength={40}
            />
            <PressScale testID="member-rename-save" onPress={saveName} disabled={savingName} style={[styles.saveBtn, savingName && { opacity: 0.6 }]}>
              {savingName ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>{t('save')}</Text>}
            </PressScale>
          </View>
        ) : (
          <PressScale testID="member-rename" onPress={() => { setNameDraft(displayName); setRenaming(true); }} style={styles.act}>
            <Pencil color={ui.muted} size={17} />
            <Text style={styles.actText}>{t('hub_rename')}</Text>
          </PressScale>
        )}

        <View style={styles.act}>
          <Shield color={ui.muted} size={17} />
          <Text style={styles.actText}>{t('hub_role_row', { role: roleLabel })}</Text>
        </View>

        {/* A PIN guards kid mode on a shared device, so it only means something
            for a managed child. Offering it on a co-parent would be a control
            that does nothing. */}
        {kind === 'kid' ? (
          <PressScale testID="member-pin" onPress={() => setPinOpen(true)} style={styles.act}>
            <KeyRound color={ui.muted} size={17} />
            <Text style={styles.actText}>{member?.has_pin ? t('kids_change_pin') : t('kids_set_pin')}</Text>
          </PressScale>
        ) : null}

        {/* You cannot remove yourself, and the founder is the one parent nobody
            can remove — the server enforces both; the UI should not tempt. */}
        {member && !member.is_me && !member.is_founder ? (
          <PressScale testID="member-remove" onPress={removeMember} style={styles.act}>
            <Trash2 color={ui.danger} size={17} />
            <Text style={[styles.actText, { color: ui.danger }]}>{t('hub_remove')}</Text>
          </PressScale>
        ) : null}
      </KeyboardAwareScrollView>


      <PinPadModal
        visible={pinOpen}
        mode="set"
        title={member?.has_pin ? t('kids_change_pin') : t('kids_set_pin')}
        subtitle={displayName}
        onClose={() => setPinOpen(false)}
        onSubmit={async (pin) => {
          try {
            await api.setMemberPin(id, pin);
            await loadMember();
            setPinOpen(false);
            return true;
          } catch (e) {
            logger.warn('set pin failed', e);
            return false;
          }
        }}
      />
    </SafeAreaView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: ui.line,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headMid: { flex: 1, alignItems: 'center', gap: 4 },
  headName: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: ui.text, maxWidth: '90%' },
  headBadge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  headBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10.5, letterSpacing: 0.4, textTransform: 'uppercase' },

  segt: {
    flexDirection: 'row', gap: 4, margin: 14, padding: 3,
    backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line, borderRadius: 12,
  },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  segOn: { backgroundColor: ui.card },
  segText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: ui.muted },
  segTextOn: { color: ui.text },

  body: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40 },

  starCard: {
    alignItems: 'center', backgroundColor: ui.mint, borderRadius: 20, paddingVertical: 22,
    borderWidth: 1, borderColor: ui.line, marginBottom: 18,
  },
  starBig: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  starBigNum: { fontFamily: 'Inter_800ExtraBold', fontSize: 40, color: ui.mintText },
  starLbl: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: ui.mintText, marginTop: 6, opacity: 0.9 },

  sec: { fontFamily: 'Inter_800ExtraBold', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: ui.muted, marginBottom: 10, marginTop: 4 },
  giveRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  giveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: ui.orange, borderRadius: 14, paddingVertical: 13,
  },
  giveBtnText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: '#fff' },

  histRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: ui.card,
    borderWidth: 1, borderColor: ui.line, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 8,
  },
  histReason: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: ui.text },
  histDate: { fontFamily: 'Inter_400Regular', fontSize: 12, color: ui.muted, marginTop: 2 },
  histDelta: { fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  infoCard: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 18, padding: 18 },
  infoTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: ui.text, marginBottom: 6 },
  infoBody: { fontFamily: 'Inter_400Regular', fontSize: 14, color: ui.muted, lineHeight: 20 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ui.card,
    borderWidth: 1, borderColor: ui.line, borderRadius: 16, padding: 13, marginBottom: 8,
  },
  rowIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: ui.text },
  rowSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: ui.muted, marginTop: 2 },
  act: {
    flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: ui.soft,
    borderWidth: 1, borderColor: ui.line, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 13,
    marginBottom: 8,
  },
  // flex so a long label (German's 'Aus dem Haushalt entfernen') wraps inside
  // the row instead of pushing the row wider than the screen.
  actText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: ui.text },
  recSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: ui.muted, marginTop: -6, marginBottom: 10 },
  recNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: ui.soft,
    borderRadius: 14, padding: 11, marginBottom: 10,
  },
  recNoteText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 17, color: ui.muted },
  recCard: {
    backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line,
    borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 10,
  },
  recGroup: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase', color: ui.muted, marginTop: 10, marginBottom: 4 },
  recGroupRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  recLock: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  recLockText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: ui.muted },
  recField: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: ui.line },
  recLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: ui.muted, marginBottom: 3 },
  recInput: {
    fontFamily: 'Inter_500Medium', fontSize: 15, color: ui.text,
    paddingVertical: 6, minHeight: 34,
  },
  recValue: { fontFamily: 'Inter_500Medium', fontSize: 15, color: ui.text, paddingVertical: 6, minHeight: 34 },
  recSpin: { position: 'absolute', right: 0, top: 12 },
  recEmptyAll: { fontFamily: 'Inter_500Medium', fontSize: 14, color: ui.muted, paddingVertical: 14 },
  pictureBox: {
    backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line,
    borderRadius: 16, padding: 14, gap: 12, marginBottom: 10,
  },
  pictureHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  renameBox: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 },
  renameInput: {
    flex: 1, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 15, color: ui.text,
  },
  saveBtn: {
    backgroundColor: ui.orange, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 13,
    alignItems: 'center', justifyContent: 'center', minWidth: 84,
  },
  saveBtnText: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, color: '#fff' },
  footNote: {
    fontFamily: 'Inter_500Medium', fontSize: 12.5, color: ui.muted, lineHeight: 18,
    backgroundColor: ui.soft, borderRadius: 12, padding: 12, marginTop: 16,
  },
});
