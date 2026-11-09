/**
 * Whose turn? — on the Family tab, under "This week".
 *
 * "It's MY turn for the front seat!" "You went last time!" The app remembers,
 * so the parent does not have to referee: each rotation says whose turn it is,
 * who is next, and who went last, and one tap passes it on.
 *
 * Only shown when there are two children (or teens) to take turns. Parents set
 * the rotations up; anyone in the shared day (a grandparent too) can say
 * "done". The server keeps the order and refuses a tap that would skip a child.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, Plus, Repeat, Trash2, X } from 'lucide-react-native';
import { api, FamilyMember, Turn } from '../api';
import { useStore } from '../store';
import { apiErrorText } from '../apiError';
import { logger } from '../logger';
import { Card, useUI, UIColors } from './Kit';
import { PersonAvatar } from './PersonAvatar';
import { PressScale } from './PressScale';
import KeyboardAwareBottomSheet from './KeyboardAwareBottomSheet';
import { advanceLocally, nameOf, toggleInOrder, turnPeople, turnWhen, TURN_IDEAS } from '../whoseTurn';

type Props = {
  members: FamilyMember[];
  /** False for a helper: they can say "done", not change the rules. */
  canEdit: boolean;
  /** Bumped by the Family tab's own refresh, so this reloads with it. */
  refreshKey?: number;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
};

export default function WhoseTurnCard({ members, canEdit, refreshKey, showToast }: Props) {
  const ui = useUI();
  const { t, user } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const people = useMemo(() => turnPeople(members), [members]);
  const [turns, setTurns] = useState<Turn[] | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  // A failed read shows nothing rather than an empty card: "no rotations
  // yet" with one-tap starters would invite a second copy of each one.
  const [failed, setFailed] = useState(false);

  // The sheet: a new rotation (editing === null) or an existing one.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Turn | null>(null);
  const [name, setName] = useState('');
  const [order, setOrder] = useState<string[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    api.listTurns().then((r) => { setTurns(r); setFailed(false); }).catch((e) => {
      logger.warn('turns load failed', e);
      setFailed(true);
    });
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (people.length < 2 || turns === null || (failed && turns.length === 0)) return null;
  // A rotation only lists people still in the family; the server tidies
  // removals, this just keeps a stale screen from showing a blank face.
  const shown = turns.filter((r) => r.current_member_id && members.some((m) => m.member_id === r.current_member_id));

  const done = async (turn: Turn) => {
    const from = turn.current_member_id;
    if (!from || busy.has(turn.turn_id)) return;
    setBusy((b) => new Set(b).add(turn.turn_id));
    const before = turn;
    setTurns((prev) => (prev ?? []).map((r) => (r.turn_id === turn.turn_id ? advanceLocally(r, user?.name || '') : r)));
    try {
      const saved = await api.nextTurn(turn.turn_id, from);
      setTurns((prev) => (prev ?? []).map((r) => (r.turn_id === saved.turn_id ? saved : r)));
    } catch (e: any) {
      // 409: someone else already passed it on. Show what is true now.
      if (e?.status === 409) {
        showToast(t('turn_already_moved'), 'info');
      } else {
        // Not saved: put back what the server still has, so the screen never
        // shows a turn that was not recorded, even if the re-read fails too.
        setTurns((prev) => (prev ?? []).map((r) => (r.turn_id === before.turn_id ? before : r)));
        showToast(apiErrorText(e, t, 'turn_save_failed'), 'error');
      }
      load();
    } finally {
      setBusy((b) => { const n = new Set(b); n.delete(turn.turn_id); return n; });
    }
  };

  const openNew = (preset?: string) => {
    setEditing(null);
    setName(preset ?? '');
    setOrder(people.map((p) => p.member_id));
    setCurrent(null);
    setSheetOpen(true);
  };

  const openEdit = (turn: Turn) => {
    if (!canEdit) return;
    setEditing(turn);
    setName(turn.name);
    // Everyone still in the family stays, child or not: saving a rename must
    // never quietly take somebody out of the rotation.
    setOrder(turn.member_ids.filter((id) => members.some((m) => m.member_id === id)));
    setCurrent(turn.current_member_id);
    setSheetOpen(true);
  };

  // One tap on an idea: everyone, in the Family tab's order, straight away.
  const quickCreate = async (key: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const made = await api.createTurn({ name: t(key), member_ids: people.map((p) => p.member_id) });
      setTurns((prev) => [...(prev ?? []), made]);
      showToast(t('turn_created', { name: made.name, who: nameOf(members, made.current_member_id) }), 'success');
    } catch (e) {
      showToast(apiErrorText(e, t, 'turn_save_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const clean = name.trim();
    if (!clean || order.length < 2 || saving) return;
    setSaving(true);
    try {
      const saved = editing
        ? await api.updateTurn(editing.turn_id, {
          name: clean,
          member_ids: order,
          ...(current && order.includes(current) ? { current_member_id: current } : {}),
        })
        : await api.createTurn({ name: clean, member_ids: order });
      setTurns((prev) => (editing
        ? (prev ?? []).map((r) => (r.turn_id === saved.turn_id ? saved : r))
        : [...(prev ?? []), saved]));
      setSheetOpen(false);
    } catch (e) {
      showToast(apiErrorText(e, t, 'turn_save_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing || saving) return;
    setSaving(true);
    try {
      await api.deleteTurn(editing.turn_id);
      setTurns((prev) => (prev ?? []).filter((r) => r.turn_id !== editing.turn_id));
      setSheetOpen(false);
    } catch (e) {
      showToast(apiErrorText(e, t, 'turn_save_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const canSave = name.trim().length > 0 && order.length >= 2 && !saving;

  return (
    <View testID="whose-turn">
      <View style={styles.header}>
        <Repeat color={ui.lavenderText} size={18} />
        <Text style={styles.headerText}>{t('turn_title')}</Text>
        {canEdit && shown.length > 0 ? (
          <PressScale testID="turn-add" accessibilityRole="button" onPress={() => openNew()} style={styles.headerBtn}>
            <Plus color={ui.lavenderText} size={14} />
            <Text style={[styles.headerBtnText, { color: ui.lavenderText }]}>{t('turn_add')}</Text>
          </PressScale>
        ) : null}
      </View>
      <Card style={styles.card}>
        {shown.length === 0 ? (
          <View>
            <Text style={styles.empty}>{t('turn_empty')}</Text>
            {canEdit ? (
              <View style={styles.ideas}>
                {TURN_IDEAS.map((key) => (
                  <PressScale
                    key={key}
                    testID={`turn-idea-${key}`}
                    accessibilityRole="button"
                    onPress={() => quickCreate(key)}
                    disabled={saving}
                    style={styles.idea}
                  >
                    <Plus color={ui.lavenderText} size={13} />
                    <Text style={styles.ideaText}>{t(key)}</Text>
                  </PressScale>
                ))}
                <PressScale testID="turn-idea-other" accessibilityRole="button" onPress={() => openNew()} style={styles.idea}>
                  <Text style={styles.ideaText}>{t('turn_idea_other')}</Text>
                </PressScale>
              </View>
            ) : null}
          </View>
        ) : null}
        {shown.map((turn, i) => {
          const who = members.find((m) => m.member_id === turn.current_member_id);
          const whoName = nameOf(members, turn.current_member_id);
          const nextName = nameOf(members, turn.next_member_id);
          const last = turn.history[0];
          return (
            <View key={turn.turn_id} style={[styles.row, i > 0 && styles.rowLine]}>
              <PressScale
                testID={`turn-open-${turn.turn_id}`}
                accessibilityRole={canEdit ? 'button' : undefined}
                accessibilityLabel={`${turn.name}: ${t('turn_now', { name: whoName })}`}
                onPress={() => openEdit(turn)}
                disabled={!canEdit}
                style={styles.rowMain}
              >
                <PersonAvatar name={who?.name || whoName} avatar={who?.avatar} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{turn.name}</Text>
                  <Text style={styles.rowWho} numberOfLines={1} testID={`turn-who-${turn.turn_id}`}>{t('turn_now', { name: whoName })}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {nextName ? t('turn_then', { name: nextName }) : ''}
                    {last ? ` · ${t('turn_last', { name: nameOf(members, last.member_id), when: turnWhen(last.at, t) })}` : ''}
                  </Text>
                </View>
              </PressScale>
              <PressScale
                testID={`turn-done-${turn.turn_id}`}
                accessibilityRole="button"
                accessibilityLabel={t('turn_done_a11y', { name: whoName, next: nextName })}
                onPress={() => done(turn)}
                disabled={busy.has(turn.turn_id)}
                style={[styles.doneBtn, busy.has(turn.turn_id) && { opacity: 0.6 }]}
              >
                <Check color="#FFFFFF" size={15} />
                <Text style={styles.doneText}>{t('turn_done')}</Text>
              </PressScale>
            </View>
          );
        })}
      </Card>

      <KeyboardAwareBottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{editing ? t('turn_edit_title') : t('turn_new_title')}</Text>
          <PressScale accessibilityRole="button" accessibilityLabel={t('close')} testID="turn-sheet-close" onPress={() => setSheetOpen(false)} style={styles.iconBtn}>
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        <Text style={styles.label}>{t('turn_name_label')}</Text>
        <TextInput
          testID="turn-name"
          maxLength={40}
          value={name}
          onChangeText={setName}
          placeholder={t('turn_name_placeholder')}
          placeholderTextColor={ui.muted}
          style={styles.input}
        />
        {!editing ? (
          <View style={[styles.ideas, { marginTop: 10 }]}>
            {TURN_IDEAS.map((key) => (
              <PressScale key={key} accessibilityRole="button" onPress={() => setName(t(key))} style={styles.idea}>
                <Text style={styles.ideaText}>{t(key)}</Text>
              </PressScale>
            ))}
          </View>
        ) : null}
        <Text style={styles.label}>{t('turn_order_label')}</Text>
        <Text style={styles.help}>{t('turn_order_help')}</Text>
        <View style={styles.people}>
          {[...people, ...members.filter((m) => order.includes(m.member_id) && !people.some((p) => p.member_id === m.member_id))].map((p) => {
            const at = order.indexOf(p.member_id);
            const on = at >= 0;
            return (
              <PressScale
                key={p.member_id}
                testID={`turn-person-${p.member_id}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setOrder((o) => toggleInOrder(o, p.member_id))}
                style={[styles.person, on && styles.personOn]}
              >
                <PersonAvatar name={p.name} avatar={p.avatar} size={30} ring={false} />
                <Text style={[styles.personName, on && styles.personNameOn]} numberOfLines={1}>{p.name}</Text>
                {on ? <Text style={styles.personNum}>{at + 1}</Text> : null}
              </PressScale>
            );
          })}
        </View>
        {order.length < 2 ? <Text style={styles.help}>{t('turn_need_two')}</Text> : null}
        {editing && order.length >= 2 ? (
          <>
            <Text style={styles.label}>{t('turn_current_label')}</Text>
            <View style={styles.ideas}>
              {order.map((id) => {
                const on = (current && order.includes(current) ? current : order[0]) === id;
                return (
                  <PressScale
                    key={id}
                    testID={`turn-current-${id}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setCurrent(id)}
                    style={[styles.idea, on && styles.ideaOn]}
                  >
                    <Text style={[styles.ideaText, on && styles.ideaTextOn]}>{nameOf(members, id)}</Text>
                  </PressScale>
                );
              })}
            </View>
          </>
        ) : null}
        <View style={styles.footer}>
          {editing ? (
            <PressScale testID="turn-delete" accessibilityRole="button" onPress={remove} disabled={saving} style={styles.deleteBtn}>
              <Trash2 color={ui.danger} size={16} />
              <Text style={styles.deleteText}>{t('turn_delete')}</Text>
            </PressScale>
          ) : (
            <PressScale testID="turn-cancel" accessibilityRole="button" onPress={() => setSheetOpen(false)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>{t('cancel')}</Text>
            </PressScale>
          )}
          <PressScale testID="turn-save" accessibilityRole="button" onPress={save} disabled={!canSave} style={[styles.saveBtn, !canSave && { opacity: 0.5 }]}>
            <Text style={styles.saveText}>{saving ? '...' : t('turn_save')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 10 },
  headerText: { flex: 1, color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 17 },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: ui.line },
  headerBtnText: { fontFamily: 'Figtree_700Bold', fontSize: 12 },
  card: { paddingHorizontal: 16, paddingVertical: 4 },
  empty: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 13.5, lineHeight: 19, paddingTop: 12 },
  ideas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12 },
  idea: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  ideaOn: { backgroundColor: ui.lavender, borderColor: ui.lavenderText },
  ideaText: { color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 13 },
  ideaTextOn: { color: ui.lavenderText },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  rowLine: { borderTopWidth: 1, borderTopColor: ui.line },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowName: { color: ui.muted, fontFamily: 'Figtree_700Bold', fontSize: 12.5 },
  rowWho: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 17, letterSpacing: -0.2, marginTop: 1 },
  rowSub: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12, marginTop: 2 },
  doneBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: ui.orangeDeep, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 99, flexShrink: 0, minHeight: 44 },
  doneText: { color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 13 },
  sheet: { backgroundColor: ui.card, borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, borderColor: ui.line, padding: 26, paddingBottom: 140 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 24, letterSpacing: -0.4 },
  iconBtn: { padding: 9, borderRadius: 9999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  label: { color: ui.muted, fontFamily: 'Figtree_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  help: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 13, lineHeight: 18, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Figtree_500Medium', fontSize: 16, color: ui.text, backgroundColor: ui.soft },
  people: { gap: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: ui.line, minHeight: 48 },
  personOn: { borderColor: ui.lavenderText, backgroundColor: ui.lavender },
  personName: { flex: 1, color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 15 },
  personNameOn: { color: ui.lavenderText },
  personNum: { minWidth: 26, height: 26, borderRadius: 13, textAlign: 'center', lineHeight: 26, overflow: 'hidden', backgroundColor: ui.lavenderText, color: ui.card, fontFamily: 'Figtree_800ExtraBold', fontSize: 13 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: ui.muted, fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: 'rgba(220,38,38,0.35)', backgroundColor: ui.dangerSoft, borderRadius: 18, paddingVertical: 15 },
  deleteText: { color: ui.danger, fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', backgroundColor: ui.orangeDeep },
  saveText: { color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
});
