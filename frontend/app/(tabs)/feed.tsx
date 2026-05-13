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
  Bell,
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
import { SmartCard } from '../../src/components/SmartCard';
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
  today: string;
  commandCenter: string;
  commandSubtitle: string;
  capture: string;
  urgent: string;
  calendarToday: string;
  kidStars: string;
  vaultDocs: string;
  needsAttention: string;
  nothingUrgent: string;
  nothingUrgentSub: string;
  nextUp: string;
  quickActions: string;
  scan: string;
  voice: string;
  manual: string;
  brief: string;
  calmScore: string;
  scoreHelper: string;
  openNow: string;
};

function labelsFor(lang: string): Labels {
  if (lang === 'fr') {
    return {
      today: "Aujourd'hui",
      commandCenter: 'Centre familial',
      commandSubtitle: 'Ce qui compte maintenant, en un seul endroit.',
      capture: 'Capturer quelque chose',
      urgent: 'Urgent',
      calendarToday: 'Calendrier',
      kidStars: 'Étoiles',
      vaultDocs: 'Coffre',
      needsAttention: 'À traiter',
      nothingUrgent: 'Rien de critique.',
      nothingUrgentSub: 'Votre foyer est sous contrôle pour le moment.',
      nextUp: 'À venir',
      quickActions: 'Actions rapides',
      scan: 'Scanner',
      voice: 'Voix',
      manual: 'Manuel',
      brief: 'Brief',
      calmScore: 'Score de calme',
      scoreHelper: 'Moins il y a de retard, plus le foyer respire.',
      openNow: 'ouverts',
    };
  }

  if (lang === 'es') {
    return {
      today: 'Hoy',
      commandCenter: 'Centro familiar',
      commandSubtitle: 'Lo importante ahora, en un solo lugar.',
      capture: 'Capturar algo',
      urgent: 'Urgente',
      calendarToday: 'Calendario',
      kidStars: 'Estrellas',
      vaultDocs: 'Bóveda',
      needsAttention: 'Necesita atención',
      nothingUrgent: 'Nada crítico.',
      nothingUrgentSub: 'Tu hogar está bajo control por ahora.',
      nextUp: 'Próximo',
      quickActions: 'Acciones rápidas',
      scan: 'Escanear',
      voice: 'Voz',
      manual: 'Manual',
      brief: 'Informe',
      calmScore: 'Calma',
      scoreHelper: 'Menos atrasos, más calma.',
      openNow: 'abiertos',
    };
  }

  if (lang === 'de') {
    return {
      today: 'Heute',
      commandCenter: 'Familien-Zentrale',
      commandSubtitle: 'Das Wichtige jetzt, an einem Ort.',
      capture: 'Etwas erfassen',
      urgent: 'Dringend',
      calendarToday: 'Kalender',
      kidStars: 'Sterne',
      vaultDocs: 'Tresor',
      needsAttention: 'Braucht Aufmerksamkeit',
      nothingUrgent: 'Nichts Kritisches.',
      nothingUrgentSub: 'Ihr Haushalt ist im Moment unter Kontrolle.',
      nextUp: 'Als Nächstes',
      quickActions: 'Schnellaktionen',
      scan: 'Scannen',
      voice: 'Stimme',
      manual: 'Manuell',
      brief: 'Brief',
      calmScore: 'Ruhe-Score',
      scoreHelper: 'Weniger Rückstand, mehr Ruhe.',
      openNow: 'offen',
    };
  }

  return {
    today: 'Today',
    commandCenter: 'Family command center',
    commandSubtitle: 'Everything that needs attention, in one calm view.',
    capture: 'Capture anything',
    urgent: 'Urgent',
    calendarToday: 'Calendar',
    kidStars: 'Stars',
    vaultDocs: 'Vault',
    needsAttention: 'Needs attention',
    nothingUrgent: 'Nothing critical.',
    nothingUrgentSub: 'Your household is under control right now.',
    nextUp: 'Next up',
    quickActions: 'Quick actions',
    scan: 'Scan',
    voice: 'Voice',
    manual: 'Manual',
    brief: 'Brief',
    calmScore: 'Calm score',
    scoreHelper: 'Fewer overdue items means a calmer household.',
    openNow: 'open',
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

      if (membersResult.status === 'fulfilled') {
        setMembers(membersResult.value);
      }
      if (rewardsResult.status === 'fulfilled') {
        setRewardCount(rewardsResult.value.length);
      }
      if (vaultResult.status === 'fulfilled') {
        setVaultCount(vaultResult.value.length);
      }

      if (cardsResult.status === 'fulfilled') {
        api
          .getNotificationSettings()
          .then((prefs) => {
            if (prefs.card_reminders) {
              return syncCardReminderNotifications(loadedCards, true);
            }
            return syncCardReminderNotifications([], false);
          })
          .catch(() => undefined);
      }
    } catch (e) {
      logger.warn('command center load failed', e);
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

  const toggle = async (card: Card) => {
    const next = card.status === 'DONE' ? 'OPEN' : 'DONE';
    setCards((prev) => prev.map((c) => (c.card_id === card.card_id ? { ...c, status: next } : c)));
    try {
      await api.updateCard(card.card_id, { status: next });
    } catch {
      load();
    }
  };

  const remove = async (card: Card) => {
    setCards((prev) => prev.filter((c) => c.card_id !== card.card_id));
    try {
      await api.deleteCard(card.card_id);
    } catch {
      load();
    }
  };

  const activeCards = useMemo(() => cards.filter((c) => c.status === 'OPEN'), [cards]);
  const openCount = activeCards.length;

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

    const calendarToday = todayCards.filter((card) => card.source === 'CALENDAR');
    const adminCards = activeCards.filter((card) => card.type === 'SIGN_SLIP' || card.type === 'RSVP');
    const nextUp = activeCards
      .filter((card) => {
        const time = dueTime(card);
        return Boolean(time && time >= now && time <= tomorrow);
      })
      .sort((a, b) => (dueTime(a) || 0) - (dueTime(b) || 0));

    const priority = uniqueCards([...overdue, ...adminCards, ...todayCards]).sort((a, b) => {
      const at = dueTime(a) || Number.MAX_SAFE_INTEGER;
      const bt = dueTime(b) || Number.MAX_SAFE_INTEGER;
      return at - bt;
    });

    const calmScore = Math.max(12, Math.min(100, 100 - overdue.length * 18 - todayCards.length * 7 - adminCards.length * 6));

    return { overdue, todayCards, calendarToday, adminCards, nextUp, priority, calmScore };
  }, [activeCards]);

  const childMembers = useMemo(() => members.filter((m) => m.role?.toLowerCase() === 'child'), [members]);
  const totalStars = useMemo(() => childMembers.reduce((sum, child) => sum + (child.stars || 0), 0), [childMembers]);

  const upcomingReminders = useMemo(() => {
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    return cards
      .filter((c) => c.status === 'OPEN' && c.due_date && (c.reminder_minutes || 0) > 0)
      .filter((c) => {
        const due = dueTime(c);
        if (!due) return false;
        const remindAt = due - (c.reminder_minutes || 0) * 60 * 1000;
        return remindAt >= now - 60 * 60 * 1000 && remindAt <= in24h;
      })
      .sort((a, b) => {
        const da = (dueTime(a) || 0) - (a.reminder_minutes || 0) * 60 * 1000;
        const dbv = (dueTime(b) || 0) - (b.reminder_minutes || 0) * 60 * 1000;
        return da - dbv;
      });
  }, [cards]);

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
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={[styles.avatar, { borderColor: theme.colors.cardBorder }]} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                <Text style={[styles.avatarText, { color: theme.colors.text }]}>{(firstName[0] || 'C').toUpperCase()}</Text>
              </View>
            )}
          </View>

          <PressScale testID="command-capture" onPress={openManual} style={[styles.searchShell, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
            <Search color={theme.colors.textSoft} size={21} />
            <Text style={[styles.searchText, { color: theme.colors.textMuted }]}>{labels.capture}</Text>
            <View style={[styles.filterButton, { backgroundColor: theme.colors.primary }]}>
              <SlidersHorizontal color={theme.colors.primaryText} size={19} />
            </View>
          </PressScale>

          <View style={[styles.commandHero, { shadowColor: theme.colors.shadow }]}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroBadge}>
                <Sparkles color="#202323" size={13} />
                <Text style={styles.heroBadgeText}>{labels.today}</Text>
              </View>
              <Text style={styles.heroCount}>{openCount} {labels.openNow}</Text>
            </View>

            <Text style={styles.heroTitle}>{labels.commandCenter}</Text>
            <Text style={styles.heroSub}>{labels.commandSubtitle}</Text>

            <View style={styles.scoreRow}>
              <View style={styles.scoreCircle}>
                <View style={styles.scoreRing} />
                <View style={styles.scoreArc} />
                <Text style={styles.scoreValue}>{dashboard.calmScore}</Text>
                <Text style={styles.scoreTotal}>/100</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.scoreTitle}>{labels.calmScore}</Text>
                <Text style={styles.scoreSub}>{labels.scoreHelper}</Text>
              </View>
            </View>
            <View pointerEvents="none" style={styles.heroIllustration}>
              <View style={styles.heroHalo} />
              <View style={styles.heartOne} />
              <View style={styles.heartTwo} />
              <View style={styles.treeTrunk} />
              <View style={styles.treeTop} />
              <View style={styles.houseBody} />
              <View style={styles.houseRoof} />
              <View style={styles.houseDoor} />
              <View style={styles.bushOne} />
              <View style={styles.bushTwo} />
            </View>

            <PressScale testID="open-brief" onPress={() => setShowBrief(true)} style={styles.heroAction}>
              <Text style={styles.heroActionText}>{t('sunday_brief')}</Text>
              <View style={styles.heroArrow}>
                <ArrowRight color="#202323" size={20} />
              </View>
            </PressScale>
          </View>

          <View style={styles.statGrid}>
            <PressScale onPress={() => router.push('/calendar')} style={[styles.statCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
              <Clock3 color={theme.colors.accent} size={19} />
              <Text style={[styles.statValue, { color: theme.colors.text }]}>{dashboard.priority.length}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>{lang === 'fr' ? 'En retard' : labels.urgent}</Text>
            </PressScale>
            <PressScale onPress={() => router.push('/calendar')} style={[styles.statCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
              <CalendarDays color={theme.colors.success} size={19} />
              <Text style={[styles.statValue, { color: theme.colors.text }]}>{dashboard.calendarToday.length}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>{lang === 'fr' ? "Événement aujourd'hui" : labels.calendarToday}</Text>
            </PressScale>
            <PressScale onPress={() => router.push('/kids')} style={[styles.statCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
              <Star color={theme.colors.accent} size={19} fill={theme.colors.accent} />
              <Text style={[styles.statValue, { color: theme.colors.text }]}>{totalStars}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>{lang === 'fr' ? 'Récompenses' : labels.kidStars}</Text>
            </PressScale>
            <PressScale onPress={() => router.push('/vault')} style={[styles.statCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
              <ShieldCheck color={theme.colors.success} size={19} />
              <Text style={[styles.statValue, { color: theme.colors.text }]}>{vaultCount}</Text>
              <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>{lang === 'fr' ? 'Tout va bien' : labels.vaultDocs}</Text>
            </PressScale>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{labels.quickActions}</Text>
          </View>
          <View style={styles.actionRow}>
            <PressScale onPress={() => setShowCamera(true)} style={[styles.actionTile, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
              <Camera color={theme.colors.text} size={19} />
              <Text style={[styles.actionText, { color: theme.colors.text }]}>{labels.scan}</Text>
            </PressScale>
            <PressScale onPress={() => setShowVoice(true)} style={[styles.actionTile, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
              <Mic color={theme.colors.text} size={19} />
              <Text style={[styles.actionText, { color: theme.colors.text }]}>{labels.voice}</Text>
            </PressScale>
            <PressScale onPress={openManual} style={[styles.actionTile, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
              <PlusCircle color={theme.colors.text} size={19} />
              <Text style={[styles.actionText, { color: theme.colors.text }]}>{labels.manual}</Text>
            </PressScale>
            <PressScale onPress={() => setShowBrief(true)} style={[styles.actionTile, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
              <Sparkles color={theme.colors.text} size={19} />
              <Text style={[styles.actionText, { color: theme.colors.text }]}>{labels.brief}</Text>
            </PressScale>
          </View>

          {upcomingReminders.length > 0 && (
            <GlassCard testID="reminders-banner" style={styles.remindersCard}>
              <View style={styles.remindersHeader}>
                <Bell color={theme.colors.accent} size={16} />
                <Text style={[styles.remindersTitle, { color: theme.colors.text }]}>{t('reminders')} · {upcomingReminders.length}</Text>
              </View>
              {upcomingReminders.slice(0, 3).map((c) => {
                const due = dueTime(c) || Date.now();
                const remindAt = due - (c.reminder_minutes || 0) * 60 * 1000;
                const mins = Math.max(0, Math.round((remindAt - Date.now()) / 60000));
                const label = mins <= 1 ? 'now' : mins < 60 ? `in ${mins}m` : `in ${Math.round(mins / 60)}h`;
                return (
                  <View key={c.card_id} style={styles.remindersRow}>
                    <Text style={[styles.remindersItem, { color: theme.colors.text }]} numberOfLines={1}>{c.title}</Text>
                    <Text style={[styles.remindersWhen, { color: theme.colors.textMuted }]}>{label}</Text>
                  </View>
                );
              })}
            </GlassCard>
          )}

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{labels.needsAttention}</Text>
            <Text style={[styles.sectionSub, { color: theme.colors.textMuted }]}>{dashboard.priority.length}</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={theme.colors.text} style={{ marginTop: 40 }} />
          ) : dashboard.priority.length === 0 ? (
            <GlassCard style={styles.emptyPriority}>
              <CheckCircle2 color={theme.colors.success} size={28} />
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{labels.nothingUrgent}</Text>
              <Text style={[styles.emptySub, { color: theme.colors.textMuted }]}>{labels.nothingUrgentSub}</Text>
            </GlassCard>
          ) : (
            dashboard.priority.slice(0, 3).map((card) => (
              <PressScale key={`priority-${card.card_id}`} style={[styles.priorityCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
                <View style={[styles.priorityIcon, { backgroundColor: card.type === 'TASK' ? theme.colors.bgSoft : theme.colors.accentSoft }]}> 
                  {card.type === 'TASK' ? <CheckCircle2 color={theme.colors.success} size={18} /> : <FileText color={theme.colors.accent} size={18} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.priorityTitle, { color: theme.colors.text }]} numberOfLines={1}>{card.title}</Text>
                  <Text style={[styles.priorityMeta, { color: theme.colors.textMuted }]} numberOfLines={1}>{formatCardDate(card)} · {card.assignee || t('family')}</Text>
                </View>
                <ArrowRight color={theme.colors.textMuted} size={17} />
              </PressScale>
            ))
          )}

          <View style={[styles.nextUpPanel, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
            <View style={styles.nextUpHeader}>
              <View>
                <Text style={[styles.nextUpEyebrow, { color: theme.colors.textMuted }]}>HOUSEHOLD PRIORITY</Text>
                <Text style={[styles.nextUpHeading, { color: theme.colors.text }]}>{labels.nextUp}</Text>
              </View>
              <View style={[styles.nextUpCountBadge, { backgroundColor: theme.colors.accentSoft }]}>
                <Text style={[styles.nextUpCountText, { color: theme.colors.accent }]}>
                  {uniqueCards([...dashboard.overdue, ...dashboard.todayCards, ...dashboard.nextUp]).length}
                </Text>
              </View>
            </View>

            <View style={styles.nextUpStats}>
              <View style={[styles.nextUpStat, { backgroundColor: theme.colors.bgSoft }]}>
                <Text style={[styles.nextUpStatNumber, { color: dashboard.overdue.length ? '#DC2626' : theme.colors.text }]}>
                  {dashboard.overdue.length}
                </Text>
                <Text style={[styles.nextUpStatLabel, { color: theme.colors.textMuted }]}>Overdue</Text>
              </View>
              <View style={[styles.nextUpStat, { backgroundColor: theme.colors.bgSoft }]}>
                <Text style={[styles.nextUpStatNumber, { color: theme.colors.text }]}>{dashboard.todayCards.length}</Text>
                <Text style={[styles.nextUpStatLabel, { color: theme.colors.textMuted }]}>{labels.today}</Text>
              </View>
              <View style={[styles.nextUpStat, { backgroundColor: theme.colors.bgSoft }]}>
                <Text style={[styles.nextUpStatNumber, { color: theme.colors.text }]}>{dashboard.nextUp.length}</Text>
                <Text style={[styles.nextUpStatLabel, { color: theme.colors.textMuted }]}>24h</Text>
              </View>
            </View>

            {uniqueCards([...dashboard.overdue, ...dashboard.todayCards, ...dashboard.nextUp]).length === 0 ? (
              <View style={styles.nextUpEmpty}>
                <CheckCircle2 color={theme.colors.success} size={22} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.nextUpTaskTitle, { color: theme.colors.text }]}>{labels.nothingUrgent}</Text>
                  <Text style={[styles.nextUpTaskMeta, { color: theme.colors.textMuted }]}>{labels.nothingUrgentSub}</Text>
                </View>
              </View>
            ) : (
              uniqueCards([...dashboard.overdue, ...dashboard.todayCards, ...dashboard.nextUp]).slice(0, 3).map((card) => (
                <PressScale
                  key={`next-command-${card.card_id}`}
                  onPress={() => router.push('/calendar')}
                  style={[styles.nextUpTask, { borderColor: theme.colors.cardBorder }]}
                >
                  <View style={[styles.nextUpTaskIcon, { backgroundColor: card.type === 'TASK' ? theme.colors.bgSoft : theme.colors.accentSoft }]}>
                    {card.type === 'TASK' ? (
                      <CheckCircle2 color={theme.colors.success} size={16} />
                    ) : (
                      <FileText color={theme.colors.accent} size={16} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.nextUpTaskTitle, { color: theme.colors.text }]} numberOfLines={1}>{card.title}</Text>
                    <Text style={[styles.nextUpTaskMeta, { color: theme.colors.textMuted }]} numberOfLines={1}>
                      {formatCardDate(card)} · {card.assignee || t('family')}
                    </Text>
                  </View>
                  <ArrowRight color={theme.colors.textMuted} size={16} />
                </PressScale>
              ))
            )}
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{t('this_week')}</Text>
            <Text style={[styles.sectionSub, { color: theme.colors.textMuted }]}>{openCount} active</Text>
          </View>

          {cards.length === 0 && !loading ? (
            <GlassCard style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{t('no_items')}</Text>
            </GlassCard>
          ) : (
            cards.slice(0, 4).map((c) => (
              <SmartCard key={c.card_id} card={c} onComplete={() => toggle(c)} onDelete={() => remove(c)} />
            ))
          )}

          <View style={styles.footerSignal}>
            <UsersRound color={theme.colors.textMuted} size={14} />
            <Text style={[styles.footerSignalText, { color: theme.colors.textMuted }]}>Household COO · {childMembers.length} kids · {rewardCount} rewards</Text>
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>
      </SafeAreaView>

      <FloatingActionBar
        onManual={openManual}
        onCamera={() => setShowCamera(true)}
        onVoice={() => setShowVoice(true)}
      />

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

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    marginTop: 8,
  },
  greet: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  name: { fontFamily: 'Inter_800ExtraBold', fontSize: 36, lineHeight: 41, letterSpacing: -0.9 },
  nameDot: { color: '#F97316' },
  avatar: { width: 50, height: 50, borderRadius: 9999, borderWidth: 1 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  searchShell: {
    minHeight: 66,
    borderRadius: 9999,
    borderWidth: 1,
    paddingLeft: 20,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 24,
    shadowOpacity: 0.10,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  searchText: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 16 },
  filterButton: { width: 52, height: 52, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  commandHero: {
    position: 'relative',
    minHeight: 372,
    borderRadius: 34,
    padding: 24,
    marginBottom: 18,
    overflow: 'hidden',
    backgroundColor: '#172024',
    shadowOpacity: 0.20,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: '#FFFFFF', borderRadius: 9999 },
  heroBadgeText: { color: '#202323', fontFamily: 'Inter_800ExtraBold', fontSize: 12, letterSpacing: 0.4 },
  heroCount: { color: 'rgba(255,255,255,0.72)', fontFamily: 'Inter_700Bold', fontSize: 13 },
  heroTitle: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 34, lineHeight: 39, letterSpacing: -0.9, marginTop: 2 },
  heroSub: { color: 'rgba(255,255,255,0.76)', fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, marginTop: 8, maxWidth: 280 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 28, maxWidth: 255, zIndex: 3 },
  scoreCircle: { width: 92, height: 92, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  scoreRing: { position: 'absolute', width: 88, height: 88, borderRadius: 9999, borderWidth: 7, borderColor: 'rgba(255,255,255,0.16)' },
  scoreArc: { position: 'absolute', width: 88, height: 88, borderRadius: 9999, borderTopWidth: 7, borderRightWidth: 7, borderTopColor: '#F97316', borderRightColor: '#F97316', borderLeftColor: 'transparent', borderBottomColor: 'transparent', transform: [{ rotate: '32deg' }] },
  scoreTotal: { color: 'rgba(255,255,255,0.68)', fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: -2 },
  scoreValue: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 28, letterSpacing: -0.7, lineHeight: 32 },
  scoreTitle: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  scoreSub: { color: 'rgba(255,255,255,0.68)', fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 18, marginTop: 4 },
  heroAction: { marginTop: 26, minHeight: 60, borderRadius: 9999, paddingLeft: 22, paddingRight: 7, backgroundColor: 'rgba(255,255,255,0.13)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', flexDirection: 'row', alignItems: 'center', zIndex: 4 },
  heroActionText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 16, flex: 1, textAlign: 'center' },
  heroArrow: { width: 48, height: 48, borderRadius: 9999, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  heroIllustration: { position: 'absolute', right: -8, bottom: 74, width: 160, height: 168, zIndex: 1 },
  heroHalo: { position: 'absolute', right: 8, bottom: 20, width: 126, height: 126, borderRadius: 9999, backgroundColor: 'rgba(148,163,184,0.13)' },
  heartOne: { position: 'absolute', top: 16, right: 42, width: 17, height: 17, borderRadius: 6, backgroundColor: '#A7F3D0', transform: [{ rotate: '45deg' }] },
  heartTwo: { position: 'absolute', top: 42, right: 74, width: 14, height: 14, borderRadius: 5, backgroundColor: '#8EE6C5', transform: [{ rotate: '45deg' }] },
  treeTrunk: { position: 'absolute', right: 12, bottom: 29, width: 8, height: 54, borderRadius: 4, backgroundColor: '#3F3A2E' },
  treeTop: { position: 'absolute', right: -2, bottom: 69, width: 62, height: 76, borderRadius: 30, backgroundColor: '#86B73E' },
  houseBody: { position: 'absolute', right: 54, bottom: 24, width: 74, height: 78, borderRadius: 14, backgroundColor: '#FFF0D7' },
  houseRoof: { position: 'absolute', right: 54, bottom: 91, width: 74, height: 42, borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: '#FFE3B8' },
  houseDoor: { position: 'absolute', right: 84, bottom: 24, width: 22, height: 38, borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: '#D9A875' },
  bushOne: { position: 'absolute', right: 124, bottom: 20, width: 36, height: 30, borderRadius: 18, backgroundColor: '#8BBE4E' },
  bushTwo: { position: 'absolute', right: 30, bottom: 20, width: 44, height: 30, borderRadius: 20, backgroundColor: '#79A93E' },
  statGrid: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: { flex: 1, minHeight: 118, borderRadius: 24, borderWidth: 1, padding: 12, justifyContent: 'space-between', shadowOpacity: 0.08, shadowRadius: 13, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, lineHeight: 25, letterSpacing: -0.5, marginTop: 10 },
  statLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10.5, lineHeight: 14, flexShrink: 1 },
  section: { marginBottom: 13, marginTop: 4, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 23, letterSpacing: -0.4 },
  sectionSub: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  actionTile: { flex: 1, minHeight: 74, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 8 },
  actionText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  remindersCard: { marginBottom: 20 },
  remindersHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  remindersTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, letterSpacing: 0.6, textTransform: 'uppercase' },
  remindersRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  remindersItem: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, marginRight: 12 },
  remindersWhen: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  emptyPriority: { paddingVertical: 28, alignItems: 'center', gap: 8, marginBottom: 18 },
  empty: { paddingVertical: 36, alignItems: 'center' },
  emptyTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 21, textAlign: 'center' },
  emptySub: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 270 },
  priorityCard: { minHeight: 82, borderRadius: 26, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 13, padding: 14, marginBottom: 10, shadowOpacity: 0.08, shadowRadius: 13, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  priorityIcon: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  priorityTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 16, lineHeight: 21 },
  priorityMeta: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 2 },
  nextRow: { minHeight: 56, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  nextDot: { width: 11, height: 11, borderRadius: 9999 },
  nextTitle: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15 },
  nextTime: { fontFamily: 'Inter_700Bold', fontSize: 12 },
  nextUpPanel: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    marginTop: 18,
    marginBottom: 8,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  nextUpHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  nextUpEyebrow: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  nextUpHeading: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: -0.3,
  },
  nextUpCountBadge: {
    minWidth: 38,
    height: 38,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  nextUpCountText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 16,
  },
  nextUpStats: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  nextUpStat: {
    flex: 1,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  nextUpStatNumber: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 20,
    lineHeight: 24,
  },
  nextUpStatLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 10,
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nextUpTask: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    paddingTop: 11,
    paddingBottom: 2,
    marginTop: 8,
  },
  nextUpTaskIcon: {
    width: 34,
    height: 34,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextUpTaskTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 14,
    lineHeight: 19,
  },
  nextUpTaskMeta: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 1,
  },
  nextUpEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
  },

  footerSignal: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 22 },
  footerSignalText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, textAlign: 'center' },
});
