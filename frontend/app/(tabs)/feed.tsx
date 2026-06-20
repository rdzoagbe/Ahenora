import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import {
  Bell,
  Camera,
  CheckCircle2,
  ChevronRight,
  Mic,
  Plus,
  Star,
} from 'lucide-react-native';

import { useBreakpoint } from '../../src/responsive';
import { useSwipeTabs } from '../../src/hooks/useSwipeTabs';
import { PressScale } from '../../src/components/PressScale';
import { AddCardModal } from '../../src/components/AddCardModal';
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

type FeedTab = 'today' | 'upcoming' | 'all';

const UI = {
  bg: '#F6F3EE',
  card: '#FFFFFF',
  text: '#101318',
  muted: '#8A909A',
  soft: '#F1EFEA',
  line: '#E6E1DA',
  orange: '#F56519',
  orangeSoft: '#FFF0E7',
  mint: '#DFF7EC',
  mintText: '#0FA36B',
  lavender: '#EDEBFF',
  lavenderText: '#6B5CFF',
};

function dueTime(card: Card) {
  if (!card.due_date) return null;
  const time = new Date(card.due_date).getTime();
  return Number.isNaN(time) ? null : time;
}

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function uniqueCards(cards: Card[]) {
  const seen = new Set<string>();
  return cards.filter((card) => {
    if (seen.has(card.card_id)) return false;
    seen.add(card.card_id);
    return true;
  });
}

function formatDayLine(date?: string | null) {
  if (!date) return 'No deadline';
  const due = new Date(date);
  if (Number.isNaN(due.getTime())) return 'No deadline';
  const today = new Date();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const time = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameLocalDay(due, today)) return `Today · ${time}`;
  if (sameLocalDay(due, tomorrow)) return `Tomorrow · ${time}`;
  return `${due.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

function feedDateLine() {
  return new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function statusCopy(type: CardType) {
  if (type === 'SIGN_SLIP') return { label: 'SIGN', bg: UI.orangeSoft, fg: UI.orange };
  if (type === 'RSVP') return { label: 'RSVP', bg: UI.lavender, fg: UI.lavenderText };
  return { label: 'TASK', bg: UI.mint, fg: UI.mintText };
}

function cardMeta(card: Card) {
  const parts = [card.assignee, card.description, formatDayLine(card.due_date)].filter(Boolean);
  return parts.join(' · ');
}

function greetingFallback(name: string) {
  const hour = new Date().getHours();
  const prefix = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${prefix},${name ? `\n${name}` : ''}`;
}

function TaskRow({ card, onComplete }: { card: Card; onComplete: () => void }) {
  const status = statusCopy(card.type);
  return (
    <PressScale style={styles.taskRow} onPress={onComplete} testID={`feed-card-${card.card_id}`}>
      <View style={styles.checkRing}>{card.status === 'DONE' ? <CheckCircle2 size={18} color={UI.orange} /> : null}</View>
      <View style={styles.taskBody}>
        <Text style={styles.taskTitle} numberOfLines={1}>{card.title}</Text>
        <Text style={styles.taskMeta} numberOfLines={1}>{cardMeta(card)}</Text>
      </View>
      <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
        <Text style={[styles.statusPillText, { color: status.fg }]}>{status.label}</Text>
      </View>
      <ChevronRight color={UI.text} size={18} />
    </PressScale>
  );
}

export default function FeedScreen() {
  const { user, t } = useStore();
  const { px, maxW } = useBreakpoint();
  const swipeHandlers = useSwipeTabs();

  const [cards, setCards] = useState<Card[]>([]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [rewardCount, setRewardCount] = useState(0);
  const [vaultCount, setVaultCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [addSource, setAddSource] = useState<'MANUAL' | 'VOICE' | 'CAMERA'>('MANUAL');
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);
  const [activeTab, setActiveTab] = useState<FeedTab>('today');

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
        logger.warn('feed cards load failed', cardsResult.reason);
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
      logger.warn('feed load failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    load();
  }, [load]);

  const activeCards = useMemo(() => cards.filter((card) => card.status === 'OPEN'), [cards]);

  const dashboard = useMemo(() => {
    const now = Date.now();
    const today = new Date();
    const tomorrow = now + 24 * 60 * 60 * 1000;

    const overdue = activeCards.filter((card) => {
      const time = dueTime(card);
      return Boolean(time && time < now && !sameLocalDay(new Date(time), today));
    });

    const todayCards = activeCards.filter((card) => {
      const time = dueTime(card);
      return Boolean(time && sameLocalDay(new Date(time), today));
    });

    const signSlips = activeCards.filter((card) => card.type === 'SIGN_SLIP');
    const weekCards = activeCards.filter((card) => {
      const time = dueTime(card);
      return Boolean(time && time >= now && time <= now + 7 * 24 * 60 * 60 * 1000);
    });
    const next24h = activeCards.filter((card) => {
      const time = dueTime(card);
      return Boolean(time && time >= now && time <= tomorrow);
    });

    const calmScore = Math.max(12, Math.min(100, 100 - overdue.length * 18 - todayCards.length * 7 - signSlips.length * 6));
    const priority = uniqueCards([...overdue, ...signSlips, ...todayCards]).sort((a, b) => (dueTime(a) || Number.MAX_SAFE_INTEGER) - (dueTime(b) || Number.MAX_SAFE_INTEGER));

    return { overdue, todayCards, signSlips, weekCards, next24h, calmScore, priority };
  }, [activeCards]);

  const tabCards = useMemo(() => {
    const now = Date.now();
    const today = new Date();

    if (activeTab === 'today') {
      return uniqueCards([...dashboard.overdue, ...dashboard.todayCards]).sort((a, b) => (dueTime(a) || 0) - (dueTime(b) || 0));
    }

    if (activeTab === 'upcoming') {
      return activeCards
        .filter((card) => {
          const time = dueTime(card);
          return Boolean(time && time > now && !sameLocalDay(new Date(time), today));
        })
        .sort((a, b) => (dueTime(a) || 0) - (dueTime(b) || 0));
    }

    return [...activeCards].sort((a, b) => {
      const at = dueTime(a);
      const bt = dueTime(b);
      if (!at && !bt) return 0;
      if (!at) return 1;
      if (!bt) return -1;
      return at - bt;
    });
  }, [activeTab, activeCards, dashboard]);

  const visibleCards = tabCards.slice(0, 5);
  const firstName = (user?.name || '').split(' ')[0] || 'Roland';
  const headline = greetingFallback(firstName);
  const alertCount = dashboard.priority.length;
  const alertText = alertCount > 0
    ? `${alertCount} ${alertCount === 1 ? 'thing needs' : 'things need'} your attention today — ${dashboard.priority[0]?.title || 'review your household list'}.`
    : 'Nothing critical today — your household is moving calmly.';

  const openManual = () => {
    setVoiceDraft(null);
    setAddSource('MANUAL');
    setShowAdd(true);
  };

  const toggle = async (card: Card) => {
    const next = card.status === 'DONE' ? 'OPEN' : 'DONE';
    setCards((prev) => (next === 'DONE' ? prev.filter((c) => c.card_id !== card.card_id) : prev.map((c) => (c.card_id === card.card_id ? { ...c, status: next, completed_at: null } : c))));
    try {
      await api.updateCard(card.card_id, { status: next });
    } catch {
      load();
    }
  };

  return (
    <View style={styles.container} {...swipeHandlers}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingHorizontal: px }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={UI.orange}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
            />
          }
        >
          <View style={[styles.page, { maxWidth: maxW }]}>
            <View style={styles.topMetaRow}>
              <Text style={styles.dateText}>{feedDateLine()} <Text style={styles.sun}>☀</Text></Text>
              <View style={styles.bellWrap}>
                <Bell color={UI.text} size={25} />
                {alertCount > 0 ? (
                  <View style={styles.bellBadge}><Text style={styles.bellBadgeText}>{Math.min(alertCount, 9)}</Text></View>
                ) : null}
              </View>
            </View>

            <View style={styles.heroRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>{headline}</Text>
                <Text style={styles.subtitle}>Household COO</Text>
              </View>
              <View style={styles.calmCard}>
                <Text style={styles.calmLabel}>CALM</Text>
                <Text style={styles.calmValue}>{dashboard.calmScore}</Text>
              </View>
            </View>

            <View style={styles.captureCard}>
              <PressScale onPress={openManual} style={styles.captureInput} testID="feed-open-add">
                <View style={styles.plusSoft}><Plus color={UI.orange} size={26} /></View>
                <Text style={styles.capturePlaceholder} numberOfLines={1}>Add a task, note or reminder...</Text>
              </PressScale>
              <View style={styles.captureActions}>
                <View style={styles.actionPillWrap}>
                  <PressScale onPress={() => setShowCamera(true)} style={styles.actionPill}>
                    <View style={[styles.actionDot, { backgroundColor: UI.lavender }]}>
                      <Camera color={UI.lavenderText} size={18} />
                    </View>
                    <Text style={styles.actionPillText}>Photo</Text>
                  </PressScale>
                </View>
                <View style={styles.actionPillWrap}>
                  <PressScale onPress={() => setShowVoice(true)} style={styles.actionPill}>
                    <View style={[styles.actionDot, { backgroundColor: UI.mint }]}>
                      <Mic color={UI.mintText} size={18} />
                    </View>
                    <Text style={styles.actionPillText}>Voice</Text>
                  </PressScale>
                </View>
                <View style={styles.actionPillWrap}>
                  <PressScale onPress={openManual} style={[styles.actionPill, styles.actionPillAccent]}>
                    <View style={[styles.actionDot, { backgroundColor: 'rgba(255,255,255,0.24)' }]}>
                      <Plus color="#FFFFFF" size={18} />
                    </View>
                    <Text style={styles.actionPillAccentText}>Add</Text>
                  </PressScale>
                </View>
              </View>
            </View>

            <View style={styles.statsStrip}>
              <View style={styles.statCell}>
                <Text style={styles.statNumber}>{dashboard.todayCards.length}</Text>
                <Text style={styles.statLabel}>Due today</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Text style={[styles.statNumber, { color: UI.orange }]}>{dashboard.signSlips.length}</Text>
                <Text style={styles.statLabel}>Sign slips</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Text style={styles.statNumber}>{dashboard.weekCards.length}</Text>
                <Text style={styles.statLabel}>This week</Text>
              </View>
            </View>

            <PressScale style={styles.alertBanner} onPress={() => setActiveTab('today')}>
              <View style={styles.alertIcon}><Star color="#FFFFFF" fill="#FFFFFF" size={19} /></View>
              <Text style={styles.alertText} numberOfLines={2}>{alertText}</Text>
              <ChevronRight color={UI.text} size={22} />
            </PressScale>

            <View style={styles.tabRow}>
              {(['today', 'upcoming', 'all'] as const).map((tab) => (
                <PressScale key={tab} onPress={() => setActiveTab(tab)} style={styles.tabItem} testID={`feed-tab-${tab}`}>
                  <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab === 'today' ? 'Today' : tab === 'upcoming' ? 'Upcoming' : 'All'}</Text>
                  {activeTab === tab ? <View style={styles.tabUnderline} /> : null}
                </PressScale>
              ))}
            </View>

            <View style={styles.listCard}>
              {loading ? (
                <ActivityIndicator color={UI.orange} style={{ paddingVertical: 32 }} />
              ) : visibleCards.length === 0 ? (
                <View style={styles.emptyBox}>
                  <CheckCircle2 color={UI.mintText} size={22} />
                  <Text style={styles.emptyTitle}>{activeTab === 'today' ? 'Nothing urgent today.' : 'Nothing to show here.'}</Text>
                  <Text style={styles.emptySub}>Use Add, Photo, or Voice to capture the next household item.</Text>
                </View>
              ) : (
                visibleCards.map((card, index) => (
                  <View key={card.card_id}>
                    <TaskRow card={card} onComplete={() => toggle(card)} />
                    {index < visibleCards.length - 1 ? <View style={styles.rowDivider} /> : null}
                  </View>
                ))
              )}
            </View>

            <View style={styles.footerSnapshot}>
              <Text style={styles.footerSnapshotText}>{members.filter((m) => m.role?.toLowerCase() === 'child').length} kids · {rewardCount} rewards · {vaultCount} vault docs</Text>
            </View>
          </View>
          <View style={{ height: 108 }} />
        </ScrollView>
      </SafeAreaView>

      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={openManual}
        testID="feed-fab-add"
      >
        <Plus color="#FFFFFF" size={31} />
      </Pressable>

      <CameraCaptureModal
        visible={showCamera}
        onClose={() => setShowCamera(false)}
        onDraft={(draft) => {
          setVoiceDraft({
            transcript: '',
            type: draft.type,
            title: draft.title,
            description: draft.description,
            assignee: draft.assignee,
            due_date: draft.due_date || null,
            image_base64: draft.image_base64 || null,
            vault_category: draft.vault_category || 'School',
            save_to_vault: draft.save_to_vault !== false,
          });
          setAddSource('CAMERA');
          setShowCamera(false);
          setShowAdd(true);
        }}
      />

      <VoiceCaptureModal
        visible={showVoice}
        onClose={() => setShowVoice(false)}
        onDraft={(draft) => {
          setVoiceDraft(draft);
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: UI.bg,
  },
  scroll: {
    paddingTop: 12,
  },
  page: {
    width: '100%',
    alignSelf: 'center',
  },
  topMetaRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  dateText: {
    color: UI.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    letterSpacing: 0.1,
  },
  sun: {
    color: UI.orange,
  },
  bellWrap: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 3,
    minWidth: 19,
    height: 19,
    borderRadius: 99,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: UI.orange,
    paddingHorizontal: 5,
  },
  bellBadgeText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 11,
  },
  heroRow: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 22,
  },
  heroTitle: {
    color: UI.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 36,
    lineHeight: 41,
    letterSpacing: -1.15,
  },
  subtitle: {
    marginTop: 8,
    color: UI.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    letterSpacing: 0.2,
  },
  calmCard: {
    width: 78,
    height: 92,
    borderRadius: 24,
    backgroundColor: UI.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: UI.line,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  calmLabel: {
    color: UI.mintText,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  calmValue: {
    marginTop: 4,
    color: UI.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 26,
    lineHeight: 30,
  },
  captureCard: {
    borderRadius: 26,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.line,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  captureInput: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 13,
  },
  plusSoft: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: UI.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capturePlaceholder: {
    flex: 1,
    color: UI.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  captureActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionPillWrap: {
    flex: 1,
  },
  actionPill: {
    height: 46,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: UI.line,
    backgroundColor: UI.soft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionPillAccent: {
    borderWidth: 0,
    backgroundColor: UI.orange,
  },
  actionDot: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillText: {
    color: UI.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  actionPillAccentText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 14,
  },
  statsStrip: {
    minHeight: 78,
    borderRadius: 23,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.line,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statNumber: {
    color: UI.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 25,
    lineHeight: 29,
  },
  statLabel: {
    color: UI.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    marginTop: 3,
  },
  statDivider: {
    width: 1,
    height: 34,
    backgroundColor: UI.line,
  },
  alertBanner: {
    minHeight: 72,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#FFD5C2',
    backgroundColor: UI.orangeSoft,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  alertIcon: {
    width: 42,
    height: 42,
    borderRadius: 99,
    backgroundColor: UI.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertText: {
    flex: 1,
    color: UI.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 14,
    lineHeight: 20,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 28,
    borderBottomWidth: 1,
    borderBottomColor: UI.line,
    marginBottom: 12,
  },
  tabItem: {
    paddingBottom: 10,
  },
  tabText: {
    color: UI.muted,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15,
  },
  tabTextActive: {
    color: UI.text,
  },
  tabUnderline: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 99,
    backgroundColor: UI.orange,
  },
  listCard: {
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: UI.card,
    borderWidth: 1,
    borderColor: UI.line,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  taskRow: {
    minHeight: 76,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  checkRing: {
    width: 26,
    height: 26,
    borderRadius: 99,
    borderWidth: 1.3,
    borderColor: '#D9D5CF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskBody: {
    flex: 1,
    minWidth: 0,
  },
  taskTitle: {
    color: UI.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15.5,
    lineHeight: 20,
  },
  taskMeta: {
    color: UI.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 12.2,
    lineHeight: 17,
    marginTop: 2,
  },
  statusPill: {
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  statusPillText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  rowDivider: {
    height: 1,
    backgroundColor: UI.line,
    marginLeft: 50,
  },
  emptyBox: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    gap: 8,
  },
  emptyTitle: {
    color: UI.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 17,
    textAlign: 'center',
  },
  emptySub: {
    color: UI.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  footerSnapshot: {
    marginTop: 14,
    alignItems: 'center',
  },
  footerSnapshotText: {
    color: UI.muted,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  fab: {
    position: 'absolute',
    right: 22,
    bottom: 102,
    width: 61,
    height: 61,
    borderRadius: 999,
    backgroundColor: UI.orange,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 7,
    zIndex: 30,
  },
  fabPressed: {
    backgroundColor: '#D9530F',
    transform: [{ scale: 0.96 }],
  },
});
