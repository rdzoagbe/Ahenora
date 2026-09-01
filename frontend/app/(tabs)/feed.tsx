import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  LayoutGrid,
  Search as SearchIcon,
  UserCheck,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  History,
  MapPin,
  Megaphone,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  Star,
  Trash2,
  User,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react-native';

import { useBreakpoint } from '../../src/responsive';
import { cleanText, openExternal, parseDescription } from '../../src/eventDescription';
import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import { AddCardModal } from '../../src/components/AddCardModal';
import { VoiceCaptureModal } from '../../src/components/VoiceCaptureModal';
import { CameraCaptureModal } from '../../src/components/CameraCaptureModal';
import { MoreSheet } from '../../src/components/MoreSheet';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import { TabScreen } from '../../src/components/TabScreen';
import { GettingStarted } from '../../src/components/GettingStarted';
import { UpgradeBanner } from '../../src/components/UpgradeBanner';
import { CoParentNudge } from '../../src/components/CoParentNudge';
import { NotificationsNudge } from '../../src/components/NotificationsNudge';
import { GiftingStrip } from '../../src/components/GiftingStrip';
import { StreakChip } from '../../src/components/StreakChip';
import { WindowedList } from '../../src/components/WindowedList';
import { useStore } from '../../src/store';
import { usePremiumGate, LockBadge, PremiumPreviewBanner } from '../../src/components/PremiumGate';
import { useUI, UIColors } from '../../src/components/Kit';
import { api, logEvent, ActivityEntry, Announcement, Card, CardType, CustodyConfig, FamilyMember, GiftPot, SantaDraw, HandoffNote, Template, WeeklyReport } from '../../src/api';
import { syncCardReminderNotifications, syncMorningDigest, syncDinnerReminder, syncSundayRecap, ensureAskedNotificationPermissionOnce } from '../../src/notifications';
import { logger } from '../../src/logger';
import { isoWeek, localeFor } from '../../src/utils/date';
import { recordWin } from '../../src/reviewPrompt';
import AppToast from '../../src/components/AppToast';
import { useToast } from '../../src/hooks/useToast';

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
  // Carried from the document scan so the sheet can offer the calendar.
  is_event?: boolean;
  expires_on?: string | null;
  location?: string | null;
}



function dueTime(card: Card) {
  if (!card.due_date) return null;
  const time = new Date(card.due_date).getTime();
  return Number.isNaN(time) ? null : time;
}

// Recognise a birthday (or anniversary — both suit a gift pot) from a title,
// across the app's languages and the common short forms people actually type.
// Mirrors the backend detector but a touch broader, so the Gift Pot strip picks
// up birthdays that were imported before the backend learned to type them.
const BIRTHDAY_WORDS = [
  'birthday', 'b-day', 'bday', '🎂',
  'anniversary', 'anniversaire', 'anniv',       // en / fr + short form
  'cumpleaños', 'cumpleanos', 'cumple',          // es
  'geburtstag',                                  // de
];
function looksLikeBirthday(title?: string | null): boolean {
  const t = (title || '').toLowerCase();
  return !!t && BIRTHDAY_WORDS.some((w) => t.includes(w));
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

type TFunc = (key: string, params?: Record<string, string | number>) => string;

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

function feedDateLine(now: Date | null) {
  if (!now) return '';
  return now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// The ISO week and its parity, beside the date. For a separated co-parent the
// number IS the schedule — French judgments read "semaines paires / impaires" —
// and for everyone else it is a normal, harmless piece of the week's identity
// (European calendars print it as a matter of course).
function feedWeekLine(now: Date | null, t: TFunc, custody?: CustodyConfig | null) {
  if (!now) return '';
  const { week, even } = isoWeek(now);
  let line = t('feed_week_line', { n: week, parity: even ? t('week_even') : t('week_odd') });
  // When a family runs alternating custody, the parity IS the schedule, so spell
  // out whose week it is right where the number already sits: "· with you" on
  // our weeks, "· at their dad's" (or a generic other-parent) on the rest.
  if (custody?.enabled) {
    const ours = custody.our_weeks === 'even' ? even : !even;
    const away = custody.away_label.trim()
      ? t('custody_away_named', { who: custody.away_label.trim() })
      : t('custody_away');
    line += ` · ${ours ? t('custody_with_you') : away}`;
  }
  return line;
}

// "in 25 min" / "in 3 h" countdown for the detail sheet — only when the item is
// due within the next 24h (that's when a countdown actually helps).
function relativeDue(date: string | null | undefined, t: (k: string, p?: Record<string, string | number>) => string) {
  if (!date) return null;
  const due = new Date(date).getTime();
  if (Number.isNaN(due)) return null;
  const diffMin = Math.round((due - Date.now()) / 60000);
  if (diffMin <= 0 || diffMin > 24 * 60) return null;
  if (diffMin < 60) return t('feed_in_min', { n: diffMin });
  return t('feed_in_h', { n: Math.round(diffMin / 60) });
}

// A small emoji that tracks the time of day, matching the greeting.
function timeEmoji(now: Date | null) {
  if (!now) return '';
  const h = now.getHours();
  if (h < 6) return '🌙';
  if (h < 12) return '☀️';
  if (h < 18) return '🌤️';
  if (h < 21) return '🌆';
  return '🌙';
}

function statusCopy(type: CardType, ui: UIColors, t: TFunc, imported?: boolean) {
  // Imported agenda items read as neutral gray — colored pills mean "added by
  // the family", gray means "came from a connected calendar".
  if (imported) return { label: t('feed_pill_imported'), bg: ui.soft, fg: ui.muted };
  if (type === 'SIGN_SLIP') return { label: t('feed_status_sign'), bg: ui.orangeSoft, fg: ui.orangeText };
  if (type === 'RSVP') return { label: t('feed_status_rsvp'), bg: ui.lavender, fg: ui.lavenderText };
  if (type === 'BIRTHDAY') return { label: t('type_birthday'), bg: ui.gold, fg: ui.goldText };
  if (type === 'SCHOOL') return { label: t('type_school'), bg: ui.lavender, fg: ui.lavenderText };
  if (type === 'APPOINTMENT') return { label: t('type_appointment'), bg: ui.orangeSoft, fg: ui.orangeText };
  if (type === 'VACATION') return { label: t('type_vacation'), bg: ui.mint, fg: ui.mintText };
  return { label: t('feed_status_task'), bg: ui.mint, fg: ui.mintText };
}

// A name to a one- or two-letter badge: "Roland Dzoagbe" -> "RD", "Keigh" -> "K".
// So a task shows at a glance whose plate it is on, without opening it.
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function cardMeta(card: Card, t: TFunc) {
  // Use the parsed description text (URLs/Location/People stripped) so list
  // rows never show raw links — the detail sheet renders those as chips.
  const desc = parseDescription(card.description, t).text.split('\n')[0];
  // A private card says so. Without it there is no way to tell at a glance
  // that an item is invisible to the rest of the household - which is how a
  // task can sit on one person's phone for a week while everyone assumes it
  // was passed on.
  const privacy = card.shared === false ? t('card_private') : null;
  const parts = [privacy, card.assignee, desc, formatDayLine(card.due_date, t)].filter(Boolean);
  return parts.join(' · ');
}

/**
 * The server stores what happened, not a sentence about it — so a French
 * co-parent reads a French feed and an English one reads English.
 */
function activityPhrase(entry: ActivityEntry, t: TFunc): string {
  switch (entry.kind) {
    case 'task_done': return t('act_task_done', { subject: entry.subject });
    case 'task_created': return t('act_task_created', { subject: entry.subject });
    case 'task_assigned':
      return t('act_task_assigned', { subject: entry.subject, target: entry.target || '' });
    case 'stars_awarded':
      return t('act_stars_awarded', { n: String(entry.amount ?? 0), subject: entry.subject });
    case 'member_joined': return t('act_member_joined');
    case 'list_cleared': return t('act_list_cleared', { n: String(entry.amount ?? 0) });
    case 'week_planned': return t('act_week_planned');
    case 'doc_shared': return t('act_doc_shared', { subject: entry.subject });
    case 'pot_pledge':
      return t('act_pot_pledge', { amount: String(entry.amount ?? 0), subject: entry.subject });
    case 'santa_opened': return t('act_santa_opened');
    default: return '';
  }
}

function shortWhen(iso: string, t: TFunc): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return t('when_now');
  if (mins < 60) return t('when_minutes', { n: String(mins) });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('when_hours', { n: String(hours) });
  return t('when_days', { n: String(Math.round(hours / 24)) });
}

function greetingFallback(name: string, t: TFunc, now: Date | null) {
  if (!now) return name || '';
  const hour = now.getHours();
  const prefix = hour < 12 ? t('feed_good_morning') : hour < 18 ? t('feed_good_afternoon') : t('feed_good_evening');
  return `${prefix},${name ? `\n${name}` : ''}`;
}

// "Snooze" presets: move a task to tomorrow, the weekend, or next week — all
// at 9am local, the times people mean by those words.
function atMorning(d: Date) {
  const x = new Date(d);
  x.setHours(9, 0, 0, 0);
  return x;
}
function snoozeOptions(t: TFunc): { label: string; date: Date }[] {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const saturday = new Date(now);
  saturday.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 7);
  return [
    { label: t('feed_snooze_tomorrow'), date: atMorning(tomorrow) },
    { label: t('feed_snooze_weekend'), date: atMorning(saturday) },
    { label: t('feed_snooze_next_week'), date: atMorning(nextWeek) },
  ];
}

function TaskRow({ card, onOpen, onComplete, styles }: { card: Card; onOpen: () => void; onComplete: () => void; styles: ReturnType<typeof createStyles> }) {
  const ui = useUI();
  const { t } = useStore();
  const imported = card.source === 'CALENDAR';
  const status = statusCopy(card.type, ui, t, imported);
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
        <View style={styles.taskTitleRow}>
          {imported ? <CalendarDays color={ui.muted} size={13} /> : null}
          <Text style={[styles.taskTitle, { flexShrink: 1 }]} numberOfLines={1}>{card.title}</Text>
        </View>
        <Text style={styles.taskMeta} numberOfLines={1}>{cardMeta(card, t)}</Text>
      </View>
      {card.assignee && card.assignee.trim() ? (
        <View
          style={[styles.assigneeBadge, { backgroundColor: ui.orangeSoft, borderColor: ui.orangeText }]}
          accessibilityLabel={t('card_assigned_to', { name: card.assignee.trim() })}
        >
          <Text style={[styles.assigneeBadgeText, { color: ui.orangeText }]}>
            {initials(card.assignee)}
          </Text>
        </View>
      ) : null}
      <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
        <Text style={[styles.statusPillText, { color: status.fg }]}>{status.label}</Text>
      </View>
      <ChevronRight color={ui.text} size={18} />
    </PressScale>
  );
}

const ANN_SEEN_KEY = 'coo_family_board_seen_at';
// Alerts the bell badge has already shown you, so it clears once looked at.
const SEEN_ALERTS_KEY = 'coo_seen_alert_ids';

export default function Feed() {
  const { user, t, lang, subscription, dataVersion, requestInvite } = useStore();
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [assigned, setAssigned] = useState<Card[]>([]);
  // Someone this household invited who never made it in. Only the household
  // that sent an invitation can send it again, so the prompt belongs here.
  const [stranded, setStranded] = useState<{ email: string; reason: string } | null>(null);
  // The web build is prerendered at BUILD time. Anything derived from "now" —
  // the date line, the greeting, the sun or moon — then disagrees with what
  // the browser computes, and React throws away the entire server render as a
  // hydration mismatch. So the first paint carries nothing time-dependent and
  // this fills it in immediately after.
  const [now, setNow] = useState<Date | null>(null);
  const { isLocked, promptUpgrade } = usePremiumGate();
  const reportLocked = isLocked('weekly_report');
  const { px, maxW } = useBreakpoint();
  const ui = useUI();
  const router = useRouter();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const [cards, setCards] = useState<Card[]>([]);
  // Gift pots keyed by their birthday card, so the Gift Pot strip can show a
  // pot's progress inline. Fetched alongside the feed; empty is fine.
  const [giftPotByCard, setGiftPotByCard] = useState<Record<string, GiftPot>>({});
  // Active Secret Santa draws, shown in the gifting card's second tab.
  const [santaDraws, setSantaDraws] = useState<SantaDraw[]>([]);
  // Card ids the user just completed/dismissed. A refetch that raced the write
  // can return them still OPEN; we hide those until the server confirms, so a
  // dismissed card never reappears.
  const pendingDismissRef = useRef<Set<string>>(new Set());
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  // Set when a tapped notification named the card it was about.
  const { cardId: notifiedCardId } = useLocalSearchParams<{ cardId?: string }>();
  const openedFromNotification = useRef<string | null>(null);
  const { toast, showToast } = useToast(3200);
  // The task being edited. Tasks live on the Feed now, but editing was only
  // ever wired on the Calendar — so opening one here gave no way to fix its
  // title or hand it to someone. The pencil in the detail sheet opens the same
  // add/edit sheet the Calendar uses, in edit mode.
  const [editing, setEditing] = useState<Card | null>(null);
  const [showAlerts, setShowAlerts] = useState(false);
  const [householdOpen, setHouseholdOpen] = useState(false);
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
  const [notes, setNotes] = useState<HandoffNote[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [expandNotes, setExpandNotes] = useState(true);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [annText, setAnnText] = useState('');
  const [savingAnn, setSavingAnn] = useState(false);
  // "Don't miss it": the Family Board carries an unread marker until each
  // person has actually seen it. A push already fires when one is posted; this
  // is the visible half, so a co-parent who didn't tap the notification still
  // sees the board is new. The baseline (the newest post they'd already seen)
  // is per device, loaded on focus and advanced to the newest on blur — so the
  // marker shows while they're looking and is gone next time.
  const [annSeenAt, setAnnSeenAt] = useState<number | null>(null);
  const newestAnnRef = useRef(0);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [expandReport, setExpandReport] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [runningTemplate, setRunningTemplate] = useState<string | null>(null);
  // Calendar events whose day has fully passed. Tasks stay (overdue = still to
  // do), but a past event is history — we prompt before clearing, never silently.
  const [pastPromptDismissed, setPastPromptDismissed] = useState(false);
  // The Feed leads with today's work; everything retrospective — who did what,
  // the board, notes, the weekly report — lives one tap down, collapsed by
  // default so the screen you open all day stays short.
  const [showHousehold, setShowHousehold] = useState(false);
  // The task list shows a handful and offers the rest, so the Feed's height
  // does not grow with how much there is to do.
  const [showAllTasks, setShowAllTasks] = useState(false);

  const load = useCallback(async () => {
    logEvent('feed_open');
    ensureAskedNotificationPermissionOnce().catch(() => undefined);
    try {
      const [cardsResult, membersResult, rewardsResult, vaultResult, notesResult, templatesResult, annResult, potsResult, santaResult] = await Promise.allSettled([
        api.listCards(),
        api.familyMembers(),
        api.listRewards(),
        api.listVault(),
        api.listHandoffNotes(),
        api.listTemplates(),
        api.listAnnouncements(),
        api.listGiftPots().catch(() => [] as GiftPot[]),
        api.listSantaDraws().catch(() => [] as SantaDraw[]),
      ]);
      if (potsResult.status === 'fulfilled') {
        const map: Record<string, GiftPot> = {};
        for (const p of potsResult.value) if (p.card_id) map[p.card_id] = p;
        setGiftPotByCard(map);
      }
      if (santaResult.status === 'fulfilled') setSantaDraws(santaResult.value);

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

      // Who did what, lately. Best effort: an empty strip is better than a
      // failed feed.
      api.listActivity(8).then(setActivity).catch(() => undefined);

      // What was handed to me. Same best-effort rule: this strip never gets
      // to take the feed down with it.
      api.listAssignedToMe().then(setAssigned).catch(() => undefined);
      // Best-effort: a nudge is never worth failing the Feed for.
      api.strandedInvites()
        .then((rows) => setStranded(rows?.[0] ? { email: rows[0].email, reason: rows[0].reason } : null))
        .catch(() => undefined);

      // Safe here rather than on first paint — see the `now` state above.
      setNow(new Date());

      // Only when the plan is KNOWN to allow it: isLocked() answers false
      // while the subscription is still loading (so the UI never flashes a
      // lock), which made every free household fire a guaranteed 402 on
      // each feed load.
      if (subscription && !reportLocked) {
        api.weeklyReport().then(setReport).catch(() => undefined);
      }

      if (cardsResult.status === 'fulfilled') {
        api
          .getNotificationSettings()
          .then((prefs) => {
            syncCardReminderNotifications(prefs.card_reminders ? loadedCards : [], prefs.card_reminders, t('notif_due_soon')).catch(() => undefined);
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
            // Both halves of the morning are the server's job now. It used to
            // schedule the CONTENT digest for tomorrow 07:30 from here — one
            // shot, only if somebody opened the Feed, carrying the agenda as it
            // looked at that moment. So it arrived only on days following a day
            // the app was opened, and could not know about anything added
            // afterwards. Roland had appointments and no notification; that is
            // the mechanism.
            //
            // The quiet-day TIP went with it. Left here it was scheduled for
            // 07:30 every day regardless, while the server sent the digest at
            // 07:30 too — so a busy day produced both, under the same title.
            // Only the server knows whether a day is actually quiet.
            //
            // Passing null for both keeps the local ones cancelled, which is
            // what stops two arriving.
            syncMorningDigest(false, null, null).catch(() => undefined);

            // Dinner nudge (17:30) and Sunday recap (18:00) are the server's
            // job now, for the same reason as the digest: they were one-shot
            // local notifications, only ever (re)scheduled while somebody had
            // the Feed open, carrying whatever the meal plan and the week's
            // tally looked like at that moment. Someone who did not open this
            // screen simply never got them.
            //
            // send_daily_local_pushes fires both at the right local hour from
            // current data, whether or not anything was opened. Cancelling here
            // is what stops two of each arriving — a duplicate notification is
            // how an app gets muted.
            syncDinnerReminder(false, null).catch(() => undefined);
            syncSundayRecap(false, null).catch(() => undefined);
          })
          .catch(() => undefined);
      }
    } catch (e) {
      logger.warn('feed load failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t, subscription, reportLocked]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // A capture from the global "+" bumps dataVersion; reload the feed in place
  // so the new card appears without a navigation. Guarded on the first render
  // (dataVersion === 0) to avoid a redundant load on mount.
  useEffect(() => {
    if (dataVersion) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  // Family-board unread tracking. On focus, snapshot the baseline from disk (so
  // the marker reflects what arrived since last time). On blur, advance the
  // baseline to the newest post seen — clearing the marker for next visit
  // without clearing it out from under someone who is still looking.
  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(ANN_SEEN_KEY)
        .then((v) => setAnnSeenAt(v ? Number(v) : 0))
        .catch(() => setAnnSeenAt(0));
      return () => {
        if (newestAnnRef.current > 0) {
          AsyncStorage.setItem(ANN_SEEN_KEY, String(newestAnnRef.current)).catch(() => undefined);
        }
      };
    }, [])
  );

  // Keep the newest-post timestamp current for the blur handler, and on the
  // very first run ever (no baseline yet) treat everything already there as
  // seen — a new install should not open to a board full of "unread".
  useEffect(() => {
    const newest = announcements.reduce(
      (max, a) => Math.max(max, new Date(a.created_at).getTime() || 0), 0);
    newestAnnRef.current = newest;
    if (annSeenAt === 0 && newest > 0) {
      AsyncStorage.getItem(ANN_SEEN_KEY).then((v) => {
        if (!v) { AsyncStorage.setItem(ANN_SEEN_KEY, String(newest)).catch(() => undefined); setAnnSeenAt(newest); }
      }).catch(() => undefined);
    }
  }, [announcements, annSeenAt]);

  const unreadAnnouncements = useMemo(() => {
    if (annSeenAt == null) return 0;
    return announcements.filter((a) => (new Date(a.created_at).getTime() || 0) > annSeenAt).length;
  }, [announcements, annSeenAt]);

  const activeCards = useMemo(() => cards.filter((card) => card.status === 'OPEN'), [cards]);

  // Open the card a notification was about, once the lists it could be in have
  // loaded. Searching `cards` and `assigned` rather than what is on screen: the
  // Feed shows today, and a reminder can name something due next week, which is
  // exactly the case that would otherwise open nothing.
  //
  // Guarded by the id itself, not a boolean, so a second notification for a
  // different card still opens while the first is being handled — and so the
  // sheet does not reappear after the reader dismisses it and the list reloads.
  useEffect(() => {
    if (!notifiedCardId || loading) return;
    if (openedFromNotification.current === notifiedCardId) return;
    const found = [...cards, ...assigned].find((c) => c.card_id === notifiedCardId);
    // Latch only once the card is actually in hand. `assigned` is a separate
    // fetch that settles on its own schedule, after `loading` has cleared, so
    // latching on the first run raced it: a task_assigned push — the most
    // common kind, and the one this exists for — would find nothing, mark
    // itself handled, and never open when the list arrived a moment later.
    //
    // Not finding it is not an error either. The card may have been completed
    // or deleted between the push and the tap, in which case nothing is
    // latched, the search costs one pass over two small arrays whenever they
    // change, and the reader is simply left on the Feed.
    if (!found) return;
    openedFromNotification.current = notifiedCardId;
    setSelectedCard(found);
  }, [notifiedCardId, loading, cards, assigned]);

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
    // A task someone HANDED you is something that needs your attention, so it
    // rings the bell. It did not before: the bell counted only overdue,
    // due-today and sign-slips, so a co-parent assigning you the school run for
    // next week notified nobody in-app — the push went out and then nothing.
    // Only work handed to you by someone ELSE counts (created_by != me), so
    // assigning something to yourself never rings your own bell. The unseen
    // mechanism below clears it the moment you open the bell.
    // Guarded on a known user id: until `user` resolves, user?.user_id is
    // undefined and "created_by != undefined" is true for every card, which
    // would briefly count tasks you assigned to YOURSELF and inflate the bell.
    // Empty until we can actually tell self-assigned from handed-to-you.
    const uid = user?.user_id;
    const assignedToMe = uid
      ? assigned.filter((card) => card.status === 'OPEN' && card.created_by_user_id !== uid)
      : [];
    const priority = uniqueCards([...overdue, ...signSlips, ...todayCards, ...assignedToMe])
      .sort((a, b) => (dueTime(a) || Number.MAX_SAFE_INTEGER) - (dueTime(b) || Number.MAX_SAFE_INTEGER));

    // The soonest birthday in the next fortnight — the trigger for the gift-pot
    // nudge. Birthdays are BIRTHDAY cards with a due date, so nothing new is
    // synthesised; this just finds the nearest one still ahead. It skips the
    // viewer's OWN birthday: nobody should be nudged to pool for their own gift,
    // and seeing the pot for it would spoil the surprise.
    // Whose birthday it is lives in the TITLE ("Nawelle's birthday"), never the
    // assignee — a calendar import stamps the assignee as the importer, so
    // reading it there made every imported birthday look like the viewer's own
    // and vanish from the strip. Match the viewer's name in the title only.
    const myName = (members.find((m) => m.user_id === uid)?.name || '').trim().toLowerCase();
    const firstName = myName.split(' ')[0];
    const isMyBirthday = (card: Card) => {
      if (!firstName) return false;
      return new RegExp(`\\b${firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
        .test((card.title || '').toLowerCase());
    };
    // Every birthday in a rolling ~60-day window, soonest first — the Gift Pot
    // strip. A card counts as a birthday when its type is BIRTHDAY OR its title
    // reads like one, so birthdays already imported as plain events (before the
    // importer learned to type them) still show, with no re-import. The viewer's
    // own is skipped so they aren't nudged to pool for their own gift.
    const upcomingBirthdays = activeCards
      .filter((card) => (card.type === 'BIRTHDAY' || looksLikeBirthday(card.title)) && !isMyBirthday(card))
      .map((card) => ({ card, time: dueTime(card) }))
      .filter((x) => x.time != null && x.time >= now && x.time <= now + 60 * 24 * 60 * 60 * 1000)
      .sort((a, b) => (a.time as number) - (b.time as number))
      .map((x) => x.card);

    return { overdue, todayCards, signSlips, weekCards, next24h, calmScore, priority, upcomingBirthdays };
  }, [activeCards, assigned, user?.user_id, members]);

  // The Feed is today, and only today. Upcoming and All were tabs here until
  // the Calendar tab (a better calendar) and the header Search (a better
  // finder) made them the second-best route to their own jobs, while the row
  // itself cost ~50px at the top of the most-visited screen and put a decision
  // on a home screen that should have none.
  const feedCards = useMemo(() => {
    // Undated tasks are "anytime today" — a freshly added task with no due
    // date must be visible immediately, not hidden until some other view.
    const undated = activeCards.filter((card) => dueTime(card) === null);
    // A task you handed to someone else is a live commitment you are
    // tracking, so it belongs on your own Feed too — not only findable on the
    // Calendar, which is what made an assigned task "show only in the
    // calendar" for the person who set it. (Work handed TO you is pinned
    // separately, above the list.)
    const me = (user?.name || '').trim().toLowerCase();
    const iAssigned = activeCards.filter(
      (card) => card.created_by_user_id === user?.user_id
        && (card.assignee || '').trim()
        && (card.assignee || '').trim().toLowerCase() !== me,
    );
    return uniqueCards([...dashboard.overdue, ...dashboard.todayCards, ...undated, ...iAssigned])
      .sort((a, b) => (dueTime(a) ?? Number.MAX_SAFE_INTEGER) - (dueTime(b) ?? Number.MAX_SAFE_INTEGER));
  }, [activeCards, dashboard, user]);

  const TASK_CAP = 5;
  const visibleCards = showAllTasks ? feedCards : feedCards.slice(0, TASK_CAP);
  const hiddenTaskCount = feedCards.length - visibleCards.length;
  // Hand-offs lead the list; everything else follows. Split rather than
  // duplicated, so a task with your name on it appears exactly once.
  // "Keigh gave Roland the swimming kit" is not news to Roland when the task
  // is sitting under HANDED TO YOU a few rows above. Somebody ELSE being
  // given something still is, so only the lines about me are dropped. Four
  // rows rather than five: this is a glance at what the household has been
  // up to, not a ledger.
  const myName = (user?.name || '').trim().toLowerCase();
  const householdActivity = activity
    .filter((e) => !(e.kind === 'task_assigned'
                     && (e.target || '').trim().toLowerCase() === myName))
    .slice(0, 4);
  // One line for the collapsed Household row: the newest thing that happened,
  // so the teaser hints at what is inside without opening it.
  const householdSummary = householdActivity.length > 0
    ? `${householdActivity[0].actor_name || t('feed_activity_someone')} ${activityPhrase(householdActivity[0], t)}`
    : t('feed_household_empty');
  // Work handed TO you is pinned to the Feed regardless of its date, and that
  // includes work that is not due yet.
  //
  // Two attempts have now been made to hide things from this list and both were
  // wrong. Intersecting it with the current tab's slice hid an assigned task due
  // next week, which showed nowhere but the Calendar. Hiding a recurring chore
  // until its turn came round stopped you completing one early — and a chore you
  // have actually done must be tickable whether or not the date agrees.
  //
  // So nothing is filtered by date here. Completing a recurring task does
  // surface its next occurrence straight away; the row carries its own due date,
  // which is what tells the two apart.
  const handedToMe = assigned.filter((c) => c.status === 'OPEN');
  const handedIds = new Set(handedToMe.map((c) => c.card_id));

  const restOfList = visibleCards.filter((c) => !handedIds.has(c.card_id));
  const firstName = (user?.name || '').split(' ')[0] || '';
  const headline = greetingFallback(firstName, t, now);
  const alertCount = dashboard.priority.length;
  // The bell badge counts what you have NOT looked at yet, not how much work is
  // outstanding. Counting the latter meant the badge never cleared however many
  // times you opened it — it reads as unread mail, so it has to behave that way.
  // Ids of alerts already seen are remembered on the device; the badge returns
  // only when something genuinely new shows up.
  const [seenAlertIds, setSeenAlertIds] = useState<string[]>([]);
  const unseenAlertCount = dashboard.priority.filter((c) => !seenAlertIds.includes(c.card_id)).length;

  useEffect(() => {
    AsyncStorage.getItem(SEEN_ALERTS_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setSeenAlertIds(parsed.filter((x) => typeof x === 'string'));
      })
      .catch(() => undefined);
  }, []);

  const markAlertsSeen = useCallback(() => {
    // Keep only ids still present, so this never grows without bound.
    const ids = dashboard.priority.map((c) => c.card_id);
    setSeenAlertIds(ids);
    AsyncStorage.setItem(SEEN_ALERTS_KEY, JSON.stringify(ids)).catch(() => undefined);
  }, [dashboard.priority]);

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
    // The pinned "Handed to you" section reads from `assigned` (a separate
    // fetch), not `cards`, so completing a handed task from there would leave
    // it sitting in the section with a stale count until the next reload.
    if (next === 'DONE') setAssigned((prev) => prev.filter((c) => c.card_id !== card.card_id));
    try {
      const saved = await api.updateCard(card.card_id, { status: next });
      if (next === 'DONE') recordWin();
      // A recurring chore does not stay done — the server spawns the next one
      // the moment this is ticked. From the outside that looks exactly like the
      // tick failing: the row vanishes and an identical row appears with a new
      // date. Hiding the new one was tried and was wrong; it removed the
      // ability to finish a chore ahead of its date. So it is SAID instead.
      if (next === 'DONE' && saved?.next_occurrence) {
        const when = new Date(saved.next_occurrence);
        if (!Number.isNaN(when.getTime())) {
          showToast(t('feed_recurring_next', {
            date: when.toLocaleDateString(localeFor(lang),
              { weekday: 'short', day: 'numeric', month: 'short' }),
          }), 'info');
        }
      }
    } catch {
      pendingDismissRef.current.delete(card.card_id);
      Alert.alert(t('feed_could_not_update'), t('feed_change_not_saved'));
      load();
    }
  };

  // Move a task to a new day without opening the editor — the "not today"
  // verb a home screen needs. Optimistic; rolls back on a failed save.
  const reschedule = async (card: Card, when: Date) => {
    const iso = when.toISOString();
    setSelectedCard((c) => (c && c.card_id === card.card_id ? { ...c, due_date: iso } : c));
    setCards((prev) => prev.map((c) => (c.card_id === card.card_id ? { ...c, due_date: iso } : c)));
    try {
      await api.updateCard(card.card_id, { due_date: iso });
    } catch {
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
      // My own post is not "unread" to me: advance the baseline past it.
      const at = new Date(created.created_at).getTime() || Date.now();
      setAnnSeenAt((prev) => Math.max(prev ?? 0, at));
      AsyncStorage.setItem(ANN_SEEN_KEY, String(at)).catch(() => undefined);
    } catch {
      Alert.alert(t('feed_error'), t('feed_could_not_post'));
    } finally {
      setSavingAnn(false);
    }
  }, [annText]);

  const removeActivity = useCallback(async (entry: ActivityEntry) => {
    // A private line is yours to delete; a shared one only leaves your own
    // feed (the server keeps it for the co-parent). Either way it goes from
    // here immediately, and comes back only if the server refuses.
    const prompt = entry.shared === false ? t('feed_activity_delete_msg') : t('feed_activity_hide_msg');
    Alert.alert(t('feed_activity_remove_title'), prompt, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: entry.shared === false ? t('set_delete') : t('feed_activity_hide'),
        style: 'destructive',
        onPress: async () => {
          setActivity((prev) => prev.filter((e) => e.activity_id !== entry.activity_id));
          try {
            await api.deleteActivity(entry.activity_id);
          } catch {
            Alert.alert(t('feed_could_not_delete'), t('feed_change_not_saved'));
            load();
          }
        },
      },
    ]);
  }, [t, load]);

  const removeAnnouncement = useCallback(async (id: string) => {
    // Announcements are shared and can be urgent — a single stray tap shouldn't
    // wipe another parent's message. Confirm, like other shared deletes.
    Alert.alert(t('feed_announcement_delete_title'), t('feed_announcement_delete_msg'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('set_delete'),
        style: 'destructive',
        onPress: async () => {
          setAnnouncements((prev) => prev.filter((a) => a.announcement_id !== id));
          try {
            await api.deleteAnnouncement(id);
          } catch {
            Alert.alert(t('feed_could_not_delete'), t('feed_announcement_restored'));
            load();
          }
        },
      },
    ]);
  }, [t, load]);

  return (
    <SwipeableTabView style={styles.container}>
      <TabScreen
        tab="Feed"
        refreshing={refreshing}
        onRefresh={handleRefresh}
        scrollViewProps={{ contentContainerStyle: [styles.scroll, { paddingHorizontal: px }] }}
      >
          <View style={[styles.page, { maxWidth: maxW }]}>
            <Text style={styles.brand}>Ahenora</Text>
            <View style={styles.topMetaRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.dateText}>{feedDateLine(now)} <Text style={styles.sun}>{timeEmoji(now)}</Text></Text>
                <Text style={styles.weekLine} testID="feed-week">{feedWeekLine(now, t, subscription?.custody)}</Text>
              </View>
              <View style={styles.topActions}>
                <PressScale
                  testID="feed-search"
                  onPress={() => router.navigate('/(tabs)/search' as never)}
                  style={styles.bellWrap}
                  accessibilityRole="button"
                  accessibilityLabel={t('search_title')}
                >
                  <SearchIcon color={ui.text} size={24} />
                </PressScale>
                <PressScale
                  testID="feed-bell"
                  onPress={() => { setShowAlerts(true); markAlertsSeen(); }}
                  style={styles.bellWrap}
                  accessibilityLabel={t('feed_view_alerts')}
                >
                  <Bell color={ui.text} size={25} />
                  {unseenAlertCount > 0 ? (
                    <View style={styles.bellBadge}><Text style={styles.bellBadgeText}>{Math.min(unseenAlertCount, 9)}</Text></View>
                  ) : null}
                </PressScale>
                <PressScale
                  testID="feed-household-menu"
                  onPress={() => setHouseholdOpen(true)}
                  style={styles.bellWrap}
                  accessibilityRole="button"
                  accessibilityLabel={t('nav_household')}
                >
                  <LayoutGrid color={ui.text} size={23} />
                </PressScale>
              </View>
            </View>

            <StreakChip />

            <View style={styles.heroRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.6}>{headline}</Text>
                {/* Calm was a hero-sized card; as an ambient signal it earns a
                    pill, not the top third of the screen. */}
                <View style={styles.heroMetaRow}>
                  {/* A plain-language status you can act on, not a bare number:
                      "All calm" when nothing's overdue, else a count that reads
                      as a nudge. */}
                  <PressScale
                    onPress={() => Alert.alert(t('feed_calm_title'), t('feed_calm_explain'))}
                    style={[styles.calmPill, dashboard.overdue.length > 0 && styles.calmPillWarn]}
                    accessibilityRole="button"
                    accessibilityLabel={t('feed_calm_title')}
                  >
                    <Text style={[styles.calmPillText, dashboard.overdue.length > 0 && styles.calmPillTextWarn]}>
                      {dashboard.overdue.length > 0
                        ? t('feed_calm_overdue', { n: String(dashboard.overdue.length) })
                        : t('feed_calm_ok')}
                    </Text>
                  </PressScale>
                </View>
              </View>
            </View>

            {/* The day leads now — the task list (with handed-to-you pinned)
                renders first, right below. Capture, gifting, first-run cards
                and templates follow it. */}

            {/* The stats strip lived here: "Due today / Sign slips / This
                week" — three numbers sitting above the task list that shows
                those same items, under a tab row that already splits them
                Today / Upcoming / All. It spent about 90px of the first
                screen restating what the next 90px showed properly.
                Counting is not a feature when the things being counted are
                right there. */}


            <View style={styles.listCard}>
              {loading ? (
                <ActivityIndicator color={ui.orange} style={{ paddingVertical: 32 }} />
              ) : loadError && visibleCards.length === 0 && handedToMe.length === 0 ? (
                <PressScale onPress={handleRefresh} style={styles.emptyBox}>
                  <AlertTriangle color={ui.orange} size={22} />
                  <Text style={styles.emptyTitle}>{t('feed_load_failed_title')}</Text>
                  <Text style={styles.emptySub}>{t('feed_load_failed_sub')}</Text>
                </PressScale>
              /* Handed-to-you is pinned independent of the tab, so the empty
                 state must yield to it: a task a co-parent gave you for next
                 week is the whole point, and it must not be hidden behind
                 "Nothing urgent" just because you have no cards of your own
                 due today. */
              ) : visibleCards.length === 0 && handedToMe.length === 0 ? (
                <View style={styles.emptyBox}>
                  <CheckCircle2 color={ui.mintText} size={22} />
                  <Text style={styles.emptyTitle}>{t('feed_nothing_urgent')}</Text>
                  <Text style={styles.emptySub}>{t('feed_empty_hint')}</Text>
                  <PressScale
                    testID="feed-empty-scan"
                    onPress={() => setShowCamera(true)}
                    style={[styles.emptyScanBtn, { backgroundColor: ui.orangeSoft, borderColor: ui.orange + '40' }]}
                  >
                    <Camera color={ui.orange} size={15} />
                    <Text style={[styles.emptyScanText, { color: ui.orangeText }]}>{t('feed_try_scan')}</Text>
                  </PressScale>
                </View>
              ) : (
                <>
                  {/* Work somebody handed you is still WORK, so it belongs in
                      the list rather than in a box above it. As its own card
                      it pushed the actual task list a full screen further
                      down — the feed's whole job is what is happening today,
                      and today's tasks had ended up last. Pinned here it
                      keeps its emphasis and costs no extra height. Filtered
                      against the rows below so nothing appears twice. */}
                  {handedToMe.length > 0 ? (
                    <View testID="feed-assigned">
                      <View style={styles.handedHeader}>
                        <UserCheck color={ui.orangeText} size={15} />
                        <Text style={styles.handedTitle}>{t('feed_assigned_title')}</Text>
                        <Text style={styles.handedCount}>{handedToMe.length}</Text>
                      </View>
                      <WindowedList
                        testID="feed-assigned-scroll"
                        count={handedToMe.length}
                        window={3}
                      >
                        {handedToMe.map((card) => (
                          <View key={card.card_id}>
                            <TaskRow card={card} onOpen={() => setSelectedCard(card)} onComplete={() => toggle(card)} styles={styles} />
                            <View style={styles.rowDivider} />
                          </View>
                        ))}
                      </WindowedList>
                    </View>
                  ) : null}
                  {/* Two lists share this card, and until now the seam between
                      them was drawn with the same divider used BETWEEN rows of
                      one list — so the handed section's scroll area looked like
                      it had simply stopped working partway down. This names the
                      second list, which is the cheapest way to say "different
                      list, not more of the same one". Only when both are
                      present: on its own, the list below needs no label. */}
                  {handedToMe.length > 0 && restOfList.length > 0 ? (
                    <Text style={styles.restTitle}>{t('feed_rest_title')}</Text>
                  ) : null}
                  {restOfList.map((card, index) => (
                    <View key={card.card_id}>
                      <TaskRow card={card} onOpen={() => setSelectedCard(card)} onComplete={() => toggle(card)} styles={styles} />
                      {index < restOfList.length - 1 ? <View style={styles.rowDivider} /> : null}
                    </View>
                  ))}
                </>
              )}
            </View>

            {hiddenTaskCount > 0 && !showAllTasks ? (
              <PressScale testID="feed-see-all" onPress={() => setShowAllTasks(true)} style={styles.seeAllBtn}>
                <Text style={styles.seeAllText}>{t('feed_see_all_tasks', { n: hiddenTaskCount })}</Text>
                <ChevronRight color={ui.orangeText} size={16} />
              </PressScale>
            ) : showAllTasks && feedCards.length > TASK_CAP ? (
              <PressScale testID="feed-see-less" onPress={() => setShowAllTasks(false)} style={styles.seeAllBtn}>
                <Text style={styles.seeAllText}>{t('feed_show_less')}</Text>
              </PressScale>
            ) : null}

            {/* Quick capture — one slim bar with camera/mic tucked to the right,
                so there's a single, clear "add" gesture that doesn't echo the
                nav bar's ＋ (was a full Add/Photo/Voice card up top). */}
            <View style={styles.addBar}>
              <PressScale onPress={openManual} style={styles.addBarMain} testID="feed-open-add">
                <View style={styles.addBarPlus}><Plus color="#FFFFFF" size={18} /></View>
                <Text style={styles.addBarText} numberOfLines={1}>{t('feed_add_placeholder')}</Text>
              </PressScale>
              <PressScale onPress={() => setShowCamera(true)} style={styles.addBarIcon} accessibilityRole="button" accessibilityLabel={t('feed_photo')}>
                <Camera color={ui.muted} size={19} />
              </PressScale>
              <PressScale onPress={() => setShowVoice(true)} style={styles.addBarIcon} accessibilityRole="button" accessibilityLabel={t('feed_voice')}>
                <Mic color={ui.muted} size={19} />
              </PressScale>
            </View>

            {/* Quick templates — one tap to run a saved routine. Sits by the
                add bar since it's another way to add. */}
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

            {/* Upcoming birthdays / Secret Santa, gathered into one compact
                strip. Hidden when there's nothing live. */}
            <GiftingStrip
              birthdays={dashboard.upcomingBirthdays}
              potByCard={giftPotByCard}
              santaDraws={santaDraws}
              lang={lang}
              onOpenBirthday={(card) => router.push({
                pathname: '/gift-pot',
                params: { cardId: card.card_id, name: card.title },
              } as never)}
              onSeeAllBirthdays={() => router.navigate('/(tabs)/calendar')}
              onOpenSanta={(draw) => router.push({ pathname: '/santa', params: { drawId: draw.draw_id } } as never)}
              onNewSanta={() => router.push('/santa' as never)}
            />

            {/* A gentle nudge to Premium — free households only, self-snoozes */}
            <UpgradeBanner />

            {/* First-run checklist — demoted below the day; self-hides once done */}
            <GettingStarted
              hasMember={members.length > 1}
              hasCard={cards.length > 0}
              hasDoc={vaultCount > 0}
              onAddMember={() => router.navigate('/(tabs)/kids')}
              onAddCard={openManual}
              onAddDoc={() => router.navigate('/(tabs)/vault')}
            />

            {/* Reminders can only arrive if the OS was ever asked. It never was
                outside a toggle buried in Settings, so most households have no
                token and the server can push them nothing. Shown here because
                onboarding only reaches the people who arrive next. */}
            <NotificationsNudge />

            {/* Solo household → bring in the co-parent. Vanishes once someone joins. */}
            <CoParentNudge
              visible={members.length <= 1}
              onInvite={() => { requestInvite(); router.navigate('/(tabs)/settings' as never); }}
              stranded={stranded}
              onResend={async (email) => {
                try {
                  await api.invite(email);
                  return true;
                } catch {
                  return false;
                }
              }}
            />

            {/* One row stands in for the whole retrospective half of the Feed —
                who did what, the board, notes, the weekly report. Collapsed by
                default; tap to open. This is what keeps the Feed to one screen. */}
            <PressScale testID="feed-household-open" onPress={() => setShowHousehold((v) => !v)} style={styles.householdRow}>
              <View style={styles.householdIcon}><History color={ui.mintText} size={17} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.householdTitle}>{t('feed_household')}</Text>
                {/* The teaser repeats the newest line; hide it once the list
                    below is open so the row reads as a header, not a duplicate. */}
                {!showHousehold ? (
                  <Text style={styles.householdSub} numberOfLines={1}>{householdSummary}</Text>
                ) : null}
              </View>
              {householdActivity.length > 0 ? (
                <View style={styles.householdCount}><Text style={styles.householdCountText}>{householdActivity.length}</Text></View>
              ) : null}
              <ChevronRight color={ui.muted} size={18} style={showHousehold ? { transform: [{ rotate: '90deg' }] } : undefined} />
            </PressScale>

            {showHousehold ? (
            <>
            {/* Retrospective sections, collapsed off the Feed by default:
                who did what, notes, the family board, the weekly report and
                the household snapshot. Opened from the row above. */}
            {householdActivity.length > 0 ? (
              <View style={styles.activityCard}>
                <View style={styles.activityHead}>
                  <History color={ui.mintText} size={17} />
                  <Text style={styles.activityTitle}>{t('feed_activity_title')}</Text>
                </View>
                {householdActivity.map((entry) => (
                  <View key={entry.activity_id} style={styles.activityRow}>
                    <View style={styles.activityDot} />
                    <Text style={styles.activityText} numberOfLines={2}>
                      <Text style={styles.activityActor}>{entry.actor_name || t('feed_activity_someone')}</Text>
                      {' '}
                      {activityPhrase(entry, t)}
                      {entry.shared === false ? <Text style={styles.activityPrivate}>{'  '}{t('feed_activity_just_you')}</Text> : null}
                    </Text>
                    <Text style={styles.activityWhen}>{shortWhen(entry.created_at, t)}</Text>
                    <PressScale
                      testID={`activity-remove-${entry.activity_id}`}
                      accessibilityRole="button"
                      accessibilityLabel={t('feed_activity_remove_title')}
                      onPress={() => removeActivity(entry)}
                      hitSlop={10}
                      style={styles.activityRemove}
                    >
                      <X color={ui.muted} size={14} />
                    </PressScale>
                  </View>
                ))}
              </View>
            ) : null}

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
                  <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_add')} onPress={addNote} disabled={savingNote || !noteText.trim()} style={[styles.noteSendBtn, (!noteText.trim() || savingNote) && { opacity: 0.4 }]}>
                    <Plus color="#FFFFFF" size={18} />
                  </PressScale>
                </View>
                {notes.slice(0, 5).map((note) => (
                  <View key={note.note_id} style={styles.noteRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.noteText}>{note.text}</Text>
                      <Text style={styles.noteMeta}>{note.author_name} · {new Date(note.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
                    </View>
                    <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} onPress={() => removeNote(note.note_id)} hitSlop={12} style={{ padding: 4 }}>
                      <Trash2 color={ui.muted} size={15} />
                    </PressScale>
                  </View>
                ))}
                {notes.length === 0 ? <Text style={styles.noteEmpty}>{t('feed_no_notes')}</Text> : null}
              </View>
            ) : null}

            {/* Only when something actually needs attention. This banner
                names the most pressing item and jumps to it, which is worth
                a card — but with nothing critical it said "your household is
                moving calmly" a few rows under a list already saying
                "Nothing urgent today", and offered a tap that led back to
                the tab you were on. The reassurance still exists; it is just
                said once, in the place that owns it. */}
            {alertCount > 0 ? (
              <View style={styles.alertBanner}>
                <View style={styles.alertIcon}><Star color="#FFFFFF" fill="#FFFFFF" size={19} /></View>
                <Text style={styles.alertText} numberOfLines={2}>{alertText}</Text>
              </View>
            ) : null}

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
                  <Text style={[styles.pastBtnText, { color: ui.orangeText }]}>{t('feed_clear')}</Text>
                </PressScale>
              </View>
            ) : null}


            {/* Announcements */}
            <View style={styles.sectionHeader}>
              <Megaphone color={ui.orange} size={18} />
              <Text style={styles.sectionHeaderText}>{t('feed_family_board')}</Text>
              {unreadAnnouncements > 0 ? (
                <View testID="board-unread-badge" style={styles.boardUnread}>
                  <Text style={styles.boardUnreadText}>
                    {t('feed_board_unread', { n: unreadAnnouncements })}
                  </Text>
                </View>
              ) : null}
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
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_add')} onPress={addAnnouncement} disabled={savingAnn || !annText.trim()} style={[styles.noteSendBtn, (!annText.trim() || savingAnn) && { opacity: 0.4 }]}>
                  <Plus color="#FFFFFF" size={18} />
                </PressScale>
              </View>
              {announcements.slice(0, 5).map((ann) => {
                const isNew = annSeenAt != null && (new Date(ann.created_at).getTime() || 0) > annSeenAt;
                return (
                <View key={ann.announcement_id} style={[styles.noteRow, isNew && styles.boardRowNew]}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.boardTagRow}>
                      {ann.priority === 'urgent' ? (
                        <View style={styles.urgentBadge}><AlertTriangle color={ui.danger} size={12} /><Text style={styles.urgentText}>{t('feed_urgent')}</Text></View>
                      ) : null}
                      {isNew ? <View style={styles.boardNewTag}><Text style={styles.boardNewTagText}>{t('feed_board_new')}</Text></View> : null}
                    </View>
                    <Text style={styles.noteText}>{ann.text}</Text>
                    <Text style={styles.noteMeta}>{ann.author_name} · {new Date(ann.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</Text>
                  </View>
                  <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} onPress={() => removeAnnouncement(ann.announcement_id)} hitSlop={12} style={{ padding: 4 }}>
                    <Trash2 color={ui.muted} size={15} />
                  </PressScale>
                </View>
                );
              })}
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
            {!reportLocked && expandReport ? <PremiumPreviewBanner /> : null}
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
                    <Text style={[styles.reportNum, report.tasks_overdue > 0 && { color: ui.danger }]}>{report.tasks_overdue}</Text>
                    <Text style={styles.reportLabel}>{t('feed_report_overdue')}</Text>
                  </View>
                  <View style={styles.reportCell}>
                    <Text style={[styles.reportNum, { color: ui.orangeText }]}>{report.stars_earned}</Text>
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
            </>
            ) : null}
          </View>
          <View style={{ height: 160 }} />
      </TabScreen>

      {/* The floating + was removed with the nav redesign: the centre ➕ in the
          tab bar now owns "add from anywhere", and the composer is still one tap
          from the "Add a task…" card at the top of the feed. */}
      {/* The Household menu (Vault, Settings, Account, Hand-off) — opened from
          the grid button in the header, now that Kitchen has its own tab. */}
      <MoreSheet visible={householdOpen} onClose={() => setHouseholdOpen(false)} />

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
            // Pass the modal's decision through untouched. The '|| School'
            // that used to sit here re-filed an uncategorised document under
            // School — the exact mis-filing the capture rewrite removed — and
            // was masked only because save_to_vault happens to be false when
            // the category is empty. One line from undoing the invariant.
            vault_category: draft.vault_category || '',
            is_event: draft.is_event,
            expires_on: draft.expires_on || null,
            location: draft.location || null,
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

      {/* Same sheet, edit mode — reached by the pencil on a task. Lets a task
          on the Feed be corrected or reassigned without deleting and retyping. */}
      <AddCardModal
        visible={!!editing}
        editCard={editing}
        onClose={() => setEditing(null)}
        onCreated={() => { setEditing(null); load(); }}
      />

      <KeyboardAwareBottomSheet visible={!!selectedCard} onClose={() => setSelectedCard(null)} contentStyle={styles.detailSheet}>
        {selectedCard ? (() => {
          const parts = parseDescription(selectedCard.description, t);
          const rel = relativeDue(selectedCard.due_date, t);
          return (
            <>
              <View style={styles.detailHeader}>
                <Text style={styles.detailTitle}>{cleanText(selectedCard.title)}</Text>
                <PressScale
                  testID="feed-card-edit"
                  accessibilityRole="button"
                  accessibilityLabel={t('card_edit')}
                  onPress={() => { setEditing(selectedCard); setSelectedCard(null); }}
                  style={styles.closeBtn}>
                  <Pencil color={ui.text} size={18} />
                </PressScale>
                <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setSelectedCard(null)} style={styles.closeBtn} testID="feed-detail-close">
                  <X color={ui.text} size={20} />
                </PressScale>
              </View>

              {/* Time card — the most important fact, promoted and unmissable */}
              <View style={styles.whenCard}>
                <Clock color={ui.orange} size={17} />
                <Text style={styles.whenText}>{formatDayLine(selectedCard.due_date, t)}</Text>
                {rel ? <View style={styles.whenPill}><Text style={styles.whenPillText}>{rel}</Text></View> : null}
              </View>

              <View style={styles.detailMetaRow}>
                <User color={ui.muted} size={17} />
                <Text style={styles.detailMetaText}>{selectedCard.assignee || t('feed_unassigned')}</Text>
              </View>
              {/* Who set it — the question the other parent asks about a task
                  that landed on a kid, a teen or the co-parent. */}
              {selectedCard.assignee && selectedCard.created_by_name ? (
                <View style={styles.detailMetaRow}>
                  <UserPlus color={ui.muted} size={17} />
                  <Text style={styles.detailMetaText}>{t('card_assigned_by', { name: selectedCard.created_by_name })}</Text>
                </View>
              ) : null}

              {/* Structured chips: location → Maps, links → browser */}
              {parts.location ? (
                <PressScale
                  onPress={() => {
                    const q = encodeURIComponent(parts.location!);
                    openExternal(Platform.OS === 'ios' ? `maps:?q=${q}` : `geo:0,0?q=${q}`, t);
                  }}
                  style={styles.detailChip}
                >
                  <MapPin color={ui.orange} size={16} />
                  <Text style={styles.detailChipText} numberOfLines={2}>{parts.location}</Text>
                  <ExternalLink color={ui.muted} size={13} />
                </PressScale>
              ) : null}
              {parts.links.map((link, i) => (
                <PressScale key={i} onPress={() => openExternal(link.url, t)} style={styles.detailChip}>
                  <ExternalLink color={ui.orange} size={16} />
                  <Text style={styles.detailChipText} numberOfLines={1}>{link.label}</Text>
                  <ExternalLink color={ui.muted} size={13} />
                </PressScale>
              ))}
              {parts.people ? (
                <View style={styles.detailMetaRow}>
                  <Users color={ui.muted} size={17} />
                  <Text style={styles.detailMetaText} numberOfLines={2}>{parts.people}</Text>
                </View>
              ) : null}

              {/* Description exactly once, cleaned of the extracted lines */}
              {parts.text ? (
                <View style={styles.detailBody}>
                  <Text style={styles.detailDescription}>{parts.text}</Text>
                </View>
              ) : !parts.location && parts.links.length === 0 && !parts.people ? (
                <View style={styles.detailBody}>
                  <Text style={[styles.detailDescription, { color: ui.muted }]}>{t('feed_no_details')}</Text>
                </View>
              ) : null}

              {/* Reschedule — the "not today, move it" action. Three presets
                  cover almost every real snooze; the chip closes the sheet so
                  the change is felt immediately. */}
              <Text style={styles.rescheduleLabel}>{t('feed_reschedule')}</Text>
              <View style={styles.rescheduleRow}>
                {snoozeOptions(t).map((opt) => (
                  <PressScale
                    key={opt.label}
                    testID={`feed-snooze-${opt.label}`}
                    onPress={() => { const c = selectedCard; setSelectedCard(null); reschedule(c, opt.date); }}
                    style={styles.rescheduleChip}
                  >
                    <Clock color={ui.orangeText} size={14} />
                    <Text style={styles.rescheduleChipText}>{opt.label}</Text>
                  </PressScale>
                ))}
              </View>

              <PressScale testID="feed-complete-card" onPress={completeSelected} style={styles.completeBtn}>
                <CheckCircle2 color="#FFFFFF" size={18} />
                <Text style={styles.completeBtnText}>{t('feed_mark_done')}</Text>
              </PressScale>
            </>
          );
        })() : null}
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showAlerts} onClose={() => setShowAlerts(false)} contentStyle={styles.detailSheet}>
        <View style={styles.detailHeader}>
          <Text style={styles.detailTitle}>{t('feed_needs_attention')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setShowAlerts(false)} style={styles.closeBtn} testID="feed-alerts-close">
            <X color={ui.text} size={20} />
          </PressScale>
        </View>
        {dashboard.priority.length === 0 ? (
          <View style={styles.alertsEmpty}>
            <CheckCircle2 color={ui.mintText} size={30} />
            <Text style={styles.alertsEmptyText}>{t('feed_all_caught_up')}</Text>
          </View>
        ) : (
          dashboard.priority.map((card, index) => (
            <PressScale
              key={card.card_id}
              testID={`feed-alert-${card.card_id}`}
              onPress={() => { setShowAlerts(false); setSelectedCard(card); }}
              style={[styles.alertRow, index === 0 && { borderTopWidth: 0 }]}
            >
              <View style={styles.alertDot} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.alertRowTitle} numberOfLines={1}>{card.title}</Text>
                <Text style={styles.alertRowMeta} numberOfLines={1}>
                  {handedIds.has(card.card_id) ? t('feed_assigned_to_you') : cardMeta(card, t)}
                </Text>
              </View>
              <ChevronRight color={ui.muted} size={18} />
            </PressScale>
          ))
        )}
      </KeyboardAwareBottomSheet>
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} />
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
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: ui.line, marginTop: 4 },
  alertDot: { width: 9, height: 9, borderRadius: 99, backgroundColor: ui.orange, flexShrink: 0 },
  alertRowTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15.5 },
  alertRowMeta: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 2 },
  alertsEmpty: { alignItems: 'center', gap: 12, paddingVertical: 34 },
  alertsEmptyText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  detailTitle: { flex: 1, color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  closeBtn: { width: 42, height: 42, borderRadius: 9999, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, alignItems: 'center', justifyContent: 'center' },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  whenCard: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16, paddingHorizontal: 15, paddingVertical: 13, borderRadius: 16, backgroundColor: ui.orangeSoft, borderWidth: 1, borderColor: ui.orange + '40' },
  whenText: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 16, letterSpacing: -0.2 },
  whenPill: { marginLeft: 'auto', backgroundColor: ui.orange + '22', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4 },
  whenPillText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
  detailChip: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 10, paddingHorizontal: 15, paddingVertical: 13, borderRadius: 16, backgroundColor: ui.soft, borderWidth: 1, borderColor: ui.line },
  detailChipText: { flex: 1, color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  detailMetaText: { flex: 1, color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 21 },
  detailBody: { marginTop: 16, gap: 10 },
  detailDescription: { color: ui.text, fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 24 },
  completeBtn: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 54, borderRadius: 99, backgroundColor: ui.orangeDeep },
  completeBtnText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 16 },
  rescheduleLabel: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 22, marginBottom: 9 },
  rescheduleRow: { flexDirection: 'row', gap: 8 },
  rescheduleChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 11, borderRadius: 14, backgroundColor: ui.orangeSoft, borderWidth: 1, borderColor: ui.orange + '30' },
  rescheduleChipText: { color: ui.orangeText, fontFamily: 'Inter_700Bold', fontSize: 12.5 },
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
  brand: {
    color: ui.orangeText,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 13,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginTop: 2,
    marginBottom: 4,
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
    color: ui.orangeText,
  },
  weekLine: {
    color: ui.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12.5,
    letterSpacing: 0.2,
    marginTop: 1,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
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
    backgroundColor: ui.orangeDeep,
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
    // Playfair carries the brand voice from the landing into the app — the
    // greeting is the one place it earns the premium display face.
    fontFamily: 'PlayfairDisplay_700Bold',
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.3,
  },
  subtitle: {
    marginTop: 8,
    color: ui.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
    letterSpacing: 0.2,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  calmPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ui.mint,
    borderRadius: 9999,
    paddingHorizontal: 11,
    paddingVertical: 5,
  },
  calmPillText: {
    color: ui.mintText,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 12.5,
    letterSpacing: 0.2,
  },
  calmPillWarn: { backgroundColor: ui.orangeSoft },
  calmPillTextWarn: { color: ui.orangeText },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 11,
    marginTop: 2,
  },
  seeAllText: {
    color: ui.orangeText,
    fontFamily: 'Inter_700Bold',
    fontSize: 13.5,
  },
  householdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 18,
    backgroundColor: ui.card,
    borderWidth: 1,
    borderColor: ui.line,
  },
  householdIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: ui.mint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  householdTitle: {
    color: ui.text,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 15.5,
  },
  householdSub: {
    color: ui.muted,
    fontFamily: 'Inter_500Medium',
    fontSize: 12.5,
    marginTop: 1,
  },
  householdCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 9999,
    paddingHorizontal: 6,
    backgroundColor: ui.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  householdCountText: {
    color: ui.orangeText,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 12,
  },
  // Slim quick-capture bar (replaced the tall Add/Photo/Voice card).
  addBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ui.card,
    borderWidth: 1,
    borderColor: ui.line,
    borderRadius: 14,
    paddingRight: 4,
    marginBottom: 12,
  },
  addBarMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingLeft: 12 },
  addBarPlus: { width: 26, height: 26, borderRadius: 8, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center' },
  addBarText: { flex: 1, color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14 },
  addBarIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  captureCard: {
    borderRadius: 22,
    backgroundColor: ui.card,
    borderWidth: 1,
    borderColor: ui.line,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  captureInput: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 9,
  },
  plusSoft: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: ui.orangeSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capturePlaceholder: {
    flex: 1,
    color: ui.muted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  captureActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionPill: {
    flexShrink: 1,
    minWidth: 0,
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ui.line,
    backgroundColor: ui.soft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  actionPillAccent: {
    borderWidth: 0,
    backgroundColor: ui.orangeDeep,
  },
  actionDot: {
    width: 26,
    height: 26,
    borderRadius: 9,
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
  alertBanner: {
    minHeight: 72,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(245,101,25,0.30)',
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
    backgroundColor: ui.orangeDeep,
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
    borderColor: ui.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskBody: {
    flex: 1,
    minWidth: 0,
  },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  assigneeBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
  },
  assigneeBadgeText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 10.5,
    letterSpacing: 0.2,
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
  // An in-list group header, not a card: the hand-off group lives inside the
  // task list now, so it needs a label with the weight of a section marker
  // rather than the chrome of a container.
  // A quieter twin of handedHeader: same alignment so the two read as siblings,
  // muted rather than orange so it labels without competing with the section
  // that carries the emphasis.
  restTitle: {
    color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 11.5,
    letterSpacing: 0.8, textTransform: 'uppercase',
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 6,
  },
  handedHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6,
  },
  handedTitle: {
    flex: 1, color: ui.orangeText, fontFamily: 'Inter_800ExtraBold',
    fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase',
  },
  handedCount: {
    color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 11.5,
    backgroundColor: ui.orangeSoft, paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 999, overflow: 'hidden',
  },
  activityCard: {
    backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line,
    padding: 14, gap: 10, marginBottom: 12,
  },
  activityHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activityTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 15, letterSpacing: -0.2 },
  activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  activityDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: ui.mintText,
    marginTop: 7, flex: 0,
  },
  activityText: { flex: 1, color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  activityActor: { color: ui.text, fontFamily: 'Inter_700Bold' },
  activityWhen: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 11, marginTop: 2 },
  activityPrivate: { color: ui.orangeText, fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  activityRemove: { padding: 4, marginLeft: 2 },
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
    backgroundColor: ui.orangeDeep,
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
    color: ui.danger,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 11,
  },
  boardUnread: {
    backgroundColor: ui.orangeDeep, borderRadius: 999,
    paddingHorizontal: 9, paddingVertical: 3, minWidth: 22, alignItems: 'center',
  },
  boardUnreadText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 11 },
  boardRowNew: {
    marginHorizontal: -8, paddingHorizontal: 8, borderRadius: 12,
    backgroundColor: ui.orangeSoft,
  },
  boardTagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  boardNewTag: { backgroundColor: ui.orangeDeep, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  boardNewTagText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase' },
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
    color: ui.orangeText,
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
