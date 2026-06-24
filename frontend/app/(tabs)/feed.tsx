import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Camera,
  CheckCircle2,
  ChevronRight,
  Megaphone,
  MessageSquare,
  Mic,
  Plus,
  Star,
  Trash2,
  Zap,
} from 'lucide-react-native';

import { useBreakpoint } from '../../src/responsive';
import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import { AddCardModal } from '../../src/components/AddCardModal';
import { VoiceCaptureModal } from '../../src/components/VoiceCaptureModal';
import { CameraCaptureModal } from '../../src/components/CameraCaptureModal';
import { TabScreen } from '../../src/components/TabScreen';
import { useStore } from '../../src/store';
import { usePremiumGate, LockBadge } from '../../src/components/PremiumGate';
import { useUI, UIColors } from '../../src/components/Kit';
import { api, Announcement, Card, CardType, FamilyMember, HandoffNote, Template, WeeklyReport } from '../../src/api';
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

function statusCopy(type: CardType, ui: UIColors) {
  if (type === 'SIGN_SLIP') return { label: 'SIGN', bg: ui.orangeSoft, fg: ui.orange };
  if (type === 'RSVP') return { label: 'RSVP', bg: ui.lavender, fg: ui.lavenderText };
  return { label: 'TASK', bg: ui.mint, fg: ui.mintText };
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

function TaskRow({ card, onComplete, styles }: { card: Card; onComplete: () => void; styles: ReturnType<typeof createStyles> }) {
  const ui = useUI();
  const status = statusCopy(card.type, ui);
  return (
    <PressScale style={styles.taskRow} onPress={onComplete} testID={`feed-card-${card.card_id}`}>
      <View style={styles.checkRing}>{card.status === 'DONE' ? <CheckCircle2 size={18} color={ui.orange} /> : null}</View>
      <View style={styles.taskBody}>
        <Text style={styles.taskTitle} numberOfLines={1}>{card.title}</Text>
        <Text style={styles.taskMeta} numberOfLines={1}>{cardMeta(card)}</Text>
      </View>
      <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
        <Text style={[styles.statusPillText, { color: status.fg }]}>{status.label}</Text>
      </View>
      <ChevronRight color={ui.text} size={18} />
    </PressScale>
  );
}

export default function Feed() {
  const { user } = useStore();
  const { isLocked, promptUpgrade } = usePremiumGate();
  const reportLocked = isLocked('weekly_report');
  const { px, maxW } = useBreakpoint();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
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

  const load = useCallback(async () => {
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
        loadedCards = cardsResult.value;
        setCards(loadedCards);
      } else {
        logger.warn('feed cards load failed', cardsResult.reason);
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
      Alert.alert('Error', 'Could not save note.');
    } finally {
      setSavingNote(false);
    }
  }, [noteText]);

  const removeNote = useCallback(async (noteId: string) => {
    setNotes((prev) => prev.filter((n) => n.note_id !== noteId));
    try {
      await api.deleteHandoffNote(noteId);
    } catch {
      load();
    }
  }, [load]);

  const runTemplate = useCallback(async (tpl: Template) => {
    try {
      await api.generateFromTemplate(tpl.template_id);
      load();
    } catch {
      Alert.alert('Error', 'Could not generate card from template.');
    }
  }, [load]);

  const enabledTemplates = useMemo(() => templates.filter((t) => t.enabled), [templates]);

  const addAnnouncement = useCallback(async () => {
    if (!annText.trim()) return;
    setSavingAnn(true);
    try {
      const created = await api.createAnnouncement({ text: annText.trim() });
      setAnnouncements((prev) => [created, ...prev]);
      setAnnText('');
    } catch {
      Alert.alert('Error', 'Could not post announcement.');
    } finally {
      setSavingAnn(false);
    }
  }, [annText]);

  const removeAnnouncement = useCallback(async (id: string) => {
    setAnnouncements((prev) => prev.filter((a) => a.announcement_id !== id));
    try { await api.deleteAnnouncement(id); } catch { load(); }
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
              <View style={styles.bellWrap}>
                <Bell color={ui.text} size={25} />
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
                <View style={styles.plusSoft}><Plus color={ui.orange} size={26} /></View>
                <Text style={styles.capturePlaceholder} numberOfLines={1}>Add a task, note or reminder...</Text>
              </PressScale>
              <View style={styles.captureActions}>
                <PressScale onPress={() => setShowCamera(true)} style={styles.actionPill}>
                  <View style={[styles.actionDot, { backgroundColor: ui.lavender }]}>
                    <Camera color={ui.lavenderText} size={18} />
                  </View>
                  <Text style={styles.actionPillText}>Photo</Text>
                </PressScale>
                <PressScale onPress={() => setShowVoice(true)} style={styles.actionPill}>
                  <View style={[styles.actionDot, { backgroundColor: ui.mint }]}>
                    <Mic color={ui.mintText} size={18} />
                  </View>
                  <Text style={styles.actionPillText}>Voice</Text>
                </PressScale>
                <PressScale onPress={openManual} style={[styles.actionPill, styles.actionPillAccent]}>
                  <View style={[styles.actionDot, { backgroundColor: 'rgba(255,255,255,0.24)' }]}>
                    <Plus color="#FFFFFF" size={18} />
                  </View>
                  <Text style={styles.actionPillAccentText}>Add</Text>
                </PressScale>
              </View>
            </View>

            {/* Quick templates */}
            {enabledTemplates.length > 0 ? (
              <View style={styles.templateRow}>
                {enabledTemplates.slice(0, 4).map((tpl) => (
                  <PressScale key={tpl.template_id} onPress={() => runTemplate(tpl)} style={styles.templateChip}>
                    <Zap color={ui.orange} size={14} />
                    <Text style={styles.templateChipText} numberOfLines={1}>{tpl.title}</Text>
                  </PressScale>
                ))}
              </View>
            ) : null}

            <View style={styles.statsStrip}>
              <View style={styles.statCell}>
                <Text style={styles.statNumber}>{dashboard.todayCards.length}</Text>
                <Text style={styles.statLabel}>Due today</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Text style={[styles.statNumber, { color: ui.orange }]}>{dashboard.signSlips.length}</Text>
                <Text style={styles.statLabel}>Sign slips</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statCell}>
                <Text style={styles.statNumber}>{dashboard.weekCards.length}</Text>
                <Text style={styles.statLabel}>This week</Text>
              </View>
            </View>

            {/* Handoff notes */}
            <PressScale onPress={() => setExpandNotes((v) => !v)} style={styles.notesHeader}>
              <MessageSquare color={ui.lavenderText} size={18} />
              <Text style={styles.notesHeaderText}>Handoff Notes</Text>
              <Text style={styles.notesBadge}>{notes.length}</Text>
              <ChevronRight color={ui.muted} size={16} style={expandNotes ? { transform: [{ rotate: '90deg' }] } : undefined} />
            </PressScale>
            {expandNotes ? (
              <View style={styles.notesCard}>
                <View style={styles.noteInputRow}>
                  <TextInput
                    value={noteText}
                    onChangeText={setNoteText}
                    placeholder="Leave a note for your co-parent..."
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
                {notes.length === 0 ? <Text style={styles.noteEmpty}>No handoff notes yet. Leave one for your co-parent.</Text> : null}
              </View>
            ) : null}

            <PressScale style={styles.alertBanner} onPress={() => setActiveTab('today')}>
              <View style={styles.alertIcon}><Star color="#FFFFFF" fill="#FFFFFF" size={19} /></View>
              <Text style={styles.alertText} numberOfLines={2}>{alertText}</Text>
              <ChevronRight color={ui.text} size={22} />
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
                <ActivityIndicator color={ui.orange} style={{ paddingVertical: 32 }} />
              ) : visibleCards.length === 0 ? (
                <View style={styles.emptyBox}>
                  <CheckCircle2 color={ui.mintText} size={22} />
                  <Text style={styles.emptyTitle}>{activeTab === 'today' ? 'Nothing urgent today.' : 'Nothing to show here.'}</Text>
                  <Text style={styles.emptySub}>Use Add, Photo, or Voice to capture the next household item.</Text>
                </View>
              ) : (
                visibleCards.map((card, index) => (
                  <View key={card.card_id}>
                    <TaskRow card={card} onComplete={() => toggle(card)} styles={styles} />
                    {index < visibleCards.length - 1 ? <View style={styles.rowDivider} /> : null}
                  </View>
                ))
              )}
            </View>

            {/* Announcements */}
            <View style={styles.sectionHeader}>
              <Megaphone color={ui.orange} size={18} />
              <Text style={styles.sectionHeaderText}>Family Board</Text>
            </View>
            <View style={styles.notesCard}>
              <View style={styles.noteInputRow}>
                <TextInput
                  value={annText}
                  onChangeText={setAnnText}
                  placeholder="Post an announcement..."
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
                      <View style={styles.urgentBadge}><AlertTriangle color="#DC2626" size={12} /><Text style={styles.urgentText}>URGENT</Text></View>
                    ) : null}
                    <Text style={styles.noteText}>{ann.text}</Text>
                    <Text style={styles.noteMeta}>{ann.author_name} · {new Date(ann.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
                  </View>
                  <PressScale onPress={() => removeAnnouncement(ann.announcement_id)} style={{ padding: 4 }}>
                    <Trash2 color={ui.muted} size={15} />
                  </PressScale>
                </View>
              ))}
              {announcements.length === 0 ? <Text style={styles.noteEmpty}>No announcements. Post dinner plans, schedule changes, or reminders.</Text> : null}
            </View>

            {/* Weekly Report Card */}
            <PressScale
              onPress={() => (reportLocked ? promptUpgrade('weekly_report') : setExpandReport((v) => !v))}
              style={styles.sectionHeader}
            >
              <BarChart3 color={ui.mintText} size={18} />
              <Text style={styles.sectionHeaderText}>Weekly Report</Text>
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
                    <Text style={styles.reportLabel}>Done</Text>
                  </View>
                  <View style={styles.reportCell}>
                    <Text style={styles.reportNum}>{report.tasks_created}</Text>
                    <Text style={styles.reportLabel}>Created</Text>
                  </View>
                  <View style={styles.reportCell}>
                    <Text style={[styles.reportNum, report.tasks_overdue > 0 && { color: '#DC2626' }]}>{report.tasks_overdue}</Text>
                    <Text style={styles.reportLabel}>Overdue</Text>
                  </View>
                  <View style={styles.reportCell}>
                    <Text style={[styles.reportNum, { color: ui.orange }]}>{report.stars_earned}</Text>
                    <Text style={styles.reportLabel}>Stars</Text>
                  </View>
                </View>
                {report.total_spent > 0 ? (
                  <View style={styles.reportSpent}>
                    <Text style={styles.reportSpentText}>${report.total_spent.toFixed(2)} spent this week</Text>
                  </View>
                ) : null}
                {report.upcoming_deadlines.length > 0 ? (
                  <View style={styles.reportUpcoming}>
                    <Text style={styles.reportUpLabel}>Upcoming</Text>
                    {report.upcoming_deadlines.slice(0, 3).map((d, i) => (
                      <Text key={i} style={styles.reportUpItem}>• {d.title}{d.assignee ? ` (${d.assignee})` : ''}</Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.footerSnapshot}>
              <Text style={styles.footerSnapshotText}>{members.filter((m) => m.role?.toLowerCase() === 'child').length} kids · {rewardCount} rewards · {vaultCount} vault docs</Text>
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
    </SwipeableTabView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
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
