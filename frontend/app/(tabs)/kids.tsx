import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  Plus,
  Star,
  Gift,
  X,
  Trash2,
  Sparkles,
  Lock,
  UserPlus,
  Pencil,
  MinusCircle,
  History,
  ChevronDown,
} from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { PressScale } from '../../src/components/PressScale';
import { PinPadModal } from '../../src/components/PinPadModal';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast, { ToastTone } from '../../src/components/AppToast';
import EmptyState from '../../src/components/EmptyState';
import ErrorState from '../../src/components/ErrorState';
import LoadingOverlay from '../../src/components/LoadingOverlay';

import { useStore } from '../../src/store';
import { api, FamilyMember, Reward, StarTransaction } from '../../src/api';
import { logger } from '../../src/logger';

type ToastState = {
  message: string;
  tone: ToastTone;
};

type RewardSheetMode = 'create' | 'edit';
type StarMode = 'add' | 'remove';

const DEFAULT_REWARD_ICON = String.fromCodePoint(0x1F381);

const REWARD_IDEAS = [
  { title: 'Pizza night', cost_stars: 50, icon: String.fromCodePoint(0x1F355) },
  { title: 'Movie night', cost_stars: 75, icon: String.fromCodePoint(0x1F3AC) },
  { title: 'Ice cream treat', cost_stars: 40, icon: String.fromCodePoint(0x1F366) },
  { title: 'Game time', cost_stars: 60, icon: String.fromCodePoint(0x1F3AE) },
] as const;

const ICON_LIBRARY: { match: string[]; icons: string[] }[] = [
  { match: ['pizza', 'dinner', 'restaurant', 'food'], icons: [String.fromCodePoint(0x1F355), String.fromCodePoint(0x1F37D), String.fromCodePoint(0x1F389), String.fromCodePoint(0x1F354)] },
  { match: ['movie', 'cinema', 'film'], icons: [String.fromCodePoint(0x1F3AC), String.fromCodePoint(0x1F37F), String.fromCodePoint(0x1F39F), String.fromCodePoint(0x2B50)] },
  { match: ['ice', 'cream', 'sweet', 'cake', 'cupcake', 'dessert'], icons: [String.fromCodePoint(0x1F366), String.fromCodePoint(0x1F9C1), String.fromCodePoint(0x1F370), String.fromCodePoint(0x1F369)] },
  { match: ['game', 'gaming', 'playstation', 'xbox', 'switch'], icons: [String.fromCodePoint(0x1F3AE), String.fromCodePoint(0x1F579), String.fromCodePoint(0x1F3C6), String.fromCodePoint(0x26A1)] },
  { match: ['park', 'outside', 'walk', 'trip'], icons: [String.fromCodePoint(0x1F333), String.fromCodePoint(0x1F6DD), String.fromCodePoint(0x2600), String.fromCodePoint(0x1F6B2)] },
  { match: ['book', 'reading', 'story'], icons: [String.fromCodePoint(0x1F4DA), String.fromCodePoint(0x1F4D6), String.fromCodePoint(0x2728), String.fromCodePoint(0x1F3C5)] },
  { match: ['toy', 'lego', 'gift'], icons: [String.fromCodePoint(0x1F9F8), String.fromCodePoint(0x1F381), String.fromCodePoint(0x1FA80), String.fromCodePoint(0x2728)] },
  { match: ['sleepover', 'friend', 'party'], icons: [String.fromCodePoint(0x1F389), String.fromCodePoint(0x1F3E0), String.fromCodePoint(0x1F9C3), String.fromCodePoint(0x2B50)] },
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

export default function KidsScreen() {
  const { t, theme } = useStore();

  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [historyItems, setHistoryItems] = useState<StarTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);

  const [showAddMenu, setShowAddMenu] = useState(false);

  const [showChildSheet, setShowChildSheet] = useState(false);
  const [childName, setChildName] = useState('');
  const [childStartingStars, setChildStartingStars] = useState('0');
  const [childPin, setChildPin] = useState('');

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
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pinPromptReward, setPinPromptReward] = useState<Reward | null>(null);

  const children = useMemo(() => members.filter((m) => m.role?.toLowerCase() === 'child'), [members]);
  const activeChild = children.find((c) => c.member_id === selectedChild) || children[0];
  const stars = activeChild?.stars || 0;
  const iconSuggestions = useMemo(() => suggestedIcons(rewardTitle), [rewardTitle]);
  const affordableRewards = useMemo(() => rewards.filter((reward) => stars >= reward.cost_stars).length, [rewards, stars]);
  const totalRewards = rewards.length;
  const recentActivityCount = historyItems.length;
  const latestActivity = historyItems[0];

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
      if (!message.includes('404')) {
        logger.warn('Star history load failed:', message);
      }
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
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
    } catch (e: any) {
      logger.warn('Kids page load failed:', e?.message || e);
      setErrorMessage(e?.message || 'Could not load Kids page.');
    } finally {
      setLoading(false);
    }
  }, [refreshHistory, selectedChild]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    refreshHistory(activeChild?.member_id);
  }, [activeChild?.member_id, refreshHistory]);

  const showBlockingError = !loading && Boolean(errorMessage) && members.length === 0;

  const openChildSheet = () => {
    setShowAddMenu(false);
    setChildName('');
    setChildStartingStars('0');
    setChildPin('');
    setTimeout(() => setShowChildSheet(true), 180);
  };

  const openCreateReward = () => {
    setShowAddMenu(false);
    setRewardMode('create');
    setEditingReward(null);
    setRewardTitle('');
    setRewardCost('50');
    setRewardIcon(DEFAULT_REWARD_ICON);
    setTimeout(() => setShowRewardSheet(true), 180);
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
      showToast('Add or select a child first.', 'error');
      return;
    }
    setStarMode(mode);
    setStarAmount(amount);
    setStarReason(mode === 'add' ? 'Good job' : '');
    setShowStarSheet(true);
  };

  const createChild = async () => {
    const name = childName.trim();
    const starting = parseInt(childStartingStars || '0', 10) || 0;
    const pin = childPin.trim();

    if (!name) {
      showToast('Child name is required.', 'error');
      return;
    }
    if (starting < 0) {
      showToast('Starting stars cannot be negative.', 'error');
      return;
    }
    if (pin && !/^\d{4}$/.test(pin)) {
      showToast('PIN must be 4 digits.', 'error');
      return;
    }

    setSaving(true);
    try {
      const created = await api.createFamilyMember({
        name,
        starting_stars: starting,
        pin: pin || undefined,
      });
      setMembers((prev) => [...prev, created]);
      setSelectedChild(created.member_id);
      setShowChildSheet(false);
      showToast(`${created.name} added.`, 'success');
      await refreshHistory(created.member_id);
    } catch (e: any) {
      logger.warn('Create child failed:', e?.message || e);
      showToast(e?.message || 'Could not add child.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveReward = async () => {
    const title = rewardTitle.trim();
    const cost = parseInt(rewardCost || '0', 10);
    const icon = rewardIcon || DEFAULT_REWARD_ICON;

    if (!title || !cost || cost < 1) {
      showToast('Reward title and star cost are required.', 'error');
      return;
    }

    setSaving(true);
    try {
      if (rewardMode === 'edit' && editingReward) {
        const updated = await api.updateReward(editingReward.reward_id, {
          title,
          cost_stars: cost,
          icon,
        });
        setRewards((prev) => prev.map((r) => (r.reward_id === updated.reward_id ? updated : r)));
        showToast('Reward updated.', 'success');
      } else {
        const created = await api.createReward({ title, cost_stars: cost, icon });
        setRewards((prev) => [created, ...prev]);
        showToast('Reward created.', 'success');
      }
      closeRewardSheet();
    } catch (e: any) {
      logger.warn('Save reward failed:', e?.message || e);
      showToast(e?.message || 'Could not save reward.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeReward = async (reward: Reward) => {
    const previous = rewards;
    setRewards((prev) => prev.filter((x) => x.reward_id !== reward.reward_id));
    try {
      await api.deleteReward(reward.reward_id);
      showToast('Reward deleted.', 'success');
      closeRewardSheet();
    } catch (e: any) {
      logger.warn('Delete reward failed:', e?.message || e);
      setRewards(previous);
      showToast('Could not delete reward.', 'error');
      load();
    }
  };

  const confirmRemoveReward = (reward: Reward) => {
    if (Platform.OS === 'web') {
      removeReward(reward);
      return;
    }
    Alert.alert('Delete reward', reward.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeReward(reward) },
    ]);
  };

  const adjustStars = async () => {
    if (!activeChild) return;

    const amount = parseInt(starAmount || '0', 10);
    if (!amount || amount < 1) {
      showToast('Enter a valid star amount.', 'error');
      return;
    }

    const delta = starMode === 'add' ? amount : -amount;
    if (stars + delta < 0) {
      showToast('Stars cannot go below zero.', 'error');
      return;
    }

    const reason = starReason.trim();
    if (delta < 0 && !reason) {
      showToast('Please add a reason for removing stars.', 'error');
      return;
    }

    setSaving(true);
    try {
      const result = await api.adjustMemberStars(activeChild.member_id, {
        delta,
        reason: reason || (delta > 0 ? 'Parent added stars' : 'Parent removed stars'),
      });
      setMembers((prev) => prev.map((member) => (member.member_id === result.member.member_id ? result.member : member)));
      setShowStarSheet(false);
      showToast(delta > 0 ? `Added ${amount} stars.` : `Removed ${amount} stars.`, 'success');
      await refreshHistory(activeChild.member_id);
    } catch (e: any) {
      logger.warn('Adjust stars failed:', e?.message || e);
      showToast(e?.message || 'Could not update stars.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const doRedeem = useCallback(async (reward: Reward) => {
    if (!activeChild) return;
    try {
      const res = await api.redeemReward(reward.reward_id, activeChild.member_id);
      setMembers((prev) => prev.map((m) => (m.member_id === res.member.member_id ? res.member : m)));
      showToast(`${t('redeemed')} ${reward.title}`, 'success');
      await refreshHistory(activeChild.member_id);
    } catch (e: any) {
      logger.warn('Reward redemption failed:', e?.message || e);
      showToast(e?.message || 'Could not redeem reward.', 'error');
    }
  }, [activeChild, refreshHistory, showToast, t]);

  const redeem = async (reward: Reward) => {
    if (!activeChild) return;
    if ((activeChild.stars || 0) < reward.cost_stars) {
      showToast(t('not_enough_stars'), 'error');
      return;
    }
    if (activeChild.has_pin) {
      setPinPromptReward(reward);
      return;
    }
    await doRedeem(reward);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <AmbientBackground />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.colors.text }]}>Kids</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>Rewards, routines & proud little wins.</Text>
            </View>
            <View>
              <PressScale
                testID="kids-add-menu"
                onPress={() => setShowAddMenu(true)}
                style={[styles.addBtn, { backgroundColor: theme.colors.primary, shadowColor: theme.colors.shadow }]}
              >
                <Plus color={theme.colors.primaryText} size={21} />
                <ChevronDown color={theme.colors.primaryText} size={14} />
              </PressScale>
            </View>
          </View>

          {showBlockingError ? (
            <ErrorState title="Kids page unavailable" message={errorMessage || 'Could not load Kids page.'} onRetry={load} />
          ) : children.length === 0 && !loading ? (
            <EmptyState title="No children yet" message="Add your first child to start using stars and rewards." actionLabel="Add Child" onAction={openChildSheet} />
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.childRow} keyboardShouldPersistTaps="handled">
                {children.map((child) => {
                  const active = child.member_id === activeChild?.member_id;
                  return (
                    <PressScale
                      key={child.member_id}
                      testID={`child-${child.member_id}`}
                      onPress={() => setSelectedChild(child.member_id)}
                      style={[
                        styles.childBtn,
                        { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder },
                        active && { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
                      ]}
                    >
                      <View style={[styles.childAvatar, { backgroundColor: theme.colors.bgSoft, borderColor: active ? theme.colors.accent : theme.colors.cardBorder }]}>
                        <Text style={[styles.childInitial, { color: theme.colors.text }]}>{child.name[0]?.toUpperCase()}</Text>
                        {child.has_pin ? (
                          <View style={[styles.lockBadge, { backgroundColor: theme.colors.primary, borderColor: theme.colors.accent }]}>
                            <Lock color={theme.colors.primaryText} size={9} />
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.childName, { color: theme.colors.text }]}>{child.name}</Text>
                      <View style={styles.childStarsRow}>
                        <Star color={theme.colors.accent} size={12} fill={theme.colors.accent} />
                        <Text style={[styles.childStars, { color: theme.colors.textMuted }]}>{child.stars}</Text>
                      </View>
                    </PressScale>
                  );
                })}
              </ScrollView>

              {activeChild ? (
                <View style={styles.hero}>
                  <View style={styles.heroGlowOne} />
                  <View style={styles.heroGlowTwo} />
                  <View style={styles.heroBadge}>
                    <Sparkles color="#111827" size={14} />
                    <Text style={styles.heroBadgeText}>Today</Text>
                  </View>

                  <View style={styles.heroTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.heroLabel}>Star wallet</Text>
                      <Text style={styles.heroName}>{activeChild.name}</Text>
                      <Text style={styles.heroSubtext}>Keep momentum going with small wins, quick boosts, and motivating rewards.</Text>
                    </View>
                    <View style={styles.pinPill}>
                      <Lock color={activeChild.has_pin ? '#F59E0B' : 'rgba(255,255,255,0.45)'} size={13} />
                      <Text style={styles.pinText}>{activeChild.has_pin ? 'PIN on' : 'No PIN'}</Text>
                    </View>
                  </View>

                  <View style={styles.heroScoreRow}>
                    <View style={styles.heroScoreCircle}>
                      <View style={styles.heroScoreRing} />
                      <View style={styles.heroScoreArc} />
                      <Star color="#F59E0B" size={20} fill="#F59E0B" />
                      <Text style={styles.heroScoreValue}>{stars}</Text>
                      <Text style={styles.heroScoreCaption}>{t('stars')}</Text>
                    </View>

                    <View style={styles.heroInsightCol}>
                      <View style={styles.heroInsightCard}>
                        <Text style={styles.heroInsightKicker}>Ready now</Text>
                        <Text style={styles.heroInsightValue}>{affordableRewards}</Text>
                        <Text style={styles.heroInsightLabel}>rewards available</Text>
                      </View>
                      <View style={styles.heroInsightCard}>
                        <Text style={styles.heroInsightKicker}>Recent activity</Text>
                        <Text style={styles.heroInsightValue}>{recentActivityCount}</Text>
                        <Text style={styles.heroInsightLabel}>{latestActivity?.reason ? latestActivity.reason : 'actions logged'}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.heroActions}>
                    <PressScale testID="kids-add-stars" onPress={() => openStarSheet('add', '5')} style={styles.heroActionBtn}>
                      <Plus color="#111827" size={16} />
                      <Text style={styles.heroActionText}>Add stars</Text>
                    </PressScale>
                    <PressScale testID="kids-remove-stars" onPress={() => openStarSheet('remove', '5')} style={styles.heroActionBtnSecondary}>
                      <MinusCircle color="#FFFFFF" size={16} />
                      <Text style={styles.heroActionTextSecondary}>Remove</Text>
                    </PressScale>
                  </View>
                </View>
              ) : null}

              <View style={styles.quickRow}>
                {['5', '10', '20'].map((amount) => (
                  <PressScale key={amount} testID={`quick-stars-${amount}`} onPress={() => openStarSheet('add', amount)} style={[styles.quickBtn, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                    <Text style={[styles.quickText, { color: theme.colors.text }]}>+{amount}</Text>
                  </PressScale>
                ))}
                <PressScale testID="quick-stars-custom" onPress={() => openStarSheet('add', '')} style={[styles.quickBtn, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                  <Text style={[styles.quickText, { color: theme.colors.text }]}>Custom</Text>
                </PressScale>
              </View>

              <View style={styles.statRow}>
                <View style={[styles.statCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                  <Text style={[styles.statEyebrow, { color: theme.colors.textMuted }]}>Reward shop</Text>
                  <Text style={[styles.statValue, { color: theme.colors.text }]}>{affordableRewards}</Text>
                  <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>{totalRewards} total rewards</Text>
                </View>
                <View style={[styles.statCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                  <Text style={[styles.statEyebrow, { color: theme.colors.textMuted }]}>Activity</Text>
                  <Text style={[styles.statValue, { color: theme.colors.text }]}>{recentActivityCount}</Text>
                  <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>{latestActivity ? formatActivityDate(latestActivity.created_at) : 'No entries yet'}</Text>
                </View>
              </View>

              <GlassCard style={styles.historyCard}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionRowInline}>
                    <History color={theme.colors.textMuted} size={16} />
                    <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>Recent activity</Text>
                  </View>
                </View>
                {historyLoading ? (
                  <Text style={[styles.emptyMini, { color: theme.colors.textMuted }]}>Loading activity...</Text>
                ) : historyItems.length === 0 ? (
                  <Text style={[styles.emptyMini, { color: theme.colors.textMuted }]}>No activity yet.</Text>
                ) : (
                  historyItems.slice(0, 3).map((item) => {
                    const positive = item.delta > 0;
                    return (
                      <View key={item.transaction_id} style={styles.activityRow}>
                        <Text style={[styles.activityDelta, { color: positive ? theme.colors.success : '#EF4444' }]}>
                          {positive ? '+' : ''}{item.delta}
                        </Text>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.activityReason, { color: theme.colors.text }]} numberOfLines={1}>{item.reason || 'Star adjustment'}</Text>
                          <Text style={[styles.activityDate, { color: theme.colors.textMuted }]}>{formatActivityDate(item.created_at)}</Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </GlassCard>
              <View style={[styles.rewardShopShell, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                <View style={styles.rewardShopHeaderCard}>
                  <View style={[styles.rewardShopBadge, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}>
                    <Gift color={theme.colors.accent} size={18} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rewardShopTitle, { color: theme.colors.text }]}>Reward Shop</Text>
                    <Text style={[styles.rewardShopSubtitle, { color: theme.colors.textMuted }]}>Beautiful little goals to keep good habits exciting.</Text>
                  </View>
                  <View style={[styles.rewardShopCountPill, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                    <Star color={theme.colors.accent} size={12} fill={theme.colors.accent} />
                    <Text style={[styles.rewardShopCountText, { color: theme.colors.text }]}>{affordableRewards}/{totalRewards}</Text>
                  </View>
                </View>

                <Text style={[styles.rewardIdeasSub, { color: theme.colors.textMuted }]}>Quick reward ideas</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rewardIdeaGrid}>
                  {REWARD_IDEAS.map((idea) => (
                    <PressScale key={idea.title} testID={idea.title} onPress={() => { setRewardMode('create'); setEditingReward(null); setRewardTitle(idea.title); setRewardCost(String(idea.cost_stars)); setRewardIcon(idea.icon); setShowRewardSheet(true); }} style={[styles.rewardIdeaCard, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
                      <View style={[styles.rewardIdeaIconWrap, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}>
                        <Text style={styles.rewardIdeaIcon}>{idea.icon}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.rewardIdeaTitle, { color: theme.colors.text }]} numberOfLines={1}>{idea.title}</Text>
                        <View style={styles.rewardIdeaCostRow}>
                          <Star color={theme.colors.accent} size={11} fill={theme.colors.accent} />
                          <Text style={[styles.rewardIdeaCost, { color: theme.colors.textMuted }]}>{idea.cost_stars} {t('stars')}</Text>
                        </View>
                        <Text style={[styles.rewardIdeaHint, { color: theme.colors.textMuted }]}>Tap to create</Text>
                      </View>
                    </PressScale>
                  ))}
                </ScrollView>

                {rewards.length === 0 ? (
                  <EmptyState title={t('no_rewards')} message="Create a small reward to make chores feel more motivating." actionLabel="Add Reward" onAction={openCreateReward} />
                ) : (
                  <View style={styles.rewardList}>
                    {rewards.slice(0, 4).map((reward) => {
                      const affordable = stars >= reward.cost_stars;
                      const starsNeeded = Math.max(0, reward.cost_stars - stars);
                      const progressWidth = `${Math.min(100, Math.round((stars / reward.cost_stars) * 100))}%`;

                      return (
                        <GlassCard key={reward.reward_id} style={[styles.rewardCard, { borderColor: affordable ? theme.colors.accent : theme.colors.cardBorder }]}>
                          <View style={styles.rewardTopRow}>
                            <View style={[styles.rewardIconWrap, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}>
                              <Text style={styles.rewardIcon}>{reward.icon || DEFAULT_REWARD_ICON}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.rewardTitle, { color: theme.colors.text }]} numberOfLines={2}>{reward.title}</Text>
                              <View style={styles.rewardMetaRow}>
                                <View style={[styles.rewardCostPill, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                                  <Star color={theme.colors.accent} size={12} fill={theme.colors.accent} />
                                  <Text style={[styles.rewardCost, { color: theme.colors.textMuted }]}>{reward.cost_stars} {t('stars')}</Text>
                                </View>
                                <Text style={[styles.rewardAvailability, { color: affordable ? theme.colors.success : theme.colors.textMuted }]}>{affordable ? 'Ready to redeem' : `${starsNeeded} more needed`}</Text>
                              </View>
                            </View>
                          </View>
                          <View style={[styles.rewardProgressTrack, { backgroundColor: theme.colors.bgSoft }]}>
                            <View style={[styles.rewardProgressFill, { width: progressWidth as any, backgroundColor: theme.colors.accent }]} />
                          </View>
                          <View style={styles.rewardActions}>
                            <PressScale testID={`redeem-${reward.reward_id}`} onPress={() => redeem(reward)} disabled={!affordable} style={[styles.redeemBtn, { backgroundColor: theme.colors.primary }, !affordable && { opacity: 0.45 }]}>
                              <Text style={[styles.redeemText, { color: theme.colors.primaryText }]}>{affordable ? t('redeem') : 'Not enough stars'}</Text>
                            </PressScale>
                            <PressScale testID={`edit-reward-${reward.reward_id}`} onPress={() => openEditReward(reward)} style={[styles.editBtn, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                              <Pencil color={theme.colors.textMuted} size={15} />
                              <Text style={[styles.editText, { color: theme.colors.textMuted }]}>Edit</Text>
                            </PressScale>
                          </View>
                        </GlassCard>
                      );
                    })}
                  </View>
                )}
              </View>

              <View style={styles.tip}>
                <Sparkles color={theme.colors.textMuted} size={14} />
                <Text style={[styles.tipText, { color: theme.colors.textMuted }]}>Reward good habits - keep it fair</Text>
              </View>
            </>
          )}

          <View style={{ height: 170 }} />
        </ScrollView>
      </SafeAreaView>


      <KeyboardAwareBottomSheet visible={showAddMenu} onClose={() => setShowAddMenu(false)} contentStyle={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>Add to Kids</Text>
          <PressScale testID="close-add-menu" onPress={() => setShowAddMenu(false)} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
            <X color={theme.colors.text} size={20} />
          </PressScale>
        </View>

        <Text style={[styles.sheetHelp, { color: theme.colors.textMuted }]}>Choose what you want to create.</Text>

        <PressScale testID="kids-add-child" onPress={openChildSheet} style={[styles.menuSheetButton, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
          <View style={[styles.menuSheetIcon, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <UserPlus color={theme.colors.text} size={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.menuSheetTitle, { color: theme.colors.text }]}>Add Child</Text>
            <Text style={[styles.menuSheetSub, { color: theme.colors.textMuted }]}>Create another child profile with optional PIN.</Text>
          </View>
        </PressScale>

        <PressScale testID="kids-add-reward" onPress={openCreateReward} style={[styles.menuSheetButton, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
          <View style={[styles.menuSheetIcon, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <Gift color={theme.colors.text} size={22} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.menuSheetTitle, { color: theme.colors.text }]}>Add Reward</Text>
            <Text style={[styles.menuSheetSub, { color: theme.colors.textMuted }]}>Create a reward with suggested icons.</Text>
          </View>
        </PressScale>
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showChildSheet} onClose={() => setShowChildSheet(false)} contentStyle={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>Add Child</Text>
          <PressScale testID="close-child-sheet" onPress={() => setShowChildSheet(false)} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
            <X color={theme.colors.text} size={20} />
          </PressScale>
        </View>

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>Child name</Text>
        <TextInput testID="child-name" value={childName} onChangeText={setChildName} placeholder="Ava" placeholderTextColor={theme.colors.textSoft} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} returnKeyType="next" />

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>Starting stars</Text>
        <TextInput testID="child-starting-stars" value={childStartingStars} onChangeText={(value) => setChildStartingStars(cleanNumber(value))} keyboardType="number-pad" placeholder="0" placeholderTextColor={theme.colors.textSoft} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} />

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>PIN optional</Text>
        <TextInput testID="child-pin" value={childPin} onChangeText={(value) => setChildPin(cleanNumber(value).slice(0, 4))} keyboardType="number-pad" secureTextEntry placeholder="4 digits" placeholderTextColor={theme.colors.textSoft} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} />

        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-child" onPress={() => setShowChildSheet(false)} style={[styles.cancelBtn, { borderColor: theme.colors.cardBorder }]}>
            <Text style={[styles.cancelText, { color: theme.colors.textMuted }]}>{t('cancel')}</Text>
          </PressScale>
          <PressScale testID="save-child" onPress={createChild} disabled={saving || !childName.trim()} style={[styles.saveBtn, { backgroundColor: theme.colors.primary }, (!childName.trim() || saving) && { opacity: 0.5 }]}>
            <Text style={[styles.saveText, { color: theme.colors.primaryText }]}>{saving ? '...' : 'Save Child'}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showRewardSheet} onClose={closeRewardSheet} contentStyle={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>{rewardMode === 'edit' ? 'Edit Reward' : 'Add Reward'}</Text>
          <PressScale testID="close-reward" onPress={closeRewardSheet} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
            <X color={theme.colors.text} size={20} />
          </PressScale>
        </View>

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>Reward title</Text>
        <TextInput testID="reward-title" value={rewardTitle} onChangeText={setRewardTitle} placeholder="Pizza Night" placeholderTextColor={theme.colors.textSoft} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} returnKeyType="next" />

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>Suggested icon</Text>
        <View style={styles.iconSuggestionRow}>
          {iconSuggestions.map((icon) => (
            <PressScale key={icon} testID={`reward-icon-${icon}`} onPress={() => setRewardIcon(icon)} style={[styles.iconChip, { backgroundColor: rewardIcon === icon ? theme.colors.accentSoft : theme.colors.bgSoft, borderColor: rewardIcon === icon ? theme.colors.accent : theme.colors.cardBorder }]}>
              <Text style={styles.iconChipText}>{icon}</Text>
            </PressScale>
          ))}
        </View>

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>Cost in stars</Text>
        <TextInput testID="reward-cost" value={rewardCost} onChangeText={(value) => setRewardCost(cleanNumber(value))} keyboardType="number-pad" placeholder="50" placeholderTextColor={theme.colors.textSoft} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} />

        <View style={styles.sheetFooter}>
          {rewardMode === 'edit' && editingReward ? (
            <PressScale testID="delete-reward" onPress={() => confirmRemoveReward(editingReward)} style={[styles.deleteBtn, { borderColor: 'rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.10)' }]}>
              <Trash2 color="#EF4444" size={17} />
              <Text style={styles.deleteText}>Delete</Text>
            </PressScale>
          ) : (
            <PressScale testID="cancel-reward" onPress={closeRewardSheet} style={[styles.cancelBtn, { borderColor: theme.colors.cardBorder }]}>
              <Text style={[styles.cancelText, { color: theme.colors.textMuted }]}>{t('cancel')}</Text>
            </PressScale>
          )}

          <PressScale testID="save-reward" onPress={saveReward} disabled={saving || !rewardTitle.trim()} style={[styles.saveBtn, { backgroundColor: theme.colors.primary }, (!rewardTitle.trim() || saving) && { opacity: 0.5 }]}>
            <Text style={[styles.saveText, { color: theme.colors.primaryText }]}>{saving ? '...' : t('save')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showStarSheet} onClose={() => setShowStarSheet(false)} contentStyle={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>{starMode === 'add' ? 'Add stars' : 'Remove stars'}</Text>
          <PressScale testID="close-stars" onPress={() => setShowStarSheet(false)} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
            <X color={theme.colors.text} size={20} />
          </PressScale>
        </View>

        <Text style={[styles.sheetHelp, { color: theme.colors.textMuted }]}>For {activeChild?.name || 'selected child'}</Text>

        <View style={styles.modeRow}>
          <PressScale testID="mode-add-stars" onPress={() => setStarMode('add')} style={[styles.modeBtn, { backgroundColor: starMode === 'add' ? theme.colors.primary : theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
            <Text style={[styles.modeText, { color: starMode === 'add' ? theme.colors.primaryText : theme.colors.textMuted }]}>Add</Text>
          </PressScale>
          <PressScale testID="mode-remove-stars" onPress={() => setStarMode('remove')} style={[styles.modeBtn, { backgroundColor: starMode === 'remove' ? theme.colors.primary : theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
            <Text style={[styles.modeText, { color: starMode === 'remove' ? theme.colors.primaryText : theme.colors.textMuted }]}>- Stars</Text>
          </PressScale>
        </View>

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>Amount</Text>
        <TextInput testID="star-amount" value={starAmount} onChangeText={(value) => setStarAmount(cleanNumber(value))} keyboardType="number-pad" placeholder="5" placeholderTextColor={theme.colors.textSoft} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} />

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>Reason</Text>
        <TextInput testID="star-reason" value={starReason} onChangeText={setStarReason} placeholder={starMode === 'add' ? 'Homework, chores, kindness...' : 'Reason for deduction'} placeholderTextColor={theme.colors.textSoft} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} />

        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-stars" onPress={() => setShowStarSheet(false)} style={[styles.cancelBtn, { borderColor: theme.colors.cardBorder }]}>
            <Text style={[styles.cancelText, { color: theme.colors.textMuted }]}>{t('cancel')}</Text>
          </PressScale>
          <PressScale testID="save-stars" onPress={adjustStars} disabled={saving || !starAmount} style={[styles.saveBtn, { backgroundColor: theme.colors.primary }, (!starAmount || saving) && { opacity: 0.5 }]}>
            <Text style={[styles.saveText, { color: theme.colors.primaryText }]}>{saving ? '...' : 'Save'}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <PinPadModal
        visible={pinPromptReward !== null}
        mode="verify"
        title={activeChild ? `${activeChild.name}'s PIN` : 'PIN'}
        subtitle="Enter your 4-digit PIN to redeem"
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

      <LoadingOverlay visible={loading} label="Loading Kids page..." />
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 168 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, marginTop: 4, zIndex: 5 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 40, lineHeight: 44, letterSpacing: -1.0 },
  sub: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginTop: 4 },
  addBtn: { minWidth: 60, height: 56, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 2, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 5 },
  addMenu: { position: 'absolute', right: 0, top: 66, borderRadius: 24, borderWidth: 1, padding: 8, minWidth: 196, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.12, shadowRadius: 22, elevation: 8, zIndex: 10 },
  addMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 18 },
  addMenuText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  childRow: { gap: 12, paddingVertical: 6, paddingRight: 18, marginBottom: 0 },
  childBtn: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 26, borderWidth: 1, minWidth: 100, shadowColor: '#0F172A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 3 },
  childAvatar: { width: 48, height: 48, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  childInitial: { fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  lockBadge: { position: 'absolute', right: -4, bottom: -4, width: 19, height: 19, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  childName: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  childStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  childStars: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  hero: { position: 'relative', padding: 20, marginTop: 14, marginBottom: 14, borderRadius: 32, overflow: 'hidden', backgroundColor: '#172024', shadowColor: '#000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 8 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, zIndex: 2 },
  heroLabel: { color: 'rgba(255,255,255,0.72)', fontFamily: 'Inter_700Bold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.1 },
  heroName: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 28, lineHeight: 32, letterSpacing: -0.8, marginTop: 6 },
  pinPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 9999, paddingHorizontal: 11, paddingVertical: 7, zIndex: 2 },
  pinText: { color: 'rgba(255,255,255,0.72)', fontFamily: 'Inter_700Bold', fontSize: 12 },
  heroStars: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 18 },
  heroCount: { fontFamily: 'Inter_800ExtraBold', fontSize: 58, lineHeight: 64, letterSpacing: -1 },
  heroUnit: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  heroActions: { flexDirection: 'row', gap: 12, marginTop: 16, flexWrap: 'wrap', zIndex: 2 },
  heroActionBtn: { flex: 1, minWidth: 132, minHeight: 50, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 16, backgroundColor: '#FFFFFF' },
  heroActionBtnSecondary: { flex: 1, minWidth: 132, minHeight: 50, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 16 },
  heroActionText: { color: '#111827', fontFamily: 'Inter_800ExtraBold', fontSize: 15, textAlign: 'center' },
  heroActionTextSecondary: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15, textAlign: 'center' },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginBottom: 12 },
  quickBtn: { flexGrow: 1, flexBasis: '22%', minWidth: 72, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 20, borderWidth: 1, paddingHorizontal: 10 },
  quickText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  heroGlowOne: { position: 'absolute', top: -60, right: -40, width: 180, height: 180, borderRadius: 9999, backgroundColor: 'rgba(255,255,255,0.06)' },
  heroGlowTwo: { position: 'absolute', bottom: -36, left: -20, width: 150, height: 150, borderRadius: 9999, backgroundColor: 'rgba(245,158,11,0.10)' },
  heroBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', paddingHorizontal: 13, paddingVertical: 8, borderRadius: 9999, zIndex: 2 },
  heroBadgeText: { color: '#111827', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  heroSubtext: { color: 'rgba(255,255,255,0.76)', fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginTop: 6, maxWidth: 250 },
  heroScoreRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18, zIndex: 2 },
  heroScoreCircle: { width: 108, height: 108, borderRadius: 9999, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  heroScoreRing: { position: 'absolute', width: 96, height: 96, borderRadius: 9999, borderWidth: 8, borderColor: 'rgba(255,255,255,0.14)' },
  heroScoreArc: { position: 'absolute', width: 96, height: 96, borderRadius: 9999, borderTopWidth: 8, borderRightWidth: 8, borderTopColor: '#F59E0B', borderRightColor: '#F59E0B', borderLeftColor: 'transparent', borderBottomColor: 'transparent', transform: [{ rotate: '32deg' }] },
  heroScoreValue: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 28, lineHeight: 31, marginTop: 8 },
  heroScoreCaption: { color: 'rgba(255,255,255,0.62)', fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 2 },
  heroInsightCol: { flex: 1, gap: 9 },
  heroInsightCard: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 18, paddingHorizontal: 13, paddingVertical: 10 },
  heroInsightKicker: { color: 'rgba(255,255,255,0.58)', fontFamily: 'Inter_700Bold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 },
  heroInsightValue: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 21, lineHeight: 24, marginTop: 4 },
  heroInsightLabel: { color: 'rgba(255,255,255,0.68)', fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 16, marginTop: 2 },
  statRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 22, padding: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 2 },
  statEyebrow: { fontFamily: 'Inter_700Bold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.1 },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 26, lineHeight: 30, marginTop: 6 },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, marginTop: 4 },
  historyCard: { marginBottom: 14 },
  sectionHeader: { marginBottom: 10 },
  sectionRowInline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 10 },
  sectionLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 },
  emptyMini: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 21 },
  activityRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 8 },
  activityDelta: { width: 48, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  activityReason: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  activityDate: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 7, justifyContent: 'center', marginTop: 16 },
  tipText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  rewardShopShell: { borderWidth: 1, borderRadius: 32, padding: 16, marginTop: 6, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.08, shadowRadius: 22, elevation: 4 },
  rewardShopHeaderCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  rewardShopBadge: { width: 48, height: 48, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rewardShopTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, lineHeight: 27, letterSpacing: -0.4 },
  rewardShopSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, marginTop: 3 },
  rewardShopCountPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 9999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 7 },
  rewardShopCountText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  rewardIdeasSub: { fontFamily: 'Inter_700Bold', fontSize: 12, lineHeight: 16, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.9 },
  rewardIdeaGrid: { gap: 10, paddingRight: 10, paddingBottom: 2, marginBottom: 16 },
  rewardIdeaCard: { width: 136, minHeight: 112, borderRadius: 22, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', gap: 8, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.06, shadowRadius: 14, elevation: 2 },
  rewardIdeaIconWrap: { width: 46, height: 46, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rewardIdeaIcon: { fontSize: 25 },
  rewardIdeaTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, lineHeight: 17, textAlign: 'center' },
  rewardIdeaCostRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 1 },
  rewardIdeaCost: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  rewardIdeaHint: { fontFamily: 'Inter_600SemiBold', fontSize: 10, lineHeight: 13, marginTop: 1, textAlign: 'center' },  rewardList: { gap: 12 },
  rewardCard: { padding: 16, borderRadius: 28, borderWidth: 1 },
  rewardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  rewardIconWrap: { width: 58, height: 58, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rewardIcon: { fontSize: 30 },
  rewardTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, lineHeight: 23 },
  rewardMetaRow: { marginTop: 8, gap: 7 },
  rewardCostPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 6 },
  rewardCost: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  rewardAvailability: { fontFamily: 'Inter_700Bold', fontSize: 12, lineHeight: 16 },
  rewardProgressTrack: { height: 8, borderRadius: 9999, overflow: 'hidden', marginTop: 16 },
  rewardProgressFill: { height: 8, borderRadius: 9999 },
  rewardActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 15 },
  redeemBtn: { flex: 1, minHeight: 46, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  redeemText: { fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  editBtn: { minHeight: 46, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  editText: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },  sheet: { borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, padding: 26, paddingBottom: 140 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 24, lineHeight: 30, letterSpacing: -0.4, flexShrink: 1 },
  sheetHelp: { fontFamily: 'Inter_600SemiBold', fontSize: 15, marginTop: -2, marginBottom: 8 },
  iconBtn: { padding: 9, borderRadius: 9999, borderWidth: 1 },
  label: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  iconSuggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  iconChip: { width: 48, height: 48, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  iconChipText: { fontSize: 23 },
  modeRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modeBtn: { flex: 1, minHeight: 48, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  menuSheetButton: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 24, padding: 16, marginTop: 12, minHeight: 86 },
  menuSheetIcon: { width: 50, height: 50, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  menuSheetTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, lineHeight: 24 },
  menuSheetSub: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 19, marginTop: 3 },
  sheetFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, minWidth: 126, borderWidth: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, minWidth: 126, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  saveText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  deleteBtn: { flex: 1, minWidth: 126, borderWidth: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  deleteText: { color: '#EF4444', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});

