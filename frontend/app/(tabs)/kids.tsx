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
  MinusCircle,
  MoreHorizontal,
  Bell,
  Bed,
  BookOpen,
  Utensils,
  Check,
  Minus,
  Timer,
  DollarSign,
  RotateCcw,
  Play,
  ChevronRight,
} from 'lucide-react-native';

import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import { PinPadModal } from '../../src/components/PinPadModal';
import { StarCelebration, CelebrationContent } from '../../src/components/StarCelebration';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast, { ToastTone } from '../../src/components/AppToast';
import EmptyState from '../../src/components/EmptyState';
import FirstRunTip from '../../src/components/FirstRunTip';
import ErrorState from '../../src/components/ErrorState';
import LoadingOverlay from '../../src/components/LoadingOverlay';
import { TabScreen } from '../../src/components/TabScreen';
import { Card, IconTile, ProgressBar, ScreenHeader, UI, useUI, UIColors } from '../../src/components/Kit';

import { useStore } from '../../src/store';
import { api, logEvent, AllowanceConfig, AllowanceTxn, Chore, FamilyMember, Redemption, Reward, Routine, StarTransaction } from '../../src/api';
import { usePremiumGate, LockBadge, PremiumPreviewBanner } from '../../src/components/PremiumGate';
import { logger } from '../../src/logger';
import { recordWin } from '../../src/reviewPrompt';
import { isAlreadySettled, mergeRedemptions, restoreRedemption, sortByNewest } from '../../src/redemptions';
import { webConfirm } from '../../src/confirm';

/** "Sat 2 Aug" — short enough for a subtitle, unambiguous about which day. */
function formatDueDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

type ToastState = { message: string; tone: ToastTone };
type RewardSheetMode = 'create' | 'edit';
type StarMode = 'add' | 'remove';

const DEFAULT_REWARD_ICON = String.fromCodePoint(0x1F381);

const REWARD_IDEAS = [
  { titleKey: 'ri_pizza', cost_stars: 50, icon: String.fromCodePoint(0x1F355) },
  { titleKey: 'ri_movie', cost_stars: 75, icon: String.fromCodePoint(0x1F3AC) },
  { titleKey: 'ri_icecream', cost_stars: 40, icon: String.fromCodePoint(0x1F366) },
  { titleKey: 'ri_game', cost_stars: 60, icon: String.fromCodePoint(0x1F3AE) },
] as const;

const QUICK_ADDS = [
  { labelKey: 'qa_bed', chore: 'bed' as const, amount: 2, Icon: Bed, bg: UI.mint, tint: UI.mintText },
  { labelKey: 'qa_read', chore: 'read' as const, amount: 3, Icon: BookOpen, bg: UI.lavender, tint: UI.lavenderText },
  { labelKey: 'qa_table', chore: 'table' as const, amount: 2, Icon: Utensils, bg: UI.orangeSoft, tint: UI.orange },
];

const CHILD_TINTS = [UI.orange, UI.lavenderText, UI.mintText, UI.goldText];

const ICON_LIBRARY: { match: string[]; icons: string[] }[] = [
  { match: ['pizza', 'dinner', 'restaurant', 'food'], icons: [String.fromCodePoint(0x1F355), String.fromCodePoint(0x1F37D), String.fromCodePoint(0x1F389), String.fromCodePoint(0x1F354)] },
  { match: ['movie', 'cinema', 'film'], icons: [String.fromCodePoint(0x1F3AC), String.fromCodePoint(0x1F37F), String.fromCodePoint(0x1F39F), String.fromCodePoint(0x2B50)] },
  { match: ['ice', 'cream', 'sweet', 'cake', 'cupcake', 'dessert'], icons: [String.fromCodePoint(0x1F366), String.fromCodePoint(0x1F9C1), String.fromCodePoint(0x1F370), String.fromCodePoint(0x1F369)] },
  { match: ['game', 'gaming', 'playstation', 'xbox', 'switch'], icons: [String.fromCodePoint(0x1F3AE), String.fromCodePoint(0x1F579), String.fromCodePoint(0x1F3C6), String.fromCodePoint(0x26A1)] },
  { match: ['park', 'outside', 'walk', 'trip'], icons: [String.fromCodePoint(0x1F333), String.fromCodePoint(0x1F6DD), String.fromCodePoint(0x2600), String.fromCodePoint(0x1F6B2)] },
  { match: ['book', 'reading', 'story'], icons: [String.fromCodePoint(0x1F4DA), String.fromCodePoint(0x1F4D6), String.fromCodePoint(0x2728), String.fromCodePoint(0x1F3C5)] },
  { match: ['toy', 'lego', 'gift'], icons: [String.fromCodePoint(0x1F9F8), String.fromCodePoint(0x1F381), String.fromCodePoint(0x1FA80), String.fromCodePoint(0x2728)] },
];

function suggestedIcons(title: string) {
  const normalized = title.trim().toLowerCase();
  const matches = ICON_LIBRARY.find((group) => group.match.some((word) => normalized.includes(word)));
  return matches?.icons || [DEFAULT_REWARD_ICON, String.fromCodePoint(0x2B50), String.fromCodePoint(0x1F389), String.fromCodePoint(0x1F3C6), String.fromCodePoint(0x2728), String.fromCodePoint(0x1F355), String.fromCodePoint(0x1F3AC), String.fromCodePoint(0x1F3AE)];
}

function cleanNumber(value: string) {
  return value.replace(/[^0-9]/g, '');
}

function formatActivityDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function Kids() {
  const { t } = useStore();
  const { isLocked, promptUpgrade } = usePremiumGate();
  const allowanceLocked = isLocked('allowance');
  const router = useRouter();

  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
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

  const [showRewardSheet, setShowRewardSheet] = useState(false);
  const [rewardMode, setRewardMode] = useState<RewardSheetMode>('create');
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [rewardTitle, setRewardTitle] = useState('');
  const [rewardCost, setRewardCost] = useState('50');
  const [rewardIcon, setRewardIcon] = useState(DEFAULT_REWARD_ICON);

  const [showStarSheet, setShowStarSheet] = useState(false);
  const [starMode, setStarMode] = useState<StarMode>('add');
  const [starAmount, setStarAmount] = useState('5');
  const [starReason, setStarReason] = useState('');

  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pinPromptReward, setPinPromptReward] = useState<Reward | null>(null);
  const [celebration, setCelebration] = useState<CelebrationContent | null>(null);
  const [showFixSheet, setShowFixSheet] = useState(false);
  const [fixValue, setFixValue] = useState('');
  const [showAllowanceSheet, setShowAllowanceSheet] = useState(false);
  // The list was capped at five with nothing to say so. A reward a child is
  // saving towards being invisible defeats the point of the page.
  const [showAllRewards, setShowAllRewards] = useState(false);
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

  const children = useMemo(() => members.filter((m) => m.role?.toLowerCase() === 'child'), [members]);
  const activeChild = children.find((c) => c.member_id === selectedChild) || children[0];
  const stars = activeChild?.stars || 0;
  const iconSuggestions = useMemo(() => suggestedIcons(rewardTitle), [rewardTitle]);
  const sortedRewards = useMemo(() => [...rewards].sort((a, b) => (stars / b.cost_stars) - (stars / a.cost_stars)), [rewards, stars]);
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
  const weeklyStars = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return historyItems.filter((h) => h.created_at && new Date(h.created_at).getTime() >= weekAgo).reduce((sum, h) => sum + h.delta, 0);
  }, [historyItems]);

  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const memberName = useCallback((memberId: string) => {
    const m = members.find((x) => x.member_id === memberId);
    return m?.name || memberId;
  }, [members]);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2300);
  }, []);

  const refreshHistory = useCallback(async (memberId?: string | null) => {
    if (!memberId) {
      setHistoryItems([]);
      return;
    }
    setHistoryLoading(true);
    try {
      const result = await api.memberStarHistory(memberId);
      setHistoryItems(result);
    } catch (e: any) {
      const message = String(e?.message || e || '');
      if (!message.includes('404')) logger.warn('Star history load failed:', message);
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    logEvent('kids_open');
    try {
      setErrorMessage(null);
      const [m, r] = await Promise.all([api.familyMembers(), api.listRewards()]);
      setMembers(m);
      setRewards(r);

      const currentChildStillExists = selectedChild && m.some((x) => x.member_id === selectedChild);
      const firstChild = m.find((x) => x.role?.toLowerCase() === 'child');
      const nextSelected = currentChildStillExists ? selectedChild : firstChild?.member_id || null;
      setSelectedChild(nextSelected);
      await refreshHistory(nextSelected);

      Promise.allSettled([api.listRoutines(), api.listAllowances(), api.listChores(), api.listRedemptions('pending')])
        .then(async ([rtnRes, alwRes, choreRes, redRes]) => {
          if (rtnRes.status === 'fulfilled') setRoutines(rtnRes.value);
          if (alwRes.status === 'fulfilled') setAllowances(alwRes.value);
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

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    refreshHistory(activeChild?.member_id);
  }, [activeChild?.member_id, refreshHistory]);

  const showBlockingError = !loading && Boolean(errorMessage) && members.length === 0;

  const openChildSheet = () => {
    setChildName('');
    setChildStartingStars('0');
    setChildPin('');
    setShowChildSheet(true);
  };

  const openCreateReward = () => {
    setRewardMode('create');
    setEditingReward(null);
    setRewardTitle('');
    setRewardCost('50');
    setRewardIcon(DEFAULT_REWARD_ICON);
    setShowRewardSheet(true);
  };

  const openEditReward = (reward: Reward) => {
    setRewardMode('edit');
    setEditingReward(reward);
    setRewardTitle(reward.title);
    setRewardCost(String(reward.cost_stars));
    setRewardIcon(reward.icon || DEFAULT_REWARD_ICON);
    setShowRewardSheet(true);
  };

  const closeRewardSheet = () => {
    setShowRewardSheet(false);
    setEditingReward(null);
  };

  const openStarSheet = (mode: StarMode, amount = '5') => {
    if (!activeChild) {
      showToast(t('kids_select_child_first'), 'error');
      return;
    }
    setStarMode(mode);
    setStarAmount(amount);
    setStarReason(mode === 'add' ? t('kids_good_job') : '');
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
    setShowManageSheet(true);
  };

  const saveManagedChild = async () => {
    if (!activeChild) return;
    const name = manageName.trim();
    const pin = managePin.trim();

    if (!name) { showToast(t('kids_name_required'), 'error'); return; }
    if (pin && !/^\d{4}$/.test(pin)) { showToast(t('kids_pin_4_digits'), 'error'); return; }

    setSaving(true);
    try {
      // Two calls with no transaction between them, so each is applied as it
      // lands rather than at the end: if the second fails, the screen still
      // shows what the first actually changed.
      if (name !== activeChild.name) {
        const updated = await api.updateFamilyMember(activeChild.member_id, { name });
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

  const saveReward = async () => {
    const title = rewardTitle.trim();
    const cost = parseInt(rewardCost || '0', 10);
    const icon = rewardIcon || DEFAULT_REWARD_ICON;

    if (!title || !cost || cost < 1) { showToast(t('kids_reward_fields_required'), 'error'); return; }

    setSaving(true);
    try {
      if (rewardMode === 'edit' && editingReward) {
        const updated = await api.updateReward(editingReward.reward_id, { title, cost_stars: cost, icon });
        setRewards((prev) => prev.map((r) => (r.reward_id === updated.reward_id ? updated : r)));
        showToast(t('kids_reward_updated'), 'success');
      } else {
        const created = await api.createReward({ title, cost_stars: cost, icon });
        setRewards((prev) => [created, ...prev]);
        showToast(t('kids_reward_created'), 'success');
      }
      closeRewardSheet();
    } catch (e: any) {
      logger.warn('Save reward failed:', e?.message || e);
      showToast(e?.message || t('kids_save_reward_error'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeReward = async (reward: Reward) => {
    const previous = rewards;
    setRewards((prev) => prev.filter((x) => x.reward_id !== reward.reward_id));
    try {
      await api.deleteReward(reward.reward_id);
      showToast(t('kids_reward_deleted'), 'success');
      closeRewardSheet();
    } catch (e: any) {
      logger.warn('Delete reward failed:', e?.message || e);
      setRewards(previous);
      showToast(t('kids_delete_reward_error'), 'error');
      load();
    }
  };

  const confirmRemoveReward = (reward: Reward) => {
    if (Platform.OS === 'web') { removeReward(reward); return; }
    Alert.alert(t('kids_delete_reward'), reward.title, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('kids_delete'), style: 'destructive', onPress: () => removeReward(reward) },
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
    }
  };

  const quickAdd = async (reason: string, amount: number, chore?: 'bed' | 'read' | 'table') => {
    if (!activeChild) { showToast(t('kids_select_child_first'), 'error'); return; }
    if (starActionRef.current) return;
    starActionRef.current = true;
    try {
      const result = await api.adjustMemberStars(activeChild.member_id, { delta: amount, reason });
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
      setAllowances((prev) => prev.map((a) =>
        a.member_id === res.allowance.member_id ? res.allowance : a));
      setBalances((prev) => ({
        ...prev,
        [activeChild.member_id]: (prev[activeChild.member_id] || 0) + res.transaction.amount,
      }));
      showToast(t('kids_allowance_paid', { amount: res.transaction.amount }), 'success');
    } catch (e: any) {
      logger.warn('Pay allowance failed:', e?.message || e);
      showToast(e?.message || t('kids_allowance_error'), 'error');
    } finally {
      moneySavingRef.current = false;
    }
  }, [activeChild, showToast, t]);

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

  const doRedeem = useCallback(async (reward: Reward) => {
    if (!activeChild) return;
    if (starActionRef.current) return;
    starActionRef.current = true;
    try {
      const res = await api.redeemReward(reward.reward_id, activeChild.member_id);
      setMembers((prev) => prev.map((m) => (m.member_id === res.member.member_id ? res.member : m)));
      if (res.redemption) {
        const created = res.redemption;
        addedIdsRef.current.add(created.redemption_id);
        setRedemptions((prev) => sortByNewest([created, ...prev]));
      }
      showToast(`${t('redeemed')} ${reward.title}`, 'success');
      setCelebration({ kind: 'reward', title: reward.title });
      await refreshHistory(activeChild.member_id);
    } catch (e: any) {
      logger.warn('Reward redemption failed:', e?.message || e);
      showToast(e?.message || t('kids_redeem_error'), 'error');
    } finally {
      starActionRef.current = false;
    }
  }, [activeChild, refreshHistory, showToast, t]);

  const redeem = async (reward: Reward) => {
    if (!activeChild) return;
    if ((activeChild.stars || 0) < reward.cost_stars) { showToast(t('not_enough_stars'), 'error'); return; }
    if (activeChild.has_pin) { setPinPromptReward(reward); return; }
    await doRedeem(reward);
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

  const weeklyLine = weeklyStars > 0
    ? `+${weeklyStars} ${t('kids_stars_this_week')} — ${t('kids_keep_it_up')} ✨`
    : weeklyStars < 0
      ? `${weeklyStars} ${t('kids_stars_this_week')}`
      : `${t('kids_fresh_week')} ✨`;

  return (
    <SwipeableTabView style={styles.container}>
      <TabScreen
        tab="Kids"
        refreshing={refreshing}
        onRefresh={handleRefresh}
        scrollViewProps={{ contentContainerStyle: styles.scroll, keyboardShouldPersistTaps: 'handled' }}
      >
          <ScreenHeader
            eyebrow={t('kids_eyebrow_family')}
            title={t('kids_title')}
            right={
              <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_notifications')} onPress={() => router.navigate('/(tabs)/feed')} style={styles.bellWrap}>
                <Bell color={ui.text} size={24} />
              </PressScale>
            }
          />

          {/* Only once the screen has something to explain — a tip above an
              error or a blank slate is noise. */}
          {!showBlockingError && !loading && children.length > 0 ? (
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
              {/* Child selector */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.childRow} style={styles.childScroll} keyboardShouldPersistTaps="handled">
                {children.map((child, index) => {
                  const active = child.member_id === activeChild?.member_id;
                  const tint = CHILD_TINTS[index % CHILD_TINTS.length];
                  // Outstanding rewards live under one child's tab, so without
                  // a mark here a parent with three children would never learn
                  // they still owe the one they aren't looking at.
                  const owed = owedByChild[child.member_id] || 0;
                  return (
                    <PressScale key={child.member_id} testID={`child-${child.member_id}`} onPress={() => setSelectedChild(child.member_id)} style={[styles.childChip, active ? styles.childChipActive : styles.childChipIdle]}>
                      <View style={[styles.childAvatar, { backgroundColor: tint }]}>
                        <Text style={styles.childAvatarText}>{child.name[0]?.toUpperCase()}</Text>
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
                      <Text style={[styles.childChipText, { color: active ? ui.bg : ui.text }]}>{child.name}</Text>
                    </PressScale>
                  );
                })}
                <PressScale testID="kids-add-child" onPress={openChildSheet} style={[styles.childChip, styles.childChipIdle]}>
                  <Plus color={ui.orange} size={18} />
                  <Text style={[styles.childChipText, { color: ui.text }]}>{t('kids_add_child')}</Text>
                </PressScale>
              </ScrollView>

              {activeChild ? (
                <>
                  {/* Wallet */}
                  <Card style={styles.walletCard}>
                    <View style={[styles.walletAvatar, { backgroundColor: ui.orangeSoft }]}>
                      <Text style={[styles.walletAvatarText, { color: ui.orange }]}>{activeChild.name[0]?.toUpperCase()}</Text>
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
                          hitSlop={12}
                          style={{ padding: 2 }}
                        >
                          <MoreHorizontal color={ui.muted} size={16} />
                        </PressScale>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
                    <PressScale testID="kids-redeem" onPress={() => setKidsTab('rewards')} style={styles.redeemBtn}>
                      <Text style={styles.redeemText}>{t('redeem')}</Text>
                    </PressScale>
                  </Card>
                  <Text style={styles.weeklyLine}>{weeklyLine}</Text>

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

                      <Text style={styles.blockLabel}>{t('kids_quick_add')}</Text>
                      <View style={styles.quickAddRow}>
                        {QUICK_ADDS.map((q) => (
                          <PressScale key={q.labelKey} testID={`quick-add-${q.labelKey}`} onPress={() => quickAdd(t(q.labelKey), q.amount, q.chore)} style={styles.quickAddChip}>
                            <IconTile bg={q.bg} size={30} radius={9}><q.Icon color={q.tint} size={15} /></IconTile>
                            <Text style={styles.quickAddText} numberOfLines={1}>{t(q.labelKey)}</Text>
                            <Text style={styles.quickAddAmt}>+{q.amount}</Text>
                          </PressScale>
                        ))}
                      </View>

                      <View style={styles.blockHead}>
                        <Text style={styles.blockTitle}>{t('kids_rewards_in_reach')}</Text>
                        <PressScale testID="kids-add-reward" onPress={openCreateReward} style={styles.newLink}>
                          <Plus color={ui.orange} size={14} />
                          <Text style={styles.newLinkText}>{t('kids_new')}</Text>
                        </PressScale>
                      </View>
                      {rewards.length === 0 ? (
                        <Card style={styles.emptyRewards}>
                          <Text style={styles.emptyRewardsText}>{t('no_rewards')}</Text>
                          <PressScale testID="kids-add-reward-empty" onPress={openCreateReward} style={styles.emptyRewardsBtn}>
                            <Plus color={ui.bg} size={16} />
                            <Text style={styles.emptyRewardsBtnText}>{t('kids_add_reward')}</Text>
                          </PressScale>
                        </Card>
                      ) : (
                        <Card style={styles.cardPad}>
                          {(showAllRewards ? sortedRewards : sortedRewards.slice(0, 5)).map((reward, index, arr) => {
                            const pct = Math.min(100, Math.round((stars / reward.cost_stars) * 100));
                            const affordable = stars >= reward.cost_stars;
                            return (
                              <View key={reward.reward_id} style={[styles.rewardRow, index < arr.length - 1 && styles.rewardRowBorder]}>
                                {/* The row body opens edit, in both states. Before,
                                    edit was only reachable while a reward was
                                    UNaffordable — the pencil sat where Redeem
                                    later appears — so the moment a child could
                                    afford something, the parent lost the way to
                                    change it. */}
                                <PressScale
                                  accessibilityRole="button"
                                  accessibilityLabel={t('a11y_edit')}
                                  testID={`edit-reward-${reward.reward_id}`}
                                  onPress={() => openEditReward(reward)}
                                  style={styles.rewardBody}
                                >
                                  <IconTile bg={affordable ? ui.orangeSoft : ui.soft} size={42} radius={13}>
                                    <Text style={styles.rewardEmoji}>{reward.icon || DEFAULT_REWARD_ICON}</Text>
                                  </IconTile>
                                  <View style={{ flex: 1, minWidth: 0 }}>
                                    <View style={styles.rewardTopRow}>
                                      <Text style={styles.rewardTitle} numberOfLines={1}>{reward.title}</Text>
                                      <Text style={[styles.rewardCount, affordable && { color: ui.mintText }]}>{stars} / {reward.cost_stars}</Text>
                                    </View>
                                    <View style={{ marginTop: 8 }}>
                                      <ProgressBar pct={pct} color={affordable ? ui.mintText : ui.orange} />
                                    </View>
                                  </View>
                                </PressScale>
                                {affordable ? (
                                  <PressScale testID={`redeem-reach-${reward.reward_id}`} onPress={() => redeem(reward)} style={styles.rewardRedeem}>
                                    <Text style={styles.rewardRedeemText}>{t('redeem')}</Text>
                                  </PressScale>
                                ) : (
                                  /* Where Redeem will be, say how far away it is.
                                     A pencil here read as "the button is missing",
                                     not "not yet". */
                                  <View style={styles.rewardToGo}>
                                    <Text style={styles.rewardToGoText}>
                                      {t('kids_stars_to_go', { n: reward.cost_stars - stars })}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            );
                          })}
                          {sortedRewards.length > 5 ? (
                            <PressScale
                              testID="kids-toggle-all-rewards"
                              onPress={() => setShowAllRewards((v) => !v)}
                              style={styles.showAllBtn}
                            >
                              <Text style={styles.showAllText}>
                                {showAllRewards
                                  ? t('kids_show_fewer')
                                  : t('kids_show_all_rewards', { n: sortedRewards.length })}
                              </Text>
                            </PressScale>
                          ) : null}
                        </Card>
                      )}

                      <Text style={styles.blockLabel}>{t('kids_quick_reward_ideas')}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ideaRow} style={styles.ideaScroll}>
                        {REWARD_IDEAS.map((idea) => (
                          <PressScale key={idea.titleKey} testID={idea.titleKey} onPress={() => { setRewardMode('create'); setEditingReward(null); setRewardTitle(t(idea.titleKey)); setRewardCost(String(idea.cost_stars)); setRewardIcon(idea.icon); setShowRewardSheet(true); }} style={styles.ideaChip}>
                            <Text style={styles.ideaEmoji}>{idea.icon}</Text>
                            <Text style={styles.ideaTitle} numberOfLines={1}>{t(idea.titleKey)}</Text>
                            <Text style={styles.ideaCost}>{idea.cost_stars} {t('stars')}</Text>
                          </PressScale>
                        ))}
                      </ScrollView>

                      <RecentActivity items={historyItems.slice(0, 4)} loading={historyLoading} />
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

                      </View>
                      <View style={styles.quickRow}>
                        {['5', '10', '20'].map((amount) => (
                          <PressScale key={amount} testID={`quick-stars-${amount}`} onPress={() => openStarSheet('add', amount)} style={styles.quickStarBtn}>
                            <Text style={styles.quickStarText}>+{amount}</Text>
                          </PressScale>
                        ))}
                        <PressScale testID="quick-stars-custom" onPress={() => openStarSheet('add', '')} style={[styles.quickStarBtn, { backgroundColor: ui.orangeSoft, borderColor: ui.orange }]}>
                          <Text style={[styles.quickStarText, { color: ui.orange }]}>{t('kids_other')}</Text>
                        </PressScale>
                      </View>
                      <RecentActivity items={historyItems.slice(0, 6)} loading={historyLoading} />
                    </>
                  )}

                  {/* History tab */}
                  {kidsTab === 'history' && (
                    <RecentActivity items={historyItems} loading={historyLoading} expanded />
                  )}
                </>
              ) : null}
            </>
          )}

          {/* Morning Routines */}
          {childRoutines.length > 0 ? (
            <>
              <View style={styles.featureHeader}>
                <Timer color={ui.lavenderText} size={18} />
                <Text style={styles.featureHeaderText}>{t('kids_morning_routines')}</Text>
              </View>
              <Card style={styles.cardPad}>
                {childRoutines.map((rtn) => (
                  <View key={rtn.routine_id} style={styles.featureRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.featureRowTitle}>{rtn.name}</Text>
                      <Text style={styles.featureRowSub}>
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
          {activeChild ? (
            <>
              <View style={styles.featureHeader}>
                <DollarSign color={ui.goldText} size={18} />
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
                      <Text style={styles.allowanceBalance}>${childBalance.toFixed(2)}</Text>
                      <Text style={styles.featureRowSub}>
                        {childAllowance ? `$${childAllowance.amount}/${t('kids_freq_' + childAllowance.frequency)}` : t('kids_no_allowance_set')}
                      </Text>
                      {/* Setting an amount used to do nothing on its own. This
                          is the line that tells a parent the app is keeping
                          count, and whether anything is owed today. */}
                      {childAllowance ? (
                        <Text style={styles.allowanceDue}>
                          {childAllowance.is_due
                            ? t('kids_allowance_due_now')
                            : t('kids_allowance_due_on', { date: formatDueDate(childAllowance.next_due_at) })}
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

          {/* Chore Wheel */}
          {chores.length > 0 ? (
            <>
              <View style={styles.featureHeader}>
                <RotateCcw color={ui.mintText} size={18} />
                <Text style={styles.featureHeaderText}>{t('kids_chore_wheel')}</Text>
              </View>
              <Card style={styles.cardPad}>
                {chores.map((chore) => (
                  <View key={chore.chore_id} style={styles.featureRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.featureRowTitle}>{chore.title}</Text>
                      <Text style={styles.featureRowSub}>
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
                      <PressScale onPress={() => rotateChore(chore.chore_id)} style={[styles.featureActionBtn, { marginLeft: 6 }]}>
                        <RotateCcw color="#FFFFFF" size={14} />
                        <Text style={styles.featureActionText}>{t('kids_rotate')}</Text>
                      </PressScale>
                    ) : null}
                    <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} onPress={() => deleteChore(chore.chore_id)} style={{ padding: 4, marginLeft: 6 }}>
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
        <TextInput testID="child-pin" value={childPin} onChangeText={(v) => setChildPin(cleanNumber(v).slice(0, 4))} keyboardType="number-pad" secureTextEntry placeholder={t('kids_pin_placeholder')} placeholderTextColor={ui.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-child" onPress={() => setShowChildSheet(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('cancel')}</Text></PressScale>
          <PressScale testID="save-child" onPress={createChild} disabled={saving || !childName.trim()} style={[styles.saveBtn, (!childName.trim() || saving) && { opacity: 0.5 }]}><Text style={styles.saveText}>{saving ? '...' : t('kids_save_child')}</Text></PressScale>
        </View>
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

        <Text style={styles.label}>
          {activeChild?.has_pin ? t('kids_change_pin') : t('kids_set_pin')}
        </Text>
        <TextInput
          testID="manage-child-pin"
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
      <KeyboardAwareBottomSheet visible={showRewardSheet} onClose={closeRewardSheet} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{rewardMode === 'edit' ? t('kids_edit_reward') : t('kids_add_reward_title')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-reward" onPress={closeRewardSheet} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.label}>{t('kids_reward_title')}</Text>
        <TextInput testID="reward-title" value={rewardTitle} onChangeText={setRewardTitle} placeholder={t('kids_reward_title_placeholder')} placeholderTextColor={ui.muted} style={styles.input} returnKeyType="next" />
        <Text style={styles.label}>{t('kids_suggested_icon')}</Text>
        <View style={styles.iconRow}>
          {iconSuggestions.map((icon) => (
            <PressScale key={icon} testID={`reward-icon-${icon}`} onPress={() => setRewardIcon(icon)} style={[styles.iconChip, { backgroundColor: rewardIcon === icon ? ui.orangeSoft : ui.soft, borderColor: rewardIcon === icon ? ui.orange : ui.line }]}>
              <Text style={styles.iconChipText}>{icon}</Text>
            </PressScale>
          ))}
        </View>
        <Text style={styles.label}>{t('kids_cost_in_stars')}</Text>
        <TextInput testID="reward-cost" value={rewardCost} onChangeText={(v) => setRewardCost(cleanNumber(v))} keyboardType="number-pad" placeholder="50" placeholderTextColor={ui.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          {rewardMode === 'edit' && editingReward ? (
            <PressScale testID="delete-reward" onPress={() => confirmRemoveReward(editingReward)} style={styles.deleteBtn}>
              <Trash2 color={ui.danger} size={17} />
              <Text style={styles.deleteText}>{t('kids_delete')}</Text>
            </PressScale>
          ) : (
            <PressScale testID="cancel-reward" onPress={closeRewardSheet} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('cancel')}</Text></PressScale>
          )}
          <PressScale testID="save-reward" onPress={saveReward} disabled={saving || !rewardTitle.trim()} style={[styles.saveBtn, (!rewardTitle.trim() || saving) && { opacity: 0.5 }]}><Text style={styles.saveText}>{saving ? '...' : t('save')}</Text></PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* Star sheet */}
      <KeyboardAwareBottomSheet visible={showStarSheet} onClose={() => setShowStarSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{starMode === 'add' ? t('kids_add_stars') : t('kids_remove_stars')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-stars" onPress={() => setShowStarSheet(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.sheetHelp}>{t('kids_for')} {activeChild?.name || t('kids_selected_child')}</Text>
        <Text style={styles.label}>{t('kids_amount')}</Text>
        <TextInput testID="star-amount" value={starAmount} onChangeText={(v) => setStarAmount(cleanNumber(v))} keyboardType="number-pad" placeholder="5" placeholderTextColor={ui.muted} style={styles.input} />
        <Text style={styles.label}>{t('kids_reason')}</Text>
        <TextInput testID="star-reason" value={starReason} onChangeText={setStarReason} placeholder={starMode === 'add' ? t('kids_reason_add_placeholder') : t('kids_reason_remove_placeholder')} placeholderTextColor={ui.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-stars" onPress={() => setShowStarSheet(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('cancel')}</Text></PressScale>
          <PressScale testID="save-stars" onPress={adjustStars} disabled={saving || !starAmount} style={[styles.saveBtn, (!starAmount || saving) && { opacity: 0.5 }]}><Text style={styles.saveText}>{saving ? '...' : t('save')}</Text></PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showFixSheet} onClose={() => setShowFixSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('kids_fix_balance')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-fix" onPress={() => setShowFixSheet(false)} style={styles.iconBtn}><X color={ui.text} size={20} /></PressScale>
        </View>
        <Text style={styles.sheetHelp}>{t('kids_fix_help', { name: activeChild?.name || '' })}</Text>
        <Text style={styles.label}>{t('kids_correct_total')}</Text>
        <TextInput testID="fix-balance-input" value={fixValue} onChangeText={(v) => setFixValue(cleanNumber(v))} keyboardType="number-pad" placeholder="0" placeholderTextColor={ui.muted} style={styles.input} />
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
          {t('kids_for')} {activeChild?.name || t('kids_selected_child')} · ${childBalance.toFixed(2)}
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
                {txn.txn_type === 'withdrawal' ? '−' : '+'}${Number(txn.amount).toFixed(2)}
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
        <TextInput testID="allowance-amount" value={alwAmount} onChangeText={(v) => setAlwAmount(cleanNumber(v))} keyboardType="number-pad" placeholder="5" placeholderTextColor={ui.muted} style={styles.input} />
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

      <PinPadModal
        visible={pinPromptReward !== null}
        mode="verify"
        title={activeChild ? t('kids_childs_pin', { name: activeChild.name }) : t('kids_pin')}
        subtitle={t('kids_pin_subtitle')}
        onClose={() => setPinPromptReward(null)}
        onSubmit={async (pin) => {
          if (!activeChild || !pinPromptReward) return false;
          try {
            await api.verifyMemberPin(activeChild.member_id, pin);
            const reward = pinPromptReward;
            setPinPromptReward(null);
            await doRedeem(reward);
            return true;
          } catch {
            return false;
          }
        }}
      />

      <LoadingOverlay visible={loading} label={t('kids_loading')} />
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} />
    </SwipeableTabView>
  );
}

function RecentActivity({ items, loading, expanded }: { items: StarTransaction[]; loading: boolean; expanded?: boolean }) {
  const ui = useUI();
  const { t } = useStore();
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
                  <Text style={styles.activityDate}>{formatActivityDate(item.created_at)}</Text>
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

  walletCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginTop: 18 },
  walletAvatar: { width: 52, height: 52, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  walletAvatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 20 },
  walletLabel: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, flexShrink: 1 },
  walletLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  helperText: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 6, lineHeight: 17 },
  inlineLink: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 2 },
  inlineLinkText: { color: ui.danger, fontFamily: 'Inter_700Bold', fontSize: 13 },
  walletCount: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 30, lineHeight: 35, marginTop: 1 },
  redeemBtn: { backgroundColor: ui.text, borderRadius: 99, paddingHorizontal: 20, paddingVertical: 13 },
  redeemText: { color: ui.bg, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  weeklyLine: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13.5, marginTop: 12, paddingHorizontal: 2 },

  tabRow: { flexDirection: 'row', gap: 26, borderBottomWidth: 1, borderBottomColor: ui.line, marginTop: 18 },
  tabBtn: { paddingTop: 6, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 15 },

  blockLabel: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13, marginTop: 20, marginBottom: 10 },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  blockTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, letterSpacing: -0.2 },
  newLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  newLinkText: { color: ui.orange, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  cardPad: { paddingHorizontal: 16 },

  quickAddRow: { flexDirection: 'row', gap: 10 },
  quickAddChip: { flex: 1, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', gap: 6 },
  quickAddText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 12, textAlign: 'center' },
  quickAddAmt: { color: ui.mintText, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },

  emptyRewards: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  emptyRewardsText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  emptyRewardsBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: ui.orange, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 99 },
  emptyRewardsBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rewardRowBorder: { borderBottomWidth: 1, borderBottomColor: ui.line },
  rewardEmoji: { fontSize: 20 },
  rewardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rewardTitle: { flex: 1, color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 14.5 },
  rewardCount: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  rewardRedeem: { backgroundColor: ui.text, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 9 },
  rewardRedeemText: { color: ui.bg, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
  rewardBody: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rewardToGo: { borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, paddingHorizontal: 12, paddingVertical: 9 },
  rewardToGoText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12 },
  rewardEdit: { width: 34, height: 34, borderRadius: 99, borderWidth: 1, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },

  // Outstanding redemptions. Deliberately not reusing rewardTitle: that one
  // carries flex:1 for a row layout and would stretch vertically here.
  pendingHead: { marginTop: 6, marginBottom: 10 },
  pendingTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 14.5 },
  pendingMeta: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 3 },
  owedBadge: { position: 'absolute', top: -3, right: -3, minWidth: 15, height: 15, paddingHorizontal: 3, borderRadius: 99, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: ui.card },
  owedBadgeText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 8.5 },

  ideaScroll: { marginHorizontal: -20 },
  ideaRow: { gap: 10, paddingHorizontal: 20 },
  ideaChip: { width: 120, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 16, padding: 12, gap: 4 },
  ideaEmoji: { fontSize: 22 },
  ideaTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 13, marginTop: 4 },
  ideaCost: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 11.5 },

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
  iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  iconChip: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  iconChipText: { fontSize: 22 },
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  modeBtn: { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 12 },
  modeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: ui.line, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: 'rgba(220,38,38,0.35)', backgroundColor: ui.dangerSoft, borderRadius: 18, paddingVertical: 15 },
  deleteText: { color: ui.danger, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', backgroundColor: ui.orange },
  saveText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },

  featureHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 10 },
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
  featureActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: ui.orange, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99 },
  featureActionText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  allowanceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  allowanceBalance: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 28 },
  allowanceDue: { color: ui.orange, fontFamily: 'Inter_700Bold', fontSize: 12, marginTop: 3 },
  payNowBtn: { backgroundColor: ui.orange, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 9 },
  payNowText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
  showAllBtn: { alignItems: 'center', paddingVertical: 13, borderTopWidth: 1, borderTopColor: ui.line },
  showAllText: { color: ui.orange, fontFamily: 'Inter_700Bold', fontSize: 13 },
});
