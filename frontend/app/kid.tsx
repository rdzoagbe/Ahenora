import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check, Gift, Hourglass, LogOut, Star } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { PasswordInput } from '../src/components/PasswordInput';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { useKeyboardHeight } from '../src/hooks/useKeyboardHeight';
import { api, kidMode, KidHome, FamilyMember } from '../src/api';
import { glyphFor } from '../src/cardIcons';
import { logger } from '../src/logger';
import { PersonAvatar } from '../src/components/PersonAvatar';
import { Bump, PopIn, successTap } from '../src/components/Motion';
import { personTone } from '../src/homeFamily';
import { savingFor } from '../src/kidPage';
import { SECTION_ART } from '../src/sectionArt';

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
 *
 * Laid out like the child's page their parent sees (KidPageTop, Roland's
 * 2026-10-26 design): their colour and their stars at the top, what they are
 * saving for, then today's jobs from the chore wheel as big tiles. A tile
 * ticked here waits for a grown-up and pays nothing until one approves it,
 * the same rule as a finished task; it says so on the tile, so waiting never
 * looks like the tap failing.
 */
export default function KidScreen() {
  const ui = useUI();
  const { t } = useStore();
  const router = useRouter();
  const keyboard = useKeyboardHeight();
  const styles = createStyles(ui);

  const [home, setHome] = useState<KidHome | null>(null);
  const [busy, setBusy] = useState(false);
  // A tap that did not save says so: a child who sees a chore vanish and
  // come straight back, with no word why, taps it again and again.
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // The job tile just ticked, so it pops as it turns to "waiting".
  const [justTicked, setJustTicked] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const tile = Math.floor((Math.min(width, 640) - 40 - 2 * 10) / 3);
  const rewardTile = Math.floor((Math.min(width, 640) - 40 - 10) / 2);
  const [exitOpen, setExitOpen] = useState(false);
  // A note from a parent. A child has no login and no inbox, so this is the
  // only place in the app someone can actually say something to them.
  const [notes, setNotes] = useState<{ text: string; sender_name: string }[]>([]);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [leaving, setLeaving] = useState(false);
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
      // Best-effort: a note is a nice-to-have and must never stop the jobs and
      // stars from loading.
      api.kidNotes()
        .then((r) => setNotes(r.messages.map((m) => ({ text: m.text, sender_name: m.sender_name }))))
        .catch(() => setNotes([]));
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
    setSaveNote(null);
    try {
      await api.kidFinishChore(cardId);
    } catch (e) {
      logger.warn('kid finish failed', e);
      setSaveNote(t('kid_couldnt_save'));
    }
    await load();   // puts the chore back if it did not save
    setBusy(false);
  };

  const finishJob = async (choreId: string) => {
    if (busy) return;
    setBusy(true);
    setSaveNote(null);
    // Shown as waiting at once: a child who taps and sees nothing taps again.
    setHome((h) => (h ? { ...h, jobs: (h.jobs || []).map((j) => (j.chore_id === choreId ? { ...j, waiting: true } : j)) } : h));
    setJustTicked(choreId);
    successTap();
    try {
      await api.kidFinishJob(choreId);
    } catch (e) {
      logger.warn('kid job failed', e);
      setSaveNote(t('kid_couldnt_save'));
    }
    await load();   // puts the tile back if it did not save
    setBusy(false);
  };

  const spend = async (rewardId: string) => {
    if (busy) return;
    setBusy(true);
    setSaveNote(null);
    try {
      const out = await api.kidRequestReward(rewardId);
      setHome((h) => (h ? { ...h, stars: out.stars } : h));
    } catch (e) {
      logger.warn('kid reward failed', e);
      setSaveNote(t('kid_couldnt_save'));
    }
    await load();
    setBusy(false);
  };

  const leave = async () => {
    // Guard against a double-tap on a slow connection: without it the second
    // call hits a torn-down session and flashes a spurious "wrong PIN".
    if (leaving) return;
    setLeaving(true);
    setPinError(false);
    try {
      await api.exitKidSession(pin.trim());
    } catch {
      setPinError(true);
      setLeaving(false);
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
  const tone = personTone(home.name, []);
  const tint = ui[tone.bg];
  const ink = ui[tone.fg];
  const jobs = home.jobs || [];
  const jobsDone = jobs.filter((j) => j.done).length;
  // The same goal the parent's page draws: the cheapest treat not yet in reach.
  const goal = savingFor({ stars: home.stars } as FamilyMember, home.rewards);
  const progress = goal ? Math.min(1, goal.need > 0 ? goal.have / goal.need : 0) : 0;
  const left = goal ? Math.max(0, goal.need - goal.have) : 0;

  return (
    <View style={styles.page}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.top, { backgroundColor: tint }]} testID="kid-top">
            <View style={styles.topRow}>
              <Image source={SECTION_ART.family ?? undefined} style={styles.art} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
              <PressScale
                testID="kid-exit"
                accessibilityRole="button"
                accessibilityLabel={t('kid_hand_back')}
                onPress={() => setExitOpen(true)}
                style={styles.exitBtn}
              >
                <LogOut color={ui.text} size={18} />
              </PressScale>
            </View>
            <View style={styles.who}>
              <View style={styles.avatarRing}>
                <PersonAvatar name={home.name} avatar={null} size={64} ring={false} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.hello} numberOfLines={1}>{t('kid_hello', { name: home.name })}</Text>
                <View style={styles.starsRow} accessible accessibilityLabel={`${home.stars} ${t('kid_stars_label')}`}>
                  <Bump trigger={home.stars}>
                    <Text testID="kid-stars" style={styles.starNumber}>{home.stars}</Text>
                  </Bump>
                  <Star color={ui.goldText} fill={ui.goldText} size={28} strokeWidth={1.6} />
                  <Text style={[styles.starLabel, { color: ink }]}>{t('kid_stars_label')}</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.body}>
            {saveNote ? (
              <Text testID="kid-save-note" style={[styles.noteText, { color: ui.danger, textAlign: 'center' }]}>{saveNote}</Text>
            ) : null}

            {notes.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text style={styles.h2}>{t('kid_notes')}</Text>
                {notes.slice(-3).map((n, i) => (
                  <View key={i} style={styles.noteCard}>
                    <Text style={styles.noteFrom}>{n.sender_name}</Text>
                    <Text style={styles.noteText}>{n.text}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {goal && goal.kind === 'reward' ? (
              <View style={styles.goal} testID="kid-saving-for">
                <View style={styles.goalRow}>
                  <View style={styles.goalTile}>
                    <Text style={styles.goalEmoji}>{goal.icon || '🎁'}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.goalLabel}>{t('hub_saving_for')}</Text>
                    <Text style={styles.goalTitle} numberOfLines={2}>{goal.title}</Text>
                  </View>
                  <Text style={styles.goalCount}>{goal.have} / {goal.need}</Text>
                </View>
                <View
                  style={styles.bar}
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: goal.need, now: Math.min(goal.have, goal.need) }}
                >
                  <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
                <Text style={styles.goalFoot}>{left === 1 ? t('hub_star_to_go') : t('hub_stars_to_go', { n: left })}</Text>
              </View>
            ) : null}

            {home.owed.length > 0 ? <Text style={styles.h2}>{t('kid_owed')}</Text> : null}
            {home.owed.map((r) => (
              <View key={r.redemption_id} style={styles.owedCard} testID={`kid-owed-${r.redemption_id}`}>
                <View style={styles.goalTile}><Text style={styles.goalEmoji}>{r.reward_icon || '🎁'}</Text></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.owedTitle} numberOfLines={1}>{r.reward_title}</Text>
                  <Text style={styles.owedWait}>{t('kid_owed_waiting')}</Text>
                </View>
              </View>
            ))}

            {jobs.length > 0 ? (
              <View style={{ gap: 10 }}>
                <View style={styles.between}>
                  <Text style={styles.h2}>{t('hub_todays_jobs')}</Text>
                  <Text style={styles.sub} testID="kid-jobs-count">{t('hub_jobs_done', { done: jobsDone, total: jobs.length })}</Text>
                </View>
                <View style={styles.grid}>
                  {jobs.map((j) => {
                    const state = j.done ? 'done' : j.waiting ? 'waiting' : 'open';
                    return (
                      <PopIn key={j.chore_id} active={justTicked === j.chore_id && state === 'waiting'}>
                        <PressScale
                          testID={`kid-job-${j.chore_id}`}
                          accessibilityRole="button"
                          accessibilityState={{ checked: state !== 'open', disabled: state !== 'open' || busy }}
                          accessibilityLabel={state === 'done' ? `${j.title}, ${t('hub_job_done')}`
                            : state === 'waiting' ? `${j.title}, ${t('kid_job_waiting')}` : j.title}
                          disabled={state !== 'open' || busy}
                          onPress={() => finishJob(j.chore_id)}
                          style={[styles.job, { width: tile },
                            state === 'done' ? styles.jobDone : state === 'waiting' ? styles.jobWaiting : styles.jobOpen]}
                        >
                          <Text style={styles.jobGlyph}>{glyphFor(j.icon) || '✅'}</Text>
                          <Text style={[styles.jobTitle, state === 'done' && styles.onGreen]} numberOfLines={2}>{j.title}</Text>
                          <View style={styles.jobPay}>
                            {state === 'done' ? (
                              <>
                                <Check color="#FFFFFF" size={14} strokeWidth={3} />
                                <Text style={[styles.jobPayText, styles.onGreen]}>+{j.stars_awarded}</Text>
                              </>
                            ) : state === 'waiting' ? (
                              <>
                                <Hourglass color={ui.goldText} size={13} />
                                <Text style={[styles.jobPayText, { color: ui.goldText }]} numberOfLines={2}>{t('kid_job_waiting')}</Text>
                              </>
                            ) : (
                              <>
                                <Text style={styles.jobPayText}>+{j.star_reward}</Text>
                                <Star color={ui.goldText} fill={ui.goldText} size={13} strokeWidth={1.6} />
                              </>
                            )}
                          </View>
                        </PressScale>
                      </PopIn>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {home.chores.length > 0 ? (
              <View style={{ gap: 10 }}>
                <Text style={styles.h2}>{jobs.length > 0 ? t('kid_my_tasks') : t('kid_my_jobs')}</Text>
                {home.chores.map((c) => (
                  <PressScale
                    key={c.card_id}
                    testID={`kid-chore-${c.card_id}`}
                    accessibilityRole="button"
                    onPress={() => finish(c.card_id)}
                    style={styles.choreRow}
                  >
                    <View style={styles.tickBox}><Check color={ui.orangeText} size={20} /></View>
                    {glyphFor(c.icon) ? (
                      <View
                        testID={`kid-chore-icon-${c.card_id}`}
                        accessibilityElementsHidden
                        importantForAccessibility="no-hide-descendants"
                        style={styles.choreIcon}
                      >
                        <Text style={styles.choreIconGlyph}>{glyphFor(c.icon)}</Text>
                      </View>
                    ) : null}
                    <Text style={styles.choreTitle} numberOfLines={2}>{c.title}</Text>
                  </PressScale>
                ))}
              </View>
            ) : null}

            {jobs.length === 0 && home.chores.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>{t('kid_no_jobs')}</Text>
              </View>
            ) : null}

            <Text style={styles.h2}>
              {t('kid_rewards')}{affordable > 0 ? ` · ${t('kid_can_get', { n: affordable })}` : ''}
            </Text>
            {home.rewards.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>{t('kid_no_rewards')}</Text>
              </View>
            ) : (
              <View style={styles.grid}>
                {home.rewards.map((r) => {
                  const can = r.cost_stars <= home.stars;
                  return (
                    <PressScale
                      key={r.reward_id}
                      testID={`kid-reward-${r.reward_id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`${r.title}, ${t('kid_costs', { n: r.cost_stars })}`}
                      disabled={!can || busy}
                      onPress={() => spend(r.reward_id)}
                      style={[styles.reward, { width: rewardTile }, can ? styles.rewardCan : styles.rewardLocked]}
                    >
                      <Text style={styles.rewardIcon}>{r.icon || '🎁'}</Text>
                      <Text style={styles.rewardTitle} numberOfLines={2}>{r.title}</Text>
                      <View style={styles.jobPay}>
                        <Text style={styles.rewardCost}>{r.cost_stars}</Text>
                        <Star color={ui.goldText} fill={ui.goldText} size={13} strokeWidth={1.6} />
                        {can ? <Gift color={ui.orangeText} size={16} style={{ marginLeft: 4 }} /> : null}
                      </View>
                      {!can ? <Text style={styles.rewardNeed}>{t('kid_need_more', { n: r.cost_stars - home.stars })}</Text> : null}
                    </PressScale>
                  );
                })}
              </View>
            )}
          </View>

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
                  testID="kid-forgot-password" returnKeyType="done" onSubmitEditing={() => leaveWithPassword()}
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
                  <PressScale testID="kid-forgot-confirm" onPress={leaveWithPassword} disabled={fBusy} style={[styles.primaryBtn, fBusy && { opacity: 0.6 }]}>
                    <Text style={styles.primaryBtnText}>{fBusy ? t('kid_saving') : t('kid_forgot_go')}</Text>
                  </PressScale>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>{t('kid_hand_back')}</Text>
                <Text style={styles.modalBody}>{t('kid_hand_back_help')}</Text>
                <TextInput
                  testID="kid-exit-pin" returnKeyType="done" onSubmitEditing={() => leave()}
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
                  <PressScale testID="kid-exit-confirm" onPress={leave} disabled={leaving} style={[styles.primaryBtn, leaving && { opacity: 0.6 }]}>
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
    scroll: { paddingBottom: 8 },
    // The child's own colour, the one they have on Home and on their parent's
    // page of them, so it reads as theirs.
    top: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, gap: 10 },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    art: { width: 56, height: 56, borderRadius: 16 },
    exitBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: ui.card, alignItems: 'center', justifyContent: 'center' },
    who: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    avatarRing: { padding: 4, borderRadius: 999, backgroundColor: ui.card },
    hello: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 28, letterSpacing: -0.5 },
    starsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    starNumber: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 40, lineHeight: 48 },
    starLabel: { fontFamily: 'Figtree_800ExtraBold', fontSize: 17 },

    body: { paddingHorizontal: 20, paddingTop: 18, gap: 14 },
    h2: { fontFamily: 'Figtree_800ExtraBold', fontSize: 19, color: ui.text },
    between: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
    sub: { fontFamily: 'Figtree_700Bold', fontSize: 14, color: ui.muted },
    noteCard: {
      backgroundColor: ui.orangeSoft, borderWidth: 1, borderColor: ui.orange,
      borderRadius: 16, padding: 14,
    },
    noteFrom: { fontFamily: 'Figtree_800ExtraBold', fontSize: 12, color: ui.orangeText, marginBottom: 4 },
    noteText: { fontFamily: 'Figtree_500Medium', fontSize: 16, lineHeight: 22, color: ui.text },

    goal: { backgroundColor: ui.gold, borderRadius: 22, padding: 16, gap: 10 },
    goalRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    goalTile: { width: 48, height: 48, borderRadius: 14, backgroundColor: ui.card, alignItems: 'center', justifyContent: 'center' },
    goalEmoji: { fontSize: 26 },
    goalLabel: { fontFamily: 'Figtree_800ExtraBold', fontSize: 13, color: ui.goldText },
    goalTitle: { fontFamily: 'Figtree_800ExtraBold', fontSize: 19, lineHeight: 24, color: ui.text },
    goalCount: { fontFamily: 'Figtree_800ExtraBold', fontSize: 16, color: ui.text },
    bar: { height: 16, borderRadius: 8, backgroundColor: ui.card, overflow: 'hidden' },
    barFill: { height: 16, borderRadius: 8, backgroundColor: ui.goldText },
    goalFoot: { fontFamily: 'Figtree_800ExtraBold', fontSize: 16, color: ui.goldText },

    owedCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ui.mint, borderRadius: 22, padding: 14 },
    owedTitle: { fontFamily: 'Figtree_800ExtraBold', fontSize: 17, color: ui.text },
    owedWait: { fontFamily: 'Figtree_700Bold', fontSize: 13.5, color: ui.mintText, marginTop: 2 },

    // Three across, like their parent's page of them: a handful of jobs read
    // at a glance, and each tile is a big target for small hands.
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    job: {
      minHeight: 124, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 6,
      alignItems: 'center', justifyContent: 'center', gap: 5,
    },
    jobOpen: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line },
    jobWaiting: { backgroundColor: ui.gold, borderWidth: 1, borderColor: ui.gold },
    jobDone: { backgroundColor: ui.mintText },
    jobGlyph: { fontSize: 32, lineHeight: 38 },
    jobTitle: { fontFamily: 'Figtree_800ExtraBold', fontSize: 15, color: ui.text, textAlign: 'center' },
    jobPay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
    jobPayText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 13, color: ui.text, textAlign: 'center' },
    onGreen: { color: '#FFFFFF' },

    emptyCard: {
      backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line,
      padding: 20, alignItems: 'center',
    },
    emptyText: { color: ui.muted, fontFamily: 'Figtree_600SemiBold', fontSize: 15, textAlign: 'center' },
    // Big rows, big targets: this is tapped by small hands, often in a hurry.
    choreRow: {
      flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: ui.card,
      borderRadius: 18, borderWidth: 1, borderColor: ui.line, padding: 16, minHeight: 68,
    },
    tickBox: {
      width: 38, height: 38, borderRadius: 12, backgroundColor: ui.orangeSoft,
      alignItems: 'center', justifyContent: 'center',
    },
    // Bigger than anywhere else in the app: this is the picture a child who
    // cannot read yet recognises, so it does the work the words cannot.
    choreIcon: {
      width: 56, height: 56, borderRadius: 18, backgroundColor: ui.soft,
      alignItems: 'center', justifyContent: 'center',
    },
    choreIconGlyph: { fontSize: 32, lineHeight: 38, textAlign: 'center' },
    choreTitle: { flex: 1, color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 17 },

    reward: { minHeight: 128, borderRadius: 20, padding: 14, alignItems: 'center', justifyContent: 'center', gap: 6 },
    rewardCan: { backgroundColor: ui.orangeSoft, borderWidth: 2, borderColor: ui.orange },
    rewardLocked: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, opacity: 0.7 },
    rewardIcon: { fontSize: 34, lineHeight: 40 },
    rewardTitle: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 16, textAlign: 'center' },
    rewardCost: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 14 },
    rewardNeed: { color: ui.muted, fontFamily: 'Figtree_700Bold', fontSize: 12.5, textAlign: 'center' },
    backdrop: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    modalCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    modalCard: {
      width: '100%', maxWidth: 380, backgroundColor: ui.card, borderRadius: 22,
      borderWidth: 1, borderColor: ui.line, padding: 22, gap: 10,
    },
    modalTitle: { color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 20 },
    modalBody: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 14, lineHeight: 20 },
    pinInput: {
      borderWidth: 1, borderColor: ui.line, borderRadius: 14, backgroundColor: ui.soft,
      color: ui.text, fontFamily: 'Figtree_800ExtraBold', fontSize: 26, textAlign: 'center',
      letterSpacing: 10, paddingVertical: 12, marginTop: 4,
      outlineStyle: 'none' as never,
    },
    pinError: { color: ui.danger, fontFamily: 'Figtree_700Bold', fontSize: 13, marginTop: 8 },
    textInput: {
      borderWidth: 1, borderColor: ui.line, borderRadius: 14, backgroundColor: ui.soft,
      color: ui.text, fontFamily: 'Figtree_600SemiBold', fontSize: 16,
      paddingVertical: 13, paddingHorizontal: 14, marginTop: 4,
      outlineStyle: 'none' as never,
    },
    forgotLink: { alignSelf: 'center', paddingVertical: 10, marginTop: 2 },
    forgotLinkText: { color: ui.orangeText, fontFamily: 'Figtree_700Bold', fontSize: 13.5 },
    modalRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
    ghostBtn: {
      flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center',
      backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line,
    },
    ghostBtnText: { color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 15 },
    primaryBtn: {
      flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center',
      backgroundColor: ui.orangeDeep,
    },
    primaryBtnText: { color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
  });
