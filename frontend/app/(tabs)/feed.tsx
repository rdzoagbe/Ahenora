import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock3,
  FileText,
  Mic,
  PlusCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  UsersRound,
} from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { PressScale } from '../../src/components/PressScale';
import { FloatingActionBar } from '../../src/components/FloatingActionBar';
import { AddCardModal } from '../../src/components/AddCardModal';
import { SundayBriefModal } from '../../src/components/SundayBriefModal';
import { VoiceCaptureModal } from '../../src/components/VoiceCaptureModal';
import { CameraCaptureModal } from '../../src/components/CameraCaptureModal';
import { useStore } from '../../src/store';
import { api, Card, CardType, FamilyMember } from '../../src/api';
import { syncCardReminderNotifications } from '../../src/notifications';
import { logger } from '../../src/logger';

interface VoiceDraft {
  transcript: string;
  type: CardType;
  title: string;
  description: string;
  assignee: string;
  due_date?: string | null;
  image_base64?: string | null;
  vault_category?: string;
  save_to_vault?: boolean;
}

type Labels = {
  capture: string;
  overdue: string;
  today: string;
  stars: string;
  vault: string;
  priorityNow: string;
  nothingUrgent: string;
  nothingUrgentSub: string;
  quickActions: string;
  scan: string;
  voice: string;
  manual: string;
  brief: string;
  calm: string;
  thisWeek: string;
  items: string;
  show: string;
  hide: string;
};

function labelsFor(lang: string): Labels {
  if (lang === 'fr') {
    return {
      capture: 'Capturer quelque chose…',
      overdue: 'En retard',
      today: "Aujourd'hui",
      stars: 'Étoiles',
      vault: 'Coffre',
      priorityNow: 'Priorité maintenant',
      nothingUrgent: 'Rien de critique.',
      nothingUrgentSub: 'Votre foyer est sous contrôle pour le moment.',
      quickActions: 'Actions rapides',
      scan: 'Scan',
      voice: 'Voix',
      manual: 'Manuel',
      brief: 'Brief',
      calm: 'calme',
      thisWeek: 'Cette semaine',
      items: 'éléments',
      show: 'Afficher',
      hide: 'Masquer',
    };
  }

  return {
    capture: 'Capture anything…',
    overdue: 'Overdue',
    today: 'Today',
    stars: 'Stars',
    vault: 'Vault',
    priorityNow: 'Priority now',
    nothingUrgent: 'Nothing critical.',
    nothingUrgentSub: 'Your household is under control right now.',
    quickActions: 'Quick actions',
    scan: 'Scan',
    voice: 'Voice',
    manual: 'Manual',
    brief: 'Brief',
    calm: 'calm',
    thisWeek: 'This week',
    items: 'items',
    show: 'Show',
    hide: 'Hide',
  };
}

function dueTime(card: Card) {
  if (!card.due_date) return null;
  const time = new Date(card.due_date).getTime();
  return Number.isNaN(time) ? null : time;
}

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatCardDate(card: Card) {
  const time = dueTime(card);
  if (!time) return 'No deadline';
  const date = new Date(time);
  const today = new Date();
  if (sameLocalDay(date, today)) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function uniqueCards(cards: Card[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.card_id)) return false;
    seen.add(card.card_id);
    return true;
  });
}

export default function FeedScreen() {
  const router = useRouter();
  const { user, t, theme, lang } = useStore();
  const labels = useMemo(() => labelsFor(lang), [lang]);

  const [cards, setCards] = useState<Card[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [rewardCount, setRewardCount] = useState(0);
  const [vaultCount, setVaultCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [addSource, setAddSource] = useState<'MANUAL' | 'VOICE' | 'CAMERA'>('MANUAL');
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);
  const [showThisWeek, setShowThisWeek] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cardsResult, membersResult, rewardsResult, vaultResult] = await Promise.allSettled([
        api.listCards(),
        api.familyMembers(),
        api.listRewards(),
        api.listVault(),
      ]);

      let loadedCards: Card[] = [];
      if (cardsResult.status === 'fulfilled') {
        loadedCards = cardsResult.value;
        setCards(loadedCards);
      } else {
        logger.warn('load cards error', cardsResult.reason);
      }

      if (membersResult.status === 'fulfilled') setMembers(membersResult.value);
      if (rewardsResult.status === 'fulfilled') setRewardCount(rewardsResult.value.length);
      if (vaultResult.status === 'fulfilled') setVaultCount(vaultResult.value.length);

      if (cardsResult.status === 'fulfilled') {
        api
          .getNotificationSettings()
          .then((prefs) => syncCardReminderNotifications(prefs.card_reminders ? loadedCards : [], prefs.card_reminders))
          .catch(() => undefined);
      }
    } catch (e) {
      logger.warn('command center load failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  const activeCards = useMemo(() => cards.filter((c) => c.status === 'OPEN'), [cards]);
  const childMembers = useMemo(() => members.filter((m) => m.role?.toLowerCase() === 'child'), [members]);
  const totalStars = useMemo(() => childMembers.reduce((sum, child) => sum + (child.stars || 0), 0), [childMembers]);

  const dashboard = useMemo(() => {
    const now = Date.now();
    const today = new Date();
    const overdue = activeCards.filter((card) => {
      const time = dueTime(card);
      return Boolean(time && time < now && !sameLocalDay(new Date(time), today));
    });
    const todayCards = activeCards.filter((card) => {
      const time = dueTime(card);
      return Boolean(time && sameLocalDay(new Date(time), today));
    });
    const adminCards = activeCards.filter((card) => card.type === 'SIGN_SLIP' || card.type === 'RSVP');
    const priority = uniqueCards([...overdue, ...adminCards, ...todayCards]).sort((a, b) => {
      const at = dueTime(a) || Number.MAX_SAFE_INTEGER;
      const bt = dueTime(b) || Number.MAX_SAFE_INTEGER;
      return at - bt;
    });
    const calmScore = Math.max(12, Math.min(100, 100 - overdue.length * 18 - todayCards.length * 7 - adminCards.length * 6));
    return { overdue, todayCards, priority, calmScore };
  }, [activeCards]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t('greeting_morning');
    if (h < 18) return t('greeting_afternoon');
    return t('greeting_evening');
  })();

  const firstName = (user?.name || '').split(' ')[0] || '';

  const openManual = () => {
    setVoiceDraft(null);
    setAddSource('MANUAL');
    setShowAdd(true);
  };

  const openCamera = () => setShowCamera(true);
  const openVoice = () => setShowVoice(true);

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <AmbientBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={theme.colors.text}
            />
          }
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.greet, { color: theme.colors.textMuted }]}>{greeting}</Text>
              <Text style={[styles.name, { color: theme.colors.text }]}>{firstName || 'Family'}<Text style={styles.nameDot}>.</Text></Text>
            </View>
            <View style={styles.headerRight}>
              <View style={[styles.calmChip, { backgroundColor: theme.colors.success + '18', borderColor: theme.colors.success + '33' }]}>
                <Clock3 color={theme.colors.success} size={13} />
                <Text style={[styles.calmValue, { color: theme.colors.success }]}>{dashboard.calmScore}</Text>
                <Text style={[styles.calmLabel, { color: theme.colors.success }]}>{labels.calm}</Text>
              </View>
              {user?.picture ? (
                <Image source={{ uri: user.picture }} style={[styles.avatar, { borderColor: theme.colors.cardBorder }]} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                  <Text style={[styles.avatarText, { color: theme.colors.text }]}>{(firstName[0] || 'C').toUpperCase()}</Text>
                </View>
              )}
            </View>
          </View>

          <PressScale testID="command-capture" onPress={openManual} style={[styles.searchShell, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
            <Search color={theme.colors.textSoft} size={20} />
            <Text style={[styles.searchText, { color: theme.colors.textMuted }]}>{labels.capture}</Text>
            <View style={[styles.filterButton, { backgroundColor: theme.colors.primary }]}>
              <SlidersHorizontal color={theme.colors.primaryText} size={18} />
            </View>
          </PressScale>

          <View style={styles.statStrip}>
            <StatChip icon={<Clock3 color="#EF4444" size={16} />} value={dashboard.overdue.length} label={labels.overdue} danger />
            <StatChip icon={<CalendarDays color={theme.colors.success} size={16} />} value={dashboard.todayCards.length} label={labels.today} />
            <StatChip icon={<Star color={theme.colors.accent} size={16} fill={theme.colors.accent} />} value={totalStars} label={labels.stars} />
            <StatChip icon={<ShieldCheck color="#60A5FA" size={16} />} value={vaultCount} label={labels.vault} />
          </View>

          <View style={styles.actionStrip}>
            <ActionTile label={labels.scan} onPress={openCamera} icon={<Camera color={theme.colors.text} size={18} />} />
            <ActionTile label={labels.voice} onPress={openVoice} icon={<Mic color={theme.colors.text} size={18} />} />
            <ActionTile label={labels.manual} onPress={openManual} icon={<PlusCircle color={theme.colors.text} size={18} />} />
            <ActionTile label={labels.brief} onPress={() => setShowBrief(true)} icon={<Sparkles color={theme.colors.text} size={18} />} />
          </View>

          <GlassCard style={[styles.priorityPanel, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <View style={styles.panelHeader}>
              <Text style={[styles.panelLabel, { color: theme.colors.textMuted }]}>{labels.priorityNow}</Text>
              <View style={[styles.countBadge, { backgroundColor: theme.colors.accentSoft }]}>
                <Text style={[styles.countBadgeText, { color: theme.colors.accent }]}>{dashboard.priority.length}</Text>
              </View>
            </View>

            {loading ? (
              <ActivityIndicator color={theme.colors.text} style={{ marginTop: 18 }} />
            ) : dashboard.priority.length === 0 ? (
              <View style={styles.emptyPriority}>
                <CheckCircle2 color={theme.colors.success} size={24} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{labels.nothingUrgent}</Text>
                  <Text style={[styles.emptySub, { color: theme.colors.textMuted }]}>{labels.nothingUrgentSub}</Text>
                </View>
              </View>
            ) : (
              dashboard.priority.slice(0, 3).map((card) => (
                <PressScale key={card.card_id} onPress={() => router.push('/calendar')} style={[styles.priorityRow, { borderColor: theme.colors.cardBorder }]}>
                  <View style={[styles.priorityIcon, { backgroundColor: card.type === 'TASK' ? theme.colors.bgSoft : theme.colors.accentSoft }]}>
                    {card.type === 'TASK' ? <CheckCircle2 color={theme.colors.success} size={17} /> : <FileText color={theme.colors.accent} size={17} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.priorityTitle, { color: theme.colors.text }]} numberOfLines={1}>{card.title}</Text>
                    <Text style={[styles.priorityMeta, { color: theme.colors.textMuted }]} numberOfLines={1}>{formatCardDate(card)} · {card.assignee || t('family')}</Text>
                  </View>
                  <ArrowRight color={theme.colors.textSoft} size={17} />
                </PressScale>
              ))
            )}
          </GlassCard>

          <PressScale
            testID="feed-this-week-toggle"
            onPress={() => setShowThisWeek((value) => !value)}
            style={[styles.weekToggle, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}
          >
            <View style={styles.weekLeft}>
              <CalendarDays color={theme.colors.textMuted} size={16} />
              <Text style={[styles.weekTitle, { color: theme.colors.text }]}>{labels.thisWeek}</Text>
              <View style={[styles.mutedChip, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <Text style={[styles.mutedChipText, { color: theme.colors.textMuted }]}>{activeCards.length} {labels.items}</Text>
              </View>
            </View>
            <Text style={[styles.weekToggleText, { color: theme.colors.textMuted }]}>{showThisWeek ? labels.hide : labels.show} ↓</Text>
          </PressScale>

          {showThisWeek ? (
            <View style={styles.weekList}>
              {activeCards.slice(0, 8).map((card) => (
                <PressScale key={`week-${card.card_id}`} onPress={() => router.push('/calendar')} style={[styles.weekItem, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                  <View style={[styles.weekDot, { backgroundColor: dueTime(card) && (dueTime(card) || 0) < Date.now() ? '#EF4444' : theme.colors.accent }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.weekItemTitle, { color: theme.colors.text }]} numberOfLines={1}>{card.title}</Text>
                    <Text style={[styles.weekItemMeta, { color: theme.colors.textMuted }]}>{formatCardDate(card)} · {card.assignee || t('family')}</Text>
                  </View>
                </PressScale>
              ))}
            </View>
          ) : null}

          <View style={styles.footerSignal}>
            <UsersRound color={theme.colors.textMuted} size={14} />
            <Text style={[styles.footerSignalText, { color: theme.colors.textMuted }]}>Household COO · {childMembers.length} kids · {rewardCount} rewards</Text>
          </View>

          <View style={{ height: 90 }} />
        </ScrollView>
      </SafeAreaView>

      <FloatingActionBar onManual={openManual} onCamera={openCamera} onVoice={openVoice} />

      <CameraCaptureModal
        visible={showCamera}
        onClose={() => setShowCamera(false)}
        onDraft={(d) => {
          setVoiceDraft({
            transcript: '',
            type: d.type,
            title: d.title,
            description: d.description,
            assignee: d.assignee,
            due_date: d.due_date || null,
            image_base64: d.image_base64 || null,
            vault_category: d.vault_category || 'School',
            save_to_vault: d.save_to_vault !== false,
          });
          setAddSource('CAMERA');
          setShowCamera(false);
          setShowAdd(true);
        }}
      />

      <VoiceCaptureModal
        visible={showVoice}
        onClose={() => setShowVoice(false)}
        onDraft={(d) => {
          setVoiceDraft(d);
          setAddSource('VOICE');
          setShowVoice(false);
          setShowAdd(true);
        }}
      />

      <AddCardModal
        visible={showAdd}
        onClose={() => {
          setShowAdd(false);
          setVoiceDraft(null);
        }}
        onCreated={load}
        initialSource={addSource}
        initialDraft={voiceDraft}
      />
      <SundayBriefModal visible={showBrief} onClose={() => setShowBrief(false)} />
    </View>
  );
}

function StatChip({ icon, value, label, danger }: { icon: React.ReactNode; value: number; label: string; danger?: boolean }) {
  const { theme } = useStore();
  return (
    <PressScale style={[styles.statChip, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
      {icon}
      <Text style={[styles.statValue, { color: danger ? '#EF4444' : theme.colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>{label}</Text>
    </PressScale>
  );
}

function ActionTile({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  const { theme } = useStore();
  return (
    <PressScale onPress={onPress} style={[styles.actionTile, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
      {icon}
      <Text style={[styles.actionText, { color: theme.colors.textMuted }]}>{label}</Text>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 14, gap: 12 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  greet: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  name: { fontFamily: 'Inter_800ExtraBold', fontSize: 24, lineHeight: 29, letterSpacing: -0.5 },
  nameDot: { color: '#F97316' },
  avatar: { width: 40, height: 40, borderRadius: 9999, borderWidth: 1 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  calmChip: { minHeight: 30, borderRadius: 9999, borderWidth: 1, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 5 },
  calmValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 11 },
  calmLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, opacity: 0.75 },
  searchShell: { minHeight: 62, borderRadius: 9999, borderWidth: 1, paddingLeft: 18, paddingRight: 9, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, shadowOpacity: 0.1, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 4 },
  searchText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 14 },
  filterButton: { width: 42, height: 42, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  statStrip: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statChip: { flex: 1, minHeight: 78, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 4 },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, lineHeight: 22, letterSpacing: -0.3 },
  statLabel: { fontFamily: 'Inter_700Bold', fontSize: 9, textAlign: 'center' },
  actionStrip: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  actionTile: { flex: 1, minHeight: 62, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 4 },
  actionText: { fontFamily: 'Inter_800ExtraBold', fontSize: 10 },
  priorityPanel: { borderRadius: 22, padding: 14, marginBottom: 12 },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  panelLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.1 },
  countBadge: { minWidth: 28, height: 28, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  countBadgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  priorityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1 },
  priorityIcon: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  priorityTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, lineHeight: 18 },
  priorityMeta: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 2 },
  emptyPriority: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  emptyTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  emptySub: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, marginTop: 2 },
  weekToggle: { minHeight: 56, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  weekLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  weekTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  weekToggleText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  mutedChip: { borderWidth: 1, borderRadius: 9999, paddingHorizontal: 9, paddingVertical: 4 },
  mutedChipText: { fontFamily: 'Inter_800ExtraBold', fontSize: 10 },
  weekList: { marginTop: 10, gap: 8 },
  weekItem: { minHeight: 58, borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  weekDot: { width: 10, height: 10, borderRadius: 9999 },
  weekItemTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  weekItemMeta: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 2 },
  footerSignal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  footerSignalText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});
