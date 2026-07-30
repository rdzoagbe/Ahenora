import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Linking, Platform, Share, StyleSheet, Text, TextInput, View } from 'react-native';
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
  Send,
  Share2,
  Sparkles,
  Trash2,
  Users,
  UserPlus,
  X,
} from 'lucide-react-native';

import AppToast, { ToastTone } from '../../src/components/AppToast';
import { SwipeableTabView } from '../../src/components/SwipeableTabView';
import { PressScale } from '../../src/components/PressScale';
import { LanguageModal } from '../../src/components/LanguageModal';
import { PinPadModal } from '../../src/components/PinPadModal';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import { TabScreen } from '../../src/components/TabScreen';
import { Card, Chevron, Divider, IconTile, MiniRow, NavRow, ScreenHeader, SectionTitle, StatBox, ToggleRow, useUI, UIColors } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { api, Card as CardType, Entitlements, Expense, ExpenseSummary, FamilyInvite, FamilyMember, NotificationSettings } from '../../src/api';
import { LANG_NAMES } from '../../src/i18n';
import { ensureNotificationPermissions, registerForPushNotificationsAsync, sendLocalNotification, sendTestScheduledReminderNotification, syncCardReminderNotifications } from '../../src/notifications';
import { logger } from '../../src/logger';

function formatBytes(bytes?: number | null) {
  const value = bytes || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export default function Settings() {
  const { user, t, lang, logout, subscription, appearanceMode, setAppearance } = useStore();
  const router = useRouter();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [invites, setInvites] = useState<FamilyInvite[]>([]);
  const [showLang, setShowLang] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2600);
  }, []);
  const [inviteMethod, setInviteMethod] = useState<'email' | 'phone' | 'link'>('email');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePhone, setInvitePhone] = useState('');
  const [sending, setSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState(false);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [pinMember, setPinMember] = useState<FamilyMember | null>(null);
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
  const planLabel = subscription?.plan === 'family_office' ? 'Family Office' : subscription?.plan === 'executive' ? 'Executive Family' : 'Village';
  const weeklyBrief = Boolean(entitlements?.weekly_brief || subscription?.limits?.weekly_brief);
  const initial = (user?.name?.[0] || 'C').toUpperCase();

  const removeMember = useCallback((member: FamilyMember) => {
    Alert.alert(
      `${t('set_remove')} ${member.name}?`,
      t('set_remove_member_msg'),
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
        if (expoPushToken) await api.registerNotificationToken(expoPushToken, Platform.OS);
        else if (pushError) warning = String(pushError);
      }

      const saved = await api.updateNotificationSettings(nextPrefs).catch(() => nextPrefs as NotificationSettings);
      setNotificationPrefs(saved);

      if (nextPrefs.card_reminders) {
        const cards = await api.listCards();
        const result = await syncCardReminderNotifications(cards, true);
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

  const openInvite = (email = '') => {
    setInviteMethod('email');
    setInviteEmail(email);
    setInvitePhone('');
    setInviteResult(null);
    setInviteError(false);
    setLastInviteUrl(null);
    setShowInvite(true);
  };

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
      const res = await api.invite(submitted);
      if (res.sent) {
        // Success gets out of the way: close the sheet and confirm with a
        // toast. Leaving the form open with a note buried mid-sheet read as
        // "did it work?" and invited double-sends.
        setInviteResult(null);
        setInviteError(false);
        setInviteEmail('');
        setShowInvite(false);
        showToast(`${t('set_invite_email_sent')} ${submitted}.`);
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
  const sendPhoneInvite = useCallback(async () => {
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
      const res = await api.createInviteLink();
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
        showToast(t('set_invite_sms_opened'));
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
  }, [invitePhone, inviteMessage, shareInviteLink, load]);

  // Link: create a link and open the native share sheet.
  const shareNewLink = useCallback(async () => {
    setSending(true);
    setInviteResult(null);
    setInviteError(false);
    try {
      const res = await api.createInviteLink();
      setLastInviteUrl(res.invite_url);
      await shareInviteLink(res.invite_url, null);
      await load();
    } catch (error: any) {
      setInviteError(true);
      setInviteResult(error?.message || t('set_error'));
    } finally {
      setSending(false);
    }
  }, [shareInviteLink, load]);

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

          {/* Notifications */}
          <SectionTitle style={styles.sectionGap}>{t('set_notifications')}</SectionTitle>
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

          {/* Appearance */}
          <SectionTitle style={styles.sectionGap}>{t('set_appearance')}</SectionTitle>
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

          {/* Household */}
          <SectionTitle style={styles.sectionGap}>{t('set_household')}</SectionTitle>
          <Card style={styles.cardPad}>
            <NavRow
              testID="settings-household-toggle"
              tile={<IconTile bg={ui.orangeSoft}><Users color={ui.orange} size={18} /></IconTile>}
              title={t('set_manage_members')}
              right={<Chevron open={expandMembers} />}
              onPress={() => setExpandMembers((v) => !v)}
            />
            {expandMembers ? (
              <View style={styles.expandBox}>
                {members.length === 0 ? <Text style={styles.emptyText}>{t('set_no_members_yet')}</Text> : members.map((m) => (
                  <View key={m.member_id} style={styles.inviteRow}>
                    <MiniRow initial={m.name[0]?.toUpperCase()} name={m.name} sub={m.has_account ? `${m.role} · ${t('set_account')}` : m.role} />
                    {!m.has_account ? (
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
                    <MiniRow initial={(invite.email?.[0] || '?').toUpperCase()} name={invite.email || t('set_invite_link')} sub={`${t('set_invite')} · ${invite.status}`} />
                    {invite.invite_url ? (
                      <PressScale onPress={() => shareInviteLink(invite.invite_url, invite.email)} style={styles.ghostBtn}>
                        <Share2 color={ui.text} size={14} />
                        <Text style={styles.ghostBtnText}>{t('set_share')}</Text>
                      </PressScale>
                    ) : null}
                    <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('a11y_delete')} testID={`revoke-invite-${invite.invite_id}`} onPress={() => revokeInvite(invite)} style={styles.iconGhostBtn}>
                      <Trash2 color={ui.danger} size={16} />
                    </PressScale>
                  </View>
                ))}
                <PressScale testID="invite-coparent" onPress={() => openInvite()} style={styles.expandAction}>
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
              onPress={() => openInvite()}
              right={<ChevronRight color={ui.muted} size={18} />}
              divider={false}
            />
          </Card>

          {/* Expenses */}
          <SectionTitle style={styles.sectionGap}>{t('set_expense_splitting')}</SectionTitle>
          <Card style={styles.cardPad}>
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

          {/* Preferences */}
          <SectionTitle style={styles.sectionGap}>{t('set_preferences')}</SectionTitle>
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

          {/* More / advanced */}
          <SectionTitle style={styles.sectionGap}>{t('set_more')}</SectionTitle>
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

            {user?.is_admin ? (
              <NavRow
                testID="settings-metrics"
                tile={<IconTile bg={ui.mint}><BarChart3 color={ui.mintText} size={18} /></IconTile>}
                title="Usage analytics"
                subtitle="Active users & feature usage (admin)"
                onPress={() => router.push('/metrics')}
              />
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
          <Text style={styles.sheetTitle}>{t('set_invite_coparent')}</Text>
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
          <Text style={styles.inviteHint}>{t('set_invite_link_hint')}</Text>
        )}

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
  avatar: { width: 52, height: 52, borderRadius: 99, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 52, height: 52, borderRadius: 99 },
  avatarText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 21 },
  profileName: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 18 },
  profileEmail: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, marginTop: 2 },
  adminBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, alignSelf: 'flex-start', backgroundColor: ui.orangeSoft, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 99 },
  adminBadgeText: { color: ui.orange, fontFamily: 'Inter_800ExtraBold', fontSize: 11 },

  planCard: { flexDirection: 'row', alignItems: 'center', padding: 18, gap: 14 },
  planCol: { flex: 1 },
  planTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 16 },
  planSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  planDivider: { width: 1, height: 38, backgroundColor: ui.line },

  sectionGap: { marginTop: 22, marginBottom: 10 },
  cardPad: { paddingHorizontal: 16 },
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
  iconGhostBtn: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, borderRadius: 99, width: 34, height: 34, marginLeft: 8 },
  ghostBtnWide: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft, borderRadius: 12, paddingVertical: 11 },
  ghostBtnText: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 12.5 },

  note: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 19, marginTop: 10 },
  emptyText: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 19, paddingVertical: 8 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 4, paddingBottom: 10 },
  testRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 2 },

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
  primaryButton: { flex: 1, minHeight: 54, borderRadius: 99, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, backgroundColor: ui.orange },
  primaryButtonText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },

  expSummary: { borderRadius: 14, backgroundColor: ui.soft, padding: 12, gap: 6, marginBottom: 6 },
  expSumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expSumName: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14 },
  expSumAmt: { color: ui.orange, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },
  expCatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  expCatChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  expCatChipActive: { backgroundColor: ui.gold, borderColor: ui.goldText },
  expCatChipText: { color: ui.muted, fontFamily: 'Inter_700Bold', fontSize: 13 },
  expCatChipTextActive: { color: ui.goldText },
});
