/**
 * "A face for Isaiah": choosing a child's picture from the Family tab.
 *
 * A child with no picture shows as a letter in a dashed ring, with "Choose a
 * face" under the name. This is the sheet that opens. The faces are the same
 * ones their own page offers (AvatarPicker); here nothing is saved until
 * "Choose", so trying faces on costs nothing, and "Later" leaves the letter.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { api, FamilyMember } from '../api';
import { useStore } from '../store';
import { apiErrorText } from '../apiError';
import { useUI, UIColors } from './Kit';
import { AvatarPicker } from './PersonAvatar';
import { PressScale } from './PressScale';
import KeyboardAwareBottomSheet from './KeyboardAwareBottomSheet';

/** A child's faces; the grown-ups' are on their own pages. */
const CHILD_GROUPS: ('children' | 'teens')[] = ['children', 'teens'];

type Props = {
  /** The child being given a face; null keeps the sheet closed. */
  member: FamilyMember | null;
  onClose: () => void;
  /** After a save: the member as the server stored them, for the tab to show. */
  onSaved: (saved: FamilyMember) => void;
  showToast: (message: string, kind?: 'success' | 'error' | 'info') => void;
};

export default function FacePickerSheet({ member, onClose, onSaved, showToast }: Props) {
  const ui = useUI();
  const { t } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The child last shown stays on the sheet while it slides shut: without it
  // the title read "A face for" nobody for a moment on every close.
  const [shown, setShown] = useState<FamilyMember | null>(member);
  // Which child the sheet is open on now, read when a save comes back.
  const openFor = useRef<string | null>(null);

  // Each child starts from their own picture (none, here), not from the face
  // tried on for the child before.
  useEffect(() => {
    openFor.current = member?.member_id ?? null;
    if (!member) return;
    setShown(member);
    setPicked(member.avatar || null);
    setSaving(false);
  }, [member]);

  const changed = !!member && (picked || '') !== (member.avatar || '');

  const save = async () => {
    if (!member || !changed || saving) return;
    setSaving(true);
    try {
      // The API takes a string; '' is how a picture goes back to the letter.
      const saved = await api.updateFamilyMember(member.member_id, { avatar: picked ?? '' });
      onSaved(saved);
      // Closed and opened on another child while this was saving: that
      // child's sheet stays as it is.
      if (openFor.current === member.member_id) onClose();
    } catch (e) {
      showToast(apiErrorText(e, t, 'face_sheet_failed'), 'error');
    } finally {
      if (openFor.current === member.member_id) setSaving(false);
    }
  };

  return (
    <KeyboardAwareBottomSheet visible={!!member} onClose={onClose} contentStyle={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.title} testID="face-sheet-title" accessibilityRole="header">
          {t('face_sheet_title', { name: shown?.name || '' })}
        </Text>
        <PressScale accessibilityRole="button" accessibilityLabel={t('close')} testID="face-sheet-close" onPress={onClose} style={styles.iconBtn}>
          <X color={ui.text} size={20} />
        </PressScale>
      </View>
      <Text style={styles.body}>{t('face_sheet_body')}</Text>
      <AvatarPicker name={shown?.name || ''} value={picked} onPick={setPicked} busy={saving} forChild groups={CHILD_GROUPS} />
      <View style={styles.footer}>
        <PressScale testID="face-sheet-later" accessibilityRole="button" onPress={onClose} style={styles.laterBtn}>
          <Text style={styles.laterText}>{t('face_sheet_later')}</Text>
        </PressScale>
        <PressScale
          testID="face-sheet-choose"
          accessibilityRole="button"
          accessibilityState={{ disabled: !changed || saving }}
          onPress={save}
          disabled={!changed || saving}
          style={[styles.chooseBtn, (!changed || saving) && { opacity: 0.5 }]}
        >
          <Text style={styles.chooseText}>{saving ? '...' : t('face_sheet_choose')}</Text>
        </PressScale>
      </View>
    </KeyboardAwareBottomSheet>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  sheet: { backgroundColor: ui.card, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, borderColor: ui.line, padding: 22, paddingBottom: 140, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 23, letterSpacing: -0.3 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center' },
  body: { color: ui.muted, fontFamily: 'Figtree_600SemiBold', fontSize: 14, lineHeight: 20 },
  footer: { flexDirection: 'row', gap: 12, marginTop: 8 },
  laterBtn: { flex: 1, minHeight: 52, borderRadius: 18, borderWidth: 1, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },
  laterText: { color: ui.muted, fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
  chooseBtn: { flex: 1, minHeight: 52, borderRadius: 18, backgroundColor: ui.orangeDeep, alignItems: 'center', justifyContent: 'center' },
  chooseText: { color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
});
