import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { api, FamilyProfile, kidMode } from '../api';
import { logger } from '../logger';

/**
 * "Who's using this?"
 *
 * The moment a parent hands the tablet over. Picking a child and entering
 * their PIN swaps the device into their much smaller app; coming back needs a
 * grown-up's PIN, which is why the sheet refuses to offer any of this until
 * one exists. Without that rule, handing over the device would be a one-way
 * door — a child could simply tap back into the household.
 */
export function HandOverSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const ui = useUI();
  const { t } = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = createStyles(ui);

  const [profiles, setProfiles] = useState<FamilyProfile[]>([]);
  const [me, setMe] = useState<FamilyProfile | null>(null);
  const [ready, setReady] = useState(true);
  const [newParentPin, setNewParentPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [chosen, setChosen] = useState<FamilyProfile | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const out = await api.listProfiles();
      setProfiles(out.profiles.filter((p) => p.is_child));
      setMe(out.profiles.find((p) => p.is_me) || null);
      setReady(out.kid_mode_ready);
    } catch (e) {
      logger.warn('profiles failed', e);
    }
  }, []);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const reset = () => { setChosen(null); setPin(''); setError(null); };

  /**
   * The way out has to exist before the way in.
   *
   * This used to be a sentence telling the parent to go and find the PIN
   * setting on another screen — which is a fair description of the app
   * failing to do its job. The requirement is real, so the sheet satisfies
   * it here, in the four seconds it takes, at the exact moment it matters.
   */
  const saveParentPin = async () => {
    if (!me || saving) return;
    const value = newParentPin.trim();
    if (!/^\d{4}$/.test(value)) { setError(t('kids_pin_4_digits')); return; }
    setSaving(true);
    setError(null);
    try {
      await api.setMemberPin(me.member_id, value);
      setNewParentPin('');
      await load();
    } catch {
      setError(t('kid_pin_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const go = async () => {
    if (!chosen) return;
    setError(null);
    try {
      const out = await api.startKidSession(chosen.member_id, pin.trim());
      await kidMode.enter(out.session_token);
      onClose();
      reset();
      router.replace('/kid');
    } catch (e: any) {
      setError(e?.status === 429 ? t('kid_locked_out') : t('kid_wrong_pin'));
    }
  };

  const children = profiles.filter((p) => p.has_pin);
  const pinless = profiles.filter((p) => !p.has_pin);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('close')} />
      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
        <View style={styles.grabber} />
        <View style={styles.header}>
          <Text style={styles.title}>{chosen ? chosen.name : t('kid_who_is_this')}</Text>
          <PressScale
            testID="handover-close"
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={() => { onClose(); reset(); }}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        {!ready ? (
          <>
            <Text style={styles.note}>{t('kid_need_parent_pin')}</Text>
            <TextInput
              testID="handover-parent-pin"
              value={newParentPin}
              onChangeText={(v) => { setNewParentPin(v); setError(null); }}
              placeholder="••••"
              placeholderTextColor={ui.muted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              style={[styles.pinInput, error && { borderColor: ui.danger }]}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <PressScale
              testID="handover-save-parent-pin"
              accessibilityRole="button"
              onPress={saveParentPin}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>
                {saving ? t('kid_saving') : t('kid_set_my_pin')}
              </Text>
            </PressScale>
          </>
        ) : chosen ? (
          <>
            <Text style={styles.note}>{t('kid_enter_pin', { name: chosen.name })}</Text>
            <TextInput
              testID="handover-pin"
              value={pin}
              onChangeText={(v) => { setPin(v); setError(null); }}
              placeholder="••••"
              placeholderTextColor={ui.muted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              autoFocus
              style={[styles.pinInput, error && { borderColor: ui.danger }]}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.row}>
              <PressScale onPress={reset} style={styles.ghostBtn}>
                <Text style={styles.ghostBtnText}>{t('back')}</Text>
              </PressScale>
              <PressScale testID="handover-go" onPress={go} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>{t('kid_open')}</Text>
              </PressScale>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.note}>{t('kid_who_help')}</Text>
            {children.map((c) => (
              <PressScale
                key={c.member_id}
                testID={`handover-${c.member_id}`}
                accessibilityRole="button"
                onPress={() => setChosen(c)}
                style={styles.profileRow}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{c.name[0]?.toUpperCase()}</Text>
                </View>
                <Text style={styles.profileName} numberOfLines={1}>{c.name}</Text>
              </PressScale>
            ))}
            {children.length === 0 ? (
              <Text style={styles.note}>{t('kid_no_children_with_pins')}</Text>
            ) : null}
            {pinless.length > 0 ? (
              <Text style={styles.hint}>
                {t('kid_needs_pin_hint', { names: pinless.map((p) => p.name).join(', ') })}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </Modal>
  );
}

const createStyles = (ui: UIColors) =>
  StyleSheet.create({
    backdrop: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.62)',
    },
    panel: {
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: ui.card,
      borderTopLeftRadius: 26, borderTopRightRadius: 26,
      borderTopWidth: 1, borderColor: ui.line,
      paddingHorizontal: 18, paddingTop: 12, gap: 10,
      shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 28,
      shadowOffset: { width: 0, height: -8 }, elevation: 24,
    },
    grabber: {
      alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
      backgroundColor: ui.muted, opacity: 0.5, marginBottom: 8,
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 21, letterSpacing: -0.4 },
    iconBtn: { padding: 6, borderRadius: 999, backgroundColor: ui.soft },
    note: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13.5, lineHeight: 20 },
    hint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 4 },
    profileRow: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line,
      borderRadius: 16, paddingVertical: 14, paddingHorizontal: 14,
    },
    avatar: {
      width: 40, height: 40, borderRadius: 999, backgroundColor: ui.orangeDeep,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
    profileName: { flex: 1, color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 16.5 },
    pinInput: {
      borderWidth: 1, borderColor: ui.line, borderRadius: 14, backgroundColor: ui.soft,
      color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 26, textAlign: 'center',
      letterSpacing: 10, paddingVertical: 12,
      outlineStyle: 'none' as never,
    },
    error: { color: ui.danger, fontFamily: 'Inter_700Bold', fontSize: 13 },
    row: { flexDirection: 'row', gap: 10, marginTop: 4 },
    ghostBtn: {
      flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center',
      backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line,
    },
    ghostBtnText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
    primaryBtn: {
      flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center',
      backgroundColor: ui.orangeDeep,
    },
    primaryBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  });
