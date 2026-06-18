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
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Plus,
  Star,
  X,
  Trash2,
  Lock,
  Pencil,
  MinusCircle,
  Bell,
  Bed,
  BookOpen,
  Utensils,
  Check,
  Minus,
} from 'lucide-react-native';

import { useSwipeTabs } from '../../src/hooks/useSwipeTabs';
import { PressScale } from '../../src/components/PressScale';
import { PinPadModal } from '../../src/components/PinPadModal';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast, { ToastTone } from '../../src/components/AppToast';
import EmptyState from '../../src/components/EmptyState';
import ErrorState from '../../src/components/ErrorState';
import LoadingOverlay from '../../src/components/LoadingOverlay';
import { Card, IconTile, ProgressBar, ScreenHeader, UI } from '../../src/components/Kit';

import { useStore } from '../../src/store';
import { api, FamilyMember, Reward, StarTransaction } from '../../src/api';
import { logger } from '../../src/logger';

type ToastState = { message: string; tone: ToastTone };
type RewardSheetMode = 'create' | 'edit';
type StarMode = 'add' | 'remove';

const DEFAULT_REWARD_ICON = String.fromCodePoint(0x1F381);

const REWARD_IDEAS = [
  { title: 'Pizza night', cost_stars: 50, icon: String.fromCodePoint(0x1F355) },
  { title: 'Movie night', cost_stars: 75, icon: String.fromCodePoint(0x1F3AC) },
  { title: 'Ice cream treat', cost_stars: 40, icon: String.fromCodePoint(0x1F366) },
  { title: 'Game time', cost_stars: 60, icon: String.fromCodePoint(0x1F3AE) },
] as const;

const QUICK_ADDS = [
  { label: 'Made bed', amount: 2, Icon: Bed, bg: UI.mint, tint: UI.mintText },
  { label: 'Read 20min', amount: 3, Icon: BookOpen, bg: UI.lavender, tint: UI.lavenderText },
  { label: 'Set table', amount: 2, Icon: Utensils, bg: UI.orangeSoft, tint: UI.orange },
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

export default function KidsScreen() {
  const { t } = useStore();
  const swipeHandlers = useSwipeTabs();
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
  const sortedRewards = useMemo(() => [...rewards].sort((a, b) => (stars / b.cost_stars) - (stars / a.cost_stars)), [rewards, stars]);
  const weeklyStars = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return historyItems.filter((h) => h.created_at && new Date(h.created_at).getTime() >= weekAgo).reduce((sum, h) => sum + h.delta, 0);
  }, [historyItems]);

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

    if (!name) { showToast('Child name is required.', 'error'); return; }
    if (starting < 0) { showToast('Starting stars cannot be negative.', 'error'); return; }
    if (pin && !/^\d{4}$/.test(pin)) { showToast('PIN must be 4 digits.', 'error'); return; }

    setSaving(true);
    try {
      const created = await api.createFamilyMember({ name, starting_stars: starting, pin: pin || undefined });
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

    if (!title || !cost || cost < 1) { showToast('Reward title and star cost are required.', 'error'); return; }

    setSaving(true);
    try {
      if (rewardMode === 'edit' && editingReward) {
        const updated = await api.updateReward(editingReward.reward_id, { title, cost_stars: cost, icon });
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
    if (Platform.OS === 'web') { removeReward(reward); return; }
    Alert.alert('Delete reward', reward.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeReward(reward) },
    ]);
  };

  const adjustStars = async () => {
    if (!activeChild) return;
    const amount = parseInt(starAmount || '0', 10);
    if (!amount || amount < 1) { showToast('Enter a valid star amount.', 'error'); return; }

    const delta = starMode === 'add' ? amount : -amount;
    if (stars + delta < 0) { showToast('Stars cannot go below zero.', 'error'); return; }

    const reason = starReason.trim();
    if (delta < 0 && !reason) { showToast('Please add a reason for removing stars.', 'error'); return; }

    setSaving(true);
    try {
      const result = await api.adjustMemberStars(activeChild.member_id, { delta, reason: reason || (delta > 0 ? 'Parent added stars' : 'Parent removed stars') });
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

  const quickAdd = async (reason: string, amount: number) => {
    if (!activeChild) { showToast('Add or select a child first.', 'error'); return; }
    try {
      const result = await api.adjustMemberStars(activeChild.member_id, { delta: amount, reason });
      setMembers((prev) => prev.map((member) => (member.member_id === result.member.member_id ? result.member : member)));
      showToast(`Added ${amount} stars · ${reason}`, 'success');
      await refreshHistory(activeChild.member_id);
    } catch (e: any) {
      logger.warn('Quick add failed:', e?.message || e);
      showToast(e?.message || 'Could not add stars.', 'error');
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
    if ((activeChild.stars || 0) < reward.cost_stars) { showToast(t('not_enough_stars'), 'error'); return; }
    if (activeChild.has_pin) { setPinPromptReward(reward); return; }
    await doRedeem(reward);
  };

  const weeklyLine = weeklyStars > 0
    ? `+${weeklyStars} stars this week — keep it up! ✨`
    : weeklyStars < 0
      ? `${weeklyStars} stars this week`
      : `A fresh week of stars ahead ✨`;

  return (
    <View style={styles.container} {...swipeHandlers}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <ScreenHeader
            eyebrow="Family"
            title="Kids"
            right={
              <PressScale onPress={() => router.navigate('/(tabs)/feed')} style={styles.bellWrap}>
                <Bell color={UI.text} size={24} />
              </PressScale>
            }
          />

          {showBlockingError ? (
            <ErrorState title="Kids page unavailable" message={errorMessage || 'Could not load Kids page.'} onRetry={load} />
          ) : children.length === 0 && !loading ? (
            <EmptyState title="No children yet" message="Add your first child to start using stars and rewards." actionLabel="Add Child" onAction={openChildSheet} />
          ) : (
            <>
              {/* Child selector */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.childRow} style={styles.childScroll} keyboardShouldPersistTaps="handled">
                {children.map((child, index) => {
                  const active = child.member_id === activeChild?.member_id;
                  const tint = CHILD_TINTS[index % CHILD_TINTS.length];
                  return (
                    <PressScale key={child.member_id} testID={`child-${child.member_id}`} onPress={() => setSelectedChild(child.member_id)} style={[styles.childChip, active ? styles.childChipActive : styles.childChipIdle]}>
                      <View style={[styles.childAvatar, { backgroundColor: tint }]}>
                        <Text style={styles.childAvatarText}>{child.name[0]?.toUpperCase()}</Text>
                        {child.has_pin ? <View style={styles.lockBadge}><Lock color="#FFFFFF" size={8} /></View> : null}
                      </View>
                      <Text style={[styles.childChipText, { color: active ? '#FFFFFF' : UI.text }]}>{child.name}</Text>
                    </PressScale>
                  );
                })}
                <PressScale testID="kids-add-child" onPress={openChildSheet} style={[styles.childChip, styles.childChipIdle]}>
                  <Plus color={UI.orange} size={18} />
                  <Text style={[styles.childChipText, { color: UI.text }]}>Add child</Text>
                </PressScale>
              </ScrollView>

              {activeChild ? (
                <>
                  {/* Wallet */}
                  <Card style={styles.walletCard}>
                    <View style={[styles.walletAvatar, { backgroundColor: UI.orangeSoft }]}>
                      <Text style={[styles.walletAvatarText, { color: UI.orange }]}>{activeChild.name[0]?.toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.walletLabel}>{activeChild.name}&apos;s stars</Text>
                      <Text style={styles.walletCount}>{stars}</Text>
                    </View>
                    <PressScale testID="kids-redeem" onPress={() => setKidsTab('rewards')} style={styles.redeemBtn}>
                      <Text style={styles.redeemText}>Redeem</Text>
                    </PressScale>
                  </Card>
                  <Text style={styles.weeklyLine}>{weeklyLine}</Text>

                  {/* Tabs */}
                  <View style={styles.tabRow}>
                    {(['rewards', 'stars', 'history'] as const).map((tab) => (
                      <PressScale key={tab} testID={`kids-tab-${tab}`} onPress={() => { setKidsTab(tab); if (tab === 'history' && activeChild) refreshHistory(activeChild.member_id); }} style={[styles.tabBtn, kidsTab === tab && { borderBottomColor: UI.orange }]}>
                        <Text style={[styles.tabText, { color: kidsTab === tab ? UI.text : UI.muted, fontFamily: kidsTab === tab ? 'Inter_800ExtraBold' : 'Inter_600SemiBold' }]}>
                          {tab === 'rewards' ? 'Rewards' : tab === 'stars' ? 'Stars' : 'History'}
                        </Text>
                      </PressScale>
                    ))}
                  </View>

                  {/* Rewards tab */}
                  {kidsTab === 'rewards' && (
                    <>
                      <Text style={styles.blockLabel}>Quick add</Text>
                      <View style={styles.quickAddRow}>
                        {QUICK_ADDS.map((q) => (
                          <PressScale key={q.label} testID={`quick-add-${q.label}`} onPress={() => quickAdd(q.label, q.amount)} style={styles.quickAddChip}>
                            <IconTile bg={q.bg} size={30} radius={9}><q.Icon color={q.tint} size={15} /></IconTile>
                            <Text style={styles.quickAddText} numberOfLines={1}>{q.label}</Text>
                            <Text style={styles.quickAddAmt}>+{q.amount}</Text>
                          </PressScale>
                        ))}
                      </View>

                      <View style={styles.blockHead}>
                        <Text style={styles.blockTitle}>Rewards in reach</Text>
                        <PressScale testID="kids-add-reward" onPress={openCreateReward} style={styles.newLink}>
                          <Plus color={UI.orange} size={14} />
                          <Text style={styles.newLinkText}>New</Text>
                        </PressScale>
                      </View>
                      {rewards.length === 0 ? (
                        <Card style={styles.emptyRewards}>
                          <Text style={styles.emptyRewardsText}>{t('no_rewards')}</Text>
                          <PressScale testID="kids-add-reward-empty" onPress={openCreateReward} style={styles.emptyRewardsBtn}>
                            <Plus color="#FFFFFF" size={16} />
                            <Text style={styles.emptyRewardsBtnText}>Add reward</Text>
                          </PressScale>
                        </Card>
                      ) : (
                        <Card style={styles.cardPad}>
                          {sortedRewards.slice(0, 5).map((reward, index, arr) => {
                            const pct = Math.min(100, Math.round((stars / reward.cost_stars) * 100));
                            const affordable = stars >= reward.cost_stars;
                            return (
                              <View key={reward.reward_id} style={[styles.rewardRow, index < arr.length - 1 && styles.rewardRowBorder]}>
                                <IconTile bg={affordable ? UI.orangeSoft : UI.soft} size={42} radius={13}>
                                  <Text style={styles.rewardEmoji}>{reward.icon || DEFAULT_REWARD_ICON}</Text>
                                </IconTile>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <View style={styles.rewardTopRow}>
                                    <Text style={styles.rewardTitle} numberOfLines={1}>{reward.title}</Text>
                                    <Text style={[styles.rewardCount, affordable && { color: UI.mintText }]}>{stars} / {reward.cost_stars}</Text>
                                  </View>
                                  <View style={{ marginTop: 8 }}>
                                    <ProgressBar pct={pct} color={affordable ? UI.mintText : UI.orange} />
                                  </View>
                                </View>
                                {affordable ? (
                                  <PressScale testID={`redeem-reach-${reward.reward_id}`} onPress={() => redeem(reward)} style={styles.rewardRedeem}>
                                    <Text style={styles.rewardRedeemText}>{t('redeem')}</Text>
                                  </PressScale>
                                ) : (
                                  <PressScale testID={`edit-reward-${reward.reward_id}`} onPress={() => openEditReward(reward)} style={styles.rewardEdit}>
                                    <Pencil color={UI.muted} size={14} />
                                  </PressScale>
                                )}
                              </View>
                            );
                          })}
                        </Card>
                      )}

                      <Text style={styles.blockLabel}>Quick reward ideas</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ideaRow} style={styles.ideaScroll}>
                        {REWARD_IDEAS.map((idea) => (
                          <PressScale key={idea.title} testID={idea.title} onPress={() => { setRewardMode('create'); setEditingReward(null); setRewardTitle(idea.title); setRewardCost(String(idea.cost_stars)); setRewardIcon(idea.icon); setShowRewardSheet(true); }} style={styles.ideaChip}>
                            <Text style={styles.ideaEmoji}>{idea.icon}</Text>
                            <Text style={styles.ideaTitle} numberOfLines={1}>{idea.title}</Text>
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
                          <Plus color="#FFFFFF" size={16} />
                          <Text style={styles.addStarsText}>Add stars</Text>
                        </PressScale>
                        <PressScale testID="kids-remove-stars" onPress={() => openStarSheet('remove', '5')} style={styles.removeStarsBtn}>
                          <MinusCircle color={UI.muted} size={16} />
                          <Text style={styles.removeStarsText}>Remove</Text>
                        </PressScale>
                      </View>
                      <View style={styles.quickRow}>
                        {['5', '10', '20'].map((amount) => (
                          <PressScale key={amount} testID={`quick-stars-${amount}`} onPress={() => openStarSheet('add', amount)} style={styles.quickStarBtn}>
                            <Text style={styles.quickStarText}>+{amount}</Text>
                          </PressScale>
                        ))}
                        <PressScale testID="quick-stars-custom" onPress={() => openStarSheet('add', '')} style={[styles.quickStarBtn, { backgroundColor: UI.orangeSoft, borderColor: UI.orange }]}>
                          <Text style={[styles.quickStarText, { color: UI.orange }]}>Other</Text>
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

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Child sheet */}
      <KeyboardAwareBottomSheet visible={showChildSheet} onClose={() => setShowChildSheet(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Add Child</Text>
          <PressScale testID="close-child-sheet" onPress={() => setShowChildSheet(false)} style={styles.iconBtn}><X color={UI.text} size={20} /></PressScale>
        </View>
        <Text style={styles.label}>Child name</Text>
        <TextInput testID="child-name" value={childName} onChangeText={setChildName} placeholder="Ava" placeholderTextColor={UI.muted} style={styles.input} returnKeyType="next" />
        <Text style={styles.label}>Starting stars</Text>
        <TextInput testID="child-starting-stars" value={childStartingStars} onChangeText={(v) => setChildStartingStars(cleanNumber(v))} keyboardType="number-pad" placeholder="0" placeholderTextColor={UI.muted} style={styles.input} />
        <Text style={styles.label}>PIN optional</Text>
        <TextInput testID="child-pin" value={childPin} onChangeText={(v) => setChildPin(cleanNumber(v).slice(0, 4))} keyboardType="number-pad" secureTextEntry placeholder="4 digits" placeholderTextColor={UI.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-child" onPress={() => setShowChildSheet(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('cancel')}</Text></PressScale>
          <PressScale testID="save-child" onPress={createChild} disabled={saving || !childName.trim()} style={[styles.saveBtn, (!childName.trim() || saving) && { opacity: 0.5 }]}><Text style={styles.saveText}>{saving ? '...' : 'Save Child'}</Text></PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      {/* Reward sheet */}
      <KeyboardAwareBottomSheet visible={showRewardSheet} onClose={closeRewardSheet} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{rewardMode === 'edit' ? 'Edit Reward' : 'Add Reward'}</Text>
          <PressScale testID="close-reward" onPress={closeRewardSheet} style={styles.iconBtn}><X color={UI.text} size={20} /></PressScale>
        </View>
        <Text style={styles.label}>Reward title</Text>
        <TextInput testID="reward-title" value={rewardTitle} onChangeText={setRewardTitle} placeholder="Pizza Night" placeholderTextColor={UI.muted} style={styles.input} returnKeyType="next" />
        <Text style={styles.label}>Suggested icon</Text>
        <View style={styles.iconRow}>
          {iconSuggestions.map((icon) => (
            <PressScale key={icon} testID={`reward-icon-${icon}`} onPress={() => setRewardIcon(icon)} style={[styles.iconChip, { backgroundColor: rewardIcon === icon ? UI.orangeSoft : UI.soft, borderColor: rewardIcon === icon ? UI.orange : UI.line }]}>
              <Text style={styles.iconChipText}>{icon}</Text>
            </PressScale>
          ))}
        </View>
        <Text style={styles.label}>Cost in stars</Text>
        <TextInput testID="reward-cost" value={rewardCost} onChangeText={(v) => setRewardCost(cleanNumber(v))} keyboardType="number-pad" placeholder="50" placeholderTextColor={UI.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          {rewardMode === 'edit' && editingReward ? (
            <PressScale testID="delete-reward" onPress={() => confirmRemoveReward(editingReward)} style={styles.deleteBtn}>
              <Trash2 color={UI.danger} size={17} />
              <Text style={styles.deleteText}>Delete</Text>
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
          <Text style={styles.sheetTitle}>{starMode === 'add' ? 'Add stars' : 'Remove stars'}</Text>
          <PressScale testID="close-stars" onPress={() => setShowStarSheet(false)} style={styles.iconBtn}><X color={UI.text} size={20} /></PressScale>
        </View>
        <Text style={styles.sheetHelp}>For {activeChild?.name || 'selected child'}</Text>
        <View style={styles.modeRow}>
          <PressScale testID="mode-add-stars" onPress={() => setStarMode('add')} style={[styles.modeBtn, { backgroundColor: starMode === 'add' ? UI.text : UI.soft }]}>
            <Text style={[styles.modeText, { color: starMode === 'add' ? '#FFFFFF' : UI.muted }]}>Add</Text>
          </PressScale>
          <PressScale testID="mode-remove-stars" onPress={() => setStarMode('remove')} style={[styles.modeBtn, { backgroundColor: starMode === 'remove' ? UI.text : UI.soft }]}>
            <Text style={[styles.modeText, { color: starMode === 'remove' ? '#FFFFFF' : UI.muted }]}>Remove</Text>
          </PressScale>
        </View>
        <Text style={styles.label}>Amount</Text>
        <TextInput testID="star-amount" value={starAmount} onChangeText={(v) => setStarAmount(cleanNumber(v))} keyboardType="number-pad" placeholder="5" placeholderTextColor={UI.muted} style={styles.input} />
        <Text style={styles.label}>Reason</Text>
        <TextInput testID="star-reason" value={starReason} onChangeText={setStarReason} placeholder={starMode === 'add' ? 'Homework, chores, kindness...' : 'Reason for deduction'} placeholderTextColor={UI.muted} style={styles.input} />
        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-stars" onPress={() => setShowStarSheet(false)} style={styles.cancelBtn}><Text style={styles.cancelText}>{t('cancel')}</Text></PressScale>
          <PressScale testID="save-stars" onPress={adjustStars} disabled={saving || !starAmount} style={[styles.saveBtn, (!starAmount || saving) && { opacity: 0.5 }]}><Text style={styles.saveText}>{saving ? '...' : 'Save'}</Text></PressScale>
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

function RecentActivity({ items, loading, expanded }: { items: StarTransaction[]; loading: boolean; expanded?: boolean }) {
  return (
    <>
      <Text style={styles.blockLabel}>Recent activity</Text>
      {loading ? (
        <Text style={styles.emptyMini}>Loading activity…</Text>
      ) : items.length === 0 ? (
        <Card style={styles.cardPad}><Text style={styles.emptyMini}>No activity yet.</Text></Card>
      ) : (
        <Card style={styles.cardPad}>
          {items.map((item, index) => {
            const positive = item.delta > 0;
            return (
              <View key={item.transaction_id} style={[styles.activityRow, index < items.length - 1 && styles.activityRowBorder]}>
                <IconTile bg={positive ? UI.mint : UI.dangerSoft} size={38} radius={11}>
                  {positive ? <Check color={UI.mintText} size={17} /> : <Minus color={UI.danger} size={17} />}
                </IconTile>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.activityReason} numberOfLines={1}>{item.reason || 'Star adjustment'}</Text>
                  <Text style={styles.activityDate}>{formatActivityDate(item.created_at)}</Text>
                </View>
                <View style={styles.activityDeltaRow}>
                  <Text style={[styles.activityDelta, { color: positive ? UI.mintText : UI.danger }]}>{positive ? '+' : ''}{item.delta}</Text>
                  <Star color={UI.star} size={14} fill={UI.star} />
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 40 },
  bellWrap: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },

  childScroll: { marginTop: 18, marginHorizontal: -20 },
  childRow: { gap: 10, paddingHorizontal: 20 },
  childChip: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 99 },
  childChipActive: { backgroundColor: UI.text },
  childChipIdle: { backgroundColor: UI.card, borderWidth: 1, borderColor: UI.line, paddingHorizontal: 14 },
  childAvatar: { width: 30, height: 30, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  childAvatarText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  lockBadge: { position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: 99, backgroundColor: UI.text, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: UI.card },
  childChipText: { fontFamily: 'Inter_700Bold', fontSize: 14 },

  walletCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginTop: 18 },
  walletAvatar: { width: 52, height: 52, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  walletAvatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 20 },
  walletLabel: { color: UI.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  walletCount: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 30, lineHeight: 35, marginTop: 1 },
  redeemBtn: { backgroundColor: UI.text, borderRadius: 99, paddingHorizontal: 20, paddingVertical: 13 },
  redeemText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  weeklyLine: { color: UI.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13.5, marginTop: 12, paddingHorizontal: 2 },

  tabRow: { flexDirection: 'row', gap: 26, borderBottomWidth: 1, borderBottomColor: UI.line, marginTop: 18 },
  tabBtn: { paddingTop: 6, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 15 },

  blockLabel: { color: UI.muted, fontFamily: 'Inter_700Bold', fontSize: 13, marginTop: 20, marginBottom: 10 },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  blockTitle: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17, letterSpacing: -0.2 },
  newLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  newLinkText: { color: UI.orange, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  cardPad: { paddingHorizontal: 16 },

  quickAddRow: { flexDirection: 'row', gap: 10 },
  quickAddChip: { flex: 1, backgroundColor: UI.card, borderWidth: 1, borderColor: UI.line, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 10, alignItems: 'center', gap: 6 },
  quickAddText: { color: UI.text, fontFamily: 'Inter_700Bold', fontSize: 12, textAlign: 'center' },
  quickAddAmt: { color: UI.mintText, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },

  emptyRewards: { alignItems: 'center', paddingVertical: 24, gap: 12 },
  emptyRewardsText: { color: UI.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  emptyRewardsBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: UI.orange, paddingHorizontal: 16, paddingVertical: 11, borderRadius: 99 },
  emptyRewardsBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rewardRowBorder: { borderBottomWidth: 1, borderBottomColor: UI.line },
  rewardEmoji: { fontSize: 20 },
  rewardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rewardTitle: { flex: 1, color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 14.5 },
  rewardCount: { color: UI.muted, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  rewardRedeem: { backgroundColor: UI.text, borderRadius: 99, paddingHorizontal: 14, paddingVertical: 9 },
  rewardRedeemText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },
  rewardEdit: { width: 34, height: 34, borderRadius: 99, borderWidth: 1, borderColor: UI.line, alignItems: 'center', justifyContent: 'center' },

  ideaScroll: { marginHorizontal: -20 },
  ideaRow: { gap: 10, paddingHorizontal: 20 },
  ideaChip: { width: 120, backgroundColor: UI.card, borderWidth: 1, borderColor: UI.line, borderRadius: 16, padding: 12, gap: 4 },
  ideaEmoji: { fontSize: 22 },
  ideaTitle: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 13, marginTop: 4 },
  ideaCost: { color: UI.muted, fontFamily: 'Inter_600SemiBold', fontSize: 11.5 },

  starActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  addStarsBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: UI.text, borderRadius: 14, paddingVertical: 14 },
  addStarsText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  removeStarsBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: UI.soft, borderWidth: 1, borderColor: UI.line, borderRadius: 14, paddingVertical: 14 },
  removeStarsText: { color: UI.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  quickRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  quickStarBtn: { flex: 1, alignItems: 'center', backgroundColor: UI.card, borderWidth: 1, borderColor: UI.line, borderRadius: 14, paddingVertical: 13 },
  quickStarText: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },

  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  activityRowBorder: { borderBottomWidth: 1, borderBottomColor: UI.line },
  activityReason: { color: UI.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  activityDate: { color: UI.muted, fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 2 },
  activityDeltaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  activityDelta: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  emptyMini: { color: UI.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, paddingVertical: 14 },

  sheet: { backgroundColor: UI.card, borderTopLeftRadius: 34, borderTopRightRadius: 34, borderWidth: 1, borderColor: UI.line, padding: 26, paddingBottom: 140 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24, letterSpacing: -0.4 },
  sheetHelp: { color: UI.muted, fontFamily: 'Inter_500Medium', fontSize: 14, marginBottom: 12 },
  iconBtn: { padding: 9, borderRadius: 9999, borderWidth: 1, borderColor: UI.line, backgroundColor: UI.soft },
  label: { color: UI.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderColor: UI.line, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Inter_500Medium', fontSize: 16, color: UI.text, backgroundColor: UI.soft },
  iconRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  iconChip: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  iconChipText: { fontSize: 22 },
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  modeBtn: { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 12 },
  modeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, borderWidth: 1, borderColor: UI.line, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { color: UI.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderWidth: 1, borderColor: 'rgba(220,38,38,0.35)', backgroundColor: UI.dangerSoft, borderRadius: 18, paddingVertical: 15 },
  deleteText: { color: UI.danger, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center', backgroundColor: UI.orange },
  saveText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
