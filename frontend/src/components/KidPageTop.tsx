import React, { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Check, ChevronLeft, Gift, Star, Ticket } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { PersonAvatar } from './PersonAvatar';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import type { FamilyMember, MemberJob, Redemption, Reward } from '../api';
import type { PersonTone } from '../homeFamily';
import { glyphFor } from '../cardIcons';
import { earnedAndReady, savingFor } from '../kidPage';

/**
 * The top of a child's page: their face and their stars in their own colour,
 * what they are saving for, what they have earned and not yet been given, and
 * the buttons a parent presses to say well done.
 *
 * The child's colour is the one they have on Home, so a parent moving between
 * the two screens sees the same person. Everything else here is read-only
 * information a parent acts on with one tap; editing the jobs and treats
 * themselves stays on the Family tab, a link away.
 */
export function KidPageTop({
  member,
  name,
  avatar,
  tone,
  rewards,
  owed,
  jobs,
  busy,
  onBack,
  onEditJobs,
  onGive,
  onUseIt,
  onDoJob,
}: {
  member: FamilyMember | null;
  name: string;
  avatar: string | null;
  tone: PersonTone;
  rewards: Reward[];
  owed: Redemption[];
  /** Today's jobs, still-to-do first; empty when the child has none. */
  jobs: MemberJob[];
  busy: boolean;
  onBack: () => void;
  onEditJobs: () => void;
  /** Give stars, with the words the ledger will show for them. */
  onGive: (n: number, reason: string) => void;
  onUseIt: (redemption: Redemption) => void;
  /** A parent ticks a job on the child's behalf: it pays what it says. */
  onDoJob: (job: MemberJob) => void;
}) {
  const ui = useUI();
  const { t } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  // Three tiles across the page's width, measured rather than a percentage:
  // a percentage of a wrapping row resolved to a sliver on the web build.
  const { width } = useWindowDimensions();
  const tile = Math.floor((Math.min(width, 640) - 40 - 2 * 10) / 3);
  const tint = ui[tone.bg];
  const ink = ui[tone.fg];

  const stars = member?.stars ?? 0;
  const goal = member ? savingFor(member, rewards) : null;
  const ready = member ? earnedAndReady(owed, member.member_id) : [];
  const progress = goal ? Math.min(1, goal.need > 0 ? goal.have / goal.need : 0) : 0;
  const left = goal ? Math.max(0, goal.need - goal.have) : 0;

  return (
    <View testID="kid-page-top">
      <View style={[styles.header, { backgroundColor: tint }]}>
        <View style={styles.headerRow}>
          <PressScale testID="member-back" onPress={onBack} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('back')}>
            <ChevronLeft color={ui.text} size={26} strokeWidth={2.4} />
          </PressScale>
          <PressScale testID="kid-edit-jobs" onPress={onEditJobs} accessibilityRole="link" style={styles.editBtn}>
            <Text style={[styles.editText, { color: ink }]}>{t('hub_edit_jobs')}</Text>
          </PressScale>
        </View>
        <View style={styles.who}>
          <View style={styles.avatarRing}>
            <PersonAvatar name={name} avatar={avatar} size={68} ring={false} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <View style={styles.starsRow} accessible accessibilityLabel={`${stars} ${t('kid_stars_label')}`}>
              <Text testID="kid-page-stars" style={styles.starsNum}>{stars}</Text>
              <Star color={ui.goldText} fill={ui.goldText} size={26} strokeWidth={1.6} />
              <Text style={styles.starsWord}>{t('kid_stars_label')}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.body}>
        {goal ? (
          <View style={styles.goal} testID="kid-saving-for">
            <View style={styles.goalRow}>
              <View style={styles.tile}>
                {goal.kind === 'reward' && goal.icon ? (
                  <Text style={styles.tileEmoji}>{goal.icon}</Text>
                ) : (
                  <Ticket color={ui.goldText} size={22} />
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.goalLabel}>{goal.kind === 'week' ? t('hub_this_week') : t('hub_saving_for')}</Text>
                <Text style={styles.goalTitle} numberOfLines={2}>
                  {goal.kind === 'week' ? t('hub_stars_week', { earned: goal.have, target: goal.need }) : goal.title}
                </Text>
              </View>
              {/* The week's title already reads "20 of 35"; a count beside it
                  would say the same thing twice. */}
              {goal.kind === 'reward' ? <Text style={styles.goalCount}>{goal.have} / {goal.need}</Text> : null}
            </View>
            <View
              style={styles.bar}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: goal.need, now: Math.min(goal.have, goal.need) }}
            >
              <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            <Text style={styles.goalFoot}>{left === 1 ? t('hub_star_to_go') : left > 0 ? t('hub_stars_to_go', { n: left }) : t('hub_week_done')}</Text>
          </View>
        ) : null}

        {ready.map((r) => (
          <View key={r.redemption_id} style={styles.readyCard} testID={`kid-ready-${r.redemption_id}`}>
            <View style={styles.tile}>
              {r.reward_icon ? <Text style={styles.tileEmoji}>{r.reward_icon}</Text> : <Gift color={ui.mintText} size={22} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.readyTitle} numberOfLines={1}>{r.reward_title}</Text>
              <Text style={styles.readySub}>{t('hub_earned_ready')}</Text>
            </View>
            <PressScale
              testID={`kid-use-it-${r.redemption_id}`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => onUseIt(r)}
              style={[styles.useBtn, busy && { opacity: 0.5 }]}
            >
              <Text style={styles.useText}>{t('hub_use_it')}</Text>
            </PressScale>
          </View>
        ))}

        {jobs.length > 0 ? (
          <>
            <View style={styles.between}>
              <Text style={styles.h2}>{t('hub_todays_jobs')}</Text>
              <Text style={styles.sub} testID="kid-jobs-count">
                {t('hub_jobs_done', { done: jobs.filter((j) => j.done).length, total: jobs.length })}
              </Text>
            </View>
            <View style={styles.grid}>
              {jobs.map((j) => (
                <PressScale
                  key={j.chore_id}
                  testID={`kid-job-${j.chore_id}`}
                  accessibilityRole="button"
                  accessibilityState={{ checked: j.done, disabled: j.done || busy }}
                  accessibilityLabel={j.done ? `${j.title}, ${t('hub_job_done')}` : j.title}
                  disabled={j.done || busy}
                  onPress={() => onDoJob(j)}
                  style={[styles.job, { width: tile }, j.done ? styles.jobDone : styles.jobOpen, !j.done && busy && { opacity: 0.5 }]}
                >
                  <Text style={styles.jobGlyph}>{glyphFor(j.icon) || '✅'}</Text>
                  <Text style={[styles.jobTitle, j.done && styles.onGreen]} numberOfLines={2}>{j.title}</Text>
                  <View style={styles.jobPay}>
                    {j.done ? (
                      <>
                        <Check color="#FFFFFF" size={14} strokeWidth={3} />
                        <Text style={[styles.jobPayText, styles.onGreen]}>{t('hub_job_done')} +{j.stars_awarded}</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.jobPayText}>+{j.star_reward}</Text>
                        <Star color={ui.goldText} fill={ui.goldText} size={13} strokeWidth={1.6} />
                      </>
                    )}
                  </View>
                </PressScale>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.h2}>{t('hub_say_well_done')}</Text>
        <View style={styles.giveRow}>
          <PressScale
            testID="member-give-1"
            accessibilityRole="button"
            disabled={busy}
            onPress={() => onGive(1, t('hub_well_done'))}
            style={[styles.giveMain, busy && { opacity: 0.5 }]}
          >
            <Text style={styles.giveMainText}>+1</Text>
            <Star color="#FFFFFF" fill="#FFFFFF" size={16} strokeWidth={1.6} />
            <Text style={styles.giveMainText}>{t('hub_well_done')}</Text>
          </PressScale>
          {[3, 5].map((n) => (
            <PressScale
              key={n}
              testID={`member-give-${n}`}
              accessibilityRole="button"
              accessibilityLabel={`+${n} ${t('kid_stars_label')}`}
              disabled={busy}
              onPress={() => onGive(n, t('kids_parent_added_stars'))}
              style={[styles.giveSmall, busy && { opacity: 0.5 }]}
            >
              <Text style={styles.giveSmallText}>+{n}</Text>
            </PressScale>
          ))}
        </View>
      </View>
    </View>
  );
}

function createStyles(ui: UIColors) {
  return StyleSheet.create({
    header: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 20, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, gap: 8 },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    backBtn: { width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' },
    editBtn: { paddingVertical: 10, paddingLeft: 10 },
    editText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
    who: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    // A ring in the page's own white, so the picture sits on the colour the
    // way a photo sits in a frame.
    avatarRing: { padding: 4, borderRadius: 999, backgroundColor: ui.card },
    name: { fontFamily: 'Figtree_800ExtraBold', fontSize: 28, letterSpacing: -0.5, color: ui.text },
    starsRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    starsNum: { fontFamily: 'Figtree_800ExtraBold', fontSize: 32, lineHeight: 40, color: ui.text },
    starsWord: { fontFamily: 'Figtree_700Bold', fontSize: 16, color: ui.muted },

    body: { paddingHorizontal: 20, paddingTop: 18, gap: 14 },
    goal: { backgroundColor: ui.gold, borderRadius: 22, padding: 16, gap: 10 },
    goalRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    tile: { width: 44, height: 44, borderRadius: 14, backgroundColor: ui.card, alignItems: 'center', justifyContent: 'center' },
    tileEmoji: { fontSize: 22 },
    goalLabel: { fontFamily: 'Figtree_800ExtraBold', fontSize: 13, color: ui.goldText },
    goalTitle: { fontFamily: 'Figtree_800ExtraBold', fontSize: 18, lineHeight: 23, color: ui.text },
    goalCount: { fontFamily: 'Figtree_800ExtraBold', fontSize: 15, color: ui.text },
    bar: { height: 14, borderRadius: 7, backgroundColor: ui.card, overflow: 'hidden' },
    barFill: { height: 14, borderRadius: 7, backgroundColor: ui.goldText },
    goalFoot: { fontFamily: 'Figtree_800ExtraBold', fontSize: 15, color: ui.goldText },

    readyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ui.mint, borderRadius: 22, padding: 14 },
    readyTitle: { fontFamily: 'Figtree_800ExtraBold', fontSize: 16, color: ui.text },
    readySub: { fontFamily: 'Figtree_600SemiBold', fontSize: 13, color: ui.mintText, marginTop: 2 },
    useBtn: { height: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 2, borderColor: ui.text, backgroundColor: ui.card, alignItems: 'center', justifyContent: 'center' },
    useText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 14, color: ui.text },

    h2: { fontFamily: 'Figtree_800ExtraBold', fontSize: 18, color: ui.text, marginTop: 2 },
    between: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
    sub: { fontFamily: 'Figtree_600SemiBold', fontSize: 13.5, color: ui.muted },
    // Three across, like the design board: a child's day has a handful of
    // jobs, and three tiles read at a glance where a list has to be read.
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    job: {
      minHeight: 112, borderRadius: 20, paddingVertical: 14, paddingHorizontal: 6,
      alignItems: 'center', justifyContent: 'center', gap: 5,
    },
    jobOpen: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line },
    jobDone: { backgroundColor: ui.mintText },
    jobGlyph: { fontSize: 28, lineHeight: 34 },
    jobTitle: { fontFamily: 'Figtree_800ExtraBold', fontSize: 14, color: ui.text, textAlign: 'center' },
    jobPay: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    jobPayText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 13, color: ui.text },
    onGreen: { color: '#FFFFFF' },
    giveRow: { flexDirection: 'row', gap: 8 },
    giveMain: {
      flex: 1, height: 48, borderRadius: 24, backgroundColor: ui.orange,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    },
    giveMainText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 16, color: '#FFFFFF' },
    giveSmall: {
      width: 58, height: 48, borderRadius: 24, borderWidth: 2, borderColor: ui.text,
      backgroundColor: ui.card, alignItems: 'center', justifyContent: 'center',
    },
    giveSmallText: { fontFamily: 'Figtree_800ExtraBold', fontSize: 15, color: ui.text },
  });
}
