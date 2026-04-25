import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { useFocusEffect } from 'expo-router';
import { Plus, Star, Gift, X, Trash2, Sparkles, Lock, Pencil } from 'lucide-react-native';
import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { PressScale } from '../../src/components/PressScale';
import { PinPadModal } from '../../src/components/PinPadModal';
import { useStore } from '../../src/store';
import { api, FamilyMember, Reward } from '../../src/api';

export default function KidsScreen() {
  const { t } = useStore();
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newCost, setNewCost] = useState('50');
  const [newIcon, setNewIcon] = useState('🎁');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pinPromptReward, setPinPromptReward] = useState<Reward | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [m, r] = await Promise.all([api.familyMembers(), api.listRewards()]);
      setMembers(m);
      setRewards(r);

      const firstChild = m.find((x) => x.role === 'Child');
      if (firstChild) {
        setSelectedChild((current) => current || firstChild.member_id);
      }
    } catch (e) {
      console.log('Kids page load failed:', e);
      showToast('Could not load Kids page. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const children = members.filter((m) => m.role === 'Child');
  const activeChild = children.find((c) => c.member_id === selectedChild) || children[0];
  const stars = activeChild?.stars || 0;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const doRedeem = useCallback(
    async (r: Reward) => {
      if (!activeChild) return;

      try {
        const res = await api.redeemReward(r.reward_id, activeChild.member_id);

        setMembers((prev) =>
          prev.map((m) => (m.member_id === res.member.member_id ? res.member : m))
        );

        showToast(`${t('redeemed')} ${r.title}`);
      } catch (e: any) {
        console.log('Reward redemption failed:', e);
        showToast(e?.message || 'Error');
      }
    },
    [activeChild, t]
  );

  const redeem = async (r: Reward) => {
    if (!activeChild) return;

    if ((activeChild.stars || 0) < r.cost_stars) {
      showToast(t('not_enough_stars'));
      return;
    }

    if (activeChild.has_pin) {
      setPinPromptReward(r);
      return;
    }

    await doRedeem(r);
  };

  const removeReward = async (r: Reward) => {
    setRewards((prev) => prev.filter((x) => x.reward_id !== r.reward_id));
    try { await api.deleteReward(r.reward_id); } catch { load(); }
  };

  const openAddReward = () => {
    setEditingReward(null);
    setNewTitle('');
    setNewCost('50');
    setNewIcon('🎁');
    setShowAdd(true);
  };

  const openEditReward = (reward: Reward) => {
    setEditingReward(reward);
    setNewTitle(reward.title);
    setNewCost(String(reward.cost_stars));
    setNewIcon(reward.icon || '🎁');
    setShowAdd(true);
  };

  const saveReward = async () => {
    const cost = parseInt(newCost, 10);

    if (!newTitle.trim() || !cost || cost < 1) return;

    setSaving(true);

    try {
      if (editingReward) {
        const updated = await api.updateReward(editingReward.reward_id, {
          title: newTitle.trim(),
          cost_stars: cost,
          icon: newIcon || '🎁',
        });

        setRewards((prev) =>
          prev.map((r) => (r.reward_id === updated.reward_id ? updated : r))
        );

        showToast('Reward updated.');
      } else {
        const created = await api.createReward({
          title: newTitle.trim(),
          cost_stars: cost,
          icon: newIcon || '🎁',
        });

        setRewards((prev) => [created, ...prev]);

        showToast('Reward created.');
      }

      setNewTitle('');
      setNewCost('50');
      setNewIcon('🎁');
      setEditingReward(null);
      setShowAdd(false);
    } catch (e: any) {
      console.log('Save reward failed:', e);
      showToast(e?.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const addStars = async (amount: number) => {
    if (!activeChild) return;

    try {
      const updated = await api.addMemberStars(activeChild.member_id, amount);

      setMembers((prev) =>
        prev.map((m) => (m.member_id === updated.member_id ? updated : m))
      );

      showToast(`${amount > 0 ? '+' : ''}${amount} stars for ${updated.name}`);
    } catch (e: any) {
      console.log('Add stars failed:', e);
      showToast(e?.message || 'Error');
    }
  };

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t('kids')}</Text>
              <Text style={styles.sub}>{t('earn_stars')}</Text>
            </View>
            <PressScale testID="add-reward" onPress={openAddReward} style={styles.addBtn}>
              <Plus color="#080910" size={18} />
            </PressScale>
          </View>

          {loading ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
          ) : children.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No children in the family yet.</Text>
            </View>
          ) : (
            <>
              {/* Child selector */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.childRow}
              >
                {children.map((c) => {
                  const active = c.member_id === activeChild?.member_id;
                  return (
                    <PressScale
                      key={c.member_id}
                      testID={`child-${c.member_id}`}
                      onPress={() => setSelectedChild(c.member_id)}
                      style={[styles.childBtn, active && styles.childBtnActive]}
                    >
                      <View style={[styles.childAvatar, active && { borderColor: '#F97316' }]}>
                        <Text style={styles.childInitial}>{c.name[0]?.toUpperCase()}</Text>
                        {c.has_pin ? (
                          <View style={styles.lockBadge}>
                            <Lock color="#F97316" size={8} />
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.childName, active && { color: '#fff' }]}>
                        {c.name}
                      </Text>
                      <View style={styles.childStarsRow}>
                        <Star color={active ? '#F59E0B' : 'rgba(255,255,255,0.5)'} size={11} fill={active ? '#F59E0B' : 'none'} />
                        <Text style={[styles.childStars, active && { color: '#fff' }]}>{c.stars}</Text>
                      </View>
                    </PressScale>
                  );
                })}
              </ScrollView>

              {/* Star balance hero */}
              {activeChild && (
                <View style={styles.hero}>
                  <Text style={styles.heroLabel}>{activeChild.name}</Text>
                  <View style={styles.heroStars}>
                    <Star color="#F59E0B" size={26} fill="#F59E0B" />
                    <Text style={styles.heroCount}>{stars}</Text>
                    <Text style={styles.heroUnit}>{t('stars')}</Text>
                  </View>

                  <View style={styles.starActions}>
                    <PressScale
                      testID="remove-stars"
                      onPress={() => addStars(-5)}
                      style={[styles.starActionBtn, stars <= 0 && { opacity: 0.45 }]}
                      disabled={stars <= 0}
                    >
                      <Text style={styles.starActionText}>-5</Text>
                    </PressScale>

                    <PressScale
                      testID="add-stars"
                      onPress={() => addStars(5)}
                      style={styles.starActionBtn}
                    >
                      <Text style={styles.starActionText}>+5 stars</Text>
                    </PressScale>
                  </View>
                </View>
              )}

              {/* Rewards */}
              <View style={styles.sectionRow}>
                <Gift color="rgba(255,255,255,0.6)" size={14} />
                <Text style={styles.sectionLabel}>{t('rewards')}</Text>
              </View>

              {rewards.length === 0 ? (
                <GlassCard>
                  <Text style={styles.emptyInline}>{t('no_rewards')}</Text>
                </GlassCard>
              ) : (
                rewards.map((r) => {
                  const affordable = stars >= r.cost_stars;
                  return (
                    <GlassCard key={r.reward_id} style={{ marginBottom: 12 }}>
                      <View style={styles.rewardRow}>
                        <Text style={styles.rewardIcon}>{r.icon || '🎁'}</Text>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rewardTitle} numberOfLines={2}>{r.title}</Text>
                          <View style={styles.rewardCostRow}>
                            <Star color="#F59E0B" size={11} fill="#F59E0B" />
                            <Text style={styles.rewardCost}>{r.cost_stars} {t('stars')}</Text>
                          </View>
                        </View>
                        <PressScale
                          testID={`redeem-${r.reward_id}`}
                          onPress={() => redeem(r)}
                          disabled={false}
                          style={styles.redeemBtn}
                        >
                          <Text style={styles.redeemText}>
                            {affordable ? t('redeem') : `Need ${r.cost_stars - stars}`}
                          </Text>
                        </PressScale>
                        <PressScale
                          testID={`edit-reward-${r.reward_id}`}
                          onPress={() => openEditReward(r)}
                          style={styles.delBtn}
                        >
                          <Pencil color="rgba(255,255,255,0.65)" size={14} />
                        </PressScale>

                        <PressScale
                          testID={`del-reward-${r.reward_id}`}
                          onPress={() =>
                            Platform.OS === 'web'
                              ? removeReward(r)
                              : Alert.alert('Delete', r.title, [
                                  { text: 'Cancel', style: 'cancel' },
                                  { text: 'Delete', style: 'destructive', onPress: () => removeReward(r) },
                                ])
                          }
                          style={styles.delBtn}
                        >
                          <Trash2 color="rgba(255,255,255,0.45)" size={14} />
                        </PressScale>
                      </View>
                    </GlassCard>
                  );
                })
              )}

              <View style={styles.tip}>
                <Sparkles color="rgba(255,255,255,0.45)" size={12} />
                <Text style={styles.tipText}>{t('parent_picks')} · 5★ per task done</Text>
              </View>
            </>
          )}

          <View style={{ height: 220 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Add/Edit Reward Modal */}
      <Modal visible={showAdd} transparent animationType="fade" onRequestClose={() => { setShowAdd(false); setEditingReward(null); }}>
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.backdrop} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{editingReward ? 'Edit reward' : t('add_reward')}</Text>
                <PressScale testID="close-reward" onPress={() => { setShowAdd(false); setEditingReward(null); }} style={styles.iconBtn}>
                  <X color="#fff" size={18} />
                </PressScale>
              </View>

              <Text style={styles.label}>Icon (emoji)</Text>
              <TextInput
                testID="reward-icon"
                value={newIcon}
                onChangeText={setNewIcon}
                maxLength={2}
                style={[styles.input, { fontSize: 22, textAlign: 'center' }]}
              />

              <Text style={styles.label}>{t('title')}</Text>
              <TextInput
                testID="reward-title"
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="Pizza Night"
                placeholderTextColor="rgba(255,255,255,0.3)"
                style={styles.input}
              />

              <Text style={styles.label}>{t('reward_cost')}</Text>
              <TextInput
                testID="reward-cost"
                value={newCost}
                onChangeText={(v) => setNewCost(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                placeholder="50"
                placeholderTextColor="rgba(255,255,255,0.3)"
                style={styles.input}
              />

              <View style={styles.sheetFooter}>
                <PressScale testID="cancel-reward" onPress={() => { setShowAdd(false); setEditingReward(null); }} style={styles.cancelBtn}>
                  <Text style={styles.cancelText}>{t('cancel')}</Text>
                </PressScale>
                <PressScale
                  testID="save-reward"
                  onPress={saveReward}
                  disabled={saving || !newTitle.trim()}
                  style={[styles.saveBtn, (!newTitle.trim() || saving) && { opacity: 0.5 }]}
                >
                  <Text style={styles.saveText}>{saving ? '...' : t('save')}</Text>
                </PressScale>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Toast */}
      {toast ? (
        <View style={styles.toastWrap} pointerEvents="none">
          <View style={styles.toast}>
            <Sparkles color="#F59E0B" size={14} />
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        </View>
      ) : null}

      {/* PIN prompt for redemption */}
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
            const r = pinPromptReward;
            setPinPromptReward(null);
            await doRedeem(r);
            return true;
          } catch {
            return false;
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080910' },
  scroll: { paddingHorizontal: 20, paddingTop: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 },
  title: { fontFamily: 'PlayfairDisplay_400Regular_Italic', color: '#fff', fontSize: 40, lineHeight: 46 },
  sub: { fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.55)', fontSize: 13, marginTop: 2 },
  addBtn: {
    width: 44, height: 44, borderRadius: 9999, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  childRow: { gap: 10, paddingVertical: 6, paddingRight: 20 },
  childBtn: {
    alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    minWidth: 84,
  },
  childBtnActive: {
    borderColor: 'rgba(249,115,22,0.5)',
    backgroundColor: 'rgba(249,115,22,0.12)',
  },
  childAvatar: {
    width: 40, height: 40, borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  childInitial: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  lockBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 16,
    height: 16,
    borderRadius: 9999,
    backgroundColor: '#080910',
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  childName: { color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_500Medium', fontSize: 12 },
  childStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  childStars: { color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  hero: {
    alignItems: 'center',
    paddingVertical: 28,
    marginTop: 16,
    marginBottom: 20,
    borderRadius: 24,
    backgroundColor: 'rgba(245,158,11,0.1)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)',
  },
  heroLabel: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_500Medium', fontSize: 13, marginBottom: 6 },
  heroStars: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroCount: {
    color: '#fff',
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 54,
    lineHeight: 58,
  },
  heroUnit: { color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_400Regular', fontSize: 14 },
  starActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    justifyContent: 'center',
  },
  starActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  starActionText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, marginBottom: 10 },
  sectionLabel: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rewardIcon: { fontSize: 26 },
  rewardTitle: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  rewardCostRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  rewardCost: { color: 'rgba(255,255,255,0.65)', fontFamily: 'Inter_500Medium', fontSize: 12 },
  redeemBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9999,
    backgroundColor: '#F59E0B',
  },
  redeemText: { color: '#080910', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  delBtn: { padding: 6 },
  emptyInline: { color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_400Regular', fontSize: 13, paddingVertical: 4 },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyText: { fontFamily: 'PlayfairDisplay_400Regular_Italic', color: 'rgba(255,255,255,0.5)', fontSize: 20 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 14 },
  tipText: { color: 'rgba(255,255,255,0.4)', fontFamily: 'Inter_400Regular', fontSize: 11 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.5)' },
  sheet: {
    backgroundColor: 'rgba(20,22,32,0.96)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    padding: 24, paddingBottom: 36,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sheetTitle: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 26, color: '#fff' },
  iconBtn: { padding: 8, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  label: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', fontFamily: 'Inter_400Regular', fontSize: 15,
  },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  cancelText: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_500Medium', fontSize: 15 },
  saveBtn: { flex: 1, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveText: { color: '#080910', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  toastWrap: {
    position: 'absolute', left: 0, right: 0, bottom: 180, alignItems: 'center',
  },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 18, paddingVertical: 12,
    backgroundColor: 'rgba(20,22,32,0.95)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)',
    borderRadius: 9999,
  },
  toastText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 13 },
});
