import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Plus,
  Star,
  X,
  Trash2,
  Lock,
  Pencil,
  MoreHorizontal,
  Bed,
  BookOpen,
  Utensils,
  Check,
  Minus,
  ChevronRight,
  ChevronLeft,
  Timer,
  PiggyBank,
  RotateCcw,
  Play,
  UserPlus,
  MessageCircle,
} from 'lucide-react-native';

import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { syncAllowanceReminders } from '../../src/notifications';
import { PressScale } from '../../src/components/PressScale';
import { weekDayCells as buildWeekDayCells } from '../../src/weekStars';
import { StarCelebration, CelebrationContent } from '../../src/components/StarCelebration';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import DateTimePickerSheet from '../../src/components/DateTimePickerSheet';
import { quickDueDate, toLocalDateInput, toLocalTimeInput } from '../../src/utils/date';
import AppToast from '../../src/components/AppToast';
import { useToast } from '../../src/hooks/useToast';
import EmptyState from '../../src/components/EmptyState';
import FirstRunTip from '../../src/components/FirstRunTip';
import ErrorState from '../../src/components/ErrorState';
import LoadingOverlay from '../../src/components/LoadingOverlay';
import { TabScreen } from '../../src/components/TabScreen';
import { PersonAvatar, avatarKind } from '../../src/components/PersonAvatar';
import { Card, IconTile, ProgressBar, ScreenHeader, UI, useUI, UIColors } from '../../src/components/Kit';

import { useStore } from '../../src/store';
import { api, logEvent, AllowanceConfig, AllowanceTxn, ChatThreadSummary, Chore, FamilyMember, Redemption, Reward, Routine, StarTransaction } from '../../src/api';
import { usePremiumGate, LockBadge, PremiumPreviewBanner } from '../../src/components/PremiumGate';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from '../../src/logger';

// The teen-accounts hint is a one-time announcement, so what it needs is a
// memory, not a timer. Scoped to the device, not the household: the key has no
// family id in it, and an earlier version of this comment claimed it did. The
// announcement is about a FEATURE of the app rather than about your family, so
// device scope is the right scope — but the comment has to say what the code
// does, not what would have sounded better.
const TEEN_HINT_SEEN_KEY = 'ahenora.teenHintSeen';
import { recordWin } from '../../src/reviewPrompt';
import { isAlreadySettled, mergeRedemptions, restoreRedemption } from '../../src/redemptions';
import { webConfirm } from '../../src/confirm';
import { localeFor } from '../../src/utils/date';

/** "Sat 2 Aug" — short enough for a subtitle, unambiguous about which day. */
function formatDueDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

type StarMode = 'add' | 'remove';

const DEFAULT_REWARD_ICON = String.fromCodePoint(0x1F381);

/**
 * Two routines most households already run, as a starting point.
 *
 * Typing five steps and five durations into a bottom sheet is the kind of
 * setup people abandon halfway. These fill the sheet in one tap and every
 * field stays editable — the preset is a draft, not a template.
 */
const ROUTINE_PRESETS = [
  {
    key: 'morning' as const,
    nameKey: 'kids_routine_preset_morning',
    steps: [
      { labelKey: 'kids_step_dressed', minutes: 5 },
      { labelKey: 'kids_step_breakfast', minutes: 15 },
      { labelKey: 'kids_step_teeth', minutes: 2 },
      { labelKey: 'kids_step_bag', minutes: 3 },
    ],
  },
  {
    key: 'bedtime' as const,
    nameKey: 'kids_routine_preset_bedtime',
    steps: [
      { labelKey: 'kids_step_tidy', minutes: 5 },
      { labelKey: 'kids_step_bath', minutes: 10 },
      { labelKey: 'kids_step_teeth', minutes: 2 },
      { labelKey: 'kids_step_story', minutes: 10 },
    ],
  },
];

/** Enough to name most treats without opening the emoji keyboard. */
const REWARD_ICONS = [
  DEFAULT_REWARD_ICON,                 // gift
  String.fromCodePoint(0x1F3AE),       // video game
  String.fromCodePoint(0x1F368),       // ice cream
  String.fromCodePoint(0x1F3AC),       // clapper board
  String.fromCodePoint(0x1F6F4),       // scooter
  String.fromCodePoint(0x1F4DA),       // books
];

/**
 * What a finished week can buy.
 *
 * Deliberately unpriced. These used to carry star costs, which meant a child
 * looking at the page was told twice what a treat costs — once by the weekly
 * meter and again, differently, by the chip — and the two numbers rarely
 * agreed. The week is the currency now: fill it, then pick one of these.
 */
const REWARD_IDEAS = [
  { titleKey: 'ri_pizza', icon: String.fromCodePoint(0x1F355) },
  { titleKey: 'ri_movie', icon: String.fromCodePoint(0x1F3AC) },
  { titleKey: 'ri_icecream', icon: String.fromCodePoint(0x1F366) },
  { titleKey: 'ri_game', icon: String.fromCodePoint(0x1F3AE) },
  { titleKey: 'ri_cinema', icon: String.fromCodePoint(0x1F37F) },
  { titleKey: 'ri_shopping', icon: String.fromCodePoint(0x1F6CD) },
  { titleKey: 'ri_swim', icon: String.fromCodePoint(0x1F3CA) },
  { titleKey: 'ri_bowling', icon: String.fromCodePoint(0x1F3B3) },
  { titleKey: 'ri_park', icon: String.fromCodePoint(0x1F333) },
  { titleKey: 'ri_baking', icon: String.fromCodePoint(0x1F9C1) },
  { titleKey: 'ri_friend', icon: String.fromCodePoint(0x1F46B) },
  { titleKey: 'ri_latenight', icon: String.fromCodePoint(0x1F319) },
  { titleKey: 'ri_dinner_choice', icon: String.fromCodePoint(0x1F37D) },
  { titleKey: 'ri_museum', icon: String.fromCodePoint(0x1F3DB) },
  { titleKey: 'ri_trampoline', icon: String.fromCodePoint(0x1F938) },
] as const;

/**
 * What a good week comes to, when nobody has said otherwise.
 *
 * This was 50 — seven perfect days of the three quick jobs plus the seventh-day
 * bonus. A goal only a spotless week can reach never gets reached, so the ring
 * never filled and the number stopped meaning anything. 35 is five solid days;
 * a perfect week now overshoots it, which is the right way round.
 *
 * The server owns the real number and it is per child. These are the fallback
 * for a member record that predates the setting, and the bounds the sheet
 * checks before asking the server to reject it.
 */
const DEFAULT_WEEKLY_TARGET = 35;
const MIN_WEEKLY_TARGET = 5;
const MAX_WEEKLY_TARGET = 500;

/** What all three quick jobs come to in one day. Derived, never typed twice. */
const QUICK_ADDS = [
  { labelKey: 'qa_bed', chore: 'bed' as const, amount: 2, Icon: Bed, bg: UI.mint, tint: UI.mintText },
  { labelKey: 'qa_read', chore: 'read' as const, amount: 3, Icon: BookOpen, bg: UI.lavender, tint: UI.lavenderText },
  { labelKey: 'qa_table', chore: 'table' as const, amount: 2, Icon: Utensils, bg: UI.orangeSoft, tint: UI.orange },
];

const QUICK_ADD_DAY = QUICK_ADDS.reduce((sum, q) => sum + q.amount, 0);

// Each child's initial is set in WHITE on their tint, so every entry has to be
// dark enough to carry it — orangeDeep rather than the brand orange, which
// reads at 3.1:1 under white.
const CHILD_TINTS = [UI.orangeDeep, UI.lavenderText, UI.mintText, UI.goldText];

function cleanNumber(value: string) {
  return value.replace(/[^0-9]/g, '');
}

function formatActivityDate(value: string | null | undefined, locale: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export default function Kids() {
  const { t, lang, dataVersion, requestMembers } = useStore();
  const { isLocked, promptUpgrade } = usePremiumGate();
  const allowanceLocked = isLocked('allowance');
  const router = useRouter();

  const [members, setMembers] = useState<FamilyMember[]>([]);
  // The grown-ups' conversations, so a Family-Hub card can carry an unread
  // count and open the right thread. Best-effort: a household with no chat yet
  // just shows no badges.
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  // Teen-finished tasks waiting for a parent to award the star.
  // Teens AND young children in kid mode: both finish a task and wait for a
  // parent to say what it was worth. One queue, one screen, one rule.
  const [teenApprovals, setTeenApprovals] = useState<{ card_id: string; title: string; teen_name: string; who?: string }[]>([]);
  const [approvingId, setApprovingId] = useState<string | null>(null);


  // Show it once, then remember. Two separate steps, and the split matters.
  //
  // Reading only says whether this device has already been told. Writing
  // happens when the hint is genuinely ON SCREEN — see the effect further
  // down — because the hint renders inside the "you have children" branch. A
  // parent who opens Kids before adding a child would otherwise burn the
  // announcement without ever having seen it, which is the same bug as showing
  // it forever, just in the opposite direction and harder to notice.
  //
  // There is no dismiss control, so "seen" can only mean displayed.
  const [teenHintEligible, setTeenHintEligible] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(TEEN_HINT_SEEN_KEY)
      .then((seen) => {
        if (!cancelled && !seen) setTeenHintEligible(true);
      })
      .catch((error) => logger.warn('Teen hint read failed:', error));
    return () => { cancelled = true; };
  }, []);


  // Which day the quick-adds are being credited to. Null means today, which
  // is the ordinary case; picking a day is how a parent fills in a missed one.
  const [backdateDay, setBackdateDay] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [historyItems, setHistoryItems] = useState<StarTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [kidsTab, setKidsTab] = useState<'rewards' | 'stars' | 'history'>('rewards');

  const [showChildSheet, setShowChildSheet] = useState(false);
  const [childName, setChildName] = useState('');
  const [childStartingStars, setChildStartingStars] = useState('0');
  const [childPin, setChildPin] = useState('');

  // Correcting a child after setup. A typo used to be permanent short of
  // deleting them — which would have taken their stars with it — and a
  // forgotten PIN locked them out of redeeming with no way back.
  const [showManageSheet, setShowManageSheet] = useState(false);
  const [manageName, setManageName] = useState('');
  const [managePin, setManagePin] = useState('');
  const [manageAge, setManageAge] = useState('');
  // Give a 13+ child their own account (teen mode): the age picker floors at
  // 13 — the compliance line — so under-13 can never get an independent account.
  const [showTeenInvite, setShowTeenInvite] = useState(false);
  const [teenAge, setTeenAge] = useState(15);
  const [teenEmail, setTeenEmail] = useState('');
  const [teenSending, setTeenSending] = useState(false);

  const [showStarSheet, setShowStarSheet] = useState(false);
  const [showGoalSheet, setShowGoalSheet] = useState(false);
  const [goalValue, setGoalValue] = useState('');
  const [starMode, setStarMode] = useState<StarMode>('add');
  const [starAmount, setStarAmount] = useState('5');
  const [starReason, setStarReason] = useState('');

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { toast, showToast } = useToast();
  const [celebration, setCelebration] = useState<CelebrationContent | null>(null);
  const [showFixSheet, setShowFixSheet] = useState(false);
  const [fixValue, setFixValue] = useState('');
  const [showAllowanceSheet, setShowAllowanceSheet] = useState(false);
  // The list was capped at five with nothing to say so. A reward a child is
  // saving towards being invisible defeats the point of the page.
  const [alwAmount, setAlwAmount] = useState('');
  const [alwFrequency, setAlwFrequency] = useState('weekly');

  // Recording actual money in and out. The balance is derived from these on the
  // server, so without a way to add them the tracker showed $0.00 forever.
  const [showMoneySheet, setShowMoneySheet] = useState(false);
  const [moneyAmount, setMoneyAmount] = useState('');
  const [moneyNote, setMoneyNote] = useState('');
  const [moneyTxns, setMoneyTxns] = useState<AllowanceTxn[]>([]);
  const [moneyLoading, setMoneyLoading] = useState(false);
  // Guards against double-tap double-charging stars (redeem) / double-awarding.
  const starActionRef = useRef(false);
  // Guards a double-tap from recording the same amount twice.
  const moneySavingRef = useRef(false);
  // A double-tap must not pay the same chore twice.
  const choreDoneRef = useRef(false);
  const routineDoneRef = useRef(false);

  // Rewards that have been paid for but not yet handed over. Spending the
  // stars was never the end of the story — somebody still owes the child a
  // trip to the cinema — and before this the promise lived only in a parent's
  // memory.
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  // Per row, not one flag for the list: settling one reward must not silently
  // swallow a tap on the next one.
  const settlingIdsRef = useRef<Set<string>>(new Set());
  // The screen reloads on focus and that fetch is deliberately not awaited, so
  // it can resolve after the list has already moved on. These two say what this
  // device did in the meantime, and a landing fetch is reconciled against them
  // rather than trusted wholesale — otherwise a reward settled a moment ago
  // reappears, and one redeemed a moment ago vanishes.
  const settledIdsRef = useRef<Set<string>>(new Set());
  const addedIdsRef = useRef<Set<string>>(new Set());

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [allowances, setAllowances] = useState<AllowanceConfig[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [chores, setChores] = useState<Chore[]>([]);
  const [showRoutineSheet, setShowRoutineSheet] = useState(false);
  const [routineName, setRoutineName] = useState('');
  const [routineStars, setRoutineStars] = useState('2');
  const [routineSteps, setRoutineSteps] = useState<{ label: string; minutes: string }[]>([]);
  const [showChoreSheet, setShowChoreSheet] = useState(false);
  const [choreTitle, setChoreTitle] = useState('');
  const [choreStars, setChoreStars] = useState('3');
  const [choreWeekly, setChoreWeekly] = useState(false);
  const [choreMembers, setChoreMembers] = useState<string[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [showRewardSheet, setShowRewardSheet] = useState(false);
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [rewardTitle, setRewardTitle] = useState('');
  const [rewardCost, setRewardCost] = useState('20');
  const [rewardIcon, setRewardIcon] = useState(DEFAULT_REWARD_ICON);

  // Teens live in this section too — same wallet (stars, redeem, adjust), so a
  // parent manages a young person's rewards whether they're a managed child or
  // a teen with their own login.
  const children = useMemo(() => members.filter((m) => ['child', 'teen'].includes(m.role?.toLowerCase() ?? '')), [members]);
  // The grown-ups half of the Family Hub: everyone who isn't a kid or teen —
  // parents, a co-parent (previously invisible in the app), a helper, or a
  // named family member (Grandma, Nanny…). The signed-in user leads the list.
  // Grown-ups used to be one list, so a childminder sat beside a co-parent. The
  // app has always known they are different - the server refuses a helper the
  // vault, the money and family chat - and the Hub was the one place that did
  // not show it. Two groups now, and the person holding the phone comes first.
  const parents = useMemo(() => {
    const rows = members.filter((m) => ['parent', 'co-parent'].includes(m.role?.toLowerCase() ?? ''));
    return rows.sort((a, b) => (a.is_me ? -1 : b.is_me ? 1 : 0));
  }, [members]);

  // Everyone who helps run the house without being a parent or a child:
  // grandparents, childminders, carers, a named family member.
  const helpers = useMemo(
    () => members
      .filter((m) => !['child', 'teen', 'parent', 'co-parent'].includes(m.role?.toLowerCase() ?? ''))
      // Phone-holder first here too: a grandparent or carer using their own
      // account should see themselves at the top of their group, not buried.
      .sort((a, b) => (a.is_me ? -1 : b.is_me ? 1 : 0)),
    [members]);

  // Open a member's profile. Parents share the adults thread; a teen has their
  // own (keyed by user_id, which we recover from the thread list by name). A
  // helper or named member has no chat — the server refuses them family chat —
  // so we pass an empty thread and the profile shows who they are instead.
  const openMember = useCallback((m: FamilyMember) => {
    const roleLc = (m.role || '').toLowerCase();
    let thread = '';
    // Parents share the adults thread; a teen's thread is keyed by their own
    // user_id (matched by id, never by display name — two teens named the same
    // used to collide). A teen with no account yet has no thread.
    if (roleLc === 'parent' || roleLc === 'co-parent') thread = 'adults';
    else if (roleLc === 'teen') thread = m.user_id || '';
    router.push({ pathname: '/member', params: { id: m.member_id, name: m.name, role: m.role, thread } });
  }, [router]);

  // Messaging moved into the Hub, which put a co-parent's message three taps
  // away and gave it no way of announcing itself. The chat icon on a row is now
  // a real shortcut — tap the row for the person, tap the icon to talk to them.
  const openThread = useCallback((m: FamilyMember) => {
    // The server says which conversation belongs to this person. Rebuilding the
    // thread id here as well meant two places had to agree on the format, and
    // when the id scheme changed one of them was wrong.
    const th = threads.find((x) => x.member_id === m.member_id);
    if (!th) { openMember(m); return; }
    router.push({
      pathname: '/conversation',
      params: { thread: th.thread, title: m.name, adults: th.is_adults ? '1' : '0' },
    });
  }, [router, openMember, threads]);

  // A kid/teen opens as their own page: the roster steps aside and this one
  // child's full detail (stars, chores, rewards, pocket money) fills the screen,
  // with a back arrow to the roster — the same "each person is a page" shape the
  // grown-ups get, but reusing all the tooling that already lives on this tab.
  const [focusedChild, setFocusedChild] = useState<string | null>(null);
  // A child's page leads with the two daily jobs — give stars, and today's
  // chores. The other six blocks are still here, behind one door, because
  // nine sections of equal weight buried the thing you actually came to do.
  const [showMore, setShowMore] = useState(false);
  const openChild = useCallback((m: FamilyMember) => {
    setSelectedChild(m.member_id);
    setBackdateDay(null);
    setFocusedChild(m.member_id);
    setShowMore(false);
  }, []);
  const activeChild = children.find((c) => c.member_id === selectedChild) || children[0];
  const isFocused = Boolean(focusedChild) && Boolean(activeChild);

  // The hint's real gate is !isFocused: with a child profile open, Kids renders
  // that profile and the hint never appears. Marking it seen on mount would
  // therefore burn the announcement for a parent who happened to arrive with a
  // child selected — the same bug as showing it forever, in the opposite
  // direction and harder to notice. Mark it when it is genuinely on screen.
  const showTeenHint = teenHintEligible && !isFocused;
  useEffect(() => {
    if (!showTeenHint) return;
    AsyncStorage.setItem(TEEN_HINT_SEEN_KEY, '1')
      .catch((error) => logger.warn('Teen hint write failed:', error));
  }, [showTeenHint]);
  const stars = activeChild?.stars || 0;
  // The bank is `stars`; the weekly meter is `week_earned`. A weekend treat is
  // measured against the week's earnings, everything else against the bank.
  const weekEarned = activeChild?.week_earned || 0;
  // One cell per day of the current week, Monday first. The arithmetic lives
  // in src/weekStars.ts so it can be tested against the rules the server
  // enforces, rather than read by eye inside a component.
  const weekDayCells = useMemo(
    () => buildWeekDayCells(historyItems, new Date(), localeFor(lang)),
    [historyItems, lang],
  );
  const backdateDayCell = useMemo(
    () => weekDayCells.find((d) => d.iso === backdateDay) || null,
    [weekDayCells, backdateDay],
  );
  // The server owns the target; the constant is only the fallback for a member
  // record that predates it, so the two can never quietly disagree.
  const weeklyTarget = activeChild?.weekly_target || DEFAULT_WEEKLY_TARGET;
  const weekClaimed = !!activeChild?.week_claimed;
  const weekFull = weekEarned >= weeklyTarget;

  const pendingRedemptions = useMemo(
    () => redemptions.filter((r) => r.status === 'pending' && r.member_id === activeChild?.member_id),
    [redemptions, activeChild?.member_id],
  );
  const owedByChild = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of redemptions) {
      if (r.status === 'pending') counts[r.member_id] = (counts[r.member_id] || 0) + 1;
    }
    return counts;
  }, [redemptions]);

  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  // One row, two groups. A parent and a helper look the same here on purpose -
  // what differs is the badge, the subtitle, and whether the server gave us a
  // conversation with them. Rendering both from one function means the groups
  // cannot quietly drift apart.
  const renderPerson = useCallback((m: FamilyMember) => {
              const roleLc = (m.role || '').toLowerCase();
              const isParent = roleLc === 'parent' || roleLc === 'co-parent';
              const isHelper = roleLc === 'helper';
              // Invited, but never actually signed in. The server has always
              // known — has_account is false on a row with no login — and the
              // app has never shown it, so a co-parent who joined and one who
              // never did looked identical. That is not cosmetic: it is how a
              // household can appear complete while the other parent sees
              // nothing, and it turned one missed invite into three separate
              // bug reports (missing children, missing notifications, a link
              // that "didn't work") before anybody could tell they were one.
              //
              // `=== false` rather than `!m.has_account`: an older server that
              // omits the field must read as "don't know", never as "absent".
              // Adults only — a young child has no login by design.
              const notJoined = (isParent || isHelper) && m.has_account === false;
              const badgeLabel = notJoined
                ? t('hub_role_invited')
                : isParent
                ? (m.is_founder ? t('hub_role_owner') : t('hub_role_coparent'))
                : isHelper ? t('hub_role_helper') : m.role;
              // Anyone the server gave us a conversation with can be messaged
              // from the roster — a co-parent, and now a helper too.
              const memberThread = threads.find((x) => x.member_id === m.member_id);
              const hasThread = Boolean(memberThread);
              const unread = memberThread?.unread || 0;
              const sub = notJoined
                ? t('hub_not_joined_sub')
                : isParent
                ? (memberThread?.last_text || t('hub_coparent_sub'))
                : isHelper ? t('hub_helper_sub') : t('hub_member_sub');
              return (
                <PressScale
                  key={m.member_id}
                  testID={`hub-member-${m.member_id}`}
                  onPress={() => openMember(m)}
                  style={styles.hubRow}
                >
                  {/* Fixed deep tints so the white initial always clears
                      4.5:1. Deep orange (#CA470A) beats ui.orange's 3.11:1;
                      a fixed slate beats ui.muted, which is a *light* slate in
                      dark mode (#CBD5E1) where white would be unreadable. */}
                  {avatarKind(m.avatar) ? (
                    <View style={styles.hubAvatarIllus}>
                      <PersonAvatar name={m.name} avatar={m.avatar} size={44} ring={false} />
                    </View>
                  ) : (
                    <View style={[styles.hubAvatar, { backgroundColor: isParent ? UI.orangeDeep : '#5F656E' }]}>
                      <Text style={styles.hubAvatarText}>{m.name[0]?.toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={styles.hubNameRow}>
                      <Text style={styles.hubName} numberOfLines={1}>
                        {m.name}{m.is_me ? ` · ${t('hub_you')}` : ''}
                      </Text>
                      <View style={[styles.hubBadge, { backgroundColor: notJoined ? ui.soft : isParent ? ui.orangeSoft : ui.soft }]}>
                        <Text
                          testID={notJoined ? `hub-not-joined-${m.member_id}` : undefined}
                          style={[styles.hubBadgeText, { color: notJoined ? ui.muted : isParent ? ui.orangeText : ui.muted }]}
                        >{badgeLabel}</Text>
                      </View>
                    </View>
                    <Text style={styles.hubSub} numberOfLines={1}>{sub}</Text>
                  </View>
                  {hasThread ? (
                    <PressScale
                      testID={`hub-message-${m.member_id}`}
                      onPress={() => openThread(m)}
                      hitSlop={10}
                      accessibilityLabel={t('hub_message_name', { name: m.name })}
                      style={styles.hubMsgBtn}
                    >
                      <MessageCircle color={unread > 0 ? '#fff' : ui.muted} size={18} />
                      {unread > 0 ? (
                        <View style={styles.hubUnread}><Text style={styles.hubUnreadText}>{unread}</Text></View>
                      ) : null}
                    </PressScale>
                  ) : (
                    <ChevronRight color={ui.muted} size={18} />
                  )}
                </PressScale>
              );
  }, [threads, openMember, openThread, t, ui, styles]);

  const memberName = useCallback((memberId: string) => {
    const m = members.find((x) => x.member_id === memberId);
    return m?.name || memberId;
  }, [members]);


  // Tapping between children fires overlapping history fetches, and without a
  // sequence the last RESPONSE wins rather than the last REQUEST — one
  // child's ledger and weekday row rendered under another child's name and
  // star total.
  const historySeqRef = useRef(0);
  const refreshHistory = useCallback(async (memberId?: string | null) => {
    const seq = ++historySeqRef.current;
    if (!memberId) {
      if (seq === historySeqRef.current) setHistoryItems([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const result = await api.memberStarHistory(memberId);
      if (seq !== historySeqRef.current) return;   // a newer child was picked
      setHistoryItems(result);
    } catch (e: any) {
      const message = String(e?.message || e || '');
      if (!message.includes('404')) logger.warn('Star history load failed:', message);
      if (seq === historySeqRef.current) setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    logEvent('kids_open');
    try {
      setErrorMessage(null);
      // One request fewer per visit: the priced-reward list is gone, so the
      // page no longer needs the rewards catalogue at all.
      const m = await api.familyMembers();
      setMembers(m);
      api.getTeenApprovals().then((r) => setTeenApprovals(r.approvals)).catch(() => setTeenApprovals([]));
      api.chatThreads().then((r) => setThreads(r.threads)).catch(() => setThreads([]));

      const currentChildStillExists = selectedChild && m.some((x) => x.member_id === selectedChild);
      const firstChild = m.find((x) => x.role?.toLowerCase() === 'child');
      const nextSelected = currentChildStillExists ? selectedChild : firstChild?.member_id || null;
      setSelectedChild(nextSelected);
      await refreshHistory(nextSelected);

      Promise.allSettled([api.listRoutines(), api.listAllowances(), api.listChores(),
                          api.listRedemptions('pending'), api.listRewards()])
        .then(async ([rtnRes, alwRes, choreRes, redRes, rewardRes]) => {
          if (rewardRes.status === 'fulfilled') setRewards(rewardRes.value);
          if (rtnRes.status === 'fulfilled') setRoutines(rtnRes.value);
          if (alwRes.status === 'fulfilled') setAllowances(alwRes.value);
          // Allowance heads-up is sent by the server now. Scheduled here it only
          // existed for someone who had opened the Kids tab, and it went stale
          // the moment a payment moved the next due date. This cancel clears
          // what an older build left behind, so nobody hears it twice — and it
          // sits OUTSIDE the fulfilled check on purpose: a failed listAllowances
          // is exactly when the stale local reminders would survive.
          syncAllowanceReminders([], false).catch(() => undefined);
          if (choreRes.status === 'fulfilled') setChores(choreRes.value);
          // A server that predates redemptions 404s here; an older app should
          // still show stars rather than an error, so a failure just leaves
          // the section hidden.
          if (redRes.status === 'fulfilled') {
            setRedemptions((prev) =>
              mergeRedemptions(prev, redRes.value, settledIdsRef.current, addedIdsRef.current));
          }
          const kids = m.filter((x) => x.role?.toLowerCase() === 'child');
          const bals: Record<string, number> = {};
          for (const kid of kids) {
            try { const b = await api.allowanceBalance(kid.member_id); bals[kid.member_id] = b.balance; } catch { /* skip */ }
          }
          setBalances(bals);
        })
        .catch(() => undefined);
    } catch (e: any) {
      logger.warn('Kids page load failed:', e?.message || e);
      setErrorMessage(e?.message || t('kids_load_error'));
    } finally {
      setLoading(false);
    }
  }, [refreshHistory, selectedChild]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Call the latest load without making it a dependency: load's identity changes
  // when it sets selectedChild, and depending on it here re-fired the whole focus
  // effect (a second fetch + a re-flashed hint) on every first open. The ref
  // keeps the effect to once per focus.
  const loadRef = useRef(load);
  loadRef.current = load;
  useFocusEffect(useCallback(() => {
    loadRef.current();
    // The teen-accounts hint used to be re-flashed here on every focus, which
    // is why it kept reappearing long after it had been read. It is a one-time
    // announcement now, owned by the effect near the top of this component.
  }, []));

  // Reload in place after a capture from the global "+".
  useEffect(() => {
    if (dataVersion) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  useEffect(() => {
    refreshHistory(activeChild?.member_id);
  }, [activeChild?.member_id, refreshHistory]);

  // If the focused child is removed (or the list reloads without them), drop
  // back to the roster rather than silently showing someone else's page.
  useEffect(() => {
    if (focusedChild && !children.some((c) => c.member_id === focusedChild)) setFocusedChild(null);
  }, [children, focusedChild]);

  const showBlockingError = !loading && Boolean(errorMessage) && members.length === 0;

  const openChildSheet = () => {
    setChildName('');
    setChildStartingStars('0');
    setChildPin('');
    setShowChildSheet(true);
  };

  const openStarSheet = (mode: StarMode, amount = '5') => {
    if (!activeChild) {
      showToast(t('kids_select_child_first'), 'error');
      return;
    }
    setStarMode(mode);
    setStarAmount(amount);
    // Deliberately empty in both directions. "Good job!" as a default answer to
    // "what did they do" is the reason the ledger filled up with stars nobody
    // could account for a week later.
    setStarReason('');
    setShowStarSheet(true);
  };

  const createChild = async () => {
    const name = childName.trim();
    const starting = parseInt(childStartingStars || '0', 10) || 0;
    const pin = childPin.trim();

    if (!name) { showToast(t('kids_name_required'), 'error'); return; }
    if (starting < 0) { showToast(t('kids_stars_not_negative'), 'error'); return; }
    if (pin && !/^\d{4}$/.test(pin)) { showToast(t('kids_pin_4_digits'), 'error'); return; }

    setSaving(true);
    try {
      const created = await api.createFamilyMember({ name, starting_stars: starting, pin: pin || undefined });
      setMembers((prev) => [...prev, created]);
      setSelectedChild(created.member_id);
      setShowChildSheet(false);
      showToast(`${created.name} ${t('kids_child_added')}`, 'success');
      await refreshHistory(created.member_id);
    } catch (e: any) {
      logger.warn('Create child failed:', e?.message || e);
      // A member-limit (402) is a plan cap, not a random error — explain it
      // clearly and offer to view plans instead of a vanishing toast.
      if (e?.status === 402 || e?.planLimit) {
        setShowChildSheet(false);
        Alert.alert(
          t('kids_household_full'),
          t('kids_household_full_msg'),
          [
            { text: t('kids_not_now'), style: 'cancel' },
            { text: t('kids_see_plans'), onPress: () => router.push('/pricing') },
          ],
        );
      } else {
        showToast(e?.message || t('kids_add_child_error'), 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const openManageSheet = () => {
    if (!activeChild) { showToast(t('kids_select_child_first'), 'error'); return; }
    setManageName(activeChild.name);
    setManagePin('');
    // Prefilled with what is stored, blank when nothing was ever set — a child
    // added before ages existed should not be shown a number nobody chose.
    setManageAge(activeChild.age != null ? String(activeChild.age) : '');
    setShowManageSheet(true);
  };

  const openTeenInvite = () => {
    if (!activeChild) { showToast(t('kids_select_child_first'), 'error'); return; }
    // Start from the age on record, so the form agrees with the household by
    // default instead of inviting a number that the server will refuse.
    setTeenAge(activeChild?.age != null ? activeChild.age : 15);
    setTeenEmail('');
    setShowTeenInvite(true);
  };

  const resolveApproval = async (cardId: string, approve: boolean, stars = 1) => {
    setApprovingId(cardId);
    try {
      await api.resolveTeenApproval(cardId, approve, stars);
      setTeenApprovals((prev) => prev.filter((a) => a.card_id !== cardId));
      if (approve) { showToast(t('teen_star_awarded', { count: stars }), 'success'); load(); }
    } catch (e: any) {
      showToast(e?.message || t('set_error'), 'error');
    } finally {
      setApprovingId(null);
    }
  };

  // A flat 1 star for every approved teen task felt stingy next to managed kids
  // (who earn 5 for an assigned task). Let the parent pick the reward so a
  // bigger job can be recognized.
  const approveWithStars = (cardId: string) => {
    Alert.alert(t('teen_approve_title'), t('teen_approve_msg'), [
      { text: t('cancel'), style: 'cancel' },
      { text: '1 ⭐', onPress: () => resolveApproval(cardId, true, 1) },
      { text: '3 ⭐', onPress: () => resolveApproval(cardId, true, 3) },
      { text: '5 ⭐', onPress: () => resolveApproval(cardId, true, 5) },
    ]);
  };

  // Upgrade a 13-17 child to their own account. The age picker already floors at
  // 13 and caps at 17; this re-checks that range before sending.
  const inviteTeen = async () => {
    const age = teenAge;
    if (age < 13 || age > 17) { showToast(t('teen_invite_range'), 'error'); return; }
    const email = teenEmail.trim().toLowerCase();
    if (!email.includes('@') || email.length < 4) { showToast(t('set_invite_valid_email'), 'error'); return; }
    setTeenSending(true);
    try {
      // Name the child. Without this the server has nothing to check the typed
      // age against, and the 13 floor is only as good as what was typed.
      await api.invite(email, undefined, { is_teen: true, age, member_id: activeChild?.member_id });
      setShowTeenInvite(false);
      showToast(t('teen_invite_sent'), 'success');
    } catch (e: any) {
      logger.warn('Teen invite failed:', e?.message || e);
      // A plan cap (402) gets the same clear "household is full → see plans"
      // path as adding a managed child, not a vanishing generic error.
      if (e?.status === 402 || e?.planLimit) {
        setShowTeenInvite(false);
        Alert.alert(
          t('kids_household_full'),
          t('kids_household_full_msg'),
          [
            { text: t('kids_not_now'), style: 'cancel' },
            { text: t('kids_see_plans'), onPress: () => router.push('/pricing') },
          ],
        );
      } else {
        showToast(e?.message || t('set_error'), 'error');
      }
    } finally {
      setTeenSending(false);
    }
  };

  const saveManagedChild = async () => {
    if (!activeChild) return;
    const name = manageName.trim();
    const pin = managePin.trim();

    if (!name) { showToast(t('kids_name_required'), 'error'); return; }
    if (pin && !/^\d{4}$/.test(pin)) { showToast(t('kids_pin_4_digits'), 'error'); return; }
    // Blank means "leave it alone"; a typed number has to be a real child's age.
    const ageText = manageAge.trim();
    const ageNum = ageText ? Number(ageText) : null;
    if (ageText && (!Number.isInteger(ageNum) || (ageNum as number) < 1 || (ageNum as number) > 17)) {
      showToast(t('kids_age_range'), 'error');
      return;
    }

    setSaving(true);
    try {
      // Two calls with no transaction between them, so each is applied as it
      // lands rather than at the end: if the second fails, the screen still
      // shows what the first actually changed.
      // Name and age travel together — one request, so a parent who corrects
      // both does not get half of it applied.
      const storedAge = activeChild.age ?? null;
      const nameChanged = name !== activeChild.name;
      const ageChanged = ageNum !== storedAge && !(ageNum === null && storedAge === null);
      if (nameChanged || ageChanged) {
        const patch: { name?: string; age?: number } = {};
        if (nameChanged) patch.name = name;
        // 0 is how the server is told to clear an age that was set by mistake.
        if (ageChanged) patch.age = ageNum ?? 0;
        const updated = await api.updateFamilyMember(activeChild.member_id, patch);
        setMembers((prev) => prev.map((m) => (m.member_id === updated.member_id ? updated : m)));
      }
      // The PIN box opens blank and is only sent when typed, so saving a
      // rename never silently rewrites a PIN the parent did not touch.
      if (pin) {
        await api.setMemberPin(activeChild.member_id, pin);
        setMembers((prev) => prev.map((m) => (
          m.member_id === activeChild.member_id ? { ...m, has_pin: true } : m
        )));
      }
      setShowManageSheet(false);
      showToast(t('kids_child_updated'), 'success');
    } catch (e: any) {
      logger.warn('Update child failed:', e?.message || e);
      showToast(e?.message || t('kids_child_update_error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // A PIN is the only thing standing between a child and spending their own
  // stars, and this sheet is one tap from the Redeem button they are looking
  // at. Removing it asks first, the same as any other undoing of a control.
  const confirmClearPin = () => {
    if (!activeChild) return;
    const message = t('kids_remove_pin_confirm', { name: activeChild.name });
    if (Platform.OS === 'web') {
      if (webConfirm(message)) clearChildPin();
      return;
    }
    Alert.alert(t('kids_remove_pin'), message, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('kids_remove_pin'), style: 'destructive', onPress: () => clearChildPin() },
    ]);
  };

  const clearChildPin = async () => {
    if (!activeChild) return;
    setSaving(true);
    try {
      await api.removeMemberPin(activeChild.member_id);
      setMembers((prev) => prev.map((m) => (
        m.member_id === activeChild.member_id ? { ...m, has_pin: false } : m
      )));
      setManagePin('');
      showToast(t('kids_pin_removed'), 'success');
    } catch (e: any) {
      logger.warn('Remove PIN failed:', e?.message || e);
      showToast(e?.message || t('kids_child_update_error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeChild = async (child: FamilyMember) => {
    setSaving(true);
    try {
      await api.deleteFamilyMember(child.member_id);
      setMembers((prev) => prev.filter((m) => m.member_id !== child.member_id));
      // Their outstanding rewards went with them on the server; drop ours too
      // rather than leave rows pointing at a child who is no longer listed.
      setRedemptions((prev) => prev.filter((r) => r.member_id !== child.member_id));
      setSelectedChild(null);
      setShowManageSheet(false);
      showToast(t('kids_child_removed', { name: child.name }), 'success');
      await load();
    } catch (e: any) {
      logger.warn('Delete child failed:', e?.message || e);
      showToast(e?.message || t('kids_child_remove_error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmRemoveChild = () => {
    if (!activeChild) return;
    const child = activeChild;
    // Spelled out rather than a bare "Are you sure?": this takes the child's
    // stars and their whole history with it, and there is no undo. Web gets a
    // real prompt too — the shortcut other delete flows take is survivable for
    // a reward and not for a child.
    const title = t('kids_remove_child_title', { name: child.name });
    const message = t('kids_remove_child_msg', { name: child.name, n: child.stars || 0 });
    if (Platform.OS === 'web') {
      if (webConfirm(`${title}\n\n${message}`)) removeChild(child);
      return;
    }
    Alert.alert(title, message, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('kids_delete'), style: 'destructive', onPress: () => removeChild(child) },
    ]);
  };

  const adjustStars = async () => {
    if (!activeChild) return;
    const amount = parseInt(starAmount || '0', 10);
    if (!amount || amount < 1) { showToast(t('kids_valid_amount'), 'error'); return; }

    const delta = starMode === 'add' ? amount : -amount;
    if (stars + delta < 0) { showToast(t('kids_stars_below_zero'), 'error'); return; }

    const reason = starReason.trim();
    if (delta < 0 && !reason) { showToast(t('kids_reason_required'), 'error'); return; }

    // Guard against a double-tap in the frame before `saving` re-renders, the
    // same ref guard quickAdd uses — otherwise both taps hit the $inc and the
    // child is awarded/docked twice.
    if (starActionRef.current) return;
    starActionRef.current = true;
    setSaving(true);
    try {
      const result = await api.adjustMemberStars(activeChild.member_id, { delta, reason: reason || (delta > 0 ? t('kids_parent_added_stars') : t('kids_parent_removed_stars')) });
      setMembers((prev) => prev.map((member) => (member.member_id === result.member.member_id ? result.member : member)));
      setShowStarSheet(false);
      showToast(delta > 0 ? `${t('kids_added')} ${amount} ${t('stars')}.` : `${t('kids_removed')} ${amount} ${t('stars')}.`, 'success');
      if (delta > 0) setCelebration({ kind: 'stars', amount });
      await refreshHistory(activeChild.member_id);
    } catch (e: any) {
      logger.warn('Adjust stars failed:', e?.message || e);
      showToast(e?.message || t('kids_update_stars_error'), 'error');
    } finally {
      setSaving(false);
      starActionRef.current = false;
    }
  };

  const quickAdd = async (reason: string, amount: number, chore?: 'bed' | 'read' | 'table') => {
    if (!activeChild) { showToast(t('kids_select_child_first'), 'error'); return; }
    if (starActionRef.current) return;
    starActionRef.current = true;
    try {
      // When a day is selected, the star is credited to THAT day — a parent
      // catching up on Sunday should not have Tuesday's job land on Sunday.
      const result = await api.adjustMemberStars(activeChild.member_id, {
        delta: amount, reason,
        // Via the cell, not the raw state: if the week rolled over while the
        // page sat open, the selected day is no longer in it and the server
        // would reject the award. Falling back to today is the right answer.
        ...(backdateDayCell ? { awarded_for: backdateDayCell.iso } : {}),
      });
      setMembers((prev) => prev.map((member) => (member.member_id === result.member.member_id ? result.member : member)));
      showToast(`${t('kids_added')} ${amount} ${t('stars')} · ${reason}`, 'success');
      setCelebration({ kind: 'stars', amount, chore });
      recordWin();
      await refreshHistory(activeChild.member_id);
    } catch (e: any) {
      logger.warn('Quick add failed:', e?.message || e);
      showToast(e?.message || t('kids_add_stars_error'), 'error');
    } finally {
      starActionRef.current = false;
    }
  };

  /**
   * Cash in a finished week for one of the ideas.
   *
   * Spends nothing. The week is what was earned and the week is what is being
   * spent — the saved balance above is untouched, which is the whole point of
   * keeping a bank and a meter as two different things. The server refuses a
   * second claim in the same week, so a double tap costs nothing either.
   */
  const claimWeek = async (title: string) => {
    if (!activeChild) { showToast(t('kids_select_child_first'), 'error'); return; }
    // Claimable at any point in the week — 50 is the celebration, not the
    // gate. The one rule the button enforces is one treat per week.
    if (weekClaimed || claiming) return;
    setClaiming(true);
    try {
      await api.claimWeeklyTreat(activeChild.member_id, title);
      showToast(t('kids_week_claimed_toast', { title }), 'success');
      setCelebration({ kind: 'reward', title });
      await load();
      await refreshHistory(activeChild.member_id);
    } catch (e: any) {
      logger.warn('Weekly claim failed:', e?.message || e);
      showToast(e?.message || t('kids_update_stars_error'), 'error');
    } finally {
      setClaiming(false);
    }
  };

  /**
   * Change what this child's week is measured against.
   *
   * The goal used to be one number for every household and every age: 50,
   * which is seven perfect days of the three everyday jobs plus the bonus. A
   * ring that only a spotless week fills is a ring that never fills, and a
   * five-year-old and a fifteen-year-old were being held to it equally.
   */
  const saveWeeklyGoal = async () => {
    if (!activeChild) return;
    const target = parseInt(goalValue || '', 10);
    if (Number.isNaN(target) || target < MIN_WEEKLY_TARGET || target > MAX_WEEKLY_TARGET) {
      showToast(t('kids_goal_range', { min: MIN_WEEKLY_TARGET, max: MAX_WEEKLY_TARGET }), 'error');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.updateFamilyMember(activeChild.member_id, { weekly_target: target });
      setMembers((prev) => prev.map((m) => (m.member_id === updated.member_id ? { ...m, ...updated } : m)));
      setShowGoalSheet(false);
      showToast(t('kids_goal_saved', { n: updated.weekly_target || target }), 'success');
    } catch (e: any) {
      logger.warn('Weekly goal save failed:', e?.message || e);
      showToast(e?.message || t('kids_update_stars_error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const fixBalance = async () => {
    if (!activeChild) return;
    const target = parseInt(fixValue || '', 10);
    if (Number.isNaN(target) || target < 0) { showToast(t('kids_valid_amount'), 'error'); return; }
    const delta = target - stars;
    if (delta === 0) { setShowFixSheet(false); return; }
    setSaving(true);
    try {
      const result = await api.adjustMemberStars(activeChild.member_id, { delta, reason: t('kids_balance_correction') });
      setMembers((prev) => prev.map((m) => (m.member_id === result.member.member_id ? result.member : m)));
      setShowFixSheet(false);
      showToast(t('kids_balance_updated'), 'success');
      await refreshHistory(activeChild.member_id);
    } catch (e: any) {
      showToast(e?.message || t('kids_update_stars_error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Pocket money is recorded when it is actually handed over, not accrued on a
  // timer. A balance that says €20 when the tin holds €5 is worse than no
  // tracker, so this is a prompt the parent answers rather than a schedule.
  const payAllowanceNow = useCallback(async () => {
    if (!activeChild || moneySavingRef.current) return;
    moneySavingRef.current = true;
    try {
      const res = await api.payAllowance(activeChild.member_id);
      const nextAllowances = allowances.map((a) =>
        a.member_id === res.allowance.member_id ? res.allowance : a);
      setAllowances(nextAllowances);
      setBalances((prev) => ({
        ...prev,
        [activeChild.member_id]: (prev[activeChild.member_id] || 0) + res.transaction.amount,
      }));
      showToast(t('kids_allowance_paid', { amount: `${t('currency_symbol')}${res.transaction.amount}` }), 'success');
    } catch (e: any) {
      logger.warn('Pay allowance failed:', e?.message || e);
      showToast(e?.message || t('kids_allowance_error'), 'error');
    } finally {
      moneySavingRef.current = false;
    }
  }, [activeChild, allowances, showToast, t]);

  const openMoneySheet = useCallback(async () => {
    if (!activeChild) return;
    setMoneyAmount('');
    setMoneyNote('');
    setShowMoneySheet(true);
    setMoneyLoading(true);
    try {
      setMoneyTxns(await api.allowanceTransactions(activeChild.member_id));
    } catch (e: any) {
      logger.warn('Load pocket money failed:', e?.message || e);
      setMoneyTxns([]);
    } finally {
      setMoneyLoading(false);
    }
  }, [activeChild]);

  const recordMoney = useCallback(async (type: 'deposit' | 'withdrawal') => {
    if (!activeChild) return;
    const amount = Number((moneyAmount || '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (moneySavingRef.current) return;
    moneySavingRef.current = true;
    try {
      const txn = await api.addAllowanceTxn({
        member_id: activeChild.member_id,
        amount,
        description: moneyNote.trim() || (type === 'deposit' ? t('kids_money_in') : t('kids_money_out')),
        txn_type: type,
      });
      setMoneyTxns((prev) => [txn, ...prev]);
      setMoneyAmount('');
      setMoneyNote('');
      // Re-derive from the server rather than adding locally, so the figure on
      // screen is always the one the backend computes.
      const b = await api.allowanceBalance(activeChild.member_id).catch(() => null);
      if (b) setBalances((prev) => ({ ...prev, [activeChild.member_id]: b.balance }));
      showToast(t('kids_money_saved'), 'success');
    } catch (e: any) {
      logger.warn('Record pocket money failed:', e?.message || e);
      showToast(e?.message || t('kids_allowance_error'), 'error');
    } finally {
      moneySavingRef.current = false;
    }
  }, [activeChild, moneyAmount, moneyNote, showToast, t]);

  const saveAllowance = async () => {
    if (!activeChild) return;
    const amount = parseInt(alwAmount || '', 10);
    if (Number.isNaN(amount) || amount < 0) { showToast(t('kids_valid_amount'), 'error'); return; }
    setSaving(true);
    try {
      const saved = await api.setAllowance({ member_id: activeChild.member_id, amount, frequency: alwFrequency });
      setAllowances((prev) => [...prev.filter((a) => a.member_id !== saved.member_id), saved]);
      setShowAllowanceSheet(false);
      showToast(t('kids_allowance_saved'), 'success');
    } catch (e: any) {
      logger.warn('Save allowance failed:', e?.message || e);
      showToast(e?.message || t('kids_allowance_error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // One-off task for the child in front of you, without leaving the page.
  // The Feed's add form always could assign to a kid; nobody found it from
  // here. Completing the task awards the child 5 stars server-side.
  const [showAssignTask, setShowAssignTask] = useState(false);
  const [assignTitle, setAssignTitle] = useState('');
  const [assigningTask, setAssigningTask] = useState(false);
  // Default: due today at 18:00 — a dated task shows on the calendar and
  // fires a reminder an hour before; an undated one is just a wish.
  const [assignDue, setAssignDue] = useState<string | null>(null);
  const [showAssignDuePicker, setShowAssignDuePicker] = useState(false);

  // Plain function on purpose: the React Compiler memoizes it itself, and a
  // manual useCallback here made it skip the whole component.
  const openAssignTask = () => {
    setAssignTitle('');
    setAssignDue(quickDueDate('today'));
    setShowAssignTask(true);
  };

  const assignTask = async () => {
    const title = assignTitle.trim();
    if (!title || !activeChild || assigningTask) return;
    setAssigningTask(true);
    try {
      await api.createCard({
        type: 'TASK', title, assignee: activeChild.name, shared: true,
        due_date: assignDue, reminder_minutes: 60,
      });
      setShowAssignTask(false);
      setAssignTitle('');
      showToast(t('kids_task_assigned', { name: activeChild.name }), 'success');
    } catch (e: any) {
      showToast(e?.message || t('vault_could_not_add_meal'), 'error');
    } finally {
      setAssigningTask(false);
    }
  };

  // Marking a reward as handed over. The row leaves the list immediately —
  // the server has the final word, so a failure puts it back rather than
  // leaving the parent staring at a row that is already settled.
  const markGiven = useCallback(async (redemption: Redemption) => {
    const id = redemption.redemption_id;
    if (settlingIdsRef.current.has(id)) return;
    settlingIdsRef.current.add(id);
    settledIdsRef.current.add(id);
    addedIdsRef.current.delete(id);
    setRedemptions((prev) => prev.filter((r) => r.redemption_id !== id));
    try {
      await api.fulfilRedemption(id);
      showToast(t('kids_redemption_given_toast', { title: redemption.reward_title }), 'success');
    } catch (e: any) {
      logger.warn('Mark redemption given failed:', e?.message || e);
      // Already settled by the other parent: the row is right to be gone, and
      // putting it back would give this device a button that can never work.
      if (isAlreadySettled(e)) {
        showToast(t('kids_redemption_already_settled'), 'info');
      } else {
        settledIdsRef.current.delete(id);
        setRedemptions((prev) => restoreRedemption(prev, redemption));
        showToast(t('kids_redemption_error'), 'error');
      }
    } finally {
      settlingIdsRef.current.delete(id);
    }
  }, [showToast, t]);

  // Sometimes the cinema is sold out. Returning the stars is the honest
  // answer; quietly marking it given is not.
  const refundRedemption = useCallback(async (redemption: Redemption) => {
    const id = redemption.redemption_id;
    if (settlingIdsRef.current.has(id)) return;
    settlingIdsRef.current.add(id);
    settledIdsRef.current.add(id);
    addedIdsRef.current.delete(id);
    setRedemptions((prev) => prev.filter((r) => r.redemption_id !== id));
    try {
      const res = await api.cancelRedemption(id);
      if (res.member) setMembers((prev) => prev.map((m) => (m.member_id === res.member!.member_id ? res.member! : m)));
      // The server declines to credit a child who is no longer there, and says
      // so by returning no ledger entry. Claiming a refund landed when it did
      // not would be worse than saying nothing.
      if (res.transaction) {
        showToast(t('kids_redemption_refunded_toast', { n: redemption.cost_stars }), 'success');
      }
      await refreshHistory(redemption.member_id);
    } catch (e: any) {
      logger.warn('Refund redemption failed:', e?.message || e);
      if (isAlreadySettled(e)) {
        showToast(t('kids_redemption_already_settled'), 'info');
      } else {
        settledIdsRef.current.delete(id);
        setRedemptions((prev) => restoreRedemption(prev, redemption));
        showToast(t('kids_redemption_error'), 'error');
      }
    } finally {
      settlingIdsRef.current.delete(id);
    }
  }, [refreshHistory, showToast, t]);

  const confirmRefund = (redemption: Redemption) => {
    if (Platform.OS === 'web') { refundRedemption(redemption); return; }
    Alert.alert(
      t('kids_redemption_refund'),
      t('kids_redemption_refund_confirm', { title: redemption.reward_title, n: redemption.cost_stars }),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('kids_redemption_refund'), style: 'destructive', onPress: () => refundRedemption(redemption) },
      ],
    );
  };

  // Finishing a chore pays whoever it currently sits with, then hands it on.
  // Kept separate from rotate: rotating is "pass it to the next child", which
  // says nothing about the work being done.
  const completeChore = useCallback(async (choreId: string) => {
    if (choreDoneRef.current) return;
    choreDoneRef.current = true;
    try {
      const res = await api.completeChore(choreId);
      setChores((prev) => prev.map((c) => (c.chore_id === choreId ? res.chore : c)));
      if (res.stars_awarded > 0) {
        // Reflect the new balance and the ledger entry the award just wrote.
        await load();
        showToast(
          t('kids_stars_earned', { n: res.stars_awarded, name: memberName(res.member_id || '') }),
          'success',
        );
      } else {
        showToast(t('kids_chore_rotated'), 'success');
      }
    } catch {
      showToast(t('kids_chore_done_error'), 'error');
    } finally {
      choreDoneRef.current = false;
    }
  }, [load, memberName, showToast, t]);

  const rotateChore = useCallback(async (choreId: string) => {
    try {
      const updated = await api.rotateChore(choreId);
      setChores((prev) => prev.map((c) => c.chore_id === choreId ? updated : c));
      showToast(t('kids_chore_rotated'), 'success');
    } catch { showToast(t('kids_rotate_chore_error'), 'error'); }
  }, [showToast]);

  // ---- Morning routines ---------------------------------------------------
  //
  // The third feature in this family that could be run and deleted but never
  // created. Listing, logging and deleting were wired; createRoutine was not,
  // and the section only rendered once a routine existed — so nobody without
  // one could ever get a first.

  const openRoutineSheet = useCallback(() => {
    setRoutineName('');
    setRoutineStars('2');
    // One empty step, so the shape of the thing is visible before anything is
    // typed. An empty list reads as a broken sheet.
    setRoutineSteps([{ label: '', minutes: '5' }]);
    setShowRoutineSheet(true);
  }, []);

  const applyRoutinePreset = useCallback((preset: typeof ROUTINE_PRESETS[number]) => {
    setRoutineName(t(preset.nameKey));
    setRoutineSteps(preset.steps.map((step) => ({
      label: t(step.labelKey), minutes: String(step.minutes),
    })));
  }, [t]);

  const createRoutine = useCallback(async () => {
    if (!activeChild) return;
    const name = routineName.trim();
    if (!name) { showToast(t('kids_routine_name_required'), 'error'); return; }
    // A blank row is somebody who added a step and changed their mind, not an
    // error worth stopping for. A routine of nothing but blanks is.
    const steps = routineSteps
      .map((step) => ({
        label: step.label.trim(),
        duration_seconds: Math.max(1, parseInt(step.minutes || '0', 10) || 1) * 60,
      }))
      .filter((step) => step.label.length > 0);
    if (steps.length === 0) { showToast(t('kids_routine_steps_required'), 'error'); return; }

    setSaving(true);
    try {
      const created = await api.createRoutine({
        name,
        steps,
        member_id: activeChild.member_id,
        star_reward: Math.max(0, parseInt(routineStars || '0', 10) || 0),
      });
      setRoutines((prev) => [...prev, created]);
      setShowRoutineSheet(false);
      showToast(t('kids_routine_added', { name: created.name }), 'success');
    } catch (e: any) {
      logger.warn('Create routine failed:', e?.message || e);
      showToast(e?.message || t('kids_routine_add_error'), 'error');
    } finally {
      setSaving(false);
    }
  }, [activeChild, routineName, routineStars, routineSteps, showToast, t]);

  /**
   * Open the "add a chore" sheet, with the child whose page this is already
   * ticked. A chore reached from a child's page is nearly always for them.
   */
  const openChoreSheet = useCallback(() => {
    setChoreTitle('');
    setChoreStars('3');
    setChoreWeekly(false);
    setChoreMembers(activeChild ? [activeChild.member_id] : []);
    setShowChoreSheet(true);
  }, [activeChild]);

  /**
   * The missing half of the Chore Wheel.
   *
   * Listing, finishing, rotating and deleting were all wired; creating never
   * was. The wheel only rendered when a chore already existed, so a household
   * with none saw nothing at all and had no way to change that — a feature
   * that could only ever be emptied.
   */
  const createChore = useCallback(async () => {
    const title = choreTitle.trim();
    if (!title) { showToast(t('kids_chore_title_required'), 'error'); return; }
    const stars = Math.max(0, parseInt(choreStars || '0', 10) || 0);
    if (choreMembers.length === 0) { showToast(t('kids_chore_who_required'), 'error'); return; }
    setSaving(true);
    try {
      const created = await api.createChore({
        title,
        frequency: choreWeekly ? 'weekly' : 'daily',
        assigned_members: choreMembers,
        // Rotating between one person is just that person, and the wheel hides
        // the rotate control in that case anyway.
        rotate: choreMembers.length > 1,
        star_reward: stars,
      });
      setChores((prev) => [...prev, created]);
      setShowChoreSheet(false);
      showToast(t('kids_chore_added', { title: created.title }), 'success');
    } catch (e: any) {
      logger.warn('Create chore failed:', e?.message || e);
      showToast(e?.message || t('kids_chore_add_error'), 'error');
    } finally {
      setSaving(false);
    }
  }, [choreTitle, choreStars, choreWeekly, choreMembers, showToast, t]);

  // ---- Saved-up rewards ---------------------------------------------------
  //
  // The week card above is one currency: fill the week, pick a treat, pay
  // nothing. This is the other: a priced thing a child saves the BANK for over
  // weeks. Both existed on the server the whole time; only the week had a
  // screen, so a household could see "4 rewards" counted on the Feed and had
  // nowhere to look at them, let alone add one.

  const openRewardSheet = useCallback((reward?: Reward) => {
    setEditingReward(reward || null);
    setRewardTitle(reward?.title || '');
    setRewardCost(String(reward?.cost_stars ?? 20));
    setRewardIcon(reward?.icon || DEFAULT_REWARD_ICON);
    setShowRewardSheet(true);
  }, []);

  const saveReward = useCallback(async () => {
    const title = rewardTitle.trim();
    if (!title) { showToast(t('kids_reward_title_required'), 'error'); return; }
    const cost = parseInt(rewardCost || '0', 10);
    if (!cost || cost < 1) { showToast(t('kids_valid_amount'), 'error'); return; }
    setSaving(true);
    try {
      const icon = rewardIcon.trim() || DEFAULT_REWARD_ICON;
      if (editingReward) {
        const updated = await api.updateReward(editingReward.reward_id, { title, cost_stars: cost, icon });
        setRewards((prev) => prev.map((r) => (r.reward_id === updated.reward_id ? updated : r)));
      } else {
        const created = await api.createReward({ title, cost_stars: cost, icon });
        setRewards((prev) => [...prev, created]);
      }
      setShowRewardSheet(false);
      showToast(t('kids_reward_saved', { title }), 'success');
    } catch (e: any) {
      logger.warn('Save reward failed:', e?.message || e);
      showToast(e?.message || t('kids_reward_save_error'), 'error');
    } finally {
      setSaving(false);
    }
  }, [rewardTitle, rewardCost, rewardIcon, editingReward, showToast, t]);

  const removeReward = useCallback((reward: Reward) => {
    const go = async () => {
      // Optimistic: the row is gone from the screen before the round trip, and
      // put back if the server refuses. Deleting a reward takes nothing from
      // anyone — stars already spent on it stay spent, in the ledger.
      setRewards((prev) => prev.filter((r) => r.reward_id !== reward.reward_id));
      try {
        await api.deleteReward(reward.reward_id);
      } catch (e: any) {
        setRewards((prev) => [...prev, reward]);
        showToast(e?.message || t('kids_reward_save_error'), 'error');
      }
    };
    const title = t('kids_reward_delete_q', { title: reward.title });
    if (Platform.OS === 'web') { if (webConfirm(title)) go(); return; }
    Alert.alert(title, '', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('kids_delete'), style: 'destructive', onPress: go },
    ]);
  }, [showToast, t]);

  /**
   * Spend the bank on a saved-up reward.
   *
   * The week meter is untouched — that is the server's rule, not a display
   * choice: savings and the week are two different things, and cashing one in
   * must not empty the other.
   */
  const redeemReward = useCallback(async (reward: Reward) => {
    if (!activeChild) { showToast(t('kids_select_child_first'), 'error'); return; }
    if (starActionRef.current) return;
    starActionRef.current = true;
    try {
      const res = await api.redeemReward(reward.reward_id, activeChild.member_id);
      setMembers((prev) => prev.map((m) => (m.member_id === res.member.member_id ? res.member : m)));
      if (res.redemption) {
        setRedemptions((prev) => [res.redemption as Redemption, ...prev]);
        addedIdsRef.current.add(res.redemption.redemption_id);
      }
      showToast(t('kids_reward_redeemed', { title: reward.title }), 'success');
      setCelebration({ kind: 'reward', title: reward.title });
      await refreshHistory(activeChild.member_id);
    } catch (e: any) {
      logger.warn('Redeem failed:', e?.message || e);
      showToast(e?.message || t('kids_reward_redeem_error'), 'error');
    } finally {
      starActionRef.current = false;
    }
  }, [activeChild, refreshHistory, showToast, t]);

  const deleteChore = useCallback((choreId: string) => {
    Alert.alert(t('kids_delete_chore_q'), t('kids_delete_chore_msg'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('kids_delete'),
        style: 'destructive',
        onPress: async () => {
          setChores((prev) => prev.filter((c) => c.chore_id !== choreId));
          try {
            await api.deleteChore(choreId);
          } catch {
            showToast(t('kids_delete_restored_error'), 'error');
            load();
          }
        },
      },
    ]);
  }, [load, showToast]);

  const deleteRoutine = useCallback((id: string) => {
    Alert.alert(t('kids_delete_routine_q'), t('kids_delete_routine_msg'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('kids_delete'),
        style: 'destructive',
        onPress: async () => {
          setRoutines((prev) => prev.filter((r) => r.routine_id !== id));
          try {
            await api.deleteRoutine(id);
          } catch {
            showToast(t('kids_delete_restored_error'), 'error');
            load();
          }
        },
      },
    ]);
  }, [load, showToast]);

  const logRoutine = useCallback(async (id: string) => {
    if (routineDoneRef.current) return;
    routineDoneRef.current = true;
    try {
      const res = await api.logRoutineCompletion(id);
      if (res.stars_awarded > 0) {
        // Pull the new balance and ledger entry the award just wrote.
        await load();
        showToast(
          t('kids_stars_earned', { n: res.stars_awarded, name: memberName(res.member_id || '') }),
          'success',
        );
      } else {
        showToast(t('kids_routine_completed'), 'success');
      }
    } catch {
      showToast(t('kids_log_routine_error'), 'error');
    } finally {
      routineDoneRef.current = false;
    }
  }, [load, memberName, showToast, t]);

  const childRoutines = useMemo(() => {
    if (!activeChild) return routines;
    return routines.filter((r) => !r.member_id || r.member_id === activeChild.member_id);
  }, [routines, activeChild]);

  const childAllowance = useMemo(() => {
    if (!activeChild) return null;
    return allowances.find((a) => a.member_id === activeChild.member_id) || null;
  }, [allowances, activeChild]);

  const childBalance = activeChild ? (balances[activeChild.member_id] || 0) : 0;

  return (
    <SwipeableTabView style={styles.container}>
      <TabScreen
        tab="Kids"
        refreshing={refreshing}
        onRefresh={handleRefresh}
        scrollViewProps={{ contentContainerStyle: styles.scroll, keyboardShouldPersistTaps: 'handled' }}
      >
          {isFocused && activeChild ? (
            /* Focused on one child — a page header with a back arrow, the
               child's name, and (for a teen) a Message shortcut. A managed kid
               has no inbox, so their Message action launches "give them their
               own account", which is how a child becomes chat-able. */
            <View style={styles.focusHeader}>
              <PressScale testID="child-back" onPress={() => setFocusedChild(null)} style={styles.focusBack} accessibilityLabel={t('back')} hitSlop={6}>
                <ChevronLeft color={ui.text} size={22} />
              </PressScale>
              <Text style={styles.focusTitle} numberOfLines={1}>{activeChild.name}</Text>
              {/* A teen opens their own conversation; a young child opens the
                  note thread a parent writes to them, which they read in kid
                  mode. Either way the button only appears when the server has
                  actually given us a conversation for this person — it used to
                  open the teen invite sheet on a six-year-old, which is how a
                  button that led nowhere got shipped. */}
              {threads.some((x) => x.member_id === activeChild.member_id) ? (
                /* Labelled, not a bare icon in the corner. A pale outlined
                   glyph next to bold orange buttons read as decoration — a
                   parent looking for "can I message my kid?" did not find it.
                   It now says what it does: a note for a young child (they read
                   it in Kid Mode), a message for a teen with their own account. */
                <PressScale testID="child-message" onPress={() => openThread(activeChild)} style={styles.focusMsg} accessibilityLabel={t('hub_tab_chat')} hitSlop={6}>
                  <MessageCircle color="#FFFFFF" size={16} />
                  <Text style={styles.focusMsgText} numberOfLines={1}>
                    {(activeChild.role || '').toLowerCase() === 'teen' ? t('kids_message_short') : t('kids_leave_note')}
                  </Text>
                </PressScale>
              ) : (
                <View style={{ width: 36 }} />
              )}
            </View>
          ) : (
            <ScreenHeader
              eyebrow={t('kids_eyebrow_family')}
              title={t('kids_title')}
              right={
                <PressScale
                  testID="family-manage-members"
                  onPress={() => { requestMembers(); router.push('/(tabs)/settings'); }}
                  accessibilityLabel={t('set_invites')}
                  style={styles.manageBtn}
                >
                  <UserPlus color={ui.orangeText} size={18} />
                  <Text style={styles.manageBtnText}>{t('set_invite')}</Text>
                </PressScale>
              }
            />
          )}

          {/* The grown-ups half of the Family Hub. Everyone who runs the house —
              you, a co-parent (who had no face in the app before this), a helper,
              a named family member — each badged, each a tap from their profile.
              Parents open the shared conversation; a helper opens who-they-are
              (the server refuses them family chat, so no chat door is offered). */}
          {!isFocused && parents.length > 0 ? (
            <View style={styles.hubGrownups}>
              <Text style={styles.hubLabel}>{t('hub_parents')}</Text>
              {parents.map(renderPerson)}
              {children.length > 0 ? <Text style={styles.hubLabel}>{t('hub_kids_teens')}</Text> : null}
            </View>
          ) : null}

          {/* Only once the screen has something to explain — a tip above an
              error or a blank slate is noise. */}
          {!isFocused && !showBlockingError && !loading && children.length > 0 ? (
            <FirstRunTip
              id="kids_stars"
              testID="kids-first-run-tip"
              title={t('kids_tip_title')}
              message={t('kids_tip_msg')}
              icon={<Star color={ui.star} size={20} fill={ui.star} />}
            />
          ) : null}

          {showBlockingError ? (
            <ErrorState title={t('kids_page_unavailable')} message={errorMessage || t('kids_load_error')} onRetry={load} />
          ) : children.length === 0 && !loading ? (
            <EmptyState title={t('kids_no_children')} message={t('kids_no_children_msg')} actionLabel={t('kids_add_child')} onAction={openChildSheet} />
          ) : (
            <>
              {/* Kids & teens — roster cards, one per young person. Tapping a
                  card selects them and reveals their stars / chores / rewards
                  in the detail below (a teen also carries a Message entry
                  inside that detail). The old horizontal chip strip hid the
                  role and the balance behind a tap; a card shows both at rest. */}
              {!isFocused ? (
              <View style={styles.hubKids}>
                {children.map((child, index) => {
                  const active = child.member_id === activeChild?.member_id;
                  const tint = CHILD_TINTS[index % CHILD_TINTS.length];
                  // Outstanding rewards live under one child's card, so without
                  // a mark here a parent with three children would never learn
                  // they still owe the one they aren't looking at.
                  const owed = owedByChild[child.member_id] || 0;
                  const isTeen = child.role?.toLowerCase() === 'teen';
                  return (
                    <PressScale
                      key={child.member_id}
                      testID={`child-${child.member_id}`}
                      onPress={() => openChild(child)}
                      style={[styles.hubRow, active && styles.hubRowActive]}
                    >
                      <View style={[styles.hubAvatar, avatarKind(child.avatar) ? styles.hubAvatarIllus : { backgroundColor: tint }]}>
                        {avatarKind(child.avatar)
                          ? <PersonAvatar name={child.name} avatar={child.avatar} size={44} ring={false} />
                          : <Text style={styles.hubAvatarText}>{child.name[0]?.toUpperCase()}</Text>}
                        {child.has_pin ? <View style={styles.lockBadge}><Lock color={ui.bg} size={8} /></View> : null}
                        {owed > 0 ? (
                          <View
                            testID={`child-owed-${child.member_id}`}
                            accessibilityLabel={t('kids_redemption_owed_badge', { n: owed })}
                            style={styles.owedBadge}
                          >
                            <Text style={styles.owedBadgeText}>{owed}</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={styles.hubNameRow}>
                          <Text style={styles.hubName} numberOfLines={1}>{child.name}</Text>
                          <View style={[styles.hubBadge, { backgroundColor: isTeen ? ui.lavender : ui.mint }]}>
                            <Text style={[styles.hubBadgeText, { color: isTeen ? ui.lavenderText : ui.mintText }]}>
                              {isTeen ? t('hub_role_teen') : t('hub_role_kid')}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.hubSub} numberOfLines={1}>{t('hub_week_earned', { n: child.week_earned || 0 })}</Text>
                      </View>
                      <View style={styles.hubStarChip}>
                        <Star color={ui.mintText} size={13} fill={ui.mintText} />
                        <Text style={styles.hubStarChipText}>{child.stars || 0}</Text>
                      </View>
                    </PressScale>
                  );
                })}
                <PressScale testID="kids-add-child" onPress={openChildSheet} style={[styles.hubRow, styles.hubAddRow]}>
                  <View style={[styles.hubAvatar, { backgroundColor: ui.orangeSoft }]}>
                    <Plus color={ui.orange} size={20} />
                  </View>
                  <Text style={styles.hubAddText}>{t('kids_add_child')}</Text>
                </PressScale>
              </View>
              ) : null}

              {/* New-feature nudge: teens get their own account. Shown once
                  per device and then remembered; showTeenHint already carries
                  the !isFocused gate. */}
              {showTeenHint ? (
              <View style={styles.teenHint}>
                <Text style={styles.teenHintNew}>NEW</Text>
                <Text style={styles.teenHintText}>{t('kids_teen_hint')}</Text>
              </View>
              ) : null}

              {/* Teen tasks waiting for a star — the parent-approval loop */}
              {!isFocused && teenApprovals.length > 0 ? (
                <Card style={styles.approvalsCard}>
                  <Text style={styles.approvalsTitle}>{t('teen_approvals_title')}</Text>
                  <Text style={styles.approvalsSub}>{t('teen_approvals_sub')}</Text>
                  {teenApprovals.map((a) => (
                    <View key={a.card_id} style={styles.approvalRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.approvalTask} numberOfLines={1}>{a.title}</Text>
                        <Text style={styles.approvalWho}>{a.who || a.teen_name}</Text>
                      </View>
                      <PressScale
                        testID={`teen-dismiss-${a.card_id}`}
                        onPress={() => resolveApproval(a.card_id, false)}
                        disabled={approvingId === a.card_id}
                        style={styles.approvalDismiss}
                      >
                        <Text style={styles.approvalDismissText}>{t('teen_dismiss')}</Text>
                      </PressScale>
                      <PressScale
                        testID={`teen-approve-${a.card_id}`}
                        onPress={() => approveWithStars(a.card_id)}
                        disabled={approvingId === a.card_id}
                        style={styles.approvalApprove}
                      >
                        <Star color="#fff" size={14} fill="#fff" />
                        <Text style={styles.approvalApproveText}>{t('teen_approve')}</Text>
                      </PressScale>
                    </View>
                  ))}
                </Card>
              ) : null}

              {isFocused && activeChild ? (
                <>
                  {/* Wallet */}
                  <Card style={styles.walletCard}>
                    <View style={styles.walletRow}>
                    <View style={[styles.walletAvatar, avatarKind(activeChild.avatar) ? styles.walletAvatarIllus : { backgroundColor: ui.orangeSoft }]}>
                      {avatarKind(activeChild.avatar)
                        ? <PersonAvatar name={activeChild.name} avatar={activeChild.avatar} size={52} ring={false} />
                        : <Text style={[styles.walletAvatarText, { color: ui.orangeText }]}>{activeChild.name[0]?.toUpperCase()}</Text>}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      {/* Built from a template, not string concatenation: the
                          English possessive 's has no equivalent in fr/es/de,
                          where it reads "Les étoiles de X". */}
                      <View style={styles.walletLabelRow}>
                        <Text style={styles.walletLabel} numberOfLines={1}>{t('kids_childs_stars', { name: activeChild.name })}</Text>
                        {/* Beside the name, because it manages the child. The
                            pencil below sits beside the balance, because that
                            is what it corrects. */}
                        <PressScale
                          testID="kids-manage-child"
                          accessibilityRole="button"
                          accessibilityLabel={t('kids_manage_child')}
                          onPress={openManageSheet}
                          hitSlop={8}
                          style={styles.managePill}
                        >
                          <MoreHorizontal color={ui.text} size={14} />
                          <Text style={styles.managePillText} numberOfLines={1}>{t('hub_manage')}</Text>
                        </PressScale>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Star color={'#E8A93B'} size={20} fill={'#E8A93B'} />
                        <Text style={styles.walletCount}>{stars}</Text>
                        <PressScale
                          testID="kids-fix-balance"
                          onPress={() => { setFixValue(String(stars)); setShowFixSheet(true); }}
                          accessibilityLabel={t('kids_fix_balance')}
                          hitSlop={12} style={{ padding: 4 }}
                        >
                          <Pencil color={ui.muted} size={14} />
                        </PressScale>
                      </View>
                    </View>
                    {/* Redeem steps back once the week is won.
                        It is the highest-contrast element on the screen and it
                        only changes tab, while "Cash in" — the payoff the whole
                        weekly rhythm exists to produce — is a smaller pill a
                        card below. When the treat is actually earned, the eye
                        should land on the treat. */}
                    <PressScale
                      testID="kids-redeem"
                      onPress={() => setKidsTab('rewards')}
                      style={styles.redeemBtn}
                    >
                      <Text style={styles.redeemText}>{t('redeem')}</Text>
                    </PressScale>
                    </View>
                    {/* Give them their own account — inside the wallet, one clear
                        divider below Redeem, and only for a managed child (a teen
                        already has an account). */}
                    {activeChild.role?.toLowerCase() !== 'teen' ? (
                      <PressScale
                        testID="kids-give-account"
                        accessibilityRole="button"
                        onPress={openTeenInvite}
                        style={styles.giveAccountRow}
                      >
                        <Text style={styles.giveAccountText}>{t('teen_invite_title')}</Text>
                        <ChevronRight color={ui.muted} size={16} />
                      </PressScale>
                    ) : null}
                  </Card>
                  {/* The daily two, in the order a parent reaches for them. */}
                  <Text style={styles.leadLabel}>{t('hub_give_stars')}</Text>
                  <View style={styles.leadRow}>
                    {[1, 3, 5].map((n) => (
                      <PressScale
                        key={n}
                        testID={`kids-give-${n}`}
                        onPress={() => quickAdd(t('kids_parent_added_stars'), n)}
                        style={styles.leadStar}
                      >
                        <Star color="#fff" size={15} fill="#fff" />
                        <Text style={styles.leadStarText}>+{n}</Text>
                      </PressScale>
                    ))}
                    {/* The one a household actually needs most days: a job that
                        is not on any list. Everything above awards a number
                        with no task attached, and the three fixed jobs below
                        cover bed, reading and the table — so "she cleared out
                        the garage" had nowhere to go but a tab two screens
                        away that nobody found. */}
                    <PressScale
                      testID="kids-give-other"
                      accessibilityRole="button"
                      onPress={() => openStarSheet('add', '')}
                      style={[styles.leadStar, styles.leadStarOther]}
                    >
                      <Plus color={ui.orangeText} size={15} />
                      <Text style={[styles.leadStarText, { color: ui.orangeText }]}>{t('kids_other')}</Text>
                    </PressScale>
                  </View>
                  {/* The other half of the same conversation, and deliberately
                      the quieter half: giving is the point, taking back is the
                      exception. It existed already, three taps deep behind the
                      Stars tab, which is the same as not existing. */}
                  <PressScale
                    testID="kids-take-back"
                    accessibilityRole="button"
                    onPress={() => openStarSheet('remove', '')}
                    style={styles.takeBackRow}
                  >
                    <Minus color={ui.muted} size={14} />
                    <Text style={styles.takeBackText}>{t('kids_remove_stars')}</Text>
                  </PressScale>

                  <Text style={styles.leadLabel}>{t('kids_today')}</Text>
                  {QUICK_ADDS.map((q) => (
                    <PressScale
                      key={q.labelKey}
                      testID={`kids-today-${q.labelKey}`}
                      onPress={() => quickAdd(t(q.labelKey), q.amount, q.chore)}
                      style={styles.todayRow}
                    >
                      <View style={[styles.todayIcon, { backgroundColor: q.bg }]}>
                        <q.Icon color={q.tint} size={16} />
                      </View>
                      <Text style={styles.todayText}>{t(q.labelKey)}</Text>
                      <Text style={styles.todayVal}>+{q.amount}★</Text>
                    </PressScale>
                  ))}

                  {/* Everything else, one row away — not deleted. */}
                  <PressScale
                    testID="kids-show-more"
                    onPress={() => setShowMore((v) => !v)}
                    style={styles.moreRow}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.moreTitle}>{t('kids_more_for', { name: activeChild.name })}</Text>
                      <Text style={styles.moreSub} numberOfLines={1}>{t('kids_more_sub')}</Text>
                    </View>
                    <ChevronRight color={ui.muted} size={18} style={{ transform: [{ rotate: showMore ? '90deg' : '0deg' }] }} />
                  </PressScale>

                  {showMore ? (<>
                  <PressScale
                    testID="kids-assign-task"
                    accessibilityRole="button"
                    onPress={openAssignTask}
                    style={styles.assignTaskBtn}
                  >
                    <Plus color={ui.orange} size={15} />
                    <Text style={styles.assignTaskText}>{t('kids_assign_task', { name: activeChild.name })}</Text>
                  </PressScale>
                  {/* This week: the meter that gates the weekend treat. The
                      saved bank sits in the card above; this is the fresh run
                      at a weekend payoff that resets each Monday. */}
                  <Card style={styles.weekCard}>
                    <View style={styles.weekTop}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.weekLabel}>{t('kids_this_week')}</Text>
                        <Text style={styles.weekNum}>
                          {weekEarned} <Text style={styles.weekNumUnit}>{t('kids_stars_earned_unit')}</Text>
                        </Text>
                      </View>
                      {weekClaimed ? (
                        <View style={styles.weekClaimedTag}>
                          <Text style={styles.weekClaimedTagText}>{t('kids_week_claimed')}</Text>
                        </View>
                      ) : (
                        /* A treat is always available to claim — reaching 50
                           is a bonus, not the price. The pill just sends the
                           parent to the ideas below; choosing one together is
                           the part a child remembers. */
                        <PressScale
                          testID="kids-claim-week"
                          onPress={() => { setKidsTab('rewards'); showToast(t('kids_claim_pick_idea'), 'success'); }}
                          style={[styles.cashInBtn, !weekFull && styles.cashInBtnSoft]}
                        >
                          <Text style={[styles.cashInText, !weekFull && styles.cashInTextSoft]}>{t('kids_claim_week')}</Text>
                        </PressScale>
                      )}
                    </View>

                    {/* One meter, one target. A weekend goal used to be able to
                        replace this with its own price — the same treat costed
                        two ways inside the page's most prominent card, which is
                        the confusion the whole redesign exists to remove. */}
                      <View style={styles.weekGoalWrap}>
                        <PressScale
                          testID="kids-edit-goal"
                          accessibilityRole="button"
                          accessibilityLabel={t('kids_goal_edit')}
                          onPress={() => { setGoalValue(String(weeklyTarget)); setShowGoalSheet(true); }}
                          style={styles.weekGoalRow}
                        >
                          <Text style={styles.weekGoalTitle} numberOfLines={1}>{t('kids_week_target_title')}</Text>
                          <Text style={styles.weekGoalCount}>{weekEarned} / {weeklyTarget}</Text>
                          <Pencil color={ui.muted} size={13} />
                        </PressScale>
                        <View style={{ marginTop: 8 }}>
                          <ProgressBar
                            pct={Math.min(100, Math.round((weekEarned / weeklyTarget) * 100))}
                            color={weekFull ? ui.mintText : ui.orange}
                          />
                        </View>
                        <Text style={styles.weekGoalHint}>
                          {weekClaimed
                            ? t('kids_week_claimed_hint')
                            : weekFull
                              ? t('kids_week_target_done')
                              : t('kids_week_target_soft', { n: weeklyTarget - weekEarned })}
                        </Text>
                      </View>

                    {/* Momentum, at a glance: one cell per day of the week,
                        filling in as stars are earned. A child reads their own
                        run without reading a number. Built from the star ledger
                        already loaded for this child — no extra request. */}
                    <View style={styles.weekDays}>
                      {weekDayCells.map((d) => {
                        const picked = backdateDay === d.iso;
                        return (
                        <PressScale
                          key={d.key}
                          testID={`week-day-${d.key}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${d.name} — ${d.earned}`}
                          disabled={d.isFuture}
                          onPress={() => setBackdateDay(picked || d.isToday ? null : d.iso)}
                          style={[
                            styles.weekDay,
                            d.earned > 0 && styles.weekDayDone,
                            d.isToday && styles.weekDayToday,
                            picked && styles.weekDayPicked,
                            d.isFuture && styles.weekDayFuture,
                          ]}
                        >
                          <Text
                            style={[
                              styles.weekDayMark,
                              d.earned > 0 && styles.weekDayMarkDone,
                              d.isToday && styles.weekDayMarkToday,
                              picked && styles.weekDayMarkPicked,
                            ]}
                          >
                            {/* A finished day just needs to read as "done"; the
                                running count only matters for today, and a tick
                                keeps the row calm however big a day was. A day
                                a parent has selected shows its number, because
                                that is the number they are about to change. */}
                            {d.earned <= 0
                              ? '·'
                              : d.isToday || picked
                                ? (d.earned > 99 ? '99+' : d.earned)
                                : '✓'}
                          </Text>
                          <Text
                            style={[
                              styles.weekDayLetter,
                              d.isToday && styles.weekDayLetterToday,
                              picked && styles.weekDayLetterPicked,
                            ]}
                          >
                            {d.letter}
                          </Text>
                        </PressScale>
                        );
                      })}
                    </View>

                    {/* Catching up. A parent who forgot Tuesday taps Tuesday and
                        the quick jobs land there instead of today — otherwise
                        a missed day stays missed and the week can never fill,
                        which is the one thing that makes the meter feel rigged. */}
                    <Text style={styles.weekDayHint}>
                      {backdateDayCell
                        ? t('kids_backdate_on', { day: backdateDayCell.name })
                        : t('kids_backdate_hint')}
                    </Text>

                    {/* Says the quiet part out loud. The card counts a week that
                        starts over, sitting under a balance that does not — and
                        nothing on screen said so, which is exactly the anxiety
                        the soft-weekly design existed to avoid. Saving is the
                        same one balance, so this states the rule rather than
                        printing the number a second time as a "saved bank". */}
                    <Text style={styles.weekResetNote}>{t('kids_week_resets_note')}</Text>
                  </Card>

                  {/* Tabs */}
                  <View style={styles.tabRow}>
                    {(['rewards', 'stars', 'history'] as const).map((tab) => (
                      <PressScale key={tab} testID={`kids-tab-${tab}`} onPress={() => { setKidsTab(tab); if (tab === 'history' && activeChild) refreshHistory(activeChild.member_id); }} style={[styles.tabBtn, kidsTab === tab && { borderBottomColor: ui.orange }]}>
                        <Text style={[styles.tabText, { color: kidsTab === tab ? ui.text : ui.muted, fontFamily: kidsTab === tab ? 'Inter_800ExtraBold' : 'Inter_600SemiBold' }]}>
                          {tab === 'rewards' ? t('kids_tab_rewards') : tab === 'stars' ? t('kids_tab_stars') : t('kids_tab_history')}
                        </Text>
                      </PressScale>
                    ))}
                  </View>

                  {/* Rewards tab */}
                  {kidsTab === 'rewards' && (
                    <>
                      {/* Owed, not yet given. Hidden when there is nothing
                          outstanding, so it reads as a reminder rather than
                          another empty box. */}
                      {pendingRedemptions.length > 0 && (
                        <>
                          <Text style={[styles.blockTitle, styles.pendingHead]}>{t('kids_redemptions_pending')}</Text>
                          <Card style={styles.cardPad}>
                            {pendingRedemptions.map((r, index, arr) => (
                              <View key={r.redemption_id} style={[styles.rewardRow, index < arr.length - 1 && styles.rewardRowBorder]}>
                                <IconTile bg={ui.orangeSoft} size={42} radius={13}>
                                  <Text style={styles.rewardEmoji}>{r.reward_icon || DEFAULT_REWARD_ICON}</Text>
                                </IconTile>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <Text style={styles.pendingTitle} numberOfLines={1}>{r.reward_title}</Text>
                                  <Text style={styles.pendingMeta} numberOfLines={1}>
                                    {t('kids_redemption_paid', { n: r.cost_stars })}
                                  </Text>
                                </View>
                                <PressScale
                                  accessibilityRole="button"
                                  accessibilityLabel={t('kids_redemption_refund')}
                                  testID={`refund-redemption-${r.redemption_id}`}
                                  onPress={() => confirmRefund(r)}
                                  hitSlop={8}
                                  style={styles.rewardEdit}
                                >
                                  <RotateCcw color={ui.muted} size={14} />
                                </PressScale>
                                <PressScale
                                  accessibilityRole="button"
                                  testID={`give-redemption-${r.redemption_id}`}
                                  onPress={() => markGiven(r)}
                                  style={styles.rewardRedeem}
                                >
                                  <Text style={styles.rewardRedeemText}>{t('kids_redemption_given')}</Text>
                                </PressScale>
                              </View>
                            ))}
                          </Card>
                        </>
                      )}

                      <View style={styles.quickAddHead}>
                        <Text style={styles.blockLabel}>{t('kids_quick_add')}</Text>
                        <Text style={styles.quickAddDay}>{t('kids_quick_add_day', { n: QUICK_ADD_DAY })}</Text>
                      </View>
                      <View style={styles.quickAddRow}>
                        {QUICK_ADDS.map((q) => (
                          <PressScale key={q.labelKey} testID={`quick-add-${q.labelKey}`} onPress={() => quickAdd(t(q.labelKey), q.amount, q.chore)} style={styles.quickAddChip}>
                            <IconTile bg={q.bg} size={30} radius={9}><q.Icon color={q.tint} size={15} /></IconTile>
                            <Text style={styles.quickAddText} numberOfLines={1}>{t(q.labelKey)}</Text>
                            <Text style={styles.quickAddAmt}>+{q.amount}</Text>
                          </PressScale>
                        ))}
                      </View>
                      {/* The sum, stated. All three jobs come to 7 a day and
                          seven of those to 49 — the last star is the full-week
                          bonus. That arithmetic was true from the start and
                          written down nowhere, so the target looked arbitrary:
                          you could do everything, every day, and have no way
                          to know it added up. */}
                      <Text style={styles.quickAddMaths}>
                        {t('kids_quick_add_maths', {
                          day: QUICK_ADD_DAY,
                          week: QUICK_ADD_DAY * 7,
                          target: weeklyTarget,
                        })}
                      </Text>

                      {/* Ideas first, because for most families this is now the
                          whole reward system: fill the week, pick one. No star
                          prices — the week above is the price. The saved-up
                          list below still exists for families who built one,
                          and is simply not shown to families who never did. */}
                      <View style={styles.blockHead}>
                        <Text style={styles.blockTitle}>{t('kids_reward_ideas')}</Text>
                      </View>
                      <Card style={styles.ideaCard}>
                        <Text style={styles.ideaLead}>
                          {weekClaimed
                            ? t('kids_reward_ideas_claimed')
                            : weekFull
                              ? t('kids_reward_ideas_ready')
                              : t('kids_reward_ideas_anytime')}
                        </Text>
                        <View style={styles.ideaWrap}>
                          {REWARD_IDEAS.map((idea) => (
                            <PressScale
                              key={idea.titleKey}
                              testID={idea.titleKey}
                              accessibilityRole="button"
                              disabled={claiming || weekClaimed}
                              onPress={() => claimWeek(t(idea.titleKey))}
                              style={[styles.ideaChip, !weekClaimed && styles.ideaChipReady]}
                            >
                              <Text style={styles.ideaEmoji}>{idea.icon}</Text>
                              <Text style={styles.ideaTitle} numberOfLines={1}>{t(idea.titleKey)}</Text>
                            </PressScale>
                          ))}
                        </View>
                      </Card>

                      {/* Saved up for — the other currency, back with a way in.
                          The week above is free: fill it, pick a treat. This is
                          the bank: a priced thing worth saving weeks for. Two
                          prices for one treat was the original confusion, so
                          they are two lists with two headings and the cost only
                          ever appears on this one. It was taken out entirely
                          when the week became the main currency, which left the
                          Feed counting "4 rewards" against a screen that had
                          stopped existing — and a new household could never
                          make a first one. */}
                      <View style={styles.blockHead}>
                        <Text style={styles.blockTitle}>{t('kids_saved_up_for')}</Text>
                        <PressScale
                          testID="kids-add-reward"
                          accessibilityRole="button"
                          onPress={() => openRewardSheet()}
                          style={styles.featureHeaderBtn}
                        >
                          <Plus color={ui.orangeText} size={14} />
                          <Text style={[styles.featureHeaderBtnText, { color: ui.orangeText }]}>{t('kids_add_reward')}</Text>
                        </PressScale>
                      </View>
                      <Card style={styles.cardPad}>
                        {rewards.length === 0 ? (
                          <Text style={styles.featureEmpty}>{t('kids_rewards_empty')}</Text>
                        ) : rewards.map((reward, index, arr) => {
                          const affordable = stars >= reward.cost_stars;
                          return (
                            <View
                              key={reward.reward_id}
                              style={[styles.rewardRow, index < arr.length - 1 && styles.rewardRowBorder]}
                            >
                              <IconTile bg={ui.orangeSoft} size={42} radius={13}>
                                <Text style={styles.rewardEmoji}>{reward.icon || DEFAULT_REWARD_ICON}</Text>
                              </IconTile>
                              <PressScale
                                accessibilityRole="button"
                                accessibilityLabel={t('kids_reward_edit', { title: reward.title })}
                                testID={`reward-edit-${reward.reward_id}`}
                                onPress={() => openRewardSheet(reward)}
                                style={{ flex: 1, minWidth: 0 }}
                              >
                                <Text style={styles.pendingTitle} numberOfLines={1}>{reward.title}</Text>
                                <Text style={styles.pendingMeta} numberOfLines={1}>
                                  {/* What it costs, and — when they cannot yet
                                      afford it — how far off they are. A price
                                      alone makes a child do the subtraction. */}
                                  {affordable
                                    ? t('kids_reward_cost', { n: reward.cost_stars })
                                    : t('kids_reward_short_by', { n: reward.cost_stars - stars })}
                                </Text>
                              </PressScale>
                              <PressScale
                                testID={`reward-redeem-${reward.reward_id}`}
                                accessibilityRole="button"
                                disabled={!affordable}
                                onPress={() => redeemReward(reward)}
                                style={[styles.featureActionBtn, { backgroundColor: ui.orange }, !affordable && { opacity: 0.4 }]}
                              >
                                <Text style={styles.featureActionText}>{t('kids_reward_redeem')}</Text>
                              </PressScale>
                              <PressScale
                                accessibilityRole="button"
                                accessibilityLabel={t('a11y_delete')}
                                testID={`reward-delete-${reward.reward_id}`}
                                onPress={() => removeReward(reward)}
                                style={styles.featureIconBtn}
                              >
                                <Trash2 color={ui.muted} size={15} />
                              </PressScale>
                            </View>
                          );
                        })}
                      </Card>
                    </>
                  )}

                  {/* Stars tab */}
                  {kidsTab === 'stars' && (
                    <>
                      <View style={styles.starActions}>
                        <PressScale testID="kids-add-stars" onPress={() => openStarSheet('add', '5')} style={styles.addStarsBtn}>
                          <Plus color={ui.bg} size={16} />
                          <Text style={styles.addStarsText}>{t('kids_add_stars')}</Text>
                        </PressScale>
                        {/* The other half of the same conversation. The sheet,
                            the required reason and the guarded decrement all
                            already existed — only this way in was missing, so a
                            parent could praise but never answer a bad week.
                            Deliberately the quieter of the two buttons: giving
                            is the point, taking is the exception. */}
                        <PressScale testID="kids-remove-stars" onPress={() => openStarSheet('remove', '5')} style={styles.removeStarsBtn}>
                          <Minus color={ui.muted} size={16} />
                          <Text style={styles.removeStarsText}>{t('kids_remove_stars')}</Text>
                        </PressScale>
                      </View>
                      <View style={styles.quickRow}>
                        {['5', '10', '20'].map((amount) => (
                          <PressScale key={amount} testID={`quick-stars-${amount}`} onPress={() => openStarSheet('add', amount)} style={styles.quickStarBtn}>
                            <Text style={styles.quickStarText}>+{amount}</Text>
                          </PressScale>
                        ))}
                        <PressScale testID="quick-stars-custom" onPress={() => openStarSheet('add', '')} style={[styles.quickStarBtn, { backgroundColor: ui.orangeSoft, borderColor: ui.orange }]}>
                          <Text style={[styles.quickStarText, { color: ui.orangeText }]}>{t('kids_other')}</Text>
                        </PressScale>
                      </View>
                    </>
                  )}

                  {/* History tab */}
                  {kidsTab === 'history' && (
                    <RecentActivity items={historyItems} loading={historyLoading} expanded />
                  )}
                  </>) : null}
                </>
              ) : null}
            </>
          )}

          {/* Helpers — grandparents, childminders, carers. Last on the page and
              in their own group, because a person who helps with the school run
              is not a co-parent and should not read as one. A sibling of the
              children block rather than inside it, so a household with no
              children still shows the people who help with it. */}
          {!isFocused && helpers.length > 0 ? (
            <View style={styles.hubGrownups}>
              <Text style={styles.hubLabel}>{t('hub_helpers')}</Text>
              {helpers.map(renderPerson)}
            </View>
          ) : null}

          {/* Morning Routines — part of the focused child's page, not the roster.
              Ungated for the same reason the Chore Wheel was: it rendered only
              when a routine existed and nothing could create the first one. */}
          {isFocused && showMore && activeChild ? (
            <>
              <View style={styles.featureHeader}>
                <Timer color={ui.lavenderText} size={18} />
                <Text style={styles.featureHeaderText}>{t('kids_morning_routines')}</Text>
                <PressScale
                  testID="kids-add-routine"
                  accessibilityRole="button"
                  onPress={openRoutineSheet}
                  style={styles.featureHeaderBtn}
                >
                  <Plus color={ui.lavenderText} size={14} />
                  <Text style={[styles.featureHeaderBtnText, { color: ui.lavenderText }]}>{t('kids_add_routine')}</Text>
                </PressScale>
              </View>
              <Card style={styles.cardPad}>
                {childRoutines.length === 0 ? (
                  <Text style={styles.featureEmpty}>{t('kids_routines_empty')}</Text>
                ) : null}
                {childRoutines.map((rtn) => (
                  <View key={rtn.routine_id} style={styles.featureRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.featureRowTitle} numberOfLines={1}>{rtn.name}</Text>
                      <Text style={styles.featureRowSub} numberOfLines={1}>
                        {rtn.steps.length} {t('kids_steps')} · {Math.round(rtn.steps.reduce((s, st) => s + (st.duration_seconds || 0), 0) / 60)} {t('kids_min')}
                        {rtn.star_reward ? ` · ${t('kids_worth', { n: rtn.star_reward })}` : ''}
                      </Text>
                    </View>
                    <PressScale onPress={() => logRoutine(rtn.routine_id)} style={styles.featureActionBtn}>
                      <Play color="#FFFFFF" size={14} />
                      <Text style={styles.featureActionText}>{t('kids_done')}</Text>
                    </PressScale>
                    <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} onPress={() => deleteRoutine(rtn.routine_id)} style={{ padding: 4, marginLeft: 6 }}>
                      <Trash2 color={ui.muted} size={15} />
                    </PressScale>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {/* Allowance Tracker */}
          {isFocused && showMore && activeChild ? (
            <>
              <View style={styles.featureHeader}>
                <PiggyBank color={ui.goldText} size={18} />
                <Text style={styles.featureHeaderText}>{t('kids_allowance')}</Text>
                {allowanceLocked ? <LockBadge onPress={() => promptUpgrade('allowance')} /> : null}
              </View>
              <PremiumPreviewBanner />
              <Card style={styles.cardPad}>
                {allowanceLocked ? (
                  <PressScale onPress={() => promptUpgrade('allowance')} style={styles.allowanceRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.featureRowTitle}>{t('kids_track_pocket_money')}</Text>
                      <Text style={styles.featureRowSub}>{t('kids_allowance_plan_note')}</Text>
                    </View>
                  </PressScale>
                ) : (
                  <View style={styles.allowanceRow}>
                    {/* The balance is the way in to recording money — without
                        somewhere to add transactions it stayed at $0.00. */}
                    <PressScale
                      testID="kids-open-money"
                      accessibilityRole="button"
                      accessibilityLabel={t('kids_money_title')}
                      onPress={openMoneySheet}
                      style={{ flex: 1 }}
                    >
                      <Text style={styles.allowanceBalance}>{t('currency_symbol')}{childBalance.toFixed(2)}</Text>
                      <Text style={styles.featureRowSub}>
                        {childAllowance ? `${t('currency_symbol')}${childAllowance.amount}/${t('kids_freq_' + childAllowance.frequency)}` : t('kids_no_allowance_set')}
                      </Text>
                      {/* Setting an amount used to do nothing on its own. This
                          is the line that tells a parent the app is keeping
                          count, and whether anything is owed today. */}
                      {childAllowance ? (
                        <Text style={styles.allowanceDue}>
                          {childAllowance.is_due
                            ? t('kids_allowance_due_now')
                            : t('kids_allowance_due_on', { date: formatDueDate(childAllowance.next_due_at, localeFor(lang)) })}
                        </Text>
                      ) : null}
                    </PressScale>
                    {childAllowance?.is_due ? (
                      <PressScale
                        testID="kids-pay-allowance"
                        onPress={payAllowanceNow}
                        style={styles.payNowBtn}
                      >
                        <Text style={styles.payNowText}>{t('kids_allowance_pay_now')}</Text>
                      </PressScale>
                    ) : null}
                    <PressScale
                      testID="kids-set-allowance"
                      onPress={() => {
                        setAlwAmount(childAllowance ? String(childAllowance.amount) : '');
                        setAlwFrequency(childAllowance?.frequency || 'weekly');
                        setShowAllowanceSheet(true);
                      }}
                      style={styles.featureActionBtn}
                    >
                      <Pencil color="#FFFFFF" size={13} />
                      <Text style={styles.featureActionText}>{t('kids_set_short')}</Text>
                    </PressScale>
                  </View>
                )}
              </Card>
            </>
          ) : null}

          {/* Chore Wheel — part of the focused child's page, not the roster.
              No longer gated on there already being a chore: it used to render
              only when one existed, and nothing anywhere could create one, so a
              household with none saw an empty page and had no way off it. */}
          {isFocused && showMore && activeChild ? (
            <>
              <View style={styles.featureHeader}>
                <RotateCcw color={ui.mintText} size={18} />
                <Text style={styles.featureHeaderText}>{t('kids_chore_wheel')}</Text>
                <PressScale
                  testID="kids-add-chore"
                  accessibilityRole="button"
                  onPress={openChoreSheet}
                  style={styles.featureHeaderBtn}
                >
                  <Plus color={ui.mintText} size={14} />
                  <Text style={[styles.featureHeaderBtnText, { color: ui.mintText }]}>{t('kids_add_chore')}</Text>
                </PressScale>
              </View>
              <Card style={styles.cardPad}>
                {chores.length === 0 ? (
                  <Text style={styles.featureEmpty}>{t('kids_chores_empty')}</Text>
                ) : null}
                {chores.map((chore) => (
                  <View key={chore.chore_id} style={styles.featureRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.featureRowTitle} numberOfLines={1}>{chore.title}</Text>
                      <Text style={styles.featureRowSub} numberOfLines={1}>
                        {chore.current_assignee ? memberName(chore.current_assignee) : t('kids_unassigned')} · {chore.frequency}
                        {chore.star_reward ? ` · ${t('kids_worth', { n: chore.star_reward })}` : ''}
                      </Text>
                    </View>
                    {/* Done pays whoever has it and then passes it on; Rotate
                        just passes it on. Both are useful — a chore can change
                        hands without anyone having finished it. */}
                    <PressScale
                      testID={`chore-done-${chore.chore_id}`}
                      accessibilityRole="button"
                      onPress={() => completeChore(chore.chore_id)}
                      style={[styles.featureActionBtn, { backgroundColor: ui.mintText }]}
                    >
                      <Check color="#FFFFFF" size={14} />
                      <Text style={styles.featureActionText}>{t('kids_chore_done')}</Text>
                    </PressScale>
                    {chore.rotate && chore.assigned_members.length > 1 ? (
                      <PressScale
                        accessibilityRole="button"
                        accessibilityLabel={t('kids_rotate')}
                        onPress={() => rotateChore(chore.chore_id)}
                        style={styles.featureIconBtn}
                      >
                        <RotateCcw color={ui.muted} size={16} />
                      </PressScale>
                    ) : null}
                    <PressScale
                      accessibilityRole="button"
                      accessibilityLabel={t('a11y_delete')} onPress={() => deleteChore(chore.chore_id)} style={styles.featureIconBtn}>
                      <Trash2 color={ui.muted} size={15} />
                    </PressScale>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          <View style={{ height: 130 }} />
      </TabScreen>

      {/* Child sheet */}
      <KeyboardAwareBottomSheet visible={showChildSheet} onClose={() => setShowChildSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kids_add_child_title')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-child-sheet" onPress={() => setShowChildSheet(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.label}>{t('kids_child_name')}</Text>
        <TextInput testID="child-name" maxLength={60} value={childName} onChangeText={setChildName} placeholder={t('kids_child_name_placeholder')} placeholderTextColor={ui.muted} style={styles.input} returnKeyType="next" />
        <Text style={styles.label}>{t('kids_starting_stars')}</Text>
        <TextInput testID="child-starting-stars" value={childStartingStars} onChangeText={(v) => setChildStartingStars(cleanNumber(v))} keyboardType="number-pad" placeholder="0" placeholderTextColor={ui.muted} style={styles.input} />
        <Text style={styles.label}>{t('kids_pin_optional')}</Text>
        <TextInput testID="child-pin" returnKeyType="done" onSubmitEditing={() => createChild()} value={childPin} onChangeText={(v) => setChildPin(cleanNumber(v).slice(0, 4))} keyboardType="number-pad" secureTextEntry placeholder={t('kids_pin_placeholder')} placeholderTextColor={ui.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-child" onPress={() => setShowChildSheet(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('cancel')}</Text></PressScale>
          <PressScale testID="save-child" onPress={createChild} disabled={saving || !childName.trim()} style={[styles.saveBtn, (!childName.trim() || saving) && { opacity: 0.5 }]}><Text style={styles.saveText}>{saving ? '...' : t('kids_save_child')}</Text></PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* Give them their own account (13+) */}
      <KeyboardAwareBottomSheet visible={showTeenInvite} onClose={() => setShowTeenInvite(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('teen_invite_title')}</Text>
          <PressScale accessibilityLabel={t('close')} testID="close-teen-invite" onPress={() => setShowTeenInvite(false)} style={styles.iconBtn}>
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        <View style={styles.teenPageTextBox}>
          <Text style={styles.teenPageText}>{t('teen_invite_page_text')}</Text>
        </View>
        <Text style={styles.teenHelp}>{t('teen_invite_help')}</Text>

        <Text style={styles.label}>{t('teen_invite_age')}</Text>
        <View style={styles.ageStepper}>
          <PressScale testID="teen-age-minus" onPress={() => setTeenAge((a) => Math.max(13, a - 1))} disabled={teenAge <= 13} style={[styles.ageStepBtn, teenAge <= 13 && { opacity: 0.35 }]}>
            <Minus color={ui.text} size={18} />
          </PressScale>
          <Text style={styles.ageValue}>{teenAge}</Text>
          <PressScale testID="teen-age-plus" onPress={() => setTeenAge((a) => Math.min(17, a + 1))} disabled={teenAge >= 17} style={[styles.ageStepBtn, teenAge >= 17 && { opacity: 0.35 }]}>
            <Plus color={ui.text} size={18} />
          </PressScale>
        </View>

        <Text style={styles.label}>{t('teen_invite_email')}</Text>
        <TextInput
          testID="teen-email" onSubmitEditing={() => inviteTeen()} value={teenEmail} onChangeText={setTeenEmail}
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
          placeholder="teen@email.com" placeholderTextColor={ui.muted}
          style={styles.input} returnKeyType="done"
        />

        <PressScale
          testID="teen-invite-send" onPress={inviteTeen}
          disabled={teenSending || !teenEmail.trim()}
          style={[styles.teenSendBtn, (teenSending || !teenEmail.trim()) && { opacity: 0.5 }]}
        >
          <Text style={styles.teenSendText}>{teenSending ? '…' : t('teen_invite_send')}</Text>
        </PressScale>
      </KeyboardAwareBottomSheet>

      {/* Manage child sheet */}
      <KeyboardAwareBottomSheet visible={showManageSheet} onClose={() => setShowManageSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kids_manage_child')}</Text>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            testID="close-manage-child"
            onPress={() => setShowManageSheet(false)}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>

        <Text style={styles.label}>{t('kids_child_name')}</Text>
        <TextInput
          testID="manage-child-name" maxLength={60}
          value={manageName}
          onChangeText={setManageName}
          placeholder={t('kids_child_name_placeholder')}
          placeholderTextColor={ui.muted}
          style={styles.input}
          returnKeyType="done"
        />

        <Text style={styles.label}>{t('kids_child_age')}</Text>
        <TextInput
          testID="manage-child-age"
          value={manageAge}
          onChangeText={(v) => setManageAge(v.replace(/[^0-9]/g, '').slice(0, 2))}
          placeholder={t('kids_child_age_placeholder')}
          placeholderTextColor={ui.muted}
          style={styles.input}
          keyboardType="number-pad"
          maxLength={2}
          returnKeyType="done"
        />

        <Text style={styles.label}>
          {activeChild?.has_pin ? t('kids_change_pin') : t('kids_set_pin')}
        </Text>
        <TextInput
          testID="manage-child-pin" returnKeyType="done" onSubmitEditing={() => saveManagedChild()}
          value={managePin}
          onChangeText={(v) => setManagePin(cleanNumber(v).slice(0, 4))}
          keyboardType="number-pad"
          secureTextEntry
          placeholder={t('kids_pin_placeholder')}
          placeholderTextColor={ui.muted}
          style={styles.input}
        />
        <Text style={styles.helperText}>
          {activeChild?.has_pin ? t('kids_pin_set_help') : t('kids_pin_none_help')}
        </Text>
        {activeChild?.has_pin ? (
          <PressScale testID="manage-child-remove-pin" onPress={confirmClearPin} disabled={saving} style={styles.inlineLink}>
            <Text style={styles.inlineLinkText}>{t('kids_remove_pin')}</Text>
          </PressScale>
        ) : null}

        <View style={styles.sheetFooter}>
          <PressScale testID="manage-child-delete" onPress={confirmRemoveChild} disabled={saving} style={[styles.deleteBtn, saving && { opacity: 0.5 }]}>
            <Trash2 color={ui.danger} size={17} />
            <Text style={styles.deleteText}>{t('kids_delete')}</Text>
          </PressScale>
          <PressScale
            testID="manage-child-save"
            onPress={saveManagedChild}
            disabled={saving || !manageName.trim()}
            style={[styles.saveBtn, (!manageName.trim() || saving) && { opacity: 0.5 }]}
          >
            <Text style={styles.saveText}>{saving ? '...' : t('save')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* Reward sheet */}
      <KeyboardAwareBottomSheet visible={showStarSheet} onClose={() => setShowStarSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{starMode === 'add' ? t('kids_add_stars') : t('kids_remove_stars')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-stars" onPress={() => setShowStarSheet(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.sheetHelp}>{t('kids_for')} {activeChild?.name || t('kids_selected_child')}</Text>
        {/* The job first, the number second. It used to be the other way round
            and the reason came pre-filled with "Good job!", so the fastest path
            through this sheet recorded an amount and no task — a history of
            anonymous stars nobody could later explain. Naming the thing is the
            point of opening the sheet at all; the quick chips outside it are
            there for when it is not. */}
        <Text style={styles.label}>{starMode === 'add' ? t('kids_what_they_did') : t('kids_reason')}</Text>
        <TextInput testID="star-reason" autoFocus returnKeyType="next" value={starReason} onChangeText={setStarReason} placeholder={starMode === 'add' ? t('kids_reason_add_placeholder') : t('kids_reason_remove_placeholder')} placeholderTextColor={ui.muted} style={styles.input} />
        <Text style={styles.label}>{t('kids_amount')}</Text>
        <TextInput testID="star-amount" returnKeyType="done" onSubmitEditing={() => adjustStars()} value={starAmount} onChangeText={(v) => setStarAmount(cleanNumber(v))} keyboardType="number-pad" placeholder="5" placeholderTextColor={ui.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-stars" onPress={() => setShowStarSheet(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('cancel')}</Text></PressScale>
          <PressScale testID="save-stars" onPress={adjustStars} disabled={saving || !starAmount} style={[styles.saveBtn, (!starAmount || saving) && { opacity: 0.5 }]}><Text style={styles.saveText}>{saving ? '...' : t('save')}</Text></PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* Add or edit a saved-up reward */}
      <KeyboardAwareBottomSheet visible={showRewardSheet} onClose={() => setShowRewardSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>
            {editingReward ? t('kids_edit_reward') : t('kids_add_reward')}
          </Text>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            testID="close-reward-sheet"
            onPress={() => setShowRewardSheet(false)}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        <Text style={styles.sheetHelp}>{t('kids_reward_help')}</Text>
        <Text style={styles.label}>{t('kids_reward_title_label')}</Text>
        <TextInput
          testID="reward-title"
          autoFocus
          value={rewardTitle}
          onChangeText={setRewardTitle}
          placeholder={t('kids_reward_title_placeholder')}
          placeholderTextColor={ui.muted}
          style={styles.input}
        />
        <Text style={styles.label}>{t('kids_reward_cost_label')}</Text>
        <TextInput
          testID="reward-cost"
          value={rewardCost}
          onChangeText={(v) => setRewardCost(cleanNumber(v))}
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={saveReward}
          placeholder="20"
          placeholderTextColor={ui.muted}
          style={styles.input}
        />
        {/* A picture beats a typed emoji on a phone keyboard, and the row is
            short enough to scan. Anything else can still be typed in. */}
        <Text style={styles.label}>{t('kids_reward_icon_label')}</Text>
        <View style={styles.quickRow}>
          {REWARD_ICONS.map((icon) => (
            <PressScale
              key={icon}
              testID={`reward-icon-${icon}`}
              accessibilityRole="button"
              onPress={() => setRewardIcon(icon)}
              style={[styles.quickStarBtn, rewardIcon === icon && { backgroundColor: ui.orangeSoft, borderColor: ui.orange }]}
            >
              <Text style={styles.rewardEmoji}>{icon}</Text>
            </PressScale>
          ))}
        </View>
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-reward" onPress={() => setShowRewardSheet(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>
          <PressScale
            testID="save-reward"
            onPress={saveReward}
            disabled={saving || !rewardTitle.trim() || !rewardCost}
            style={[styles.saveBtn, (saving || !rewardTitle.trim() || !rewardCost) && { opacity: 0.5 }]}
          >
            <Text style={styles.saveText}>{saving ? '...' : t('save')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* Build a routine: a name, some steps, and what finishing it is worth */}
      <KeyboardAwareBottomSheet visible={showRoutineSheet} onClose={() => setShowRoutineSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kids_add_routine')}</Text>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            testID="close-routine-sheet"
            onPress={() => setShowRoutineSheet(false)}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        {/* Start from something. Five steps and five durations typed into a
            bottom sheet is where this kind of setup gets abandoned. */}
        <View style={styles.quickRow}>
          {ROUTINE_PRESETS.map((preset) => (
            <PressScale
              key={preset.key}
              testID={`routine-preset-${preset.key}`}
              accessibilityRole="button"
              onPress={() => applyRoutinePreset(preset)}
              style={styles.quickStarBtn}
            >
              <Text style={styles.quickStarText} numberOfLines={1}>{t(preset.nameKey)}</Text>
            </PressScale>
          ))}
        </View>
        <Text style={styles.label}>{t('kids_routine_name_label')}</Text>
        <TextInput
          testID="routine-name"
          value={routineName}
          onChangeText={setRoutineName}
          placeholder={t('kids_routine_name_placeholder')}
          placeholderTextColor={ui.muted}
          style={styles.input}
        />
        <Text style={styles.label}>{t('kids_routine_steps_label')}</Text>
        {routineSteps.map((step, index) => (
          <View key={index} style={styles.stepRow}>
            <TextInput
              testID={`routine-step-${index}`}
              value={step.label}
              onChangeText={(v) => setRoutineSteps((prev) =>
                prev.map((row, i) => (i === index ? { ...row, label: v } : row)))}
              placeholder={t('kids_routine_step_placeholder')}
              placeholderTextColor={ui.muted}
              style={[styles.input, styles.stepLabelInput]}
            />
            <TextInput
              testID={`routine-step-mins-${index}`}
              value={step.minutes}
              onChangeText={(v) => setRoutineSteps((prev) =>
                prev.map((row, i) => (i === index ? { ...row, minutes: cleanNumber(v) } : row)))}
              keyboardType="number-pad"
              placeholder="5"
              placeholderTextColor={ui.muted}
              style={[styles.input, styles.stepMinsInput]}
            />
            <PressScale
              accessibilityRole="button"
              accessibilityLabel={t('a11y_delete')}
              testID={`routine-step-remove-${index}`}
              onPress={() => setRoutineSteps((prev) => prev.filter((_, i) => i !== index))}
              style={styles.featureIconBtn}
            >
              <Trash2 color={ui.muted} size={15} />
            </PressScale>
          </View>
        ))}
        <PressScale
          testID="routine-add-step"
          accessibilityRole="button"
          onPress={() => setRoutineSteps((prev) => [...prev, { label: '', minutes: '5' }])}
          style={styles.addStepBtn}
        >
          <Plus color={ui.lavenderText} size={14} />
          <Text style={[styles.featureHeaderBtnText, { color: ui.lavenderText }]}>{t('kids_routine_add_step')}</Text>
        </PressScale>
        <Text style={styles.label}>{t('kids_routine_worth_label')}</Text>
        <TextInput
          testID="routine-stars"
          value={routineStars}
          onChangeText={(v) => setRoutineStars(cleanNumber(v))}
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={createRoutine}
          placeholder="2"
          placeholderTextColor={ui.muted}
          style={styles.input}
        />
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-routine" onPress={() => setShowRoutineSheet(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>
          <PressScale
            testID="save-routine"
            onPress={createRoutine}
            disabled={saving || !routineName.trim()}
            style={[styles.saveBtn, (saving || !routineName.trim()) && { opacity: 0.5 }]}
          >
            <Text style={styles.saveText}>{saving ? '...' : t('save')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* Add a chore to the wheel */}
      <KeyboardAwareBottomSheet visible={showChoreSheet} onClose={() => setShowChoreSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kids_add_chore')}</Text>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            testID="close-chore-sheet"
            onPress={() => setShowChoreSheet(false)}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        <Text style={styles.label}>{t('kids_chore_title_label')}</Text>
        <TextInput
          testID="chore-title"
          autoFocus
          value={choreTitle}
          onChangeText={setChoreTitle}
          placeholder={t('kids_chore_title_placeholder')}
          placeholderTextColor={ui.muted}
          style={styles.input}
        />
        <Text style={styles.label}>{t('kids_chore_worth_label')}</Text>
        <TextInput
          testID="chore-stars"
          value={choreStars}
          onChangeText={(v) => setChoreStars(cleanNumber(v))}
          keyboardType="number-pad"
          placeholder="3"
          placeholderTextColor={ui.muted}
          style={styles.input}
        />
        {/* Who it goes to. More than one turns it into a wheel: finishing it
            pays whoever had it and hands it to the next name. */}
        <Text style={styles.label}>{t('kids_chore_who_label')}</Text>
        <View style={styles.quickRow}>
          {children.map((child) => {
            const picked = choreMembers.includes(child.member_id);
            return (
              <PressScale
                key={child.member_id}
                testID={`chore-who-${child.member_id}`}
                accessibilityRole="button"
                onPress={() => setChoreMembers((prev) => (picked
                  ? prev.filter((id) => id !== child.member_id)
                  : [...prev, child.member_id]))}
                style={[styles.quickStarBtn, picked && { backgroundColor: ui.orangeSoft, borderColor: ui.orange }]}
              >
                <Text style={[styles.quickStarText, picked && { color: ui.orangeText }]} numberOfLines={1}>
                  {child.name}
                </Text>
              </PressScale>
            );
          })}
        </View>
        <PressScale
          testID="chore-weekly"
          accessibilityRole="button"
          onPress={() => setChoreWeekly((v) => !v)}
          style={styles.sheetToggleRow}
        >
          <Text style={styles.sheetToggleText}>
            {choreWeekly ? t('kids_chore_weekly') : t('kids_chore_daily')}
          </Text>
          <Text style={styles.sheetToggleHint}>{t('kids_chore_frequency_hint')}</Text>
        </PressScale>
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-chore" onPress={() => setShowChoreSheet(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>
          <PressScale
            testID="save-chore"
            onPress={createChore}
            disabled={saving || !choreTitle.trim() || choreMembers.length === 0}
            style={[styles.saveBtn, (saving || !choreTitle.trim() || choreMembers.length === 0) && { opacity: 0.5 }]}
          >
            <Text style={styles.saveText}>{saving ? '...' : t('save')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* What this child's week is measured against */}
      <KeyboardAwareBottomSheet visible={showGoalSheet} onClose={() => setShowGoalSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kids_goal_sheet_title', { name: activeChild?.name || '' })}</Text>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            testID="close-goal"
            onPress={() => setShowGoalSheet(false)}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        <Text style={styles.sheetHelp}>{t('kids_goal_help', { n: QUICK_ADD_DAY })}</Text>
        <Text style={styles.label}>{t('kids_goal_label')}</Text>
        <TextInput
          testID="goal-value"
          value={goalValue}
          onChangeText={(v) => setGoalValue(cleanNumber(v))}
          keyboardType="number-pad"
          returnKeyType="done"
          onSubmitEditing={saveWeeklyGoal}
          placeholder={String(DEFAULT_WEEKLY_TARGET)}
          placeholderTextColor={ui.muted}
          style={styles.input}
        />
        {/* The everyday jobs are worth QUICK_ADD_DAY a day, so these are two,
            four and six solid days — the goal expressed in the unit a parent
            actually thinks in. Derived, so they stay true if a job's value
            changes. */}
        <View style={styles.quickRow}>
          {[2, 4, 6].map((days) => (
            <PressScale
              key={days}
              testID={`goal-days-${days}`}
              onPress={() => setGoalValue(String(days * QUICK_ADD_DAY))}
              style={styles.quickStarBtn}
            >
              <Text style={styles.quickStarText}>{t('kids_goal_days', { n: days, stars: days * QUICK_ADD_DAY })}</Text>
            </PressScale>
          ))}
        </View>
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-goal" onPress={() => setShowGoalSheet(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>
          <PressScale
            testID="save-goal"
            onPress={saveWeeklyGoal}
            disabled={saving || !goalValue}
            style={[styles.saveBtn, (!goalValue || saving) && { opacity: 0.5 }]}
          >
            <Text style={styles.saveText}>{saving ? '...' : t('save')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* Assign a one-off task to the selected child */}
      <KeyboardAwareBottomSheet visible={showAssignTask} onClose={() => setShowAssignTask(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{activeChild ? t('kids_assign_task', { name: activeChild.name }) : ''}</Text>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            onPress={() => setShowAssignTask(false)}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        <TextInput
          testID="assign-task-title"
          value={assignTitle}
          onChangeText={setAssignTitle}
          placeholder={t('kids_assign_placeholder')}
          placeholderTextColor={ui.muted}
          style={styles.input}
          autoFocus
          onSubmitEditing={assignTask}
        />
        <View style={styles.assignDueRow}>
          <PressScale
            testID="assign-due-open"
            accessibilityRole="button"
            onPress={() => setShowAssignDuePicker(true)}
            style={[styles.assignDueChip, assignDue && styles.assignDueChipActive]}
          >
            <Text style={[styles.assignDueText, assignDue && styles.assignDueTextActive]}>
              {assignDue ? `${toLocalDateInput(assignDue)} · ${toLocalTimeInput(assignDue)}` : t('no_due')}
            </Text>
          </PressScale>
          {assignDue ? (
            <PressScale
              testID="assign-due-clear"
              accessibilityRole="button"
              accessibilityLabel={t('dt_clear')}
              onPress={() => setAssignDue(null)}
              style={styles.assignDueChip}
            >
              <Text style={styles.assignDueText}>✕</Text>
            </PressScale>
          ) : null}
        </View>
        <Text style={styles.assignTaskHint}>{activeChild ? t('kids_assign_stars_note', { name: activeChild.name }) : ''}</Text>
        <PressScale
          testID="assign-task-save"
          accessibilityRole="button"
          onPress={assignTask}
          disabled={!assignTitle.trim() || assigningTask}
          style={[styles.saveBtn, (!assignTitle.trim() || assigningTask) && { opacity: 0.5 }]}
        >
          <Text style={styles.saveText}>{t('kids_assign_confirm')}</Text>
        </PressScale>
      </KeyboardAwareBottomSheet>

      <DateTimePickerSheet
        visible={showAssignDuePicker}
        value={assignDue}
        onChange={setAssignDue}
        onClose={() => setShowAssignDuePicker(false)}
      />

      <KeyboardAwareBottomSheet visible={showFixSheet} onClose={() => setShowFixSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kids_fix_balance')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-fix" onPress={() => setShowFixSheet(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.sheetHelp}>{t('kids_fix_help', { name: activeChild?.name || '' })}</Text>
        <Text style={styles.label}>{t('kids_correct_total')}</Text>
        <TextInput testID="fix-balance-input" returnKeyType="done" onSubmitEditing={() => fixBalance()} value={fixValue} onChangeText={(v) => setFixValue(cleanNumber(v))} keyboardType="number-pad" placeholder="0" placeholderTextColor={ui.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-fix" onPress={() => setShowFixSheet(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('cancel')}</Text></PressScale>
          <PressScale testID="save-fix" onPress={fixBalance} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.5 }]}><Text style={styles.saveText}>{saving ? '...' : t('save')}</Text></PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* Pocket money — record what actually went in and out. The server
          derives the balance from these, so this is what makes the tracker
          real rather than a permanent $0.00. */}
      <KeyboardAwareBottomSheet visible={showMoneySheet} onClose={() => setShowMoneySheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kids_money_title')}</Text>
          <PressScale
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            testID="close-money"
            onPress={() => setShowMoneySheet(false)}
            style={styles.iconBtn}
          >
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        <Text style={styles.sheetHelp}>
          {t('kids_for')} {activeChild?.name || t('kids_selected_child')} · {t('currency_symbol')}{childBalance.toFixed(2)}
        </Text>

        <Text style={styles.label}>{t('kids_money_amount')}</Text>
        <TextInput
          testID="money-amount"
          value={moneyAmount}
          onChangeText={setMoneyAmount}
          keyboardType="decimal-pad"
          placeholder="5.00"
          placeholderTextColor={ui.muted}
          style={styles.input}
        />

        <Text style={styles.label}>{t('kids_money_note')}</Text>
        <TextInput
          testID="money-note"
          value={moneyNote}
          onChangeText={setMoneyNote}
          placeholder={t('kids_money_note')}
          placeholderTextColor={ui.muted}
          style={styles.input}
        />

        <View style={styles.moneyBtnRow}>
          <PressScale
            testID="money-in"
            onPress={() => recordMoney('deposit')}
            style={[styles.moneyBtn, { backgroundColor: ui.mint }]}
          >
            <Text style={[styles.moneyBtnText, { color: ui.mintText }]}>+ {t('kids_money_in')}</Text>
          </PressScale>
          <PressScale
            testID="money-out"
            onPress={() => recordMoney('withdrawal')}
            style={[styles.moneyBtn, { backgroundColor: ui.soft }]}
          >
            <Text style={[styles.moneyBtnText, { color: ui.text }]}>− {t('kids_money_out')}</Text>
          </PressScale>
        </View>

        <Text style={styles.label}>{t('kids_money_recent')}</Text>
        {moneyLoading ? (
          <ActivityIndicator color={ui.goldText} style={{ marginVertical: 16 }} />
        ) : moneyTxns.length === 0 ? (
          <Text style={styles.sheetHelp}>{t('kids_money_none')}</Text>
        ) : (
          moneyTxns.slice(0, 12).map((txn) => (
            <View key={txn.txn_id} style={styles.moneyRow}>
              <Text style={styles.moneyDesc} numberOfLines={1}>{txn.description}</Text>
              <Text
                style={[
                  styles.moneyAmount,
                  { color: txn.txn_type === 'withdrawal' ? ui.muted : ui.mintText },
                ]}
              >
                {txn.txn_type === 'withdrawal' ? '−' : '+'}{t('currency_symbol')}{Number(txn.amount).toFixed(2)}
              </Text>
            </View>
          ))
        )}
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showAllowanceSheet} onClose={() => setShowAllowanceSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kids_set_allowance')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-allowance" onPress={() => setShowAllowanceSheet(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.sheetHelp}>{t('kids_for')} {activeChild?.name || t('kids_selected_child')}</Text>
        <Text style={styles.label}>{t('kids_amount')}</Text>
        <TextInput testID="allowance-amount" returnKeyType="done" onSubmitEditing={() => saveAllowance()} value={alwAmount} onChangeText={(v) => setAlwAmount(cleanNumber(v))} keyboardType="number-pad" placeholder="5" placeholderTextColor={ui.muted} style={styles.input} />
        <Text style={styles.label}>{t('kids_frequency')}</Text>
        <View style={styles.freqRow}>
          {['weekly', 'biweekly', 'monthly'].map((f) => (
            <PressScale key={f} testID={`allowance-freq-${f}`} onPress={() => setAlwFrequency(f)} style={[styles.freqChip, alwFrequency === f && styles.freqChipActive]}>
              <Text style={[styles.freqChipText, alwFrequency === f && styles.freqChipTextActive]}>{t('kids_freq_' + f)}</Text>
            </PressScale>
          ))}
        </View>
        <Text style={styles.pocketTip}>{t('kids_pocket_tip')}</Text>
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-allowance" onPress={() => setShowAllowanceSheet(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('cancel')}</Text></PressScale>
          <PressScale testID="save-allowance" onPress={saveAllowance} disabled={saving || !alwAmount} style={[styles.saveBtn, (!alwAmount || saving) && { opacity: 0.5 }]}><Text style={styles.saveText}>{saving ? '...' : t('save')}</Text></PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <StarCelebration content={celebration} onDone={() => setCelebration(null)} />


      <LoadingOverlay visible={loading} label={t('kids_loading')} />
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} />
    </SwipeableTabView>
  );
}

function RecentActivity({ items, loading, expanded }: { items: StarTransaction[]; loading: boolean; expanded?: boolean }) {
  const ui = useUI();
  const { t, lang } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);
  return (
    <>
      <Text style={styles.blockLabel}>{t('kids_recent_activity')}</Text>
      {loading ? (
        <Text style={styles.emptyMini}>{t('kids_loading_activity')}</Text>
      ) : items.length === 0 ? (
        <Card style={styles.cardPad}><Text style={styles.emptyMini}>{t('kids_no_activity')}</Text></Card>
      ) : (
        <Card style={styles.cardPad}>
          {items.map((item, index) => {
            const positive = item.delta > 0;
            return (
              <View key={item.transaction_id} style={[styles.activityRow, index < items.length - 1 && styles.activityRowBorder]}>
                <IconTile bg={positive ? ui.mint : ui.dangerSoft} size={38} radius={11}>
                  {positive ? <Check color={ui.mintText} size={17} /> : <Minus color={ui.danger} size={17} />}
                </IconTile>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.activityReason} numberOfLines={1}>{item.reason || t('kids_star_adjustment')}</Text>
                  <Text style={styles.activityDate}>{formatActivityDate(item.created_at, localeFor(lang))}</Text>
                </View>
                <View style={styles.activityDeltaRow}>
                  <Text style={[styles.activityDelta, { color: positive ? ui.mintText : ui.danger }]}>{positive ? '+' : ''}{item.delta}</Text>
                  <Star color={ui.star} size={14} fill={ui.star} />
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ui.orangeSoft,
    borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8,
  },
  manageBtnText: { fontFamily: 'Inter_700Bold', fontSize: 12.5, color: ui.orangeText },

  // Family Hub — the grown-ups roster
  hubGrownups: { marginTop: 4, marginBottom: 4 },
  hubLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: ui.muted, marginLeft: 4, marginBottom: 8, marginTop: 8 },
  hubRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 16, padding: 12, marginBottom: 9 },
  hubAvatar: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  // An illustration is drawn to the edges of its box, so the holder clips
  // it to the same rounded square the initial tile uses.
  hubAvatarIllus: { width: 44, height: 44, borderRadius: 13, overflow: 'hidden' },
  hubAvatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: '#fff' },
  hubNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  hubName: { fontFamily: 'Inter_700Bold', fontSize: 15, color: ui.text, flexShrink: 1 },
  hubBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  hubBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.3, textTransform: 'uppercase' },
  hubSub: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: ui.muted, marginTop: 2 },
  hubMsgBtn: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.soft },
  hubUnread: { position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  hubUnreadText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 11 },
  teenMsgBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ui.orangeSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  teenMsgText: { fontFamily: 'Inter_700Bold', fontSize: 11.5, color: ui.orangeText },
  leadLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: ui.muted, marginTop: 18, marginBottom: 9, marginLeft: 2 },
  leadRow: { flexDirection: 'row', gap: 10 },
  leadStar: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: ui.orange, borderRadius: 14, paddingVertical: 13 },
  leadStarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: '#fff' },
  // Same size and shape as the amounts beside it — it is not a lesser action —
  // but outlined rather than filled, because it opens a sheet instead of
  // awarding a star on the spot.
  leadStarOther: { backgroundColor: ui.orangeSoft, borderWidth: 1, borderColor: ui.orange },
  takeBackRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 2 },
  takeBackText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: ui.muted },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12, marginBottom: 7 },
  todayIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  todayText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14, color: ui.text },
  todayVal: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, color: ui.mintText },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line, borderRadius: 14, paddingVertical: 13, paddingHorizontal: 14, marginTop: 16, marginBottom: 4 },
  moreTitle: { fontFamily: 'Inter_700Bold', fontSize: 14.5, color: ui.text },
  moreSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: ui.muted, marginTop: 2 },
  hubKids: { marginTop: 2, marginBottom: 6 },
  hubRowActive: { borderColor: ui.orange, borderWidth: 1.5 },
  hubStarChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: ui.mint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  hubStarChipText: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, color: ui.mintText },
  hubAddRow: { borderStyle: 'dashed' },
  hubAddText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: ui.text },
  focusHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 6, marginBottom: 2 },
  focusBack: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line },
  focusTitle: { flex: 1, fontFamily: 'Inter_800ExtraBold', fontSize: 22, letterSpacing: -0.3, color: ui.text },
  focusMsg: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 99, justifyContent: 'center', backgroundColor: ui.orangeDeep },
  focusMsgText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  bellWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },

  childScroll: { marginTop: 18, marginHorizontal: -20 },
  childRow: { gap: 10, paddingHorizontal: 20 },
  childChip: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 99 },
  childChipActive: { backgroundColor: ui.text },
  childChipIdle: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, paddingHorizontal: 14 },
  childAvatar: { width: 30, height: 30, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  childAvatarText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  lockBadge: { position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: 99, backgroundColor: ui.text, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: ui.card },
  childChipText: { fontFamily: 'Inter_700Bold', fontSize: 14 },

  walletCard: { padding: 16, marginTop: 18 },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  giveAccountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: '#F1EFEA', marginTop: 14, paddingTop: 14 },
  walletAvatar: { width: 52, height: 52, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  walletAvatarIllus: { width: 52, height: 52, borderRadius: 99, overflow: 'hidden' },
  walletAvatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 20 },
  walletLabel: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, flexShrink: 1 },
  walletLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // A findable control, not a lone grey ⋯. Setting a child's age (and PIN, and
  // teen invite) lives behind this, so it says "Manage" in a tinted pill rather
  // than hiding behind three dots nobody reads as a button.
  managePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: ui.soft },
  managePillText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 12 },
  helperText: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 6, lineHeight: 17 },
  inlineLink: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 2 },
  inlineLinkText: { color: ui.danger, fontFamily: 'Inter_700Bold', fontSize: 13 },
  walletCount: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 30, lineHeight: 35, marginTop: 1 },
  redeemBtn: { backgroundColor: ui.text, borderRadius: 99, paddingHorizontal: 20, paddingVertical: 13 },
  assignTaskBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: ui.orange, backgroundColor: ui.orangeSoft },
  assignTaskText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 13 },
  assignDueRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  assignDueChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  assignDueChipActive: { borderColor: ui.orange, backgroundColor: ui.orangeSoft },
  assignDueText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  assignDueTextActive: { color: ui.orangeText },
  assignTaskHint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 8, marginBottom: 14, lineHeight: 18 },
  redeemText: { color: ui.bg, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  weekCard: { marginTop: 12, padding: 16 },
  weekTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  weekLabel: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 11.5, letterSpacing: 1, textTransform: 'uppercase' },
  weekNum: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 28, marginTop: 2 },
  weekNumUnit: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13 },
  cashInBtn: { backgroundColor: ui.orangeDeep, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  cashInText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  weekGoalWrap: { marginTop: 14 },
  weekGoalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  weekGoalTitle: { flex: 1, color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  weekGoalCount: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  weekGoalHint: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 8 },
  weekDays: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, marginTop: 14 },
  weekDay: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 12, backgroundColor: ui.soft },
  weekDayDone: { backgroundColor: ui.mint },
  weekDayToday: { borderWidth: 1.5, borderColor: ui.orange },
  weekDayMark: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 13, lineHeight: 17 },
  weekDayMarkDone: { color: ui.mintText },
  weekDayMarkToday: { color: ui.orangeText },
  weekDayLetter: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 10, marginTop: 2 },
  weekDayLetterToday: { color: ui.orangeText },
  // A picked day has to beat both of the states above it, so it takes the
  // solid fill rather than another border — two rings side by side read as
  // noise, not as "this one".
  weekDayPicked: { backgroundColor: ui.orangeDeep, borderColor: ui.orangeDeep },
  weekDayMarkPicked: { color: '#FFFFFF' },
  weekDayLetterPicked: { color: '#FFFFFF' },
  weekDayFuture: { opacity: 0.4 },
  weekDayHint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 11.5, lineHeight: 16, marginTop: 8 },
  cashInBtnSoft: { backgroundColor: ui.orangeSoft },
  cashInTextSoft: { color: ui.orangeText },
  weekClaimedTag: { backgroundColor: ui.mint, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  weekClaimedTagText: { color: ui.mintText, fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  weekResetNote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 11.5, lineHeight: 16, marginTop: 12 },



  tabRow: { flexDirection: 'row', gap: 26, borderBottomWidth: 1, borderBottomColor: ui.line, marginTop: 18 },
  tabBtn: { paddingTop: 6, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 15 },

  blockLabel: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13, marginTop: 20, marginBottom: 10 },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  blockTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, letterSpacing: -0.2 },
  cardPad: { paddingHorizontal: 16 },

  quickAddHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  quickAddDay: { color: ui.mintText, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
  quickAddMaths: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, marginTop: 8 },
  quickAddRow: { flexDirection: 'row', gap: 10 },
  quickAddChip: { flex: 1, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', gap: 6 },
  quickAddText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 12, textAlign: 'center' },
  quickAddAmt: { color: ui.mintText, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },


  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rewardRowBorder: { borderBottomWidth: 1, borderBottomColor: ui.line },
  rewardEmoji: { fontSize: 20 },
  rewardRedeem: { backgroundColor: ui.text, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 9 },
  rewardRedeemText: { color: ui.bg, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
  rewardEdit: { width: 34, height: 34, borderRadius: 99, borderWidth: 1, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },

  // Outstanding redemptions. Deliberately not reusing rewardTitle: that one
  // carries flex:1 for a row layout and would stretch vertically here.
  pendingHead: { marginTop: 6, marginBottom: 10 },
  pendingTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 14.5 },
  pendingMeta: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 3 },
  owedBadge: { position: 'absolute', top: -3, right: -3, minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 99, backgroundColor: ui.orangeDeep, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: ui.card },
  owedBadgeText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 8.5 },

  ideaCard: { padding: 16 },
  ideaLead: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  // Wrapped, not a horizontal scroller: a list you have to swipe hides most of
  // itself, and the point of these is that a child can see the choice.
  ideaWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ideaChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 },
  ideaChipReady: { backgroundColor: ui.orangeSoft, borderColor: ui.orange },
  ideaEmoji: { fontSize: 15 },
  ideaTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 12.5 },

  starActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  addStarsBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: ui.text, borderRadius: 14, paddingVertical: 14 },
  addStarsText: { color: ui.bg, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  removeStarsBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line, borderRadius: 14, paddingVertical: 14 },
  removeStarsText: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  quickRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  quickStarBtn: { flex: 1, alignItems: 'center', backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 14, paddingVertical: 13 },
  quickStarText: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },

  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  activityRowBorder: { borderBottomWidth: 1, borderBottomColor: ui.line },
  activityReason: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  activityDate: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
  activityDeltaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  activityDelta: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  emptyMini: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, paddingVertical: 14 },

  sheet: { backgroundColor: ui.card, borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, borderColor: ui.line, padding: 26, paddingBottom: 140 },
  moneyBtnRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  moneyBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 999 },
  moneyBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  moneyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: ui.line },
  moneyDesc: { flex: 1, color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 14 },
  moneyAmount: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24, letterSpacing: -0.4 },
  sheetHelp: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, marginBottom: 12 },
  iconBtn: { padding: 9, borderRadius: 9999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  label: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Inter_500Medium', fontSize: 16, color: ui.text, backgroundColor: ui.soft },
  teenPageTextBox: { backgroundColor: ui.orangeSoft, borderRadius: 14, padding: 14, marginBottom: 12 },
  teenPageText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 20, color: ui.orangeText },
  teenChipBadge: { backgroundColor: ui.orangeSoft, borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 6 },
  teenChipBadgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 9, letterSpacing: 0.3, textTransform: 'uppercase' },
  teenHint: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: ui.orangeSoft, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(245,101,25,0.22)', paddingVertical: 10, paddingHorizontal: 12, marginBottom: 14 },
  // White on ui.orange measures 3.11:1 — below the 4.5 WCAG AA needs for text
  // this size. It was never caught because the badge used to be removed after
  // two seconds, so the contrast harness photographed the screen without it;
  // making the hint persist is what finally made the defect measurable. Dark
  // ink on the same orange is 5.82:1, and ui.orange is identical in both
  // themes, so one pair fixes light and dark together.
  teenHintNew: { fontFamily: 'Inter_800ExtraBold', fontSize: 10, letterSpacing: 0.4, color: '#2A0E02', backgroundColor: ui.orange, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 99, overflow: 'hidden' },
  teenHintText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 12.5, color: ui.orangeText, lineHeight: 17 },
  approvalsCard: { backgroundColor: ui.card, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(245,101,25,0.28)', padding: 16, marginBottom: 14 },
  approvalsTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, color: ui.text, letterSpacing: -0.2 },
  approvalsSub: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: ui.muted, marginTop: 2, marginBottom: 10 },
  approvalRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#F1EFEA' },
  approvalTask: { fontFamily: 'Inter_700Bold', fontSize: 14.5, color: ui.text },
  approvalWho: { fontFamily: 'Inter_500Medium', fontSize: 12, color: ui.muted, marginTop: 1 },
  approvalDismiss: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 99, backgroundColor: ui.bg },
  approvalDismissText: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5, color: ui.muted },
  approvalApprove: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, backgroundColor: ui.orange },
  approvalApproveText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12.5, color: '#fff' },
  giveAccountBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 16, marginTop: 10 },
  giveAccountText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: ui.text },
  teenHelp: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, color: ui.muted, marginTop: 4, marginBottom: 14 },
  ageStepper: { flexDirection: 'row', alignItems: 'center', gap: 18, alignSelf: 'flex-start', backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  ageStepBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.bg },
  ageValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, color: ui.text, minWidth: 34, textAlign: 'center' },
  teenSendBtn: { backgroundColor: ui.orange, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 18 },
  teenSendText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: 'rgba(220,38,38,0.35)', backgroundColor: ui.dangerSoft, borderRadius: 18, paddingVertical: 15 },
  deleteText: { color: ui.danger, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', backgroundColor: ui.orangeDeep },
  saveText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },

  featureHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 10 },
  // Sits at the end of the section header, where the eye already is when it is
  // reading "Chore Wheel" and finding nothing under it.
  featureHeaderBtn: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: ui.line },
  featureHeaderBtnText: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  featureEmpty: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, paddingVertical: 6 },
  // Label, minutes, bin — on one line, because a routine is read as a list and
  // stacking each step three rows deep makes four steps fill the screen.
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepLabelInput: { flex: 1, minWidth: 0 },
  stepMinsInput: { width: 68, textAlign: 'center' },
  addStepBtn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: ui.line, marginTop: 4 },
  sheetToggleRow: { marginTop: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: ui.line },
  sheetToggleText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  sheetToggleHint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
  featureHeaderText: { flex: 1, color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: ui.line },
  featureRowTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  featureRowSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
  freqRow: { flexDirection: 'row', gap: 8 },
  freqChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  freqChipActive: { backgroundColor: ui.text, borderColor: ui.text },
  freqChipText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13 },
  freqChipTextActive: { color: ui.bg },
  pocketTip: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, marginTop: 14 },
  featureActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: ui.orangeDeep, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, flexShrink: 0 },
  featureIconBtn: { width: 34, height: 34, borderRadius: 99, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.soft, flexShrink: 0 },
  featureActionText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  allowanceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  allowanceBalance: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 28 },
  allowanceDue: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 12, marginTop: 3 },
  payNowBtn: { backgroundColor: ui.orangeDeep, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 9 },
  payNowText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
});
