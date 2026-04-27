import React, { useCallback, useEffect, useState } from 'react';
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
import { Plus, Star, Gift, X, Trash2, Sparkles, Lock } from 'lucide-react-native';

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
import { api, FamilyMember, Reward } from '../../src/api';
import { logger } from '../../src/logger';

type ToastState = {
  message: string;
  tone: ToastTone;
};

export default function KidsScreen() {
  const { t, theme } = useStore();

  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);

  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newCost, setNewCost] = useState('50');
  const [newIcon, setNewIcon] = useState('🎁');
  const [saving, setSaving] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);
  const [pinPromptReward, setPinPromptReward] = useState<Reward | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2300);
  }, []);

  const load = useCallback(async () => {
    try {
      setErrorMessage(null);
      const [m, r] = await Promise.all([api.familyMembers(), api.listRewards()]);
      setMembers(m);
      setRewards(r);
      const firstChild = m.find((x) => x.role === 'Child');
      if (firstChild) setSelectedChild((current) => current || firstChild.member_id);
    } catch (e: any) {
      logger.warn('Kids page load failed:', e?.message || e);
      setErrorMessage(e?.message || 'Could not load Kids page.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  const children = members.filter((m) => m.role === 'Child');
  const activeChild = children.find((c) => c.member_id === selectedChild) || children[0];
  const stars = activeChild?.stars || 0;

  const doRedeem = useCallback(async (r: Reward) => {
    if (!activeChild) return;
    try {
      const res = await api.redeemReward(r.reward_id, activeChild.member_id);
      setMembers((prev) => prev.map((m) => (m.member_id === res.member.member_id ? res.member : m)));
      showToast(`${t('redeemed')} ${r.title}`, 'success');
    } catch (e: any) {
      logger.warn('Reward redemption failed:', e?.message || e);
      showToast(e?.message || 'Could not redeem reward.', 'error');
    }
  }, [activeChild, showToast, t]);

  const redeem = async (r: Reward) => {
    if (!activeChild) return;
    if ((activeChild.stars || 0) < r.cost_stars) {
      showToast(t('not_enough_stars'), 'error');
      return;
    }
    if (activeChild.has_pin) {
      setPinPromptReward(r);
      return;
    }
    await doRedeem(r);
  };

  const removeReward = async (r: Reward) => {
    const previous = rewards;
    setRewards((prev) => prev.filter((x) => x.reward_id !== r.reward_id));
    try {
      await api.deleteReward(r.reward_id);
      showToast('Reward deleted.', 'success');
    } catch (e: any) {
      logger.warn('Delete reward failed:', e?.message || e);
      setRewards(previous);
      showToast('Could not delete reward.', 'error');
      load();
    }
  };

  const openAddReward = () => {
    setNewTitle('');
    setNewCost('50');
    setNewIcon('🎁');
    setShowAdd(true);
  };

  const closeAddReward = () => setShowAdd(false);

  const createReward = async () => {
    const cost = parseInt(newCost, 10);
    if (!newTitle.trim() || !cost || cost < 1) return;
    setSaving(true);
    try {
      const created = await api.createReward({ title: newTitle.trim(), cost_stars: cost, icon: newIcon || '🎁' });
      setRewards((prev) => [created, ...prev]);
      setNewTitle('');
      setNewCost('50');
      setNewIcon('🎁');
      setShowAdd(false);
      showToast('Reward created.', 'success');
    } catch (e: any) {
      logger.warn('Create reward failed:', e?.message || e);
      showToast(e?.message || 'Could not create reward.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const showBlockingError = !loading && Boolean(errorMessage) && members.length === 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <AmbientBackground />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.colors.text }]}>{t('kids')}</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>{t('earn_stars')}</Text>
            </View>
            <PressScale testID="add-reward" onPress={openAddReward} style={[styles.addBtn, { backgroundColor: theme.colors.primary, shadowColor: theme.colors.shadow }]}>
              <Plus color={theme.colors.primaryText} size={22} />
            </PressScale>
          </View>

          {showBlockingError ? (
            <ErrorState title="Kids page unavailable" message={errorMessage || 'Could not load Kids page.'} onRetry={load} />
          ) : children.length === 0 && !loading ? (
            <EmptyState title="No children yet" message="Add family members to start using stars and rewards." />
          ) : (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.childRow} keyboardShouldPersistTaps="handled">
                {children.map((c) => {
                  const active = c.member_id === activeChild?.member_id;
                  return (
                    <PressScale
                      key={c.member_id}
                      testID={`child-${c.member_id}`}
                      onPress={() => setSelectedChild(c.member_id)}
                      style={[
                        styles.childBtn,
                        { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder },
                        active && { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentSoft },
                      ]}
                    >
                      <View style={[styles.childAvatar, { backgroundColor: theme.colors.bgSoft, borderColor: active ? theme.colors.accent : theme.colors.cardBorder }]}> 
                        <Text style={[styles.childInitial, { color: theme.colors.text }]}>{c.name[0]?.toUpperCase()}</Text>
                        {c.has_pin ? (
                          <View style={[styles.lockBadge, { backgroundColor: theme.colors.primary, borderColor: theme.colors.accent }]}> 
                            <Lock color={theme.colors.primaryText} size={9} />
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.childName, { color: theme.colors.text }]}>{c.name}</Text>
                      <View style={styles.childStarsRow}>
                        <Star color={theme.colors.accent} size={12} fill={theme.colors.accent} />
                        <Text style={[styles.childStars, { color: theme.colors.textMuted }]}>{c.stars}</Text>
                      </View>
                    </PressScale>
                  );
                })}
              </ScrollView>

              {activeChild ? (
                <View style={[styles.hero, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}> 
                  <Text style={[styles.heroLabel, { color: theme.colors.textMuted }]}>{activeChild.name}</Text>
                  <View style={styles.heroStars}>
                    <Star color={theme.colors.accent} size={30} fill={theme.colors.accent} />
                    <Text style={[styles.heroCount, { color: theme.colors.text }]}>{stars}</Text>
                    <Text style={[styles.heroUnit, { color: theme.colors.textMuted }]}>{t('stars')}</Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.sectionRow}>
                <Gift color={theme.colors.textMuted} size={16} />
                <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>{t('rewards')}</Text>
              </View>

              {rewards.length === 0 ? (
                <EmptyState title={t('no_rewards')} message="Create a small reward to make chores feel more motivating." actionLabel={t('add_reward')} onAction={openAddReward} />
              ) : (
                rewards.map((r) => {
                  const affordable = stars >= r.cost_stars;
                  return (
                    <GlassCard key={r.reward_id} style={{ marginBottom: 12 }}>
                      <View style={styles.rewardRow}>
                        <Text style={styles.rewardIcon}>{r.icon || '🎁'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.rewardTitle, { color: theme.colors.text }]} numberOfLines={2}>{r.title}</Text>
                          <View style={styles.rewardCostRow}>
                            <Star color={theme.colors.accent} size={12} fill={theme.colors.accent} />
                            <Text style={[styles.rewardCost, { color: theme.colors.textMuted }]}>{r.cost_stars} {t('stars')}</Text>
                          </View>
                        </View>
                        <PressScale testID={`redeem-${r.reward_id}`} onPress={() => redeem(r)} disabled={!affordable} style={[styles.redeemBtn, { backgroundColor: theme.colors.primary }, !affordable && { opacity: 0.4 }]}>
                          <Text style={[styles.redeemText, { color: theme.colors.primaryText }]}>{affordable ? t('redeem') : `Need ${r.cost_stars - stars}`}</Text>
                        </PressScale>
                        <PressScale testID={`del-reward-${r.reward_id}`} onPress={() => Platform.OS === 'web' ? removeReward(r) : Alert.alert('Delete', r.title, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => removeReward(r) }])} style={[styles.delBtn, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
                          <Trash2 color={theme.colors.textSoft} size={16} />
                        </PressScale>
                      </View>
                    </GlassCard>
                  );
                })
              )}

              <View style={styles.tip}>
                <Sparkles color={theme.colors.textMuted} size={14} />
                <Text style={[styles.tipText, { color: theme.colors.textMuted }]}>{t('parent_picks')} · 5★ per task done</Text>
              </View>
            </>
          )}
          <View style={{ height: 220 }} />
        </ScrollView>
      </SafeAreaView>

      <KeyboardAwareBottomSheet visible={showAdd} onClose={closeAddReward} contentStyle={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}> 
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>{t('add_reward')}</Text>
          <PressScale testID="close-reward" onPress={closeAddReward} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}> 
            <X color={theme.colors.text} size={20} />
          </PressScale>
        </View>

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>Icon (emoji)</Text>
        <TextInput testID="reward-icon" value={newIcon} onChangeText={setNewIcon} maxLength={2} style={[styles.input, styles.iconInput, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} returnKeyType="next" />

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>{t('title')}</Text>
        <TextInput testID="reward-title" value={newTitle} onChangeText={setNewTitle} placeholder="Pizza Night" placeholderTextColor={theme.colors.textSoft} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} returnKeyType="next" />

        <Text style={[styles.label, { color: theme.colors.textMuted }]}>{t('reward_cost')}</Text>
        <TextInput testID="reward-cost" value={newCost} onChangeText={(v) => setNewCost(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="50" placeholderTextColor={theme.colors.textSoft} style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]} />

        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-reward" onPress={closeAddReward} style={[styles.cancelBtn, { borderColor: theme.colors.cardBorder }]}>
            <Text style={[styles.cancelText, { color: theme.colors.textMuted }]}>{t('cancel')}</Text>
          </PressScale>
          <PressScale testID="save-reward" onPress={createReward} disabled={saving || !newTitle.trim()} style={[styles.saveBtn, { backgroundColor: theme.colors.primary }, (!newTitle.trim() || saving) && { opacity: 0.5 }]}>
            <Text style={[styles.saveText, { color: theme.colors.primaryText }]}>{saving ? '...' : t('save')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <PinPadModal visible={pinPromptReward !== null} mode="verify" title={activeChild ? `${activeChild.name}'s PIN` : 'PIN'} subtitle="Enter your 4-digit PIN to redeem" onClose={() => setPinPromptReward(null)} onSubmit={async (pin) => { if (!activeChild || !pinPromptReward) return false; try { await api.verifyMemberPin(activeChild.member_id, pin); const reward = pinPromptReward; setPinPromptReward(null); await doRedeem(reward); return true; } catch { return false; } }} />

      <LoadingOverlay visible={loading} label="Loading Kids page..." />
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 18 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 22 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 42, lineHeight: 48, letterSpacing: -0.9 },
  sub: { fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 23, marginTop: 4 },
  addBtn: { width: 58, height: 58, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.12, shadowRadius: 16, elevation: 5 },
  childRow: { gap: 12, paddingVertical: 8, paddingRight: 20 },
  childBtn: { alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 24, borderWidth: 1, minWidth: 92, shadowColor: '#0F172A', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2 },
  childAvatar: { width: 48, height: 48, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  childInitial: { fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  lockBadge: { position: 'absolute', right: -4, bottom: -4, width: 19, height: 19, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  childName: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  childStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  childStars: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  hero: { alignItems: 'center', paddingVertical: 30, marginTop: 18, marginBottom: 22, borderRadius: 30, borderWidth: 1 },
  heroLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, marginBottom: 8 },
  heroStars: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  heroCount: { fontFamily: 'Inter_800ExtraBold', fontSize: 58, lineHeight: 64, letterSpacing: -1 },
  heroUnit: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 12 },
  sectionLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rewardIcon: { fontSize: 28 },
  rewardTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, lineHeight: 23 },
  rewardCostRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  rewardCost: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  redeemBtn: { paddingHorizontal: 15, paddingVertical: 10, borderRadius: 9999 },
  redeemText: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  delBtn: { width: 38, height: 38, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 7, justifyContent: 'center', marginTop: 16 },
  tipText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, padding: 24, paddingBottom: 130 },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sheetTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 26, letterSpacing: -0.4 },
  iconBtn: { padding: 9, borderRadius: 9999, borderWidth: 1 },
  label: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  input: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, fontFamily: 'Inter_500Medium', fontSize: 16 },
  iconInput: { fontSize: 24, textAlign: 'center' },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 22 },
  cancelBtn: { flex: 1, borderWidth: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  cancelText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  saveBtn: { flex: 1, borderRadius: 18, paddingVertical: 15, alignItems: 'center' },
  saveText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
