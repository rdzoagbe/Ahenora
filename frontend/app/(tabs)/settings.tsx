import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Platform, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import {
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
  PenLine,
  Plus,
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
  const [inviteEmail, setInviteEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
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
      const [memberRows, inviteRows, notificationRows, entitlementRows, completedRows] = await Promise.all([
        api.familyMembers(),
        api.listInvites(),
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
      setMembers(memberRows);
      setInvites(inviteRows);
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
  const childMembers = useMemo(() => members.filter((m) => m.role === 'Child'), [members]);
  const adultCount = Math.max(1, members.filter((m) => m.role !== 'Child').length);
  const planLabel = subscription?.plan === 'family_office' ? 'Family Office' : subscription?.plan === 'executive' ? 'Executive Family' : 'Village';
  const weeklyBrief = Boolean(entitlements?.weekly_brief || subscription?.limits?.weekly_brief);
  const initial = (user?.name?.[0] || 'C').toUpperCase();

  const shareInviteLink = useCallback(async (inviteUrl?: string | null, email?: string | null) => {
    if (!inviteUrl) {
      setInviteResult(email ? 'Invite link is not available yet for ' + email + '.' : 'Invite link is not available yet.');
      return;
    }
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(inviteUrl);
        setInviteResult(email ? `Invite link copied for ${email}.` : 'Invite link copied.');
        return;
      }
      await Share.share({
        title: 'Join Household COO',
        message: `${user?.name || 'A family member'} invited you to join Household COO.\n\n${inviteUrl}`,
        url: inviteUrl,
      });
    } catch {
      setInviteResult(`Could not open share sheet. Share this link manually: ${inviteUrl}`);
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
          setNotificationStatus('Notification permission was not granted.');
          return;
        }
      }

      let warning = '';
      if (nextPrefs.new_card_alerts) {
        const push = await registerForPushNotificationsAsync().catch((e) => ({ granted: false, error: e?.message || 'Remote push registration failed.' }));
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
        setNotificationStatus(result.scheduled ? `${result.scheduled} reminder notification${result.scheduled === 1 ? '' : 's'} scheduled.` : warning || 'Reminder alerts are on.');
      } else {
        await syncCardReminderNotifications([], false).catch(() => undefined);
        setNotificationStatus(nextPrefs.new_card_alerts ? warning || 'New-card alerts are on.' : 'Notifications are off.');
      }
    } catch (error: any) {
      logger.warn('notification settings failed', error);
      setNotificationStatus(error?.message || 'Could not update notification settings.');
    } finally {
      setSavingNotifications(false);
    }
  }, [notificationPrefs]);

  const testReminderNotification = useCallback(async () => {
    const granted = await ensureNotificationPermissions();
    if (!granted) { setNotificationStatus('Notification permission was not granted.'); return; }
    await sendTestScheduledReminderNotification();
    setNotificationStatus('Test reminder scheduled. It should appear in about 5 seconds.');
  }, []);

  const testNewCardAlert = useCallback(async () => {
    const granted = await ensureNotificationPermissions();
    if (!granted) { setNotificationStatus('Notification permission was not granted.'); return; }
    await sendLocalNotification('New Household COO card', 'This is how a new-card alert will appear.');
    setNotificationStatus('Test new-card alert sent on this device.');
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
      Alert.alert('Error', 'Could not add expense.');
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
    setInviteEmail(email);
    setInviteResult(null);
    setLastInviteUrl(null);
    setShowInvite(true);
  };

  return (
    <SwipeableTabView style={styles.container}>
      <TabScreen
        tab="Settings"
        refreshing={refreshing}
        onRefresh={handleRefresh}
        scrollViewProps={{ contentContainerStyle: styles.scroll, keyboardShouldPersistTaps: 'handled' }}
      >
          <ScreenHeader eyebrow="Manage" title="Settings" />

          {/* Profile */}
          <PressScale testID="settings-open-account" onPress={() => router.push('/account')} style={styles.headerGap}>
            <Card style={styles.profileCard}>
              {user?.picture ? (
                <Image source={{ uri: user.picture }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.profileName} numberOfLines={1}>{user?.name || 'Household member'}</Text>
                <Text style={styles.profileEmail} numberOfLines={1}>{user?.email || 'Not signed in'}</Text>
                {user?.is_admin ? (
                  <View style={styles.adminBadge}>
                    <Crown color={ui.orange} size={13} />
                    <Text style={styles.adminBadgeText}>Admin / Tester</Text>
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
                <Text style={styles.planTitle}>{user?.is_admin ? 'Admin / Tester' : `${planLabel} Plan`}</Text>
                <Text style={styles.planSub}>{memberLimit ? `${memberSlotsUsed}/${memberLimit} slots` : 'Tap to view plans'}</Text>
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
          <SectionTitle style={styles.sectionGap}>Notifications</SectionTitle>
          <Card style={styles.cardPad}>
            <ToggleRow
              testID="notif-push"
              tile={<IconTile bg={ui.orangeSoft}><Bell color={ui.orange} size={18} /></IconTile>}
              title="Push notifications"
              subtitle="Reminders, deadlines & updates"
              on={notificationPrefs.card_reminders}
              disabled={savingNotifications}
              onPress={() => updateNotificationPrefs({ card_reminders: !notificationPrefs.card_reminders })}
            />
            <ToggleRow
              testID="notif-sign"
              tile={<IconTile bg={ui.lavender}><PenLine color={ui.lavenderText} size={18} /></IconTile>}
              title="Sign slip alerts"
              subtitle="When a form needs your signature"
              on={notificationPrefs.new_card_alerts}
              disabled={savingNotifications}
              onPress={() => updateNotificationPrefs({ new_card_alerts: !notificationPrefs.new_card_alerts })}
            />
            <ToggleRow
              testID="notif-digest"
              tile={<IconTile bg={ui.soft}><Mail color={ui.muted} size={18} /></IconTile>}
              title="Weekly digest email"
              subtitle={weeklyBrief ? 'Sunday evening summary' : 'Upgrade to unlock'}
              on={weeklyBrief}
              onPress={() => router.push('/pricing')}
              divider={false}
            />
          </Card>
          {notificationStatus ? <Text style={styles.note}>{notificationStatus}</Text> : null}

          {/* Appearance */}
          <SectionTitle style={styles.sectionGap}>Appearance</SectionTitle>
          <Card style={styles.segmentCard}>
            <View style={styles.segmentWrap}>
              {(['light', 'dark', 'system'] as const).map((mode) => {
                const active = appearanceMode === mode;
                return (
                  <PressScale key={mode} testID={`appearance-${mode}`} onPress={() => setAppearance(mode)} style={[styles.segmentBtn, active && { borderBottomColor: ui.orange }]}>
                    <Text style={[styles.segmentText, { color: active ? ui.text : ui.muted, fontFamily: active ? 'Inter_800ExtraBold' : 'Inter_600SemiBold' }]}>
                      {mode[0].toUpperCase() + mode.slice(1)}
                    </Text>
                  </PressScale>
                );
              })}
            </View>
          </Card>

          {/* Household */}
          <SectionTitle style={styles.sectionGap}>Household</SectionTitle>
          <Card style={styles.cardPad}>
            <NavRow
              testID="settings-household-toggle"
              tile={<IconTile bg={ui.orangeSoft}><Users color={ui.orange} size={18} /></IconTile>}
              title="Manage members"
              right={<Chevron open={expandMembers} />}
              onPress={() => setExpandMembers((v) => !v)}
            />
            {expandMembers ? (
              <View style={styles.expandBox}>
                {members.length === 0 ? <Text style={styles.emptyText}>No family members yet.</Text> : members.map((m) => (
                  <MiniRow key={m.member_id} initial={m.name[0]?.toUpperCase()} name={m.name} sub={m.role} />
                ))}
                {invites.filter((i) => i.status === 'pending').map((invite) => (
                  <View key={invite.invite_id} style={styles.inviteRow}>
                    <MiniRow initial={(invite.email?.[0] || '?').toUpperCase()} name={invite.email || 'Invite link'} sub={`Invite · ${invite.status}`} />
                    {invite.invite_url ? (
                      <PressScale onPress={() => shareInviteLink(invite.invite_url, invite.email)} style={styles.ghostBtn}>
                        <Share2 color={ui.text} size={14} />
                        <Text style={styles.ghostBtnText}>Share</Text>
                      </PressScale>
                    ) : null}
                  </View>
                ))}
                <PressScale testID="invite-coparent" onPress={() => openInvite()} style={styles.expandAction}>
                  <UserPlus color={ui.text} size={18} />
                  <Text style={styles.expandActionText}>Invite co-parent</Text>
                </PressScale>
              </View>
            ) : null}
            <Divider />

            <NavRow
              tile={<IconTile bg={ui.lavender}><Lock color={ui.lavenderText} size={18} /></IconTile>}
              title="Manage children"
              subtitle={`${childMembers.length} child${childMembers.length === 1 ? '' : 'ren'} · kid PINs`}
              right={<Chevron open={expandChildren} />}
              onPress={() => setExpandChildren((v) => !v)}
            />
            {expandChildren ? (
              <View style={styles.expandBox}>
                {childMembers.length === 0 ? <Text style={styles.emptyText}>No children to secure.</Text> : childMembers.map((m) => (
                  <PressScale key={m.member_id} testID={`set-pin-${m.member_id}`} onPress={() => setPinMember(m)} style={styles.inviteRow}>
                    <MiniRow initial={m.name[0]?.toUpperCase()} name={m.name} sub={m.has_pin ? 'PIN set · tap to change' : 'No PIN · tap to add'} />
                    {m.has_pin ? <Lock color={ui.orange} size={16} /> : <ChevronRight color={ui.muted} size={18} />}
                  </PressScale>
                ))}
              </View>
            ) : null}
            <Divider />

            <NavRow
              tile={<IconTile bg={ui.mint}><Link2 color={ui.mintText} size={18} /></IconTile>}
              title="Invite a family member"
              subtitle="Send an invite link via email"
              onPress={() => openInvite()}
              right={<ChevronRight color={ui.muted} size={18} />}
              divider={false}
            />
          </Card>

          {/* Expenses */}
          <SectionTitle style={styles.sectionGap}>Expense Splitting</SectionTitle>
          <Card style={styles.cardPad}>
            <NavRow
              testID="settings-expenses-toggle"
              tile={<IconTile bg={ui.gold}><DollarSign color={ui.goldText} size={18} /></IconTile>}
              title="Household expenses"
              subtitle={expenseSummary ? `$${expenseSummary.total.toFixed(0)} last ${expenseSummary.days} days` : 'Track shared costs'}
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
                      sub={`$${exp.amount.toFixed(2)} · ${exp.category} · ${exp.paid_by_name}`}
                    />
                    <PressScale onPress={() => removeExpense(exp.expense_id)} style={{ padding: 4 }}>
                      <Trash2 color={ui.muted} size={15} />
                    </PressScale>
                  </View>
                ))}
                {expenses.length === 0 ? <Text style={styles.emptyText}>No expenses recorded yet.</Text> : null}
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
                  <Text style={styles.expandActionText}>Add expense</Text>
                </PressScale>
              </View>
            ) : null}
          </Card>

          {/* Preferences */}
          <SectionTitle style={styles.sectionGap}>Preferences</SectionTitle>
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
          <SectionTitle style={styles.sectionGap}>More</SectionTitle>
          <Card style={styles.cardPad}>
            <NavRow
              testID="settings-completed-history-toggle"
              tile={<IconTile bg={ui.soft}><CalendarDays color={ui.text} size={18} /></IconTile>}
              title="Completed history"
              subtitle={`${completedCards.length} completed card${completedCards.length === 1 ? '' : 's'}`}
              right={<Chevron open={expandHistory} />}
              onPress={() => setExpandHistory((v) => !v)}
            />
            {expandHistory ? (
              <View style={styles.expandBox}>
                {completedCards.length === 0 ? <Text style={styles.emptyText}>No completed cards yet.</Text> : completedCards.slice(0, 8).map((card) => (
                  <View key={card.card_id} style={styles.inviteRow}>
                    <MiniRow initial={card.type === 'TASK' ? 'T' : card.type === 'RSVP' ? 'R' : 'S'} name={card.title} sub={`Done · ${card.assignee || 'Family'}`} />
                    <PressScale
                      testID={`restore-card-${card.card_id}`}
                      onPress={() => {
                        Alert.alert('Restore card?', `"${card.title}" will be moved back to your active cards.`, [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Restore',
                            onPress: async () => {
                              try {
                                await api.updateCard(card.card_id, { status: 'OPEN' });
                                setCompletedCards((prev) => prev.filter((c) => c.card_id !== card.card_id));
                              } catch {
                                Alert.alert('Error', 'Could not restore this card.');
                              }
                            },
                          },
                        ]);
                      }}
                      style={styles.ghostBtn}
                    >
                      <RotateCcw color={ui.text} size={14} />
                      <Text style={styles.ghostBtnText}>Restore</Text>
                    </PressScale>
                  </View>
                ))}
              </View>
            ) : null}
            <Divider />

            <NavRow
              tile={<IconTile bg={ui.soft}><Sparkles color={ui.text} size={18} /></IconTile>}
              title="Plan &amp; usage"
              subtitle="AI scans, vault storage & limits"
              right={<Chevron open={expandUsage} />}
              onPress={() => setExpandUsage((v) => !v)}
              divider={false}
            />
            {expandUsage ? (
              <View style={styles.statGrid}>
                <StatBox label="Members" value={`${memberSlotsUsed}/${memberLimit || '∞'}`} />
                <StatBox label="AI scans" value={entitlements ? `${entitlements.ai_scans_used}/${entitlements.ai_scans_limit}` : `${subscription?.ai_scans_used ?? 0}/${subscription?.limits?.ai_scans_per_month ?? '∞'}`} />
                <StatBox label="Vault" value={formatBytes(entitlements?.vault_bytes_used ?? subscription?.vault_bytes_used)} />
                <StatBox label="Weekly brief" value={weeklyBrief ? 'On' : 'Locked'} />
                <View style={styles.testRow}>
                  <PressScale onPress={testReminderNotification} style={styles.ghostBtnWide}><Text style={styles.ghostBtnText}>Test reminder</Text></PressScale>
                  <PressScale onPress={testNewCardAlert} style={styles.ghostBtnWide}><Text style={styles.ghostBtnText}>Test alert</Text></PressScale>
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
        title={pinMember ? `${pinMember.name}'s PIN` : 'Set PIN'}
        subtitle="4 digits. Tap any digit to clear and retry."
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
          <Text style={styles.sheetTitle}>Invite co-parent</Text>
          <PressScale testID="close-invite" onPress={() => setShowInvite(false)} style={styles.iconBtn}>
            <X color={ui.text} size={22} />
          </PressScale>
        </View>
        <Text style={styles.sheetHelp}>They will receive a join link and can sign in to join your household.</Text>
        <TextInput
          testID="invite-email"
          value={inviteEmail}
          onChangeText={setInviteEmail}
          placeholder="partner@example.com"
          placeholderTextColor={ui.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={styles.input}
          returnKeyType="send"
        />
        {inviteResult ? <Text style={styles.note}>{inviteResult}</Text> : null}
        {lastInviteUrl ? (
          <PressScale onPress={() => shareInviteLink(lastInviteUrl, inviteEmail)} style={styles.expandAction}>
            <Share2 color={ui.text} size={18} />
            <Text style={styles.expandActionText}>Share invite link</Text>
          </PressScale>
        ) : null}
        <View style={styles.sheetFooter}>
          <PressScale onPress={() => setShowInvite(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>
          <PressScale
            testID="send-invite"
            onPress={async () => {
              if (!inviteEmail.trim() || !inviteEmail.includes('@')) return;
              setSending(true);
              setInviteResult(null);
              try {
                const submittedEmail = inviteEmail.trim();
                const res = await api.invite(submittedEmail);
                if (res.invite_url) setLastInviteUrl(res.invite_url);
                setInviteResult(res.sent ? `Invitation email sent to ${submittedEmail}.` : res.invite_url ? `Invite created. Share this link manually: ${res.invite_url}` : res.message || 'Invite created.');
                setInviteEmail('');
                await load();
              } catch (error: any) {
                setInviteResult(error?.message || 'Error');
              } finally {
                setSending(false);
              }
            }}
            disabled={sending || !inviteEmail.trim()}
            style={[styles.primaryButton, (!inviteEmail.trim() || sending) && { opacity: 0.5 }]}
          >
            <Send color="#FFFFFF" size={18} />
            <Text style={styles.primaryButtonText}>{sending ? 'Sending...' : 'Send invite'}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showExpenseAdd} onClose={() => setShowExpenseAdd(false)} contentStyle={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Add Expense</Text>
          <PressScale testID="close-expense" onPress={() => setShowExpenseAdd(false)} style={styles.iconBtn}>
            <X color={ui.text} size={22} />
          </PressScale>
        </View>
        <Text style={styles.sheetHelp}>Split household costs between family members.</Text>
        <TextInput
          testID="expense-desc"
          value={expDesc}
          onChangeText={setExpDesc}
          placeholder="What was it for?"
          placeholderTextColor={ui.muted}
          style={styles.input}
          returnKeyType="next"
        />
        <TextInput
          testID="expense-amount"
          value={expAmount}
          onChangeText={setExpAmount}
          placeholder="Amount (e.g. 42.50)"
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
            <Text style={styles.primaryButtonText}>{savingExpense ? 'Saving...' : 'Add expense'}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>
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
