import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Platform, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronRight,
  Crown,
  DollarSign,
  Globe,
  Link2,
  Lock,
  LogOut,
  Mail,
  MessageSquare,
  PenLine,
  Receipt,
  RotateCcw,
  Search as SearchIcon,
  Send,
  Share2,
  Sparkles,
  Star,
  Trash2,
  Users,
  UserPlus,
  X,
} from 'lucide-react-native';

import AppToast from '../../src/components/AppToast';
import { useToast } from '../../src/hooks/useToast';
import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import { LanguageModal } from '../../src/components/LanguageModal';
import { PinPadModal } from '../../src/components/PinPadModal';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import { TabScreen } from '../../src/components/TabScreen';
import { PremiumPreviewBanner } from '../../src/components/PremiumGate';
import { Card, Chevron, Divider, IconTile, MiniRow, NavRow, ScreenHeader, StatBox, ToggleRow, useUI, UIColors } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { openReview } from '../../src/reviewPrompt';
import { api, Card as CardType, Entitlements, Expense, ExpenseSummary, FamilyInvite, FamilyMember, NotificationSettings } from '../../src/api';
import { LANG_NAMES } from '../../src/i18n';
import { appVersionInfo, ensureNotificationPermissions, registerForPushNotificationsAsync, sendLocalNotification, sendTestScheduledReminderNotification, syncCardReminderNotifications } from '../../src/notifications';
import { logger } from '../../src/logger';

function formatBytes(bytes?: number | null) {
  const value = bytes || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export default function Settings() {
  const { user, t, lang, logout, subscription, appearanceMode, setAppearance, inviteRequested, clearInviteRequest } = useStore();
  const router = useRouter();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [invites, setInvites] = useState<FamilyInvite[]>([]);
  const [showLang, setShowLang] = useState(false);
  // isUpdatePending is only exposed through the hook, and it is the piece that
  // distinguishes "nothing new" from "new build already downloaded, waiting
  // for a restart" — two states checkForUpdateAsync reports identically.
  const { isUpdatePending } = Updates.useUpdates();
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'downloading'>('idle');
  const [updateNote, setUpdateNote] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const { toast, showToast } = useToast(2600);
  const [inviteMethod, setInviteMethod] = useState<'email' | 'phone' | 'link'>('email');
  // 'coparent' is the one-tap path inside Manage members; 'family' is the
  // generic invite with a free-text relationship (grandparent, nanny...).
  const [inviteMode, setInviteMode] = useState<'coparent' | 'family'>('coparent');
  const [inviteRole, setInviteRole] = useState('');
  const [inviteLabel, setInviteLabel] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [sending, setSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [pinMember, setPinMember] = useState<FamilyMember | null>(null);
  const [expandClientErrors, setExpandClientErrors] = useState(false);
  const [clientErrors, setClientErrors] = useState<Awaited<ReturnType<typeof api.listClientErrors>>>([]);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationSettings>({ card_reminders: false, new_card_alerts: false });
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [completedCards, setCompletedCards] = useState<CardType[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseSummary, setExpenseSummary] = useState<ExpenseSummary | null>(null);
  const [expandExpenses, setExpandExpenses] = useState(false);
  const [showExpenseAdd, setShowExpenseAdd] = useState(false);
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expCategory, setExpCategory] = useState('Groceries');
  const [savingExpense, setSavingExpense] = useState(false);

  const [refreshing, setRefreshing] = useState(false);
  const [expandMembers, setExpandMembers] = useState(false);
  const [expandChildren, setExpandChildren] = useState(false);
  const [expandHistory, setExpandHistory] = useState(false);
  const [expandUsage, setExpandUsage] = useState(false);
  // Settings is a hub now: each group is a row that opens on tap, so the
  // screen is a short list of homes rather than a long scroll of everything.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [settingsQuery, setSettingsQuery] = useState('');
  const toggleGroup = (id: string) => setOpenGroups((g) => ({ ...g, [id]: !g[id] }));

  const load = useCallback(async () => {
    try {
      // Each call is individually fault-tolerant so one failing endpoint
      // (offline / cold backend) can't blank the whole Settings screen.
      const [memberRows, inviteRows, notificationRows, entitlementRows, completedRows] = await Promise.all([
        api.familyMembers().catch(() => null),
        api.listInvites().catch(() => null),
        api.getNotificationSettings().catch(() => ({ card_reminders: false, new_card_alerts: false })),
        api.getEntitlements().catch(() => null),
        api.listCards('DONE')
          .then(async (rows) => {
            const directDone = rows.filter((card) => card.status === 'DONE');
            if (directDone.length > 0) return directDone;
            const allCards = await api.listCards().catch(() => [] as CardType[]);
            return allCards.filter((card) => card.status === 'DONE');
          })
          .catch(async () => {
            const allCards = await api.listCards().catch(() => [] as CardType[]);
            return allCards.filter((card) => card.status === 'DONE');
          }),
      ]);
      // Only overwrite on success — keep existing data if a call failed.
      if (memberRows) setMembers(memberRows);
      if (inviteRows) setInvites(inviteRows);
      setNotificationPrefs(notificationRows);
      setEntitlements(entitlementRows);
      setCompletedCards(completedRows);

      Promise.allSettled([api.listExpenses(), api.getExpenseSummary()])
        .then(([expRes, sumRes]) => {
          if (expRes.status === 'fulfilled') setExpenses(expRes.value);
          if (sumRes.status === 'fulfilled') setExpenseSummary(sumRes.value);
        })
        .catch(() => undefined);
    } catch (error) {
      logger.warn('settings load failed', error);
    }
  }, []);

  /**
   * What this device is actually running.
   *
   * The store version alone is not the answer, because updates land over the
   * air on top of it — two phones on the same store build can be showing
   * different apps. The update's own id is the part that distinguishes them,
   * so it is shown alongside, short enough to read out.
   */
  const versionLabel = useMemo(() => {
    const store = Constants.expoConfig?.version || '—';
    const update = Updates.isEmbeddedLaunch ? null : (Updates.updateId || '').slice(0, 8);
    return update ? `${store} · ${update}` : store;
  }, []);

  /**
   * Fetch the newest published build and restart into it.
   *
   * Updates otherwise arrive silently and apply on the NEXT launch, which from
   * the outside looks exactly like nothing happening — you close the app,
   * reopen it, and the old screen is still there because the download only
   * just finished. This does the whole thing on demand and says which of the
   * three outcomes happened, so "am I up to date?" is answerable.
   */
  const checkForUpdates = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled) {
      setUpdateNote(t('set_update_unavailable'));
      return;
    }
    setUpdateNote(null);
    setUpdateState('checking');
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        // "Not available" also means "already downloaded, waiting for a
        // restart" — which is exactly the state this button exists to resolve.
        // Reporting it as up to date told people they had the newest version
        // while they were still looking at the old one.
        if (isUpdatePending) {
          await Updates.reloadAsync();
          return;
        }
        setUpdateState('idle');
        setUpdateNote(t('set_update_current'));
        return;
      }
      setUpdateState('downloading');
      await Updates.fetchUpdateAsync();
      // Restarting is the only way the new bundle takes effect; doing it here
      // rather than asking the user to close the app twice is the entire point.
      await Updates.reloadAsync();
    } catch (e: any) {
      logger.warn('update check failed', e);
      setUpdateState('idle');
      setUpdateNote(t('set_update_failed'));
    }
  }, [t, isUpdatePending]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const memberLimit = entitlements?.max_members ?? subscription?.limits?.max_members ?? 0;
  const memberSlotsUsed = entitlements?.member_slots_used ?? members.length + invites.filter((invite) => invite.status === 'pending').length;
  // Case-insensitive on purpose: the backend queries roles with ^child$/i,
  // so the client must not be stricter than the server about casing. The
  // kids page already compares this way.
  const childMembers = useMemo(() => members.filter((m) => m.role?.toLowerCase() === 'child'), [members]);
  const adultCount = Math.max(1, members.filter((m) => m.role?.toLowerCase() !== 'child').length);
  // Adults with their own sign-in AND a parenting role are the co-parents;
  // a grandparent or nanny with an account is family, not a co-parent.
  const coParents = useMemo(
    () => members.filter((m) => {
      const role = m.role?.toLowerCase() || '';
      return m.has_account && (role === 'parent' || role === 'co-parent');
    }),
    [members],
  );
  const isCoParented = coParents.length >= 2;
  const planLabel = subscription?.plan === 'family_office' ? 'Family Office' : subscription?.plan === 'executive' ? 'Executive Family' : 'Village';
  const weeklyBrief = Boolean(entitlements?.weekly_brief || subscription?.limits?.weekly_brief);
  const initial = (user?.name?.[0] || 'C').toUpperCase();

  const removeMember = useCallback((member: FamilyMember) => {
    Alert.alert(
      `${t('set_remove')} ${member.name}?`,
      member.has_account ? t('set_remove_coparent_msg') : t('set_remove_member_msg'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('set_remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteFamilyMember(member.member_id);
              setMembers((prev) => prev.filter((m) => m.member_id !== member.member_id));
            } catch (error: any) {
              Alert.alert(t('set_remove_member_error'), error?.message || t('set_please_try_again'));
            }
          },
        },
      ],
    );
  }, []);

  // The inviter completes the join from their own device — built for the
  // household whose invitee's phone could read the invite but never deliver
  // the acceptance. Plain function (React Compiler: no manual useCallback).
  const completeInvite = (invite: FamilyInvite) => {
    Alert.alert(
      t('set_invite_add_now_title'),
      `${t('set_invite_add_now_msg')} ${invite.email}`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('set_invite_add_now'),
          onPress: async () => {
            try {
              await api.completeInvite(invite.invite_id);
              showToast(t('set_invite_add_now_done'), 'success');
              await load();
            } catch (error: any) {
              const detail = String(error?.message || '').match(/\{.*"detail"\s*:\s*"([^"]+)"/)?.[1];
              showToast(detail || t('set_error'), 'error');
            }
          },
        },
      ],
    );
  };

  const revokeInvite = useCallback((invite: FamilyInvite) => {
    Alert.alert(
      t('set_revoke_invite_title'),
      `${t('set_revoke_invite_msg')}${invite.email ? ` (${invite.email})` : ''}`,
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('set_revoke'),
          style: 'destructive',
          onPress: async () => {
            const prev = invites;
            setInvites((list) => list.filter((i) => i.invite_id !== invite.invite_id));
            try {
              await api.deleteInvite(invite.invite_id);
            } catch (error: any) {
              setInvites(prev);
              Alert.alert(t('set_error'), error?.message || t('set_please_try_again'));
            }
          },
        },
      ],
    );
  }, [invites]);

  const shareInviteLink = useCallback(async (inviteUrl?: string | null, email?: string | null) => {
    if (!inviteUrl) {
      setInviteResult(email ? `${t('set_invite_link_unavailable_for')} ${email}.` : t('set_invite_link_unavailable'));
      return;
    }
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(inviteUrl);
        setInviteResult(email ? `${t('set_invite_link_copied_for')} ${email}.` : t('set_invite_link_copied'));
        return;
      }
      await Share.share({
        title: t('set_join_household_coo'),
        message: `${user?.name || t('set_a_family_member')} ${t('set_invited_you')}\n\n${inviteUrl}`,
        url: inviteUrl,
      });
    } catch {
      setInviteResult(`${t('set_share_sheet_error')} ${inviteUrl}`);
    }
  }, [user?.name]);

  const updateNotificationPrefs = useCallback(async (changes: Partial<NotificationSettings>) => {
    const nextPrefs = { ...notificationPrefs, ...changes };
    setSavingNotifications(true);
    setNotificationStatus(null);
    setNotificationPrefs(nextPrefs);

    try {
      if (nextPrefs.card_reminders || nextPrefs.new_card_alerts) {
        const granted = await ensureNotificationPermissions();
        if (!granted) {
          // Revert the optimistic toggle so it doesn't stay ON while
          // notifications are actually off.
          setNotificationPrefs(notificationPrefs);
          setNotificationStatus(t('set_notif_permission_denied_long'));
          return;
        }
      }

      let warning = '';
      if (nextPrefs.new_card_alerts) {
        const push = await registerForPushNotificationsAsync().catch((e) => ({ granted: false, error: e?.message || t('set_push_registration_failed') }));
        const expoPushToken = 'expoPushToken' in push ? push.expoPushToken : undefined;
        const pushError = 'error' in push ? push.error : undefined;
        if (expoPushToken) {
          const { appVersion, runtimeVersion } = await appVersionInfo();
          await api.registerNotificationToken(expoPushToken, Platform.OS, appVersion, runtimeVersion);
        }
        else if (pushError) warning = String(pushError);
      }

      const saved = await api.updateNotificationSettings(nextPrefs).catch(() => nextPrefs as NotificationSettings);
      setNotificationPrefs(saved);

      if (nextPrefs.card_reminders) {
        const cards = await api.listCards();
        const result = await syncCardReminderNotifications(cards, true, t('notif_due_soon'));
        setNotificationStatus(result.scheduled ? `${result.scheduled} reminder notification${result.scheduled === 1 ? '' : 's'} scheduled.` : warning || t('set_reminder_alerts_on'));
      } else {
        await syncCardReminderNotifications([], false).catch(() => undefined);
        setNotificationStatus(nextPrefs.new_card_alerts ? warning || t('set_new_card_alerts_on') : t('set_notifications_off'));
      }
    } catch (error: any) {
      logger.warn('notification settings failed', error);
      setNotificationStatus(error?.message || t('set_notif_update_error'));
    } finally {
      setSavingNotifications(false);
    }
  }, [notificationPrefs]);

  const testReminderNotification = useCallback(async () => {
    const granted = await ensureNotificationPermissions();
    if (!granted) { setNotificationStatus(t('set_notif_permission_denied')); return; }
    await sendTestScheduledReminderNotification();
    setNotificationStatus(t('set_test_reminder_scheduled'));
  }, []);

  const testNewCardAlert = useCallback(async () => {
    const granted = await ensureNotificationPermissions();
    if (!granted) { setNotificationStatus(t('set_notif_permission_denied')); return; }
    await sendLocalNotification(t('set_test_alert_title'), t('set_test_alert_body'));
    setNotificationStatus(t('set_test_alert_sent'));
  }, []);

  const addExpense = useCallback(async () => {
    const amt = parseFloat(expAmount);
    if (!expDesc.trim() || isNaN(amt) || amt <= 0) return;
    setSavingExpense(true);
    try {
      const created = await api.addExpense({ description: expDesc.trim(), amount: amt, category: expCategory });
      setExpenses((prev) => [created, ...prev]);
      setExpDesc('');
      setExpAmount('');
      setShowExpenseAdd(false);
      const sum = await api.getExpenseSummary().catch(() => null);
      if (sum) setExpenseSummary(sum);
    } catch {
      Alert.alert(t('set_error'), t('set_add_expense_error'));
    } finally {
      setSavingExpense(false);
    }
  }, [expDesc, expAmount, expCategory]);

  const removeExpense = useCallback(async (id: string) => {
    setExpenses((prev) => prev.filter((e) => e.expense_id !== id));
    try {
      await api.deleteExpense(id);
      const sum = await api.getExpenseSummary().catch(() => null);
      if (sum) setExpenseSummary(sum);
    } catch {
      load();
    }
  }, [load]);

  const EXPENSE_CATS = ['Groceries', 'School', 'Medical', 'Activities', 'Childcare', 'Other'];

  const doLogout = async () => {
    await logout();
    router.replace('/');
  };

  const openInvite = (email = '', mode: 'coparent' | 'family' = 'coparent') => {
    setInviteMethod('email');
    setInviteMode(mode);
    setInviteRole('');
    setInviteLabel('');
    setInviteEmail(email);
    setInvitePhone('');
    setInviteResult(null);
    setInviteError(false);
    setLastInviteUrl(null);
    setShowInvite(true);
  };

  // The Feed's co-parent nudge navigates here with this flag raised; open the
  // invite sheet on arrival and clear it so it fires once.
  useEffect(() => {
    if (!inviteRequested) return;
    openInvite('', 'coparent');
    clearInviteRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteRequested]);

  // Two parents is the ceiling — a parent and a co-parent. A third would-be
  // parent is redirected to the family-member invite, where they get a role.
  const tryInviteCoparent = useCallback(() => {
    if (coParents.length >= 2) {
      Alert.alert(
        t('set_two_parents_title'),
        t('set_two_parents_msg'),
        [
          { text: t('cancel'), style: 'cancel' },
          { text: t('set_invite_family_member'), onPress: () => openInvite('', 'family') },
        ],
      );
      return;
    }
    openInvite();
  }, [coParents.length]);

  const inviteMessage = useCallback(
    (url: string) => `${user?.name || t('set_a_family_member')} ${t('set_invited_you')}\n\n${url}`,
    [user?.name],
  );

  // Email: send directly through the backend and confirm — no extra steps.
  // Plain function: a manual useCallback here makes the React Compiler
  // skip the whole component (same lesson as the kids page).
  const sendEmailInvite = async () => {
    const submitted = inviteEmail.trim();
    if (!submitted || !submitted.includes('@')) {
      setInviteError(true);
      setInviteResult(t('set_invite_valid_email'));
      return;
    }
    setSending(true);
    setInviteResult(null);
    setInviteError(false);
    try {
      const res = await api.invite(
        submitted,
        inviteMode === 'family' ? inviteRole.trim() || undefined : undefined,
      );
      if (res.sent) {
        // Success gets out of the way: close the sheet and confirm with a
        // toast. Leaving the form open with a note buried mid-sheet read as
        // "did it work?" and invited double-sends.
        setInviteResult(null);
        setInviteError(false);
        setInviteEmail('');
        setShowInvite(false);
        showToast(`${t('set_invite_email_sent')} ${submitted}.`, 'success');
      } else {
        // Delivery not configured / failed — fall back to the shareable link.
        setInviteError(true);
        // Show the provider's exact reason to admins so email issues are
        // debuggable (e.g. unverified domain) without digging through logs.
        const detail = user?.is_admin ? (res.email_error || res.message) : '';
        setInviteResult(detail ? `${t('set_invite_email_failed')}\n\n${detail}` : t('set_invite_email_failed'));
        if (res.invite_url) setLastInviteUrl(res.invite_url);
      }
      await load();
    } catch (error: any) {
      setInviteError(true);
      setInviteResult(error?.message || t('set_error'));
    } finally {
      setSending(false);
    }
  };

  // Phone: create a link, then hand off to the device's SMS app pre-filled.
  // Plain function: manual useCallback trips the React Compiler here.
  const sendPhoneInvite = async () => {
    const phone = invitePhone.trim();
    if (phone.replace(/[^0-9]/g, '').length < 6) {
      setInviteError(true);
      setInviteResult(t('set_invite_valid_phone'));
      return;
    }
    setSending(true);
    setInviteResult(null);
    setInviteError(false);
    try {
      const res = await api.createInviteLink({
        relationship: inviteMode === 'family' ? inviteRole.trim() || undefined : undefined,
        label: phone,
      });
      const url = res.invite_url;
      setLastInviteUrl(url);
      const sep = Platform.OS === 'ios' ? '&' : '?';
      const smsUrl = `sms:${phone}${sep}body=${encodeURIComponent(inviteMessage(url))}`;
      try {
        // Attempt directly — canOpenURL can falsely report false on Android 11+
        // because of package visibility rules.
        await Linking.openURL(smsUrl);
        setInviteResult(null);
        setShowInvite(false);
        showToast(t('set_invite_sms_opened'), 'success');
      } catch {
        // No SMS app (e.g. a tablet) — fall back to the share sheet.
        await shareInviteLink(url, null);
      }
      await load();
    } catch (error: any) {
      setInviteError(true);
      setInviteResult(error?.message || t('set_error'));
    } finally {
      setSending(false);
    }
  };

  // Link: create a named, role-carrying link. On web it goes straight to the
  // clipboard; on native the share sheet opens (its own Copy included).
  // Plain function: manual useCallback trips the React Compiler here.
  const shareNewLink = async () => {
    setSending(true);
    setInviteResult(null);
    setInviteError(false);
    try {
      const res = await api.createInviteLink({
        relationship: inviteMode === 'family' ? inviteRole.trim() || undefined : undefined,
        label: inviteLabel.trim() || undefined,
      });
      setLastInviteUrl(res.invite_url);
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(res.invite_url);
          showToast(t('set_link_copied'), 'success');
        } catch {
          await shareInviteLink(res.invite_url, null);
        }
      } else {
        await shareInviteLink(res.invite_url, null);
      }
      await load();
    } catch (error: any) {
      setInviteError(true);
      setInviteResult(error?.message || t('set_error'));
    } finally {
      setSending(false);
    }
  };

  const q = settingsQuery.trim().toLowerCase();
  // Keywords per group, so a search reaches settings by the words people use
  // for them, not the labels we happened to pick.
  const GK = {
    notifications: 'notifications push sign slip weekly digest email alert reminder',
    appearance: 'appearance theme light dark system display',
    household: 'household members co-parent co parent children child pin invite family expenses money cost split receipt',
    preferences: 'preferences language translation locale',
    more: 'more history completed cards replay setup onboarding plans plan upgrade premium billing subscription usage limits version update metrics',
  };
  // Open when the user tapped it, or when their search names it. A search also
  // hides the groups it does not match, so "pin" leaves only Household on screen.
  const groupOpen = (id: string, keywords: string) => !!openGroups[id] || (q.length > 0 && keywords.includes(q));
  const groupVisible = (keywords: string) => q.length === 0 || keywords.includes(q);
  const groupHead = (id: string, icon: React.ReactNode, title: string, subtitle: string, keywords: string) => (
    <PressScale testID={`settings-group-${id}`} onPress={() => toggleGroup(id)} style={styles.groupHead}>
      {icon}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.groupTitle}>{title}</Text>
        {subtitle ? <Text style={styles.groupSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <Chevron open={groupOpen(id, keywords)} />
    </PressScale>
  );

  return (
    <SwipeableTabView style={styles.container}>
      <TabScreen
        tab="Settings"
        refreshing={refreshing}
        onRefresh={handleRefresh}
        scrollViewProps={{ contentContainerStyle: styles.scroll, keyboardShouldPersistTaps: 'handled' }}
      >
          <ScreenHeader eyebrow={t('set_manage')} title={t('set_settings')} />

          {/* Profile */}
          <PressScale testID="settings-open-account" onPress={() => router.push('/account')} style={styles.headerGap}>
            <Card style={styles.profileCard}>
              {user?.picture ? (
                <Image source={{ uri: user.picture }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.profileName} numberOfLines={1}>{user?.name || t('set_household_member')}</Text>
                <Text style={styles.profileEmail} numberOfLines={1}>{user?.email || t('set_not_signed_in')}</Text>
                {user?.is_admin ? (
                  <View style={styles.adminBadge}>
                    <Crown color={ui.orange} size={13} />
                    <Text style={styles.adminBadgeText}>{t('set_admin_tester')}</Text>
                  </View>
                ) : null}
              </View>
              <ChevronRight color={ui.muted} size={22} />
            </Card>
          </PressScale>

          {/* Family plan */}
          <PressScale testID="open-pricing" onPress={() => router.push('/pricing')} style={{ marginTop: 14 }}>
            <Card style={styles.planCard}>
              <View style={styles.planCol}>
                <Text style={styles.planTitle}>{user?.is_admin ? t('set_admin_tester') : `${planLabel} ${t('set_plan')}`}</Text>
                <Text style={styles.planSub}>{memberLimit ? `${memberSlotsUsed}/${memberLimit} ${t('set_slots')}` : t('set_tap_view_plans')}</Text>
              </View>
              <View style={styles.planDivider} />
              <View style={styles.planCol}>
                <Text style={styles.planTitle}>{memberSlotsUsed} member{memberSlotsUsed === 1 ? '' : 's'}</Text>
                <Text style={styles.planSub}>{adultCount} adult{adultCount === 1 ? '' : 's'}, {childMembers.length} kid{childMembers.length === 1 ? '' : 's'}</Text>
              </View>
              <ChevronRight color={ui.muted} size={20} />
            </Card>
          </PressScale>

          {/* Everyone visits Settings, so this is where the free-preview state
              must be unmissable: while billing is off, say plainly that Premium
              is free for now and what it will cost — so it's never a surprise
              takeaway. Renders nothing once billing is live. */}
          <View style={{ marginTop: 12 }}>
            <PremiumPreviewBanner />
          </View>

          {/* Search across every setting — the escape hatch that makes
              grouping safe: nothing being one tap deeper matters when it is
              also one search away. */}
          <View style={[styles.searchWrap, styles.sectionGap]}>
            <SearchIcon color={ui.muted} size={18} />
            <TextInput
              testID="settings-search"
              value={settingsQuery}
              onChangeText={setSettingsQuery}
              placeholder={t('set_search')}
              placeholderTextColor={ui.muted}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {settingsQuery.length > 0 ? (
              <PressScale accessibilityRole="button" accessibilityLabel={t('cancel')} onPress={() => setSettingsQuery('')} hitSlop={10}>
                <X color={ui.muted} size={16} />
              </PressScale>
            ) : null}
          </View>

          {/* Notifications */}
          {groupVisible(GK.notifications) ? (<>
          {groupHead('notifications',
            <IconTile bg={ui.orangeSoft}><Bell color={ui.orange} size={18} /></IconTile>,
            t('set_notifications'),
            `${t('set_push_notifications')}: ${notificationPrefs.card_reminders ? t('set_on') : t('set_off')}`,
            GK.notifications)}
          {groupOpen('notifications', GK.notifications) ? (<>
          <Card style={styles.cardPad}>
            <ToggleRow
              testID="notif-push"
              tile={<IconTile bg={ui.orangeSoft}><Bell color={ui.orange} size={18} /></IconTile>}
              title={t('set_push_notifications')}
              subtitle={t('set_push_notifications_sub')}
              on={notificationPrefs.card_reminders}
              disabled={savingNotifications}
              onPress={() => updateNotificationPrefs({ card_reminders: !notificationPrefs.card_reminders })}
            />
            <ToggleRow
              testID="notif-sign"
              tile={<IconTile bg={ui.lavender}><PenLine color={ui.lavenderText} size={18} /></IconTile>}
              title={t('set_sign_slip_alerts')}
              subtitle={t('set_sign_slip_alerts_sub')}
              on={notificationPrefs.new_card_alerts}
              disabled={savingNotifications}
              onPress={() => updateNotificationPrefs({ new_card_alerts: !notificationPrefs.new_card_alerts })}
            />
            <ToggleRow
              testID="notif-digest"
              tile={<IconTile bg={ui.soft}><Mail color={ui.muted} size={18} /></IconTile>}
              title={t('set_weekly_digest')}
              subtitle={weeklyBrief ? t('set_weekly_digest_sub') : t('set_upgrade_to_unlock')}
              on={weeklyBrief}
              onPress={() => router.push('/pricing')}
              divider={false}
            />
          </Card>
          {notificationStatus ? <Text style={styles.note}>{notificationStatus}</Text> : null}
          </>) : null}
          </>) : null}

          {/* Appearance */}
          {groupVisible(GK.appearance) ? (<>
          {groupHead('appearance',
            <IconTile bg={ui.lavender}><Sparkles color={ui.lavenderText} size={18} /></IconTile>,
            t('set_appearance'),
            t('set_appearance_' + appearanceMode),
            GK.appearance)}
          {groupOpen('appearance', GK.appearance) ? (
          <Card style={styles.segmentCard}>
            <View style={styles.segmentWrap}>
              {(['light', 'dark', 'system'] as const).map((mode) => {
                const active = appearanceMode === mode;
                return (
                  <PressScale key={mode} testID={`appearance-${mode}`} onPress={() => setAppearance(mode)} style={[styles.segmentBtn, active && { borderBottomColor: ui.orange }]}>
                    <Text style={[styles.segmentText, { color: active ? ui.text : ui.muted, fontFamily: active ? 'Inter_800ExtraBold' : 'Inter_600SemiBold' }]}>
                      {t('set_appearance_' + mode)}
                    </Text>
                  </PressScale>
                );
              })}
            </View>
          </Card>
          ) : null}
          </>) : null}

          {/* Household — members, children, invites and shared expenses */}
          {groupVisible(GK.household) ? (<>
          {groupHead('household',
            <IconTile bg={ui.orangeSoft}><Users color={ui.orange} size={18} /></IconTile>,
            t('set_household'),
            isCoParented ? `${t('set_co_parents')}: ${coParents.map((m) => m.name).join(' & ')}` : `${memberSlotsUsed} ${t('set_slots')}`,
            GK.household)}
          {groupOpen('household', GK.household) ? (<>
          <Card style={styles.cardPad}>
            <NavRow
              testID="settings-household-toggle"
              tile={<IconTile bg={ui.orangeSoft}><Users color={ui.orange} size={18} /></IconTile>}
              title={t('set_manage_members')}
              subtitle={isCoParented ? `${t('set_co_parents')}: ${coParents.map((m) => m.name).join(' & ')}` : undefined}
              right={<Chevron open={expandMembers} />}
              onPress={() => setExpandMembers((v) => !v)}
            />
            {expandMembers ? (
              <View style={styles.expandBox}>
                {members.length === 0 ? <Text style={styles.emptyText}>{t('set_no_members_yet')}</Text> : members.map((m) => (
                  <View key={m.member_id} style={styles.inviteRow}>
                    <MiniRow
                      initial={m.name[0]?.toUpperCase()}
                      name={m.name}
                      sub={
                        isCoParented && coParents.some((p) => p.member_id === m.member_id)
                          ? `${t('set_co_parent')} · ${t('set_account')}`
                          : m.has_account ? `${m.role} · ${t('set_account')}` : m.role
                      }
                    />
                    {(!m.has_account || (m.has_account && !m.is_me && !m.is_founder)) ? (
                      <PressScale
                        testID={`remove-member-${m.member_id}`}
                        onPress={() => removeMember(m)}
                        hitSlop={12} style={{ padding: 4 }}
                        accessibilityLabel={`${t('set_remove')} ${m.name}`}
                      >
                        <Trash2 color={ui.muted} size={15} />
                      </PressScale>
                    ) : null}
                  </View>
                ))}
                {invites.filter((i) => i.status === 'pending').map((invite) => (
                  <View key={invite.invite_id} style={styles.inviteRow}>
                    <MiniRow
                      initial={((invite.email || invite.label)?.[0] || '?').toUpperCase()}
                      name={invite.email || invite.label || t('set_invite_link')}
                      sub={`${invite.relationship ? `${invite.relationship} · ` : ''}${t('set_invite')} · ${invite.status}`}
                    />
                    {invite.email ? (
                      <PressScale
                        testID={`complete-invite-${invite.invite_id}`}
                        onPress={() => completeInvite(invite)}
                        style={[styles.ghostBtn, { backgroundColor: ui.orangeSoft }]}
                      >
                        <UserPlus color={ui.orange} size={14} />
                        <Text style={[styles.ghostBtnText, { color: ui.orangeText }]}>{t('set_invite_add_now')}</Text>
                      </PressScale>
                    ) : null}
                    {invite.invite_url ? (
                      <PressScale
                        onPress={async () => {
                          if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                            try {
                              await navigator.clipboard.writeText(invite.invite_url!);
                              showToast(t('set_link_copied'), 'success');
                              return;
                            } catch { /* fall through to share */ }
                          }
                          await shareInviteLink(invite.invite_url, invite.email);
                        }}
                        style={styles.ghostBtn}
                      >
                        <Share2 color={ui.text} size={14} />
                        <Text style={styles.ghostBtnText}>{Platform.OS === 'web' ? t('set_copy') : t('set_share')}</Text>
                      </PressScale>
                    ) : null}
                    <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} testID={`revoke-invite-${invite.invite_id}`} onPress={() => revokeInvite(invite)} style={styles.iconGhostBtn}>
                      <Trash2 color={ui.danger} size={16} />
                    </PressScale>
                  </View>
                ))}
                <PressScale testID="invite-coparent" onPress={tryInviteCoparent} style={styles.expandAction}>
                  <UserPlus color={ui.text} size={18} />
                  <Text style={styles.expandActionText}>{t('set_invite_coparent')}</Text>
                </PressScale>
              </View>
            ) : null}
            <Divider />

            <NavRow
              tile={<IconTile bg={ui.lavender}><Lock color={ui.lavenderText} size={18} /></IconTile>}
              title={t('set_manage_children')}
              subtitle={`${childMembers.length} child${childMembers.length === 1 ? '' : 'ren'} · ${t('set_kid_pins')}`}
              right={<Chevron open={expandChildren} />}
              onPress={() => setExpandChildren((v) => !v)}
            />
            {expandChildren ? (
              <View style={styles.expandBox}>
                {childMembers.length === 0 ? <Text style={styles.emptyText}>{t('set_no_children')}</Text> : childMembers.map((m) => (
                  <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_lock')} key={m.member_id} testID={`set-pin-${m.member_id}`} onPress={() => setPinMember(m)} style={styles.inviteRow}>
                    <MiniRow initial={m.name[0]?.toUpperCase()} name={m.name} sub={m.has_pin ? t('set_pin_set') : t('set_no_pin')} />
                    {m.has_pin ? <Lock color={ui.orange} size={16} /> : <ChevronRight color={ui.muted} size={18} />}
                  </PressScale>
                ))}
              </View>
            ) : null}
            <Divider />

            <NavRow
              tile={<IconTile bg={ui.mint}><Link2 color={ui.mintText} size={18} /></IconTile>}
              title={t('set_invite_family_member')}
              subtitle={t('set_invite_family_member_sub')}
              onPress={() => openInvite('', 'family')}
              right={<ChevronRight color={ui.muted} size={18} />}
              divider={false}
            />
          </Card>

          {/* Shared expenses — folded into the Household group */}
          <Card style={[styles.cardPad, styles.subCardGap]}>
            <NavRow
              testID="settings-expenses-toggle"
              tile={<IconTile bg={ui.gold}><DollarSign color={ui.goldText} size={18} /></IconTile>}
              title={t('set_household_expenses')}
              subtitle={expenseSummary ? `${t('currency_symbol')}${expenseSummary.total.toFixed(0)} ${t('set_last_n_days', { n: expenseSummary.days })}` : t('set_track_shared_costs')}
              right={<Chevron open={expandExpenses} />}
              onPress={() => setExpandExpenses((v) => !v)}
              divider={false}
            />
            {expandExpenses ? (
              <View style={styles.expandBox}>
                {expenseSummary && Object.keys(expenseSummary.by_person).length > 0 ? (
                  <View style={styles.expSummary}>
                    {Object.entries(expenseSummary.by_person).map(([name, amount]) => (
                      <View key={name} style={styles.expSumRow}>
                        <Text style={styles.expSumName}>{name}</Text>
                        <Text style={styles.expSumAmt}>${amount.toFixed(2)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {expenses.slice(0, 8).map((exp) => (
                  <View key={exp.expense_id} style={styles.inviteRow}>
                    <MiniRow
                      initial="$"
                      name={exp.description}
                      sub={`${t('currency_symbol')}${exp.amount.toFixed(2)} · ${exp.category} · ${exp.paid_by_name}`}
                    />
                    <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} onPress={() => removeExpense(exp.expense_id)} hitSlop={12} style={{ padding: 4 }}>
                      <Trash2 color={ui.muted} size={15} />
                    </PressScale>
                  </View>
                ))}
                {expenses.length === 0 ? <Text style={styles.emptyText}>{t('set_no_expenses')}</Text> : null}
                <PressScale
                  testID="add-expense"
                  onPress={() => {
                    setExpDesc('');
                    setExpAmount('');
                    setExpCategory('Groceries');
                    setShowExpenseAdd(true);
                  }}
                  style={styles.expandAction}
                >
                  <Receipt color={ui.text} size={18} />
                  <Text style={styles.expandActionText}>{t('set_add_expense')}</Text>
                </PressScale>
              </View>
            ) : null}
          </Card>

          </>) : null}
          </>) : null}

          {/* Preferences — language */}
          {groupVisible(GK.preferences) ? (<>
          {groupHead('preferences',
            <IconTile bg={ui.soft}><Globe color={ui.text} size={18} /></IconTile>,
            t('set_preferences'),
            LANG_NAMES[lang],
            GK.preferences)}
          {groupOpen('preferences', GK.preferences) ? (
          <Card style={styles.cardPad}>
            <NavRow
              testID="settings-lang"
              tile={<IconTile bg={ui.soft}><Globe color={ui.text} size={18} /></IconTile>}
              title={t('language')}
              right={<View style={styles.valueRow}><Text style={styles.valueText}>{LANG_NAMES[lang]}</Text><ChevronRight color={ui.muted} size={18} /></View>}
              onPress={() => setShowLang(true)}
              divider={false}
            />
          </Card>

          ) : null}
          </>) : null}

          {/* More — history, plans, usage, updates */}
          {groupVisible(GK.more) ? (<>
          {groupHead('more',
            <IconTile bg={ui.soft}><BarChart3 color={ui.text} size={18} /></IconTile>,
            t('set_more'),
            versionLabel,
            GK.more)}
          {groupOpen('more', GK.more) ? (<>
          <Card style={styles.cardPad}>
            <NavRow
              testID="settings-replay-setup"
              tile={<IconTile bg={ui.orangeSoft}><Sparkles color={ui.orange} size={18} /></IconTile>}
              title={t('set_replay_setup')}
              subtitle={t('set_replay_setup_sub')}
              right={<ChevronRight color={ui.muted} size={18} />}
              onPress={() => router.push('/onboarding')}
            />
            <NavRow
              testID="settings-completed-history-toggle"
              tile={<IconTile bg={ui.soft}><CalendarDays color={ui.text} size={18} /></IconTile>}
              title={t('set_completed_history')}
              subtitle={`${completedCards.length} ${completedCards.length === 1 ? t('set_completed_card') : t('set_completed_cards')}`}
              right={<Chevron open={expandHistory} />}
              onPress={() => setExpandHistory((v) => !v)}
            />
            {expandHistory ? (
              <View style={styles.expandBox}>
                {completedCards.length === 0 ? <Text style={styles.emptyText}>{t('set_no_completed_cards')}</Text> : completedCards.slice(0, 8).map((card) => (
                  <View key={card.card_id} style={styles.inviteRow}>
                    <MiniRow initial={card.type === 'TASK' ? 'T' : card.type === 'RSVP' ? 'R' : 'S'} name={card.title} sub={`${t('set_done')} · ${card.assignee || t('set_family')}`} />
                    <View style={styles.historyBtnRow}>
                      <PressScale
                        testID={`restore-card-${card.card_id}`}
                        onPress={() => {
                          Alert.alert(t('set_restore_card_title'), `"${card.title}" ${t('set_restore_card_msg')}`, [
                            { text: t('cancel'), style: 'cancel' },
                            {
                              text: t('set_restore'),
                              onPress: async () => {
                                try {
                                  await api.updateCard(card.card_id, { status: 'OPEN' });
                                  setCompletedCards((prev) => prev.filter((c) => c.card_id !== card.card_id));
                                } catch {
                                  Alert.alert(t('set_error'), t('set_restore_error'));
                                }
                              },
                            },
                          ]);
                        }}
                        style={styles.ghostBtn}
                      >
                        <RotateCcw color={ui.text} size={14} />
                        <Text style={styles.ghostBtnText}>{t('set_restore')}</Text>
                      </PressScale>
                      {/* Permanent removal — the card AND its "done" line in the
                          feed go. Restore un-completes; this erases. */}
                      <PressScale
                        testID={`delete-card-${card.card_id}`}
                        accessibilityRole="button"
                        accessibilityLabel={t('set_delete')}
                        onPress={() => {
                          Alert.alert(t('set_delete_card_title'), `"${card.title}" ${t('set_delete_card_msg')}`, [
                            { text: t('cancel'), style: 'cancel' },
                            {
                              text: t('set_delete'),
                              style: 'destructive',
                              onPress: async () => {
                                setCompletedCards((prev) => prev.filter((c) => c.card_id !== card.card_id));
                                try {
                                  await api.deleteCard(card.card_id);
                                } catch {
                                  Alert.alert(t('set_error'), t('set_delete_error'));
                                  setCompletedCards(await api.listCards('DONE').catch(() => []));
                                }
                              },
                            },
                          ]);
                        }}
                        hitSlop={8}
                        style={styles.historyDeleteBtn}
                      >
                        <Trash2 color={ui.danger} size={15} />
                      </PressScale>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
            <Divider />

            <NavRow
              testID="settings-view-plans"
              tile={<IconTile bg={ui.orangeSoft}><Crown color={ui.orange} size={18} /></IconTile>}
              title={t('set_view_all_plans')}
              subtitle={`${t('set_youre_on')} ${user?.is_admin ? t('set_admin_tester') : `${planLabel}`} · ${t('set_compare_tiers')}`}
              onPress={() => router.push('/pricing')}
            />

            <NavRow
              testID="settings-rate-app"
              tile={<IconTile bg={ui.mint}><Star color={ui.mintText} size={18} /></IconTile>}
              title={t('set_rate_app')}
              subtitle={t('set_rate_app_sub')}
              onPress={() => { openReview().catch(() => undefined); }}
            />

            {user?.is_admin ? (
              <NavRow
                testID="settings-metrics"
                tile={<IconTile bg={ui.mint}><BarChart3 color={ui.mintText} size={18} /></IconTile>}
                title="Usage analytics"
                subtitle="Active users & feature usage (admin)"
                onPress={() => router.push('/metrics')}
              />
            ) : null}

            {user?.is_admin ? (
              <>
                <NavRow
                  testID="settings-client-errors"
                  tile={<IconTile bg={ui.orangeSoft}><RotateCcw color={ui.orange} size={18} /></IconTile>}
                  title="Device errors"
                  subtitle="Failed requests from family devices (admin)"
                  right={<Chevron open={expandClientErrors} />}
                  onPress={() => {
                    setExpandClientErrors((v) => !v);
                    if (!expandClientErrors) {
                      api.listClientErrors().then(setClientErrors).catch(() => setClientErrors([]));
                    }
                  }}
                />
                {expandClientErrors ? (
                  <View style={styles.expandBox}>
                    {clientErrors.length === 0 ? (
                      <Text style={styles.emptyText}>No device errors recorded.</Text>
                    ) : clientErrors.map((e) => (
                      <View key={e.error_id} style={{ paddingVertical: 6 }}>
                        <Text style={styles.ghostBtnText}>
                          {`${e.name || '?'} · ${e.platform || '?'} · ${e.method || ''} ${e.endpoint}${e.status ? ` · ${e.status}` : ''}`}
                        </Text>
                        <Text style={[styles.emptyText, { marginTop: 2 }]} numberOfLines={2}>
                          {`${(e.created_at || '').replace('T', ' ').slice(0, 16)} — ${e.message || ''}`}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}

            <NavRow
              tile={<IconTile bg={ui.soft}><Sparkles color={ui.text} size={18} /></IconTile>}
              title={t('set_plan_usage')}
              subtitle={t('set_plan_usage_sub')}
              right={<Chevron open={expandUsage} />}
              onPress={() => setExpandUsage((v) => !v)}
              divider={false}
            />
            {expandUsage ? (
              <View style={styles.statGrid}>
                <StatBox label={t('set_stat_members')} value={`${memberSlotsUsed}/${memberLimit || '∞'}`} />
                <StatBox label={t('set_stat_ai_scans')} value={entitlements ? `${entitlements.ai_scans_used}/${entitlements.ai_scans_limit}` : `${subscription?.ai_scans_used ?? 0}/${subscription?.limits?.ai_scans_per_month ?? '∞'}`} />
                <StatBox label={t('set_stat_vault')} value={formatBytes(entitlements?.vault_bytes_used ?? subscription?.vault_bytes_used)} />
                <StatBox label={t('set_stat_weekly_brief')} value={weeklyBrief ? t('set_on') : t('set_locked')} />
                <View style={styles.testRow}>
                  <PressScale onPress={testReminderNotification} style={styles.ghostBtnWide}><Text style={styles.ghostBtnText}>{t('set_test_reminder')}</Text></PressScale>
                  <PressScale onPress={testNewCardAlert} style={styles.ghostBtnWide}><Text style={styles.ghostBtnText}>{t('set_test_alert')}</Text></PressScale>
                </View>
              </View>
            ) : null}
          </Card>

          {/* App version + a way to pull the latest one in by hand.
              Updates arrive over the air and apply on the NEXT launch, which
              from the outside is indistinguishable from nothing happening —
              there was no way to see which version you were on or to ask for
              a newer one, so "is my app up to date?" had no answer. This gives
              both: the version you are running, and a button that fetches and
              restarts into the newest build on the spot. */}
          <Card>
            <View style={styles.updateRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.updateTitle}>{t('set_app_version')}</Text>
                <Text style={styles.updateVersion} numberOfLines={2}>{versionLabel}</Text>
              </View>
              <PressScale
                testID="check-updates"
                accessibilityRole="button"
                onPress={checkForUpdates}
                disabled={updateState === 'checking' || updateState === 'downloading'}
                style={styles.updateBtn}
              >
                {updateState === 'checking' || updateState === 'downloading' ? (
                  <ActivityIndicator color={ui.orangeText} size="small" />
                ) : (
                  <Text style={styles.updateBtnText}>{t('set_check_updates')}</Text>
                )}
              </PressScale>
            </View>
            {updateNote ? <Text style={styles.updateNote}>{updateNote}</Text> : null}
          </Card>

          </>) : null}
          </>) : null}

          {/* Logout */}
          <PressScale testID="logout" onPress={doLogout} style={styles.logoutBtn}>
            <LogOut color={ui.danger} size={20} />
            <Text style={styles.logoutText}>{t('log_out')}</Text>
          </PressScale>

          <View style={{ height: 70 }} />
      </TabScreen>

      <LanguageModal visible={showLang} onClose={() => setShowLang(false)} />
      <PinPadModal
        visible={pinMember !== null}
        mode="set"
        title={pinMember ? `${t('set_pin_for')} ${pinMember.name}` : t('set_set_pin')}
        subtitle={t('set_pin_subtitle')}
        onClose={() => setPinMember(null)}
        onSubmit={async (pin) => {
          if (!pinMember) return false;
          try {
            await api.setMemberPin(pinMember.member_id, pin);
            setPinMember(null);
            load();
            return true;
          } catch {
            return false;
          }
        }}
      />

      <KeyboardAwareBottomSheet visible={showInvite} onClose={() => setShowInvite(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{inviteMode === 'family' ? t('set_send_invite_title') : t('set_invite_coparent')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-invite" onPress={() => setShowInvite(false)} style={styles.iconBtn}>
            <X color={ui.text} size={22} />
          </PressScale>
        </View>
        <Text style={styles.sheetHelp}>{t('set_invite_help')}</Text>

        {/* Method selector: Email · Phone · Link — three distinct paths. */}
        <View style={styles.inviteMethodRow}>
          {([
            { key: 'email', icon: Mail, label: t('set_invite_via_email') },
            { key: 'phone', icon: MessageSquare, label: t('set_invite_via_phone') },
            { key: 'link', icon: Link2, label: t('set_invite_via_link') },
          ] as const).map((m) => {
            const active = inviteMethod === m.key;
            const Icon = m.icon;
            return (
              <PressScale
                key={m.key}
                testID={`invite-method-${m.key}`}
                onPress={() => { setInviteMethod(m.key); setInviteResult(null); setInviteError(false); setLastInviteUrl(null); }}
                style={[styles.inviteMethodBtn, active && styles.inviteMethodBtnActive]}
              >
                <Icon color={active ? ui.bg : ui.muted} size={18} />
                <Text style={[styles.inviteMethodLabel, { color: active ? ui.bg : ui.muted }]}>{m.label}</Text>
              </PressScale>
            );
          })}
        </View>

        {inviteMethod === 'email' ? (
          <>
            <TextInput
              testID="invite-email"
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder={t('set_email_placeholder')}
              placeholderTextColor={ui.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
              returnKeyType="send"
              onSubmitEditing={sendEmailInvite}
            />
            <Text style={styles.inviteHint}>{t('set_invite_email_hint')}</Text>
          </>
        ) : inviteMethod === 'phone' ? (
          <>
            <TextInput
              testID="invite-phone"
              value={invitePhone}
              onChangeText={setInvitePhone}
              placeholder={t('set_phone_placeholder')}
              placeholderTextColor={ui.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="phone-pad"
              style={styles.input}
              returnKeyType="send"
              onSubmitEditing={sendPhoneInvite}
            />
            <Text style={styles.inviteHint}>{t('set_invite_phone_hint')}</Text>
          </>
        ) : (
          <>
            <TextInput
              testID="invite-label"
              value={inviteLabel}
              onChangeText={setInviteLabel}
              placeholder={t('set_invite_link_for_ph')}
              placeholderTextColor={ui.muted}
              autoCapitalize="words"
              autoCorrect={false}
              style={styles.input}
              maxLength={48}
            />
            <Text style={styles.inviteHint}>{t('set_invite_link_hint')}</Text>
          </>
        )}

        {inviteMode === 'family' ? (
          <>
            <TextInput
              testID="invite-role"
              value={inviteRole}
              onChangeText={setInviteRole}
              placeholder={t('set_invite_role_ph')}
              placeholderTextColor={ui.muted}
              autoCapitalize="words"
              autoCorrect={false}
              style={styles.input}
              returnKeyType={inviteMethod === 'email' ? 'send' : 'done'}
              onSubmitEditing={inviteMethod === 'email' ? sendEmailInvite : undefined}
              maxLength={32}
            />
            <Text style={styles.inviteHint}>{t('set_invite_role_hint')}</Text>
          </>
        ) : null}

        {inviteResult ? (
          <Text style={[styles.note, inviteError && { color: ui.danger }]}>{inviteResult}</Text>
        ) : null}
        {inviteError && lastInviteUrl ? (
          <PressScale testID="invite-share-fallback" onPress={() => shareInviteLink(lastInviteUrl, null)} style={styles.expandAction}>
            <Share2 color={ui.text} size={18} />
            <Text style={styles.expandActionText}>{t('set_share_invite_link')}</Text>
          </PressScale>
        ) : null}

        <View style={styles.sheetFooter}>
          <PressScale onPress={() => setShowInvite(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>
          <PressScale
            testID="send-invite"
            onPress={inviteMethod === 'email' ? sendEmailInvite : inviteMethod === 'phone' ? sendPhoneInvite : shareNewLink}
            disabled={sending || (inviteMethod === 'email' && !inviteEmail.trim()) || (inviteMethod === 'phone' && !invitePhone.trim())}
            style={[styles.primaryButton, (sending || (inviteMethod === 'email' && !inviteEmail.trim()) || (inviteMethod === 'phone' && !invitePhone.trim())) && { opacity: 0.5 }]}
          >
            {inviteMethod === 'link' ? <Share2 color="#FFFFFF" size={18} /> : <Send color="#FFFFFF" size={18} />}
            <Text style={styles.primaryButtonText}>
              {sending ? t('set_sending') : inviteMethod === 'email' ? t('set_send_invite') : inviteMethod === 'phone' ? t('set_invite_send_text') : t('set_invite_share_link_cta')}
            </Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showExpenseAdd} onClose={() => setShowExpenseAdd(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{t('set_add_expense_title')}</Text>
          <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} testID="close-expense" onPress={() => setShowExpenseAdd(false)} style={styles.iconBtn}>
            <X color={ui.text} size={22} />
          </PressScale>
        </View>
        <Text style={styles.sheetHelp}>{t('set_expense_help')}</Text>
        <TextInput
          testID="expense-desc"
          value={expDesc}
          onChangeText={setExpDesc}
          placeholder={t('set_expense_desc_placeholder')}
          placeholderTextColor={ui.muted}
          style={styles.input}
          returnKeyType="next"
        />
        <TextInput
          testID="expense-amount"
          value={expAmount}
          onChangeText={setExpAmount}
          placeholder={t('set_expense_amount_placeholder')}
          placeholderTextColor={ui.muted}
          keyboardType="decimal-pad"
          style={[styles.input, { marginTop: 10 }]}
          returnKeyType="done"
        />
        <View style={styles.expCatRow}>
          {EXPENSE_CATS.map((cat) => (
            <PressScale key={cat} onPress={() => setExpCategory(cat)} style={[styles.expCatChip, expCategory === cat && styles.expCatChipActive]}>
              <Text style={[styles.expCatChipText, expCategory === cat && styles.expCatChipTextActive]}>{cat}</Text>
            </PressScale>
          ))}
        </View>
        <View style={styles.sheetFooter}>
          <PressScale onPress={() => setShowExpenseAdd(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>
          <PressScale
            testID="save-expense"
            onPress={addExpense}
            disabled={savingExpense || !expDesc.trim() || !expAmount.trim()}
            style={[styles.primaryButton, (savingExpense || !expDesc.trim() || !expAmount.trim()) && { opacity: 0.5 }]}
          >
            <DollarSign color="#FFFFFF" size={18} />
            <Text style={styles.primaryButtonText}>{savingExpense ? t('set_saving') : t('set_add_expense')}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>
      <AppToast visible={Boolean(toast)} message={toast?.message || null} tone={toast?.tone || 'info'} />
    </SwipeableTabView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 60 },
  headerGap: { marginTop: 18 },

  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  avatar: { width: 52, height: 52, borderRadius: 99, backgroundColor: ui.orangeDeep, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 52, height: 52, borderRadius: 99 },
  avatarText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 21 },
  profileName: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 18 },
  profileEmail: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 2 },
  adminBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, alignSelf: 'flex-start', backgroundColor: ui.orangeSoft, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99 },
  adminBadgeText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 11 },

  planCard: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 14 },
  planCol: { flex: 1 },
  planTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 16 },
  planSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  planDivider: { width: 1, height: 38, backgroundColor: ui.line },

  sectionGap: { marginTop: 22, marginBottom: 10 },
  cardPad: { paddingHorizontal: 16 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: ui.soft,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  searchInput: {
    flex: 1,
    color: ui.text,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    padding: 0,
  },
  groupHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: ui.card,
    borderWidth: 1,
    borderColor: ui.line,
  },
  groupTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 16 },
  groupSubtitle: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 1 },
  subCardGap: { marginTop: 8 },
  segmentCard: { paddingHorizontal: 18, paddingTop: 6 },

  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  valueText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  segmentWrap: { flexDirection: 'row', alignItems: 'center', gap: 26, borderBottomWidth: 1, borderBottomColor: ui.line },
  segmentBtn: { paddingTop: 8, paddingBottom: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  segmentText: { fontSize: 15 },

  expandBox: { paddingBottom: 10, gap: 2 },
  expandAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 10, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  expandActionText: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 8 },
  historyBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyDeleteBtn: { padding: 8, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  iconGhostBtn: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, borderRadius: 99, width: 34, height: 34, marginLeft: 8 },
  ghostBtnWide: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, borderRadius: 12, paddingVertical: 11 },
  ghostBtnText: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },

  note: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, marginTop: 10 },
  emptyText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 19, paddingVertical: 8 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 4, paddingBottom: 10 },
  testRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 2 },

  updateRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  updateTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  updateVersion: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 3 },
  updateBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: ui.orange, minWidth: 104, alignItems: 'center' },
  updateBtnText: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  updateNote: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  logoutBtn: { marginTop: 26, minHeight: 54, borderRadius: 99, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: ui.dangerSoft },
  logoutText: { color: ui.danger, fontFamily: 'Inter_800ExtraBold', fontSize: 16 },

  sheet: { backgroundColor: ui.card, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, borderColor: ui.line, padding: 24, paddingBottom: 120 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 24 },
  iconBtn: { width: 42, height: 42, borderRadius: 9999, borderWidth: 1, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },
  sheetHelp: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, marginBottom: 18 },
  input: { borderWidth: 1, borderColor: ui.line, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, fontFamily: 'Inter_500Medium', fontSize: 16, color: ui.text, backgroundColor: ui.soft },
  inviteMethodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  inviteMethodBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 14, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  inviteMethodBtnActive: { backgroundColor: ui.text, borderColor: ui.text },
  inviteMethodLabel: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  inviteHint: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, marginTop: 10 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 18 },
  cancelBtn: { flex: 1, minHeight: 54, borderRadius: 99, borderWidth: 1, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: ui.muted, fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  primaryButton: { flex: 1, minHeight: 54, borderRadius: 99, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, backgroundColor: ui.orangeDeep },
  primaryButtonText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },

  expSummary: { borderRadius: 14, backgroundColor: ui.soft, padding: 12, gap: 6, marginBottom: 6 },
  expSumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expSumName: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  expSumAmt: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  expCatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  expCatChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  expCatChipActive: { backgroundColor: ui.gold, borderColor: ui.goldText },
  expCatChipText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13 },
  expCatChipTextActive: { color: ui.goldText },
});
