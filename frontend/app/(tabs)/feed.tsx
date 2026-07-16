import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  Megaphone,
  MessageSquare,
  Mic,
  Plus,
  Star,
  Trash2,
  User,
  X,
  Zap,
} from 'lucide-react-native';

import { useBreakpoint } from '../../src/responsive';
import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import { AddCardModal } from '../../src/components/AddCardModal';
import { VoiceCaptureModal } from '../../src/components/VoiceCaptureModal';
import { CameraCaptureModal } from '../../src/components/CameraCaptureModal';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import { TabScreen } from '../../src/components/TabScreen';
import { GettingStarted } from '../../src/components/GettingStarted';
import { useStore } from '../../src/store';
import { usePremiumGate, LockBadge } from '../../src/components/PremiumGate';
import { useUI, UIColors } from '../../src/components/Kit';
import { api, logEvent, Announcement, Card, CardType, FamilyMember, HandoffNote, Template, WeeklyReport } from '../../src/api';
import { syncCardReminderNotifications, syncMorningDigest, ensureAskedNotificationPermissionOnce } from '../../src/notifications';
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

type TFunc = (key: string) => string;

function formatDayLine(date: string | null | undefined, t: TFunc) {
  if (!date) return t('feed_no_deadline');
  const due = new Date(date);
  if (Number.isNaN(due.getTime())) return t('feed_no_deadline');
  const today = new Date();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const time = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameLocalDay(due, today)) return `${t('feed_today')} · ${time}`;
  if (sameLocalDay(due, tomorrow)) return `${t('feed_tomorrow')} · ${time}`;
  return `${due.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

function feedDateLine() {
  return new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function statusCopy(type: CardType, ui: UIColors, t: TFunc) {
  if (type === 'SIGN_SLIP') return { label: t('feed_status_sign'), bg: ui.orangeSoft, fg: ui.orange };
  if (type === 'RSVP') return { label: t('feed_status_rsvp'), bg: ui.lavender, fg: ui.lavenderText };
  return { label: t('feed_status_task'), bg: ui.mint, fg: ui.mintText };
}

function cardMeta(card: Card, t: TFunc) {
  const parts = [card.assignee, card.description, formatDayLine(card.due_date, t)].filter(Boolean);
  return parts.join(' · ');
}

function greetingFallback(name: string, t: TFunc) {
  const hour = new Date().getHours();
  const prefix = hour < 12 ? t('feed_good_morning') : hour < 18 ? t('feed_good_afternoon') : t('feed_good_evening');
  return `${prefix},${name ? `\n${name}` : ''}`;
}

function TaskRow({ card, onOpen, onComplete, styles }: { card: Card; onOpen: () => void; onComplete: () => void; styles: ReturnType<typeof createStyles> }) {
  const ui = useUI();
  const { t } = useStore();
  const status = statusCopy(card.type, ui, t);
  return (
    <PressScale style={styles.taskRow} onPress={onOpen} testID={`feed-card-${card.card_id}`}>
      <PressScale
        onPress={onComplete}
        style={styles.checkRing}
        accessibilityLabel={card.status === 'DONE' ? t('feed_mark_not_done') : t('feed_mark_done')}
        accessibilityRole="button"
        testID={`feed-card-complete-${card.card_id}`}
      >
        {card.status === 'DONE' ? <CheckCircle2 size={18} color={ui.orange} /> : null}
      </PressScale>
      <View style={styles.taskBody}>
        <Text style={styles.taskTitle} numberOfLines={1}>{card.title}</Text>
        <Text style={styles.taskMeta} numberOfLines={1}>{cardMeta(card, t)}</Text>
      </View>
      <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
        <Text style={[styles.statusPillText, { color: status.fg }]}>{status.label}</Text>
      </View>
      <ChevronRight color={ui.text} size={18} />
    </PressScale>
  );
}

export default function Feed() {
  const { user, t } = useStore();
  const { isLocked, promptUpgrade } = usePremiumGate();
  const reportLocked = isLocked('weekly_report');
  const { px, maxW } = useBreakpoint();
  const ui = useUI();
  const router = useRouter();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const [cards, setCards] = useState<Card[]>([]);
  // Card ids the user just completed/dismissed. A refetch that raced the write
  // can return them still OPEN; we hide those until the server confirms, so a
  // dismissed card never reappears.
  const pendingDismissRef = useRef<Set<string>>(new Set());
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
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
  const [notes, setNotes] = useState<HandoffNote[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [expandNotes, setExpandNotes] = useState(true);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annText, setAnnText] = useState('');
  const [savingAnn, setSavingAnn] = useState(false);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [expandReport, setExpandReport] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [runningTemplate, setRunningTemplate] = useState<string | null>(null);
  // Calendar events whose day has fully passed. Tasks stay (overdue = still to
  // do), but a past event is history — we prompt before clearing, never silently.
  const [pastPromptDismissed, setPastPromptDismissed] = useState(false);

  const load = useCallback(async () => {
    logEvent('feed_open');
    ensureAskedNotificationPermissionOnce().catch(() => undefined);
    try {
      const [cardsResult, membersResult, rewardsResult, vaultResult, notesResult, templatesResult, annResult] = await Promise.allSettled([
        api.listCards(),
        api.familyMembers(),
        api.listRewards(),
        api.listVault(),
        api.listHandoffNotes(),
        api.listTemplates(),
        api.listAnnouncements(),
      ]);

      let loadedCards: Card[] = [];
      if (cardsResult.status === 'fulfilled') {
        // Drop cards the user just dismissed that the server still reports as
        // OPEN (a stale/raced snapshot); clear ones the server confirms DONE.
        const pending = pendingDismissRef.current;
        loadedCards = cardsResult.value.filter((c) => {
          if (!pending.has(c.card_id)) return true;
          if (c.status !== 'OPEN') {
            pending.delete(c.card_id);
            return true;
          }
          return false;
        });
        setCards(loadedCards);
        setLoadError(false);
      } else {
        // Distinguish a real load failure (offline / backend down) from a
        // genuinely empty account so we don't show an empty feed as if the
        // user's data vanished.
        logger.warn('feed cards load failed', cardsResult.reason);
        setLoadError(true);
      }

      if (membersResult.status === 'fulfilled') setMembers(membersResult.value);
      if (rewardsResult.status === 'fulfilled') setRewardCount(rewardsResult.value.length);
      if (vaultResult.status === 'fulfilled') setVaultCount(vaultResult.value.length);
      if (notesResult.status === 'fulfilled') setNotes(notesResult.value);
      if (templatesResult.status === 'fulfilled') setTemplates(templatesResult.value);
      if (annResult.status === 'fulfilled') setAnnouncements(annResult.value);

      if (!reportLocked) api.weeklyReport().then(setReport).catch(() => undefined);

      if (cardsResult.status === 'fulfilled') {
        api
          .getNotificationSettings()
          .then((prefs) => {
            syncCardReminderNotifications(prefs.card_reminders ? loadedCards : [], prefs.card_reminders).catch(() => undefined);
            // Morning digest: 07:30 local tomorrow, listing what is due that
            // day (plus anything overdue). Recomputed on every sync; skipped
            // when there is nothing to say. Rides the card_reminders toggle.
            const startTomorrow = new Date();
            startTomorrow.setDate(startTomorrow.getDate() + 1);
            startTomorrow.setHours(0, 0, 0, 0);
            const endTomorrow = new Date(startTomorrow);
            endTomorrow.setDate(endTomorrow.getDate() + 1);
            const dueTomorrow = loadedCards.filter((c) => {
              if (c.status !== 'OPEN') return false;
              const time = dueTime(c);
              return time !== null && (time < endTomorrow.getTime());
            });
            let payload: { title: string; body: string } | null = null;
            if (dueTomorrow.length > 0) {
              const names = dueTomorrow.slice(0, 3).map((c) => c.title).join(' · ');
              const extra = dueTomorrow.length > 3 ? ` +${dueTomorrow.length - 3}` : '';
              payload = {
                title: t('digest_title'),
                body: `${dueTomorrow.length} ${dueTomorrow.length === 1 ? t('digest_item_one') : t('digest_item_many')}: ${names}${extra}`,
              };
            }
            const tipKeys = ['tip_scan', 'tip_note', 'tip_kids', 'tip_meal', 'tip_vault'];
            const tipKey = tipKeys[new Date().getDate() % tipKeys.length];
            const quietTip = { title: t('digest_title'), body: t(tipKey) };
            // Quiet tip is silent (low-priority channel) so it is enabled by
            // default; the content digest still respects the reminders toggle.
            syncMorningDigest(true, prefs.card_reminders ? payload : null, quietTip).catch(() => undefined);
          })
          .catch(() => undefined);
      }
    } catch (e) {
      logger.warn('feed load failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const activeCards = useMemo(() => cards.filter((card) => card.status === 'OPEN'), [cards]);

  const pastEvents = useMemo(() => {
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    return activeCards.filter((c) => {
      const isEvent = c.source === 'CALENDAR' || !!c.google_event_id;
      if (!isEvent) return false;
      const time = dueTime(c);
      return time !== null && time < startToday.getTime();
    });
  }, [activeCards]);

  const clearPastEvents = useCallback(async () => {
    const ids = pastEvents.map((c) => c.card_id);
    if (ids.length === 0) return;
    ids.forEach((id) => pendingDismissRef.current.add(id));
    setCards((prev) => prev.filter((c) => !ids.includes(c.card_id)));
    const results = await Promise.allSettled(ids.map((id) => api.updateCard(id, { status: 'DONE' })));
    if (results.some((r) => r.status === 'rejected')) {
      ids.forEach((id) => pendingDismissRef.current.delete(id));
      Alert.alert(t('feed_could_not_update'), t('feed_change_not_saved'));
      load();
    }
  }, [pastEvents, load, t]);

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
  const firstName = (user?.name || '').split(' ')[0] || '';
  const headline = greetingFallback(firstName, t);
  const alertCount = dashboard.priority.length;
  const alertText = alertCount > 0
    ? `${alertCount} ${alertCount === 1 ? t('feed_thing_needs') : t('feed_things_need')} — ${dashboard.priority[0]?.title || t('feed_review_list')}.`
    : t('feed_nothing_critical');

  const openManual = () => {
    setVoiceDraft(null);
    setAddSource('MANUAL');
    setShowAdd(true);
  };

  const toggle = async (card: Card) => {
    const next = card.status === 'DONE' ? 'OPEN' : 'DONE';
    if (next === 'DONE') {
      pendingDismissRef.current.add(card.card_id);
    } else {
      pendingDismissRef.current.delete(card.card_id);
    }
    setCards((prev) => (next === 'DONE' ? prev.filter((c) => c.card_id !== card.card_id) : prev.map((c) => (c.card_id === card.card_id ? { ...c, status: next, completed_at: null } : c))));
    try {
      await api.updateCard(card.card_id, { status: next });
    } catch {
      pendingDismissRef.current.delete(card.card_id);
      Alert.alert(t('feed_could_not_update'), t('feed_change_not_saved'));
      load();
    }
  };

  const completeSelected = () => {
    if (!selectedCard) return;
    const card = selectedCard;
    Alert.alert(
      t('feed_mark_done_q'),
      `"${card.title}" ${t('feed_move_to_history')}`,
      [
        { text: t('feed_cancel'), style: 'cancel' },
        {
          text: t('feed_done'),
          onPress: () => {
            setSelectedCard(null);
            toggle(card);
          },
        },
      ],
    );
  };

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const addNote = useCallback(async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      const created = await api.createHandoffNote({ text: noteText.trim() });
      setNotes((prev) => [created, ...prev]);
      setNoteText('');
    } catch {
      Alert.alert(t('feed_error'), t('feed_could_not_save_note'));
    } finally {
      setSavingNote(false);
    }
  }, [noteText]);

  const removeNote = useCallback(async (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.note_id !== noteId));
    try {
      await api.deleteHandoffNote(noteId);
    } catch {
      Alert.alert(t('feed_could_not_delete'), t('feed_note_restored'));
      load();
    }
  }, [load]);

  const runTemplate = useCallback(async (tpl: Template) => {
    if (runningTemplate) return;
    setRunningTemplate(tpl.template_id);
    try {
      await api.generateFromTemplate(tpl.template_id);
      load();
    } catch {
      Alert.alert(t('feed_error'), t('feed_could_not_generate'));
    } finally {
      setRunningTemplate(null);
    }
  }, [load, runningTemplate]);

  const enabledTemplates = useMemo(() => templates.filter((t) => t.enabled), [templates]);

  const addAnnouncement = useCallback(async () => {
    if (!annText.trim()) return;
    setSavingAnn(true);
    try {
      const created = await api.createAnnouncement({ text: annText.trim() });
      setAnnouncements((prev) => [created, ...prev]);
      setAnnText('');
    } catch {
      Alert.alert(t('feed_error'), t('feed_could_not_post'));
    } finally {
      setSavingAnn(false);
    }
  }, [annText]);

  const removeAnnouncement = useCallback(async (id: string) => {
    setAnnouncements((prev) => prev.filter((a) => a.announcement_id !== id));
    try {
      await api.deleteAnnouncement(id);
    } catch {
      Alert.alert(t('feed_could_not_delete'), t('feed_announcement_restored'));
      load();
    }
  }, [load]);

  return (
    <SwipeableTabView style={styles.container}>
      <TabScreen
        tab="Feed"
        refreshing={refreshing}
        onRefresh={handleRefresh}
        scrollViewProps={{ contentContainerStyle: [styles.scroll, { paddingHorizontal: px }] }}
      >
          <View style={[styles.page, { maxWidth: maxW }]}>
            <View style={styles.topMetaRow}>
              <Text style={styles.dateText}>{feedDateLine()} <Text style={styles.sun}>☀</Text></Text>
              <PressScale
                testID="feed-bell"
                onPress={() => setActiveTab('today')}
                style={styles.bellWrap}
                accessibilityLabel={t('feed_view_alerts')}
              >
                <Bell color={ui.text} size={25} />
                {alertCount > 0 ? (
                  <View style={styles.bellBadge}><Text style={styles.bellBadgeText}>{Math.min(alertCount, 9)}</Text></View>
                ) : null}
              </PressScale>
            </View>

            <View style={styles.heroRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>{headline}</Text>
                <Text style={styles.subtitle}>Household COO</Text>
              </View>
              <View style={styles.calmCard}>
                <Text style={styles.calmLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{t('feed_calm')}</Text>
                <Text style={styles.calmValue}>{dashboard.calmScore}</Text>
              </View>
            </View>

            <View style={styles.captureCard}>
              <PressScale onPress={openManual} style={styles.captureInput} testID="feed-open-add">
                <View style={styles.plusSoft}><Plus color={ui.orange} size={26} /></View>
                <Text style={styles.capturePlaceholder} numberOfLines={1}>{t('feed_add_placeholder')}</Text>
              </PressScale>
              <View style={styles.captureActions}>
                <PressScale onPress={() => setShowCamera(true)} style={styles.actionPill}>
                  <View style={[styles.actionDot, { backgroundColor: ui.lavender }]}>
                    <Camera color={ui.lavenderText} size={18} />
                  </View>
                  <Text style={styles.actionPillText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t('feed_photo')}</Text>
                </PressScale>
                <PressScale onPress={() => setShowVoice(true)} style={styles.actionPill}>
                  <View style={[styles.actionDot, { backgroundColor: ui.mint }]}>
                    <Mic color={ui.mintText} size={18} />
                  </View>
                  <Text style={styles.actionPillText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t('feed_voice')}</Text>
                </PressScale>
                <PressScale onPress={openManual} style={[styles.actionPill, styles.actionPillAccent]}>
                  <View style={[styles.actionDot, { backgroundColor: 'rgba(255,255,255,0.24)' }]}>
                    <Plus color="#FFFFFF" size={18} />
                  </View>
                  <Text style={styles.actionPillAccentText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{t('feed_add')}</Text>
                </PressScale>
              </View>
            </View>

            {/* First-run checklist for new households (self-hides once done) */}
            <GettingStarted
              hasMember={members.length > 1}
              hasCard={cards.length > 0}
              hasDoc={vaultCount > 0}
              onAddMember={() => router.navigate('/(tabs)/kids')}
              onAddCard={openManual}
              onAddDoc={() => router.navigate('/(tabs)/vault')}
            />

            {/* Quick templates */}
            {enabledTemplates.length > 0 ? (
              <View style={styles.templateRow}>
                {enabledTemplates.slice(0, 4).map((tpl) => (
                  <PressScale
                    key={tpl.template_id}
                    onPress={() => runTemplate(tpl)}
                    disabled={runningTemplate !== null}
                    style={[styles.templateChip, runningTemplate !== null && { opacity: 0.5 }]}
                  >
                    <Zap color={ui.orange} size={14} />
                    <Text style={styles.templateChipText} numberOfLines={1}>{tpl.title}</Text>
                  </PressScale>
                ))}
              </View>
            ) : null}

            <View style={styles.statsStrip}>
              <View style={styles.statCell}>
                <Text style={styles.statNumber}>{dashboard.todayCards.length}</Text>
                <Text style={styles.statLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>{t('feed_due_today')}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Text style={[styles.statNumber, { color: ui.orange }]}>{dashboard.signSlips.length}</Text>
                <Text style={styles.statLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>{t('feed_sign_slips')}</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Text style={styles.statNumber}>{dashboard.weekCards.length}</Text>
                <Text style={styles.statLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>{t('feed_this_week')}</Text>
              </View>
            </View>

            {/* Handoff notes */}
            <PressScale onPress={() => setExpandNotes((v) => !v)} style={styles.notesHeader}>
              <MessageSquare color={ui.lavenderText} size={18} />
              <Text style={styles.notesHeaderText}>{t('feed_handoff_notes')}</Text>
              <Text style={styles.notesBadge}>{notes.length}</Text>
              <ChevronRight color={ui.muted} size={16} style={expandNotes ? { transform: [{ rotate: '90deg' }] } : undefined} />
            </PressScale>
            {expandNotes ? (
              <View style={styles.notesCard}>
                <View style={styles.noteInputRow}>
                  <TextInput
                    value={noteText}
                    onChangeText={setNoteText}
                    placeholder={t('feed_note_placeholder')}
                    placeholderTextColor={ui.muted}
                    style={styles.noteInput}
                    returnKeyType="send"
                    onSubmitEditing={addNote}
                    multiline={false}
                  />
                  <PressScale onPress={addNote} disabled={savingNote || !noteText.trim()} style={[styles.noteSendBtn, (!noteText.trim() || savingNote) && { opacity: 0.4 }]}>
                    <Plus color="#FFFFFF" size={18} />
                  </PressScale>
                </View>
                {notes.slice(0, 5).map((note) => (
                  <View key={note.note_id} style={styles.noteRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.noteText}>{note.text}</Text>
                      <Text style={styles.noteMeta}>{note.author_name} · {new Date(note.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
                    </View>
                    <PressScale onPress={() => removeNote(note.note_id)} style={{ padding: 4 }}>
                      <Trash2 color={ui.muted} size={15} />
                    </PressScale>
                  </View>
                ))}
                {notes.length === 0 ? <Text style={styles.noteEmpty}>{t('feed_no_notes')}</Text> : null}
              </View>
            ) : null}

            <PressScale style={styles.alertBanner} onPress={() => setActiveTab('today')}>
              <View style={styles.alertIcon}><Star color="#FFFFFF" fill="#FFFFFF" size={19} /></View>
              <Text style={styles.alertText} numberOfLines={2}>{alertText}</Text>
              <ChevronRight color={ui.text} size={22} />
            </PressScale>

            {pastEvents.length > 0 && !pastPromptDismissed ? (
              <View style={[styles.pastBanner, { backgroundColor: ui.soft, borderColor: ui.line }]}>
                <Clock color={ui.muted} size={16} />
                <Text style={[styles.pastBannerText, { color: ui.text }]} numberOfLines={2}>
                  {pastEvents.length} {pastEvents.length === 1 ? t('feed_past_event') : t('feed_past_events')}
                </Text>
                <PressScale testID="feed-past-keep" onPress={() => setPastPromptDismissed(true)} style={styles.pastBtn}>
                  <Text style={[styles.pastBtnText, { color: ui.muted }]}>{t('feed_keep')}</Text>
                </PressScale>
                <PressScale testID="feed-past-clear" onPress={clearPastEvents} style={[styles.pastBtn, { backgroundColor: ui.orangeSoft }]}>
                  <Text style={[styles.pastBtnText, { color: ui.orange }]}>{t('feed_clear')}</Text>
                </PressScale>
              </View>
            ) : null}

            <View style={styles.tabRow}>
              {(['today', 'upcoming', 'all'] as const).map((tab) => (
                <PressScale key={tab} onPress={() => setActiveTab(tab)} style={styles.tabItem} testID={`feed-tab-${tab}`}>
                  <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab === 'today' ? t('feed_today') : tab === 'upcoming' ? t('feed_upcoming') : t('feed_all')}</Text>
                  {activeTab === tab ? <View style={styles.tabUnderline} /> : null}
                </PressScale>
              ))}
            </View>

            <View style={styles.listCard}>
              {loading ? (
                <ActivityIndicator color={ui.orange} style={{ paddingVertical: 32 }} />
              ) : loadError && visibleCards.length === 0 ? (
                <PressScale onPress={handleRefresh} style={styles.emptyBox}>
                  <AlertTriangle color={ui.orange} size={22} />
                  <Text style={styles.emptyTitle}>{t('feed_load_failed_title')}</Text>
                  <Text style={styles.emptySub}>{t('feed_load_failed_sub')}</Text>
                </PressScale>
              ) : visibleCards.length === 0 ? (
                <View style={styles.emptyBox}>
                  <CheckCircle2 color={ui.mintText} size={22} />
                  <Text style={styles.emptyTitle}>{activeTab === 'today' ? t('feed_nothing_urgent') : t('feed_nothing_to_show')}</Text>
                  <Text style={styles.emptySub}>{t('feed_empty_hint')}</Text>
                  <PressScale
                    testID="feed-empty-scan"
                    onPress={() => setShowCamera(true)}
                    style={[styles.emptyScanBtn, { backgroundColor: ui.orangeSoft, borderColor: ui.orange + '40' }]}
                  >
                    <Camera color={ui.orange} size={15} />
                    <Text style={[styles.emptyScanText, { color: ui.orange }]}>{t('feed_try_scan')}</Text>
                  </PressScale>
                </View>
              ) : (
                visibleCards.map((card, index) => (
                  <View key={card.card_id}>
                    <TaskRow card={card} onOpen={() => setSelectedCard(card)} onComplete={() => toggle(card)} styles={styles} />
                    {index < visibleCards.length - 1 ? <View style={styles.rowDivider} /> : null}
                  </View>
                ))
              )}
            </View>

            {/* Announcements */}
            <View style={styles.sectionHeader}>
              <Megaphone color={ui.orange} size={18} />
              <Text style={styles.sectionHeaderText}>{t('feed_family_board')}</Text>
            </View>
            <View style={styles.notesCard}>
              <View style={styles.noteInputRow}>
                <TextInput
                  value={annText}
                  onChangeText={setAnnText}
                  placeholder={t('feed_announcement_placeholder')}
                  placeholderTextColor={ui.muted}
                  style={styles.noteInput}
                  returnKeyType="send"
                  onSubmitEditing={addAnnouncement}
                />
                <PressScale onPress={addAnnouncement} disabled={savingAnn || !annText.trim()} style={[styles.noteSendBtn, (!annText.trim() || savingAnn) && { opacity: 0.4 }]}>
                  <Plus color="#FFFFFF" size={18} />
                </PressScale>
              </View>
              {announcements.slice(0, 5).map((ann) => (
                <View key={ann.announcement_id} style={styles.noteRow}>
                  <View style={{ flex: 1 }}>
                    {ann.priority === 'urgent' ? (
                      <View style={styles.urgentBadge}><AlertTriangle color="#DC2626" size={12} /><Text style={styles.urgentText}>{t('feed_urgent')}</Text></View>
                    ) : null}
                    <Text style={styles.noteText}>{ann.text}</Text>
                    <Text style={styles.noteMeta}>{ann.author_name} · {new Date(ann.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
                  </View>
                  <PressScale onPress={() => removeAnnouncement(ann.announcement_id)} style={{ padding: 4 }}>
                    <Trash2 color={ui.muted} size={15} />
                  </PressScale>
                </View>
              ))}
              {announcements.length === 0 ? <Text style={styles.noteEmpty}>{t('feed_no_announcements')}</Text> : null}
            </View>

            {/* Weekly Report Card */}
            <PressScale
              onPress={() => (reportLocked ? promptUpgrade('weekly_report') : setExpandReport((v) => !v))}
              style={styles.sectionHeader}
            >
              <BarChart3 color={ui.mintText} size={18} />
              <Text style={styles.sectionHeaderText}>{t('feed_weekly_report')}</Text>
              {reportLocked ? (
                <LockBadge onPress={() => promptUpgrade('weekly_report')} />
              ) : (
                <ChevronRight color={ui.muted} size={16} style={expandReport ? { transform: [{ rotate: '90deg' }] } : undefined} />
              )}
            </PressScale>
            {!reportLocked && expandReport && report ? (
              <View style={styles.reportCard}>
                <View style={styles.reportGrid}>
                  <View style={styles.reportCell}>
                    <Text style={styles.reportNum}>{report.tasks_completed}</Text>
                    <Text style={styles.reportLabel}>{t('feed_report_done')}</Text>
                  </View>
                  <View style={styles.reportCell}>
                    <Text style={styles.reportNum}>{report.tasks_created}</Text>
                    <Text style={styles.reportLabel}>{t('feed_report_created')}</Text>
                  </View>
                  <View style={styles.reportCell}>
                    <Text style={[styles.reportNum, report.tasks_overdue > 0 && { color: '#DC2626' }]}>{report.tasks_overdue}</Text>
                    <Text style={styles.reportLabel}>{t('feed_report_overdue')}</Text>
                  </View>
                  <View style={styles.reportCell}>
                    <Text style={[styles.reportNum, { color: ui.orange }]}>{report.stars_earned}</Text>
                    <Text style={styles.reportLabel}>{t('feed_report_stars')}</Text>
                  </View>
                </View>
                {report.total_spent > 0 ? (
                  <View style={styles.reportSpent}>
                    <Text style={styles.reportSpentText}>${report.total_spent.toFixed(2)} {t('feed_spent_this_week')}</Text>
                  </View>
                ) : null}
                {report.upcoming_deadlines.length > 0 ? (
                  <View style={styles.reportUpcoming}>
                    <Text style={styles.reportUpLabel}>{t('feed_upcoming')}</Text>
                    {report.upcoming_deadlines.slice(0, 3).map((d, i) => (
                      <Text key={i} style={styles.reportUpItem}>• {d.title}{d.assignee ? ` (${d.assignee})` : ''}</Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.footerSnapshot}>
              <Text style={styles.footerSnapshotText}>{members.filter((m) => m.role?.toLowerCase() === 'child').length} {t('feed_kids')} · {rewardCount} {t('feed_rewards')} · {vaultCount} {t('feed_vault_docs')}</Text>
            </View>
          </View>
          <View style={{ height: 160 }} />
      </TabScreen>

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
          logEvent('scan_used');
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
        onCreated={() => { logEvent('card_created'); load(); }}
        initialSource={addSource}
        initialDraft={voiceDraft}
      />

      <KeyboardAwareBottomSheet visible={!!selectedCard} onClose={() => setSelectedCard(null)} contentStyle={styles.detailSheet}>
        {selectedCard ? (
          <>
            <View style={styles.detailHeader}>
              <Text style={styles.detailTitle}>{selectedCard.title}</Text>
              <PressScale onPress={() => setSelectedCard(null)} style={styles.closeBtn} testID="feed-detail-close">
                <X color={ui.text} size={20} />
              </PressScale>
            </View>
            <View style={styles.detailMetaRow}>
              <Clock color={ui.muted} size={17} />
              <Text style={styles.detailMetaText}>{cardMeta(selectedCard, t)}</Text>
            </View>
            <View style={styles.detailMetaRow}>
              <User color={ui.muted} size={17} />
              <Text style={styles.detailMetaText}>{selectedCard.assignee || t('feed_unassigned')}</Text>
            </View>
            <View style={styles.detailBody}>
              <Text style={[styles.detailDescription, !selectedCard.description && { color: ui.muted }]}>
                {selectedCard.description || t('feed_no_details')}
              </Text>
            </View>
            <PressScale testID="feed-complete-card" onPress={completeSelected} style={styles.completeBtn}>
              <CheckCircle2 color="#FFFFFF" size={18} />
              <Text style={styles.completeBtnText}>{t('feed_mark_done')}</Text>
            </PressScale>
          </>
        ) : null}
      </KeyboardAwareBottomSheet>
    </SwipeableTabView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  pastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  pastBannerText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 12.5, lineHeight: 17 },
  pastBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9999 },
  pastBtnText: { fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  emptyScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 9999,
    borderWidth: 1,
  },
  emptyScanText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  detailSheet: { backgroundColor: ui.card, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, borderColor: ui.line, padding: 24, paddingBottom: 110 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  detailTitle: { flex: 1, color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  closeBtn: { width: 42, height: 42, borderRadius: 9999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center' },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  detailMetaText: { flex: 1, color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 21 },
  detailBody: { marginTop: 16, gap: 10 },
  detailDescription: { color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 24 },
  completeBtn: { marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 54, borderRadius: 99, backgroundColor: ui.orange },
  completeBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 16 },
  container: {
    flex: 1,
    backgroundColor: ui.bg,
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
    color: ui.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    letterSpacing: 0.1,
  },
  sun: {
    color: ui.orange,
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
    backgroundColor: ui.orange,
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
    color: ui.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 36,
    lineHeight: 41,
    letterSpacing: -1.15,
  },
  subtitle: {
    marginTop: 8,
    color: ui.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    letterSpacing: 0.2,
  },
  calmCard: {
    width: 78,
    height: 92,
    borderRadius: 24,
    backgroundColor: ui.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ui.line,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  calmLabel: {
    color: ui.mintText,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  calmValue: {
    marginTop: 4,
    color: ui.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 26,
    lineHeight: 30,
  },
  captureCard: {
    borderRadius: 26,
    backgroundColor: ui.card,
    borderWidth: 1,
    borderColor: ui.line,
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
    backgroundColor: ui.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capturePlaceholder: {
    flex: 1,
    color: ui.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  captureActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionPill: {
    flexShrink: 1,
    minWidth: 0,
    flex: 1,
    height: 46,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: ui.line,
    backgroundColor: ui.soft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionPillAccent: {
    borderWidth: 0,
    backgroundColor: ui.orange,
  },
  actionDot: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPillText: {
    color: ui.text,
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
    backgroundColor: ui.card,
    borderWidth: 1,
    borderColor: ui.line,
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
    minWidth: 0,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statNumber: {
    color: ui.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 25,
    lineHeight: 29,
  },
  statLabel: {
    color: ui.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    marginTop: 3,
  },
  statDivider: {
    width: 1,
    height: 34,
    backgroundColor: ui.line,
  },
  alertBanner: {
    minHeight: 72,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#FFD5C2',
    backgroundColor: ui.orangeSoft,
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
    backgroundColor: ui.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertText: {
    flex: 1,
    color: ui.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 14,
    lineHeight: 20,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 28,
    borderBottomWidth: 1,
    borderBottomColor: ui.line,
    marginBottom: 12,
  },
  tabItem: {
    paddingBottom: 10,
  },
  tabText: {
    color: ui.muted,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15,
  },
  tabTextActive: {
    color: ui.text,
  },
  tabUnderline: {
    position: 'absolute',
    bottom: -1,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 99,
    backgroundColor: ui.orange,
  },
  listCard: {
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: ui.card,
    borderWidth: 1,
    borderColor: ui.line,
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
    color: ui.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15.5,
    lineHeight: 20,
  },
  taskMeta: {
    color: ui.muted,
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
    backgroundColor: ui.line,
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
    color: ui.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 17,
    textAlign: 'center',
  },
  emptySub: {
    color: ui.muted,
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
    color: ui.muted,
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  fab: {
    position: 'absolute',
    right: 22,
    bottom: 120,
    width: 61,
    height: 61,
    borderRadius: 999,
    backgroundColor: ui.orange,
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
  templateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  templateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 99,
    backgroundColor: ui.orangeSoft,
    borderWidth: 1,
    borderColor: ui.line,
  },
  templateChipText: {
    color: ui.text,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    maxWidth: 120,
  },
  notesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    paddingVertical: 4,
  },
  notesHeaderText: {
    flex: 1,
    color: ui.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 16,
  },
  notesBadge: {
    color: ui.muted,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  notesCard: {
    borderRadius: 20,
    backgroundColor: ui.card,
    borderWidth: 1,
    borderColor: ui.line,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  noteInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  noteInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: ui.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: ui.text,
    backgroundColor: ui.soft,
  },
  noteSendBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: ui.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: ui.line,
  },
  noteText: {
    color: ui.text,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    lineHeight: 20,
  },
  noteMeta: {
    color: ui.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    marginTop: 2,
  },
  noteEmpty: {
    color: ui.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    marginBottom: 8,
    paddingVertical: 4,
  },
  sectionHeaderText: {
    flex: 1,
    color: ui.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 16,
  },
  urgentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  urgentText: {
    color: '#DC2626',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 11,
  },
  reportCard: {
    borderRadius: 20,
    backgroundColor: ui.card,
    borderWidth: 1,
    borderColor: ui.line,
    padding: 16,
    marginBottom: 14,
  },
  reportGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  reportCell: {
    flex: 1,
    alignItems: 'center',
  },
  reportNum: {
    color: ui.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 22,
    lineHeight: 26,
  },
  reportLabel: {
    color: ui.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    marginTop: 2,
  },
  reportSpent: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: ui.line,
    alignItems: 'center',
  },
  reportSpentText: {
    color: ui.orange,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  reportUpcoming: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: ui.line,
  },
  reportUpLabel: {
    color: ui.muted,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  reportUpItem: {
    color: ui.text,
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 20,
  },
});
