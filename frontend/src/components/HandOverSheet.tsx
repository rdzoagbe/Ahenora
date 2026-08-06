import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { PinPad } from './PinPad';
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
  const { height: windowHeight } = useWindowDimensions();
  const styles = createStyles(ui);

  const [profiles, setProfiles] = useState<FamilyProfile[]>([]);
  const [me, setMe] = useState<FamilyProfile | null>(null);
  const [ready, setReady] = useState(true);
  const [newParentPin, setNewParentPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [entering, setEntering] = useState(false);
  // Guarded with refs, not state: a pasted or autofilled 4-digit PIN arrives
  // as change events inside one React batch, and a state flag set in the
  // first has not committed by the time the second reads it — so both got
  // through and opened two sessions.
  const enteringRef = useRef(false);
  const savingRef = useRef(false);
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
  // Closing by any route must forget who was being handed the device and
  // what was typed — only the X button used to reset, so a backdrop tap
  // reopened on the last child's PIN screen with their digits still in it.
  useEffect(() => { if (!visible) { setChosen(null); setPin(''); setError(null); } }, [visible]);

  const reset = () => { setChosen(null); setPin(''); setError(null); };

  /**
   * The way out has to exist before the way in.
   *
   * This used to be a sentence telling the parent to go and find the PIN
   * setting on another screen — which is a fair description of the app
   * failing to do its job. The requirement is real, so the sheet satisfies
   * it here, in the four seconds it takes, at the exact moment it matters.
   */
  const saveParentPin = async (override?: string) => {
    if (!me || savingRef.current) return;
    savingRef.current = true;
    // The auto-submit passes the digit it just saw: state has not re-rendered
    // yet at that point, so reading newParentPin here would be one keystroke
    // behind and always reject a correct PIN as too short.
    const value = (override ?? newParentPin).trim();
    if (!/^\d{4}$/.test(value)) { savingRef.current = false; setError(t('kids_pin_4_digits')); return; }
    setSaving(true);
    setError(null);
    try {
      await api.setMemberPin(me.member_id, value);
      setNewParentPin('');
      await load();
    } catch {
      setError(t('kid_pin_save_failed'));
      // Leaving a rejected PIN in the box invites the next tap to resend it.
      setNewParentPin('');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const go = async (override?: string) => {
    if (!chosen || enteringRef.current) return;
    enteringRef.current = true;
    setError(null);
    setEntering(true);
    try {
      const out = await api.startKidSession(chosen.member_id, (override ?? pin).trim());
      await kidMode.enter(out.session_token);
      onClose();
      reset();
      router.replace('/kid');
    } catch (e: any) {
      setError(e?.status === 429 ? t('kid_locked_out') : t('kid_wrong_pin'));
      // M13: clear it. A wrong PIN left in the field means the obvious next
      // tap resends the same wrong digits, and eight of those lock a child
      // out of their own device for fifteen minutes.
      setPin('');
    } finally {
      enteringRef.current = false;
      setEntering(false);
    }
  };

  const children = profiles.filter((p) => p.has_pin);
  const pinless = profiles.filter((p) => !p.has_pin);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('close')} />
      {/* Sits still. This panel used to shift up by the measured keyboard
          height, which is the right idea and the wrong input: Android reported
          zero on a real phone, so the panel stayed flush to the bottom and the
          confirm button lived under the keys. The digits are entered on an
          in-app pad now, no system keyboard opens over anything, and there is
          nothing left to measure or get wrong. */}
      <View style={[styles.panel, { paddingBottom: Math.max(insets.bottom, 16) + 18 }]}>
        <View style={styles.grabber} />
        {/* Still capped and scrollable, but now for an ordinary reason: a
            household with several children plus a keypad can outgrow a short
            phone. The bound is the window, not a keyboard measurement. */}
        <ScrollView
          style={{ maxHeight: Math.max(240, windowHeight * 0.8) }}
          contentContainerStyle={styles.scrollBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.header}>
          {/* Name the moment plainly when a PIN is still needed — "Who's using
              this?" over a PIN field read as a puzzle rather than a setup step. */}
          <Text style={styles.title}>
            {chosen ? chosen.name : !ready ? t('kid_set_pin_first_title') : t('kid_who_is_this')}
          </Text>
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
            <PinPad
              pin={newParentPin}
              error={error}
              disabled={saving}
              colors={{ text: ui.text, muted: ui.muted, line: ui.line, danger: ui.danger }}
              onBack={() => { setNewParentPin((v) => v.slice(0, -1)); setError(null); }}
              onDigit={(d) => {
                // Saves itself on the fourth digit. Four digits have exactly
                // one moment they are complete, so there is no button to hunt
                // for — and the value is passed through rather than read back
                // from state, which has not re-rendered yet.
                const next = (newParentPin + d).slice(0, 4);
                setNewParentPin(next);
                setError(null);
                if (next.length === 4) saveParentPin(next);
              }}
            />
            {saving ? <Text style={styles.note}>{t('kid_saving')}</Text> : null}
          </>
        ) : chosen ? (
          <>
            <Text style={styles.note}>{t('kid_enter_pin', { name: chosen.name })}</Text>
            <PinPad
              pin={pin}
              error={error}
              disabled={entering}
              colors={{ text: ui.text, muted: ui.muted, line: ui.line, danger: ui.danger }}
              onBack={() => { setPin((v) => v.slice(0, -1)); setError(null); }}
              onDigit={(d) => {
                const next = (pin + d).slice(0, 4);
                setPin(next);
                setError(null);
                if (next.length === 4) go(next);
              }}
            />
            <PressScale testID="handover-back" onPress={reset} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>{t('back')}</Text>
            </PressScale>
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
        </ScrollView>
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
      paddingHorizontal: 18, paddingTop: 12,
      shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 28,
      shadowOffset: { width: 0, height: -8 }, elevation: 24,
    },
    // The gap that used to live on the panel now lives here, because the
    // panel's direct child is the scroll view rather than the content itself.
    scrollBody: { gap: 10, paddingBottom: 4 },
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
