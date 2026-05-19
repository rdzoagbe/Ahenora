import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  ChevronDown,
  Gift,
  History,
  Lock,
  MinusCircle,
  Pencil,
  Plus,
  Sparkles,
  Star,
  Trash2,
  UserPlus,
  X,
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

const ICON_LIBRARY: { match: string[]; icons: string[] }[] = [
  { match: ['pizza', 'dinner', 'restaurant', 'food'], icons: [String.fromCodePoint(0x1F355), String.fromCodePoint(0x1F37D), String.fromCodePoint(0x1F389), String.fromCodePoint(0x1F354)] },
  { match: ['movie', 'cinema', 'film'], icons: [String.fromCodePoint(0x1F3AC), String.fromCodePoint(0x1F37F), String.fromCodePoint(0x1F39F), String.fromCodePoint(0x2B50)] },
  { match: ['ice', 'cream', 'sweet', 'cake', 'cupcake', 'dessert'], icons: [String.fromCodePoint(0x1F366), String.fromCodePoint(0x1F9C1), String.fromCodePoint(0x1F370), String.fromCodePoint(0x1F369)] },
  { match: ['game', 'gaming', 'playstation', 'xbox', 'switch'], icons: [String.fromCodePoint(0x1F3AE), String.fromCodePoint(0x1F579), String.fromCodePoint(0x1F3C6), String.fromCodePoint(0x26A1)] },
  { match: ['book', 'reading', 'story'], icons: [String.fromCodePoint(0x1F4DA), String.fromCodePoint(0x1F4D6), String.fromCodePoint(0x2728), String.fromCodePoint(0x1F3C5)] },
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
  const [showKidsActivity, setShowKidsActivity] = useState(false);
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
  const recentActivityCount = historyItems.length;

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
  useEffect(() => { refreshHistory(activeChild?.member_id); }, [activeChild?.member_id, refreshHistory]);

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
    if (!name) return showToast('Child name is required.', 'error');
    if (starting < 0) return showToast('Starting stars cannot be negative.', 'error');
    if (pin && !/^\d{4}$/.test(pin)) return showToast('PIN must be 4 digits.', 'error');

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
    if (!title || !cost || cost < 1) return showToast('Reward title and star cost are required.', 'error');

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
    if (Platform.OS === 'web') return removeReward(reward);
    Alert.alert('Delete reward', reward.title, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeReward(reward) },
    ]);
  };

  const adjustStars = async () => {
    if (!activeChild) return;
    const amount = parseInt(starAmount || '0', 10);
    if (!amount || amount < 1) return showToast('Enter a valid star amount.', 'error');
    const delta = starMode === 'add' ? amount : -amount;
    if (stars + delta < 0) return showToast('Stars cannot go below zero.', 'error');
    const reason = starReason.trim();
    if (delta < 0 && !reason) return showToast('Please add a reason for removing stars.', 'error');

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
    if ((activeChild.stars || 0) < reward.cost_stars) return showToast(t('not_enough_stars'), 'error');
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
              <Text style={[styles.title, { color: theme.colors.text }]}>Kids<Text style={styles.titleDot}>.</Text></Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>Rewards & proud wins</Text>
            </View>
            <PressScale testID="kids-add-menu" onPress={() => setShowAddMenu(true)} style={[styles.addBtn, { backgroundColor: theme.colors.primary, shadowColor: theme.colors.shadow }]}>
              <Plus color={theme.colors.primaryText} size={21} />
              <ChevronDown color={theme.colors.primaryText} size={14} />
            </PressScale>
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
                      style={[styles.childBtn, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }, active && { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft }]}
                    >
                      <View style={[styles.childAvatar, { backgroundColor: active ? theme.colors.accent : theme.colors.bgSoft, borderColor: active ? theme.colors.accent : theme.colors.cardBorder }]}>
                        <Text style={[styles.childInitial, { color: active ? '#111827' : theme.colors.text }]}>{child.name[0]?.toUpperCase()}</Text>
                        {child.has_pin ? <View style={[styles.lockBadge, { backgroundColor: theme.colors.primary }]}><Lock color={theme.colors.primaryText} size={9} /></View> : null}
                      </View>
                      <View style={{ alignItems: 'flex-start' }}>
                        <Text style={[styles.childName, { color: theme.colors.text }]}>{child.name}</Text>
                        <View style={styles.childStarsRow}>
                          <Star color={theme.colors.accent} size={11} fill={theme.colors.accent} />
                          <Text style={[styles.childStars, { color: theme.colors.textMuted }]}>{child.stars}</Text>
                        </View>
                      </View>
                    </PressScale>
                  );
                })}
              </ScrollView>

              {activeChild ? (
                <View style={styles.compactHero}>
                  <View style={styles.starCircle}>
                    <View style={styles.starArc} />
                    <Star color="#F59E0B" size={18} fill="#F59E0B" />
                    <Text style={styles.starValue}>{stars}</Text>
                    <Text style={styles.starCaption}>{t('stars')}</Text>
                  </View>
                  <View style={styles.heroContent}>
                    <View style={styles.heroHeaderLine}>
                      <View>
                        <Text style={styles.heroKicker}>{activeChild.name}'s wallet</Text>
                        <Text style={styles.heroPin}>{activeChild.has_pin ? 'PIN on' : 'No PIN'}</Text>
                      </View>
                      <View style={styles.readyPill}><Text style={styles.readyPillText}>{affordableRewards}/{rewards.length} ready</Text></View>
                    </View>
                    <View style={styles.heroStatsRow}>
                      <MiniInsight label="Ready" value={affordableRewards} sub="rewards" />
                      <MiniInsight label="Recent" value={recentActivityCount} sub="actions" />
                    </View>
                    <View style={styles.heroActions}>
                      <PressScale testID="kids-add-stars" onPress={() => openStarSheet('add', '5')} style={styles.heroActionBtn}><Text style={styles.heroActionText}>+ Add</Text></PressScale>
                      <PressScale testID="kids-remove-stars" onPress={() => openStarSheet('remove', '5')} style={styles.heroActionBtnSecondary}><Text style={styles.heroActionTextSecondary}>− Remove</Text></PressScale>
                    </View>
                  </View>
                </View>
              ) : null}

              <View style={styles.quickRow}>
                {['5', '10', '20'].map((amount) => (
                  <PressScale key={amount} testID={`quick-stars-${amount}`} onPress={() => openStarSheet('add', amount)} style={[styles.quickBtn, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                    <Text style={[styles.quickText, { color: theme.colors.text }]}>+{amount}</Text>
                  </PressScale>
                ))}
                <PressScale testID="quick-stars-custom" onPress={() => openStarSheet('add', '')} style={[styles.quickBtn, styles.quickCustom, { borderColor: theme.colors.accent }]}>
                  <Text style={[styles.quickText, { color: theme.colors.accent }]}>Custom</Text>
                </PressScale>
              </View>

              <View style={styles.rewardHeader}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Reward Shop</Text>
                <View style={[styles.readyBadge, { backgroundColor: theme.colors.success + '22', borderColor: theme.colors.success + '44' }]}>
                  <Text style={[styles.readyBadgeText, { color: theme.colors.success }]}>{affordableRewards}/{rewards.length} ready</Text>
                </View>
              </View>

              {rewards.length === 0 ? (
                <EmptyState title={t('no_rewards')} message="Create a small reward to make chores feel more motivating." actionLabel="Add Reward" onAction={openCreateReward} />
              ) : (
                <View style={styles.rewardGrid}>
                  {rewards.slice(0, 4).map((reward) => {
                    const affordable = stars >= reward.cost_stars;
                    const starsNeeded = Math.max(0, reward.cost_stars - stars);
                    const progressWidth = `${Math.min(100, Math.round((stars / reward.cost_stars) * 100))}%`;
                    return (
                      <PressScale key={reward.reward_id} onPress={() => openEditReward(reward)} style={[styles.rewardCard, { backgroundColor: theme.colors.card, borderColor: affordable ? theme.colors.success : theme.colors.cardBorder }]}>
                        <Text style={styles.rewardIcon}>{reward.icon || DEFAULT_REWARD_ICON}</Text>
                        <Text style={[styles.rewardTitle, { color: theme.colors.text }]} numberOfLines={2}>{reward.title}</Text>
                        <Text style={[styles.rewardMeta, { color: affordable ? theme.colors.success : theme.colors.textMuted }]}>
                          ★ {reward.cost_stars} · {affordable ? 'Ready!' : `${starsNeeded} more`}
                        </Text>
                        <View style={[styles.progressTrack, { backgroundColor: theme.colors.bgSoft }]}>
                          <View style={[styles.progressFill, { width: progressWidth as any, backgroundColor: affordable ? theme.colors.success : theme.colors.accent }]} />
                        </View>
                        <PressScale testID={`redeem-${reward.reward_id}`} onPress={() => redeem(reward)} disabled={!affordable} style={[styles.redeemBtn, { backgroundColor: affordable ? theme.colors.success : theme.colors.bgSoft }, !affordable && { opacity: 0.65 }]}>
                          <Text style={[styles.redeemText, { color: affordable ? '#111827' : theme.colors.textMuted }]}>{affordable ? t('redeem') : 'Not yet'}</Text>
                        </PressScale>
                      </PressScale>
                    );
                  })}
                </View>
              )}

              <PressScale
                testID="kids-activity-toggle"
                onPress={() => setShowKidsActivity((value) => !value)}
                style={[styles.activityToggle, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}
              >
                <View style={styles.activityToggleLeft}>
                  <History color={theme.colors.textMuted} size={16} />
                  <Text style={[styles.activityToggleTitle, { color: theme.colors.text }]}>Recent activity</Text>
                  <View style={[styles.activityCount, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                    <Text style={[styles.activityCountText, { color: theme.colors.textMuted }]}>{recentActivityCount} items</Text>
                  </View>
                </View>
                <Text style={[styles.activityToggleValue, { color: theme.colors.textMuted }]}>{showKidsActivity ? 'Hide' : 'Show'} ↓</Text>
              </PressScale>

              {showKidsActivity ? (
                <GlassCard style={styles.historyCard}>
                  {historyLoading ? (
                    <Text style={[styles.emptyMini, { color: theme.colors.textMuted }]}>Loading activity...</Text>
                  ) : historyItems.length === 0 ? (
                    <Text style={[styles.emptyMini, { color: theme.colors.textMuted }]}>No activity yet.</Text>
                  ) : (
                    historyItems.slice(0, 5).map((item) => {
                      const positive = item.delta > 0;
                      return (
                        <View key={item.transaction_id} style={[styles.activityRow, { borderColor: theme.colors.cardBorder }]}>
                          <Text style={[styles.activityDelta, { color: positive ? theme.colors.success : '#EF4444' }]}>{positive ? '+' : ''}{item.delta}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.activityReason, { color: theme.colors.text }]} numberOfLines={1}>{item.reason || 'Star adjustment'}</Text>
                            <Text style={[styles.activityDate, { color: theme.colors.textMuted }]}>{formatActivityDate(item.created_at)}</Text>
                          </View>
                        </View>
                      );
                    })
                  )}
                </GlassCard>
              ) : null}
            </>
          )}
          <View style={{ height: 160 }} />
        </ScrollView>
      </SafeAreaView>

      <KeyboardAwareBottomSheet visible={showAddMenu} onClose={() => setShowAddMenu(false)} contentStyle={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>Add to Kids</Text>
          <PressScale testID="close-add-menu" onPress={() => setShowAddMenu(false)} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}><X color={theme.colors.text} size={20} /></PressScale>
        </View>
        <Text style={[styles.sheetHelp, { color: theme.colors.textMuted }]}>Choose what you want to create.</Text>
        <SheetMenuButton title="Add Child" subtitle="Create another child profile with optional PIN." icon={<UserPlus color={theme.colors.text} size={22} />} onPress={openChildSheet} />
        <SheetMenuButton title="Add Reward" subtitle="Create a reward with suggested icons." icon={<Gift color={theme.colors.text} size={22} />} onPress={openCreateReward} />
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showChildSheet} onClose={() => setShowChildSheet(false)} contentStyle={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
        <View style={styles.sheetHeader}><Text style={[styles.sheetTitle, { color: theme.colors.text }]}>Add Child</Text><PressScale testID="close-child-sheet" onPress={() => setShowChildSheet(false)} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}><X color={theme.colors.text} size={20} /></PressScale></View>
        <FormInput label="Child name" value={childName} onChangeText={setChildName} placeholder="Ava" />
        <FormInput label="Starting stars" value={childStartingStars} onChangeText={(value) => setChildStartingStars(cleanNumber(value))} placeholder="0" keyboardType="number-pad" />
        <FormInput label="PIN optional" value={childPin} onChangeText={(value) => setChildPin(cleanNumber(value).slice(0, 4))} placeholder="4 digits" keyboardType="number-pad" secureTextEntry />
        <View style={styles.sheetFooter}><CancelButton label={t('cancel')} onPress={() => setShowChildSheet(false)} /><SaveButton label={saving ? '...' : 'Save Child'} onPress={createChild} disabled={saving || !childName.trim()} /></View>
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showRewardSheet} onClose={closeRewardSheet} contentStyle={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
        <View style={styles.sheetHeader}><Text style={[styles.sheetTitle, { color: theme.colors.text }]}>{rewardMode === 'edit' ? 'Edit Reward' : 'Add Reward'}</Text><PressScale testID="close-reward" onPress={closeRewardSheet} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}><X color={theme.colors.text} size={20} /></PressScale></View>
        <FormInput label="Reward title" value={rewardTitle} onChangeText={setRewardTitle} placeholder="Pizza Night" />
        <Text style={[styles.label, { color: theme.colors.textMuted }]}>Suggested icon</Text>
        <View style={styles.iconSuggestionRow}>{iconSuggestions.map((icon) => <PressScale key={icon} testID={`reward-icon-${icon}`} onPress={() => setRewardIcon(icon)} style={[styles.iconChip, { backgroundColor: rewardIcon === icon ? theme.colors.accentSoft : theme.colors.bgSoft, borderColor: rewardIcon === icon ? theme.colors.accent : theme.colors.cardBorder }]}><Text style={styles.iconChipText}>{icon}</Text></PressScale>)}</View>
        <FormInput label="Cost in stars" value={rewardCost} onChangeText={(value) => setRewardCost(cleanNumber(value))} placeholder="50" keyboardType="number-pad" />
        <View style={styles.sheetFooter}>{rewardMode === 'edit' && editingReward ? <PressScale testID="delete-reward" onPress={() => confirmRemoveReward(editingReward)} style={styles.deleteBtn}><Trash2 color="#EF4444" size={17} /><Text style={styles.deleteText}>Delete</Text></PressScale> : <CancelButton label={t('cancel')} onPress={closeRewardSheet} />}<SaveButton label={saving ? '...' : t('save')} onPress={saveReward} disabled={saving || !rewardTitle.trim()} /></View>
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showStarSheet} onClose={() => setShowStarSheet(false)} contentStyle={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
        <View style={styles.sheetHeader}><Text style={[styles.sheetTitle, { color: theme.colors.text }]}>{starMode === 'add' ? 'Add stars' : 'Remove stars'}</Text><PressScale testID="close-stars" onPress={() => setShowStarSheet(false)} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}><X color={theme.colors.text} size={20} /></PressScale></View>
        <Text style={[styles.sheetHelp, { color: theme.colors.textMuted }]}>For {activeChild?.name || 'selected child'}</Text>
        <View style={styles.modeRow}><ModeButton label="Add" active={starMode === 'add'} onPress={() => setStarMode('add')} /><ModeButton label="− Stars" active={starMode === 'remove'} onPress={() => setStarMode('remove')} /></View>
        <FormInput label="Amount" value={starAmount} onChangeText={(value) => setStarAmount(cleanNumber(value))} placeholder="5" keyboardType="number-pad" />
        <FormInput label="Reason" value={starReason} onChangeText={setStarReason} placeholder={starMode === 'add' ? 'Homework, chores, kindness...' : 'Reason for deduction'} />
        <View style={styles.sheetFooter}><CancelButton label={t('cancel')} onPress={() => setShowStarSheet(false)} /><SaveButton label={saving ? '...' : 'Save'} onPress={adjustStars} disabled={saving || !starAmount} /></View>
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

function MiniInsight({ label, value, sub }: { label: string; value: number; sub: string }) {
  return <View style={styles.miniInsight}><Text style={styles.miniKicker}>{label}</Text><Text style={styles.miniValue}>{value}</Text><Text style={styles.miniSub}>{sub}</Text></View>;
}

function SheetMenuButton({ title, subtitle, icon, onPress }: { title: string; subtitle: string; icon: React.ReactNode; onPress: () => void }) {
  const { theme } = useStore();
  return <PressScale onPress={onPress} style={[styles.menuSheetButton, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}><View style={[styles.menuSheetIcon, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>{icon}</View><View style={{ flex: 1 }}><Text style={[styles.menuSheetTitle, { color: theme.colors.text }]}>{title}</Text><Text style={[styles.menuSheetSub, { color: theme.colors.textMuted }]}>{subtitle}</Text></View></PressScale>;
}

function FormInput(props: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { theme } = useStore();
  const { label, ...inputProps } = props;
  return <><Text style={[styles.label, { color: theme.colors.textMuted }]}>{label}</Text><TextInput placeholderTextColor={theme.colors.textSoft} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} {...inputProps} /></>;
}

function CancelButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useStore();
  return <PressScale onPress={onPress} style={[styles.cancelBtn, { borderColor: theme.colors.cardBorder }]}><Text style={[styles.cancelText, { color: theme.colors.textMuted }]}>{label}</Text></PressScale>;
}

function SaveButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { theme } = useStore();
  return <PressScale onPress={onPress} disabled={disabled} style={[styles.saveBtn, { backgroundColor: theme.colors.primary }, disabled && { opacity: 0.5 }]}><Text style={[styles.saveText, { color: theme.colors.primaryText }]}>{label}</Text></PressScale>;
}

function ModeButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { theme } = useStore();
  return <PressScale onPress={onPress} style={[styles.modeBtn, { backgroundColor: active ? theme.colors.primary : theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}><Text style={[styles.modeText, { color: active ? theme.colors.primaryText : theme.colors.textMuted }]}>{label}</Text></PressScale>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 168 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, marginTop: 4 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  titleDot: { color: '#F97316' },
  sub: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16, marginTop: 2 },
  addBtn: { width: 48, height: 48, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 1, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 5 },
  childRow: { gap: 10, paddingVertical: 5, paddingRight: 18, marginBottom: 12 },
  childBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9999, borderWidth: 1, minWidth: 116 },
  childAvatar: { width: 30, height: 30, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  childInitial: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  lockBadge: { position: 'absolute', right: -4, bottom: -4, width: 16, height: 16, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  childName: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  childStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
  childStars: { fontFamily: 'Inter_700Bold', fontSize: 10 },
  compactHero: { flexDirection: 'row', gap: 12, backgroundColor: '#172024', borderRadius: 24, padding: 16, marginBottom: 12, overflow: 'hidden' },
  starCircle: { width: 88, height: 88, borderRadius: 9999, borderWidth: 6, borderColor: 'rgba(245,158,11,0.22)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  starArc: { position: 'absolute', inset: -6, borderRadius: 9999, borderTopWidth: 6, borderRightWidth: 6, borderTopColor: '#F59E0B', borderRightColor: '#F59E0B', borderLeftColor: 'transparent', borderBottomColor: 'transparent', transform: [{ rotate: '30deg' }] },
  starValue: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 20, lineHeight: 23 },
  starCaption: { color: 'rgba(255,255,255,0.54)', fontFamily: 'Inter_700Bold', fontSize: 9 },
  heroContent: { flex: 1, gap: 8 },
  heroHeaderLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  heroKicker: { color: 'rgba(255,255,255,0.48)', fontFamily: 'Inter_800ExtraBold', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },
  heroPin: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 14, marginTop: 2 },
  readyPill: { alignSelf: 'flex-start', backgroundColor: 'rgba(74,222,128,0.12)', borderRadius: 9999, paddingHorizontal: 9, paddingVertical: 5 },
  readyPillText: { color: '#4ADE80', fontFamily: 'Inter_800ExtraBold', fontSize: 10 },
  heroStatsRow: { flexDirection: 'row', gap: 7 },
  miniInsight: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.06)', padding: 8 },
  miniKicker: { color: 'rgba(255,255,255,0.42)', fontFamily: 'Inter_800ExtraBold', fontSize: 9, textTransform: 'uppercase' },
  miniValue: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 16, marginTop: 1 },
  miniSub: { color: 'rgba(255,255,255,0.42)', fontFamily: 'Inter_600SemiBold', fontSize: 9 },
  heroActions: { flexDirection: 'row', gap: 8 },
  heroActionBtn: { flex: 1, minHeight: 36, borderRadius: 9999, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  heroActionBtnSecondary: { flex: 1, minHeight: 36, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  heroActionText: { color: '#111827', fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  heroActionTextSecondary: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  quickRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  quickBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 1 },
  quickCustom: { backgroundColor: 'rgba(249,115,22,0.10)' },
  quickText: { fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  rewardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  readyBadge: { borderWidth: 1, borderRadius: 9999, paddingHorizontal: 10, paddingVertical: 5 },
  readyBadgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 10 },
  rewardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  rewardCard: { width: '48.4%', borderRadius: 18, borderWidth: 1, padding: 13, minHeight: 172 },
  rewardIcon: { fontSize: 22, marginBottom: 6 },
  rewardTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, lineHeight: 17, minHeight: 34 },
  rewardMeta: { fontFamily: 'Inter_700Bold', fontSize: 11, marginTop: 3 },
  progressTrack: { height: 6, borderRadius: 9999, overflow: 'hidden', marginTop: 8, marginBottom: 8 },
  progressFill: { height: 6, borderRadius: 9999 },
  redeemBtn: { minHeight: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  redeemText: { fontFamily: 'Inter_800ExtraBold', fontSize: 11 },
  activityToggle: { minHeight: 52, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  activityToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  activityToggleTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  activityCount: { borderWidth: 1, borderRadius: 9999, paddingHorizontal: 8, paddingVertical: 4 },
  activityCountText: { fontFamily: 'Inter_800ExtraBold', fontSize: 10 },
  activityToggleValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 11 },
  historyCard: { marginTop: 10 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: 1 },
  activityDelta: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, width: 42 },
  activityReason: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  activityDate: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 2 },
  emptyMini: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18 },
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, padding: 24, paddingBottom: 120 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 24 },
  iconBtn: { width: 42, height: 42, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sheetHelp: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, marginBottom: 18 },
  menuSheetButton: { borderWidth: 1, borderRadius: 20, minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, marginBottom: 12 },
  menuSheetIcon: { width: 46, height: 46, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  menuSheetTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 16 },
  menuSheetSub: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, marginTop: 2 },
  label: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, fontFamily: 'Inter_500Medium', fontSize: 16 },
  iconSuggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  iconChip: { width: 45, height: 45, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  iconChipText: { fontSize: 22 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 18 },
  cancelBtn: { flex: 1, minHeight: 54, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, minHeight: 54, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  deleteBtn: { flex: 1, minHeight: 54, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)', backgroundColor: 'rgba(239,68,68,0.10)', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  deleteText: { color: '#EF4444', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  modeRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  modeBtn: { flex: 1, minHeight: 48, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
