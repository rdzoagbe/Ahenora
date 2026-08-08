import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check, Gift, LogOut, Star } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { PasswordInput } from '../src/components/PasswordInput';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { useKeyboardHeight } from '../src/hooks/useKeyboardHeight';
import { api, kidMode, KidHome } from '../src/api';
import { logger } from '../src/logger';

/**
 * A child's whole app.
 *
 * Not the household with things hidden — a different, much smaller thing:
 * their stars, the jobs with their name on them, what they can spend on. The
 * feed, the calendar, the vault and a co-parent's private items are not
 * filtered out here, they are simply unreachable: the session this screen
 * holds is refused by every other endpoint on the server.
 *
 * Written big and plain on purpose. The reader may be seven.
 */
export default function KidScreen() {
  const ui = useUI();
  const { t } = useStore();
  const router = useRouter();
  const keyboard = useKeyboardHeight();
  const styles = createStyles(ui);

  const [home, setHome] = useState<KidHome | null>(null);
  const [busy, setBusy] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  // The way out when the PIN is forgotten: a parent's account login.
  const [forgot, setForgot] = useState(false);
  const [fEmail, setFEmail] = useState('');
  const [fPassword, setFPassword] = useState('');
  const [fError, setFError] = useState<string | null>(null);
  const [fBusy, setFBusy] = useState(false);

  const closeExit = () => {
    setExitOpen(false); setPin(''); setPinError(false);
    setForgot(false); setFEmail(''); setFPassword(''); setFError(null);
  };

  const load = useCallback(async () => {
    try {
      setHome(await api.kidHome());
    } catch (e) {
      logger.warn('kid home failed', e);
      // The session expired or was revoked — a device left in kid mode
      // overnight lands back at the picker rather than on a broken screen.
      if (await kidMode.leave()) router.replace('/(tabs)/feed');
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const finish = async (cardId: string) => {
    if (busy) return;
    setBusy(true);
    // Take it off the list straight away — a child who taps and sees nothing
    // happen taps again.
    setHome((h) => (h ? { ...h, chores: h.chores.filter((c) => c.card_id !== cardId) } : h));
    try { await api.kidFinishChore(cardId); } catch (e) { logger.warn('kid finish failed', e); }
    await load();
    setBusy(false);
  };

  const spend = async (rewardId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await api.kidRequestReward(rewardId);
      setHome((h) => (h ? { ...h, stars: out.stars } : h));
    } catch (e) {
      logger.warn('kid reward failed', e);
    }
    await load();
    setBusy(false);
  };

  const leave = async () => {
    setPinError(false);
    try {
      await api.exitKidSession(pin.trim());
    } catch {
      setPinError(true);
      return;
    }
    await kidMode.leave();
    closeExit();
    router.replace('/(tabs)/feed');
  };

  const leaveWithPassword = async () => {
    if (fBusy) return;
    setFError(null);
    const email = fEmail.trim();
    if (!email || !fPassword) { setFError(t('kid_forgot_fields')); return; }
    setFBusy(true);
    try {
      await api.exitKidForgotPin(email, fPassword);
    } catch (e: any) {
      setFError(e?.status === 429 ? t('kid_locked_out') : t('kid_forgot_bad'));
      setFBusy(false);
      return;
    }
    await kidMode.leave();
    closeExit();
    // The PIN was cleared server-side; the hand-over sheet will ask for a new
    // one before the device can go back to a child.
    router.replace('/(tabs)/feed');
  };

  if (!home) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={ui.orange} size="large" />
      </View>
    );
  }

  const affordable = home.rewards.filter((r) => r.cost_stars <= home.stars).length;

  return (
    <View style={styles.page}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.hello}>{t('kid_hello', { name: home.name })}</Text>
            <PressScale
              testID="kid-exit"
              accessibilityRole="button"
              accessibilityLabel={t('kid_hand_back')}
              onPress={() => setExitOpen(true)}
              style={styles.exitBtn}
            >
              <LogOut color={ui.muted} size={18} />
            </PressScale>
          </View>

          <View style={styles.starCard}>
            <Star color="#FFFFFF" size={30} fill="#FFFFFF" />
            <Text testID="kid-stars" style={styles.starNumber}>{home.stars}</Text>
            <Text style={styles.starLabel}>{t('kid_stars_label')}</Text>
          </View>

          <Text style={styles.section}>{t('kid_my_jobs')}</Text>
          {home.chores.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('kid_no_jobs')}</Text>
            </View>
          ) : (
            home.chores.map((c) => (
              <PressScale
                key={c.card_id}
                testID={`kid-chore-${c.card_id}`}
                accessibilityRole="button"
                onPress={() => finish(c.card_id)}
                style={styles.choreRow}
              >
                <View style={styles.tickBox}><Check color={ui.orangeText} size={20} /></View>
                <Text style={styles.choreTitle} numberOfLines={2}>{c.title}</Text>
              </PressScale>
            ))
          )}

          {home.owed.length > 0 ? (
            <>
              <Text style={styles.section}>{t('kid_owed')}</Text>
              {home.owed.map((r) => (
                <View key={r.redemption_id} style={styles.owedRow}>
                  <Text style={styles.owedIcon}>{r.reward_icon || '🎁'}</Text>
                  <Text style={styles.owedTitle} numberOfLines={1}>{r.reward_title}</Text>
                  <Text style={styles.owedWait}>{t('kid_owed_waiting')}</Text>
                </View>
              ))}
            </>
          ) : null}

          <Text style={styles.section}>
            {t('kid_rewards')}{affordable > 0 ? ` · ${t('kid_can_get', { n: affordable })}` : ''}
          </Text>
          {home.rewards.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>{t('kid_no_rewards')}</Text>
            </View>
          ) : (
            home.rewards.map((r) => {
              const can = r.cost_stars <= home.stars;
              return (
                <PressScale
                  key={r.reward_id}
                  testID={`kid-reward-${r.reward_id}`}
                  accessibilityRole="button"
                  disabled={!can || busy}
                  onPress={() => spend(r.reward_id)}
                  style={[styles.rewardRow, !can && styles.rewardLocked]}
                >
                  <Text style={styles.rewardIcon}>{r.icon || '🎁'}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rewardTitle} numberOfLines={1}>{r.title}</Text>
                    <Text style={styles.rewardCost}>
                      {t('kid_costs', { n: r.cost_stars })}
                      {can ? '' : ` · ${t('kid_need_more', { n: r.cost_stars - home.stars })}`}
                    </Text>
                  </View>
                  {can ? <Gift color={ui.orangeText} size={20} /> : null}
                </PressScale>
              );
            })
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Handing the device back is a grown-up's PIN, so a child cannot let
          themselves out into the household. */}
      <Modal visible={exitOpen} transparent animationType="fade" onRequestClose={() => setExitOpen(false)}>
        <View style={styles.backdrop} />
        {/* Centred in what is LEFT of the screen, not the whole of it: with
            the keypad up, centring against the full height puts the card
            behind it. */}
        <View style={[styles.modalCenter, { paddingBottom: keyboard }]}>
          <View style={styles.modalCard}>
            {forgot ? (
              <>
                <Text style={styles.modalTitle}>{t('kid_forgot_title')}</Text>
                <Text style={styles.modalBody}>{t('kid_forgot_help')}</Text>
                <TextInput
                  testID="kid-forgot-email"
                  value={fEmail}
                  onChangeText={(v) => { setFEmail(v); setFError(null); }}
                  placeholder={t('set_email_placeholder')}
                  placeholderTextColor={ui.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.textInput, fError && { borderColor: ui.danger }]}
                />
                <PasswordInput
                  testID="kid-forgot-password"
                  value={fPassword}
                  onChangeText={(v) => { setFPassword(v); setFError(null); }}
                  placeholder={t('email_password_placeholder_login')}
                  placeholderTextColor={ui.muted}
                  eyeColor={ui.muted}
                  showLabel={t('a11y_show_password')}
                  hideLabel={t('a11y_hide_password')}
                  containerStyle={{ marginTop: 10 }}
                  style={[styles.textInput, fError && { borderColor: ui.danger }]}
                />
                {fError ? <Text style={styles.pinError}>{fError}</Text> : null}
                <View style={styles.modalRow}>
                  <PressScale onPress={() => { setForgot(false); setFError(null); }} style={styles.ghostBtn}>
                    <Text style={styles.ghostBtnText}>{t('back')}</Text>
                  </PressScale>
                  <PressScale testID="kid-forgot-confirm" onPress={leaveWithPassword} style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnText}>{fBusy ? t('kid_saving') : t('kid_forgot_go')}</Text>
                  </PressScale>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>{t('kid_hand_back')}</Text>
                <Text style={styles.modalBody}>{t('kid_hand_back_help')}</Text>
                <TextInput
                  testID="kid-exit-pin"
                  value={pin}
                  onChangeText={(v) => { setPin(v); setPinError(false); }}
                  placeholder="••••"
                  placeholderTextColor={ui.muted}
                  keyboardType="number-pad"
                  secureTextEntry
                  maxLength={4}
                  style={[styles.pinInput, pinError && { borderColor: ui.danger }]}
                />
                {pinError ? <Text style={styles.pinError}>{t('kid_wrong_pin')}</Text> : null}
                <PressScale testID="kid-forgot-pin" onPress={() => { setForgot(true); setPinError(false); }} style={styles.forgotLink}>
                  <Text style={styles.forgotLinkText}>{t('kid_forgot_pin')}</Text>
                </PressScale>
                <View style={styles.modalRow}>
                  <PressScale onPress={closeExit} style={styles.ghostBtn}>
                    <Text style={styles.ghostBtnText}>{t('cancel')}</Text>
                  </PressScale>
                  <PressScale testID="kid-exit-confirm" onPress={leave} style={styles.primaryBtn}>
                    <Text style={styles.primaryBtnText}>{t('kid_hand_back_go')}</Text>
                  </PressScale>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (ui: UIColors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: ui.bg },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.bg },
    scroll: { paddingHorizontal: 20, paddingTop: 8, gap: 10 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    hello: { flex: 1, color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 30, letterSpacing: -0.7 },
    exitBtn: { padding: 10, borderRadius: 999, backgroundColor: ui.soft },
    starCard: {
      backgroundColor: ui.orangeDeep, borderRadius: 26, alignItems: 'center',
      paddingVertical: 26, marginTop: 8, gap: 2,
    },
    starNumber: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 58, lineHeight: 64 },
    starLabel: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 15, opacity: 0.92 },
    section: {
      color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5,
      letterSpacing: 0.9, textTransform: 'uppercase', marginTop: 22, marginBottom: 2,
    },
    emptyCard: {
      backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line,
      padding: 20, alignItems: 'center',
    },
    emptyText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center' },
    // Big rows, big targets: this is tapped by small hands, often in a hurry.
    choreRow: {
      flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: ui.card,
      borderRadius: 18, borderWidth: 1, borderColor: ui.line, padding: 16, minHeight: 68,
    },
    tickBox: {
      width: 38, height: 38, borderRadius: 12, backgroundColor: ui.orangeSoft,
      alignItems: 'center', justifyContent: 'center',
    },
    choreTitle: { flex: 1, color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 17 },
    owedRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ui.mint,
      borderRadius: 16, paddingVertical: 13, paddingHorizontal: 15,
    },
    owedIcon: { fontSize: 22 },
    owedTitle: { flex: 1, color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 16 },
    owedWait: { color: ui.mintText, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
    rewardRow: {
      flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: ui.card,
      borderRadius: 18, borderWidth: 1, borderColor: ui.line, padding: 16, minHeight: 68,
    },
    rewardLocked: { opacity: 0.55 },
    rewardIcon: { fontSize: 26 },
    rewardTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 17 },
    rewardCost: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 2 },
    backdrop: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    modalCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    modalCard: {
      width: '100%', maxWidth: 380, backgroundColor: ui.card, borderRadius: 22,
      borderWidth: 1, borderColor: ui.line, padding: 22, gap: 10,
    },
    modalTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 20 },
    modalBody: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20 },
    pinInput: {
      borderWidth: 1, borderColor: ui.line, borderRadius: 14, backgroundColor: ui.soft,
      color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 26, textAlign: 'center',
      letterSpacing: 10, paddingVertical: 12, marginTop: 4,
      outlineStyle: 'none' as never,
    },
    pinError: { color: ui.danger, fontFamily: 'Inter_700Bold', fontSize: 13, marginTop: 8 },
    textInput: {
      borderWidth: 1, borderColor: ui.line, borderRadius: 14, backgroundColor: ui.soft,
      color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 16,
      paddingVertical: 13, paddingHorizontal: 14, marginTop: 4,
      outlineStyle: 'none' as never,
    },
    forgotLink: { alignSelf: 'center', paddingVertical: 10, marginTop: 2 },
    forgotLinkText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 13.5 },
    modalRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
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
