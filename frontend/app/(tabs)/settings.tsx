import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
  Platform,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  CalendarDays,
  Globe,
  LogOut,
  Users,
  Mail,
  UserPlus,
  X,
  Send,
  Lock,
  Bell,
  Crown,
  Sparkles,
  Share2,
  Moon,
  Sun,
  ShieldCheck,
  ArrowUpRight,
  ChevronRight,
} from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { PressScale } from '../../src/components/PressScale';
import { LanguageModal } from '../../src/components/LanguageModal';
import { PinPadModal } from '../../src/components/PinPadModal';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import { PricingView } from '../../src/components/PricingView';
import { useStore } from '../../src/store';
import { api, CalendarContact, Entitlements, FamilyInvite, FamilyMember, NotificationSettings } from '../../src/api';
import { LANG_NAMES } from '../../src/i18n';
import {
  ensureNotificationPermissions,
  registerForPushNotificationsAsync,
  sendLocalNotification,
  sendTestScheduledReminderNotification,
  syncCardReminderNotifications,
} from '../../src/notifications';

function formatBytes(bytes?: number | null) {
  const value = bytes || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export default function SettingsScreen() {
  const { user, t, lang, logout, subscription, appearanceMode, setAppearance, theme } = useStore();
  const router = useRouter();
  const isLight = theme.mode === 'light';
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [invites, setInvites] = useState<FamilyInvite[]>([]);
  const [calendarContacts, setCalendarContacts] = useState<CalendarContact[]>([]);
  const [showLang, setShowLang] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [lastInviteEmail, setLastInviteEmail] = useState('');
  const [pinMember, setPinMember] = useState<FamilyMember | null>(null);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationSettings>({ card_reminders: false, new_card_alerts: false });
  const [notificationStatus, setNotificationStatus] = useState<string | null>(null);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);

  const load = useCallback(async () => {
    try {
      const [memberRows, inviteRows, contactRows, notificationRows, entitlementRows] = await Promise.all([
        api.familyMembers(),
        api.listInvites(),
        api.listCalendarContacts().catch(() => []),
        api.getNotificationSettings().catch(() => ({ card_reminders: false, new_card_alerts: false })),
        api.getEntitlements().catch(() => null),
      ]);
      setMembers(memberRows);
      setInvites(inviteRows);
      setCalendarContacts(contactRows);
      setNotificationPrefs(notificationRows);
      setEntitlements(entitlementRows);
    } catch (error) {
      console.log('settings load failed', error);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const memberLimit = entitlements?.max_members ?? subscription?.limits?.max_members ?? 0;
  const memberSlotsUsed = entitlements?.member_slots_used ?? members.length + invites.filter((invite) => invite.status === 'pending').length;
  const memberLimitReached = !user?.is_admin && memberLimit > 0 && memberSlotsUsed >= memberLimit;
  const childMembers = useMemo(() => members.filter((m) => m.role === 'Child'), [members]);
  const planLabel = subscription?.plan === 'family_office' ? 'Family Office' : subscription?.plan === 'executive' ? 'Executive' : 'Village';

  const readable = {
    title: theme.colors.text,
    body: theme.colors.textMuted,
    muted: theme.colors.textSoft,
    border: theme.colors.cardBorder,
    soft: theme.colors.bgSoft,
    accent: theme.colors.accent,
    card: theme.colors.card,
  };

  const doLogout = async () => {
    await logout();
    router.replace('/');
  };

  const shareInviteLink = useCallback(
    async (inviteUrl: string, email?: string) => {
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
    },
    [user?.name]
  );

  const updateNotificationPrefs = useCallback(
    async (changes: Partial<NotificationSettings>) => {
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
          try {
            const push = await registerForPushNotificationsAsync();
            if (push.expoPushToken) await api.registerNotificationToken(push.expoPushToken, Platform.OS);
            else if (push.error) warning = push.error;
          } catch (pushError: any) {
            warning = pushError?.message || 'Remote push registration failed. Local tests still work.';
          }
        }

        try {
          const saved = await api.updateNotificationSettings(nextPrefs);
          setNotificationPrefs(saved);
        } catch (backendError) {
          console.log('notification backend settings failed', backendError);
          warning = warning || 'Backend notification preferences could not be saved, but local notifications can still be tested.';
        }

        if (nextPrefs.card_reminders) {
          const cards = await api.listCards();
          const result = await syncCardReminderNotifications(cards, true);
          setNotificationStatus(
            result.scheduled
              ? `${result.scheduled} reminder notification${result.scheduled === 1 ? '' : 's'} scheduled.`
              : warning || 'Reminder alerts are on. Add due dates and reminder times to schedule alerts.'
          );
        } else {
          await syncCardReminderNotifications([], false).catch(() => undefined);
          setNotificationStatus(nextPrefs.new_card_alerts ? warning || 'New-card alerts are on.' : 'Notifications are off.');
        }
      } catch (error: any) {
        console.log('notification settings failed', error);
        setNotificationStatus(error?.message || 'Could not update notification settings.');
      } finally {
        setSavingNotifications(false);
      }
    },
    [notificationPrefs]
  );

  const testReminderNotification = useCallback(async () => {
    try {
      const granted = await ensureNotificationPermissions();
      if (!granted) {
        setNotificationStatus('Notification permission was not granted.');
        return;
      }
      await sendTestScheduledReminderNotification();
      setNotificationStatus('Test reminder scheduled. It should appear in about 5 seconds.');
    } catch (error: any) {
      console.log('test reminder notification failed', error);
      setNotificationStatus(error?.message || 'Could not send test notification.');
    }
  }, []);

  const testNewCardAlert = useCallback(async () => {
    try {
      const granted = await ensureNotificationPermissions();
      if (!granted) {
        setNotificationStatus('Notification permission was not granted.');
        return;
      }
      await sendLocalNotification('New Household COO card', 'This is how a new-card alert will appear.');
      setNotificationStatus('Test new-card alert sent on this device.');
    } catch (error: any) {
      console.log('test new-card alert failed', error);
      setNotificationStatus(error?.message || 'Could not send test new-card alert.');
    }
  }, []);

  const openInvite = (email = '') => {
    setInviteEmail(email);
    setInviteResult(null);
    setLastInviteUrl(null);
    setLastInviteEmail('');
    setShowInvite(true);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <AmbientBackground />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, { color: readable.title }]}>Settings</Text>
          <Text style={[styles.subtitle, { color: readable.body }]}>Manage your household, access, alerts, and preferences.</Text>

          <GlassCard style={styles.profileCard}>
            <View style={styles.profileRow}>
              {user?.picture ? (
                <Image source={{ uri: user.picture }} style={[styles.avatar, { borderColor: readable.border }]} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { borderColor: readable.border, backgroundColor: readable.soft }]}>
                  <Text style={[styles.avatarText, { color: readable.title }]}>{(user?.name?.[0] || 'C').toUpperCase()}</Text>
                </View>
              )}
              <View style={styles.profileTextWrap}>
                <Text style={[styles.name, { color: readable.title }]} numberOfLines={1}>{user?.name || 'Household member'}</Text>
                <View style={styles.emailRow}>
                  <Mail color={readable.muted} size={16} />
                  <Text style={[styles.email, { color: readable.body }]} numberOfLines={1}>{user?.email}</Text>
                </View>
                {user?.is_admin ? (
                  <View testID="admin-badge" style={[styles.adminBadge, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}> 
                    <Crown color={theme.colors.accent} size={16} />
                    <Text style={[styles.adminBadgeText, { color: theme.colors.accent }]}>Admin / Tester · all features unlocked</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </GlassCard>

          <SectionTitle icon={<ShieldCheck color={readable.body} size={18} />} label="Plan & access" color={readable.body} />
          <GlassCard>
            <View style={styles.cardHeaderRow}>
              <View style={styles.flex1}>
                <Text style={[styles.cardTitle, { color: readable.title }]}>{user?.is_admin ? 'Admin / Tester' : planLabel}</Text>
                <Text style={[styles.cardSub, { color: readable.body }]}> {user?.is_admin ? 'All feature gates are bypassed for testing.' : `${memberSlotsUsed}/${memberLimit || '∞'} member slots used`} </Text>
              </View>
              <PrimaryPill label="View plans" onPress={() => setShowPricing(true)} color={theme.colors.primary} textColor={theme.colors.primaryText} />
            </View>
            <View style={styles.statGrid}>
              <StatBox label="Members" value={`${memberSlotsUsed}/${memberLimit || '∞'}`} theme={theme} />
              <StatBox label="AI scans" value={entitlements ? `${entitlements.ai_scans_used}/${entitlements.ai_scans_limit}` : `${subscription?.ai_scans_used ?? 0}/${subscription?.limits?.ai_scans_per_month ?? '∞'}`} theme={theme} />
              <StatBox label="Vault" value={formatBytes(entitlements?.vault_bytes_used ?? subscription?.vault_bytes_used)} theme={theme} />
              <StatBox label="Weekly brief" value={entitlements?.weekly_brief || subscription?.limits?.weekly_brief ? 'On' : 'Locked'} theme={theme} />
            </View>
            {memberLimitReached ? <Text style={[styles.warningText, { color: theme.colors.accent }]}>You have reached your member limit. Upgrade before inviting another person.</Text> : null}
          </GlassCard>

          <SectionTitle icon={<Bell color={readable.body} size={18} />} label="Notifications" color={readable.body} />
          <GlassCard>
            <SettingToggle
              title="Reminder notifications"
              description="Alerts before cards with due dates and reminder times."
              value={notificationPrefs.card_reminders}
              disabled={savingNotifications}
              onPress={() => updateNotificationPrefs({ card_reminders: !notificationPrefs.card_reminders })}
              theme={theme}
              testID="toggle-card-reminders"
            />
            <Divider color={readable.border} />
            <SettingToggle
              title="New-card alerts"
              description="Alerts when another household member adds a card."
              value={notificationPrefs.new_card_alerts}
              disabled={savingNotifications}
              onPress={() => updateNotificationPrefs({ new_card_alerts: !notificationPrefs.new_card_alerts })}
              theme={theme}
              testID="toggle-new-card-alerts"
            />
            <View style={styles.testButtonRow}>
              <SecondaryButton label="Test reminder" onPress={testReminderNotification} theme={theme} testID="test-reminder-notification" />
              <SecondaryButton label="Test new-card alert" onPress={testNewCardAlert} theme={theme} testID="test-new-card-alert" />
            </View>
            <Text style={[styles.note, { color: readable.body }]}>{notificationStatus || 'Use a development build for full push notification testing.'}</Text>
          </GlassCard>

          <SectionTitle icon={<Globe color={readable.body} size={18} />} label="Preferences" color={readable.body} />
          <GlassCard>
            <View style={styles.preferenceHeader}>
              <View style={styles.preferenceTitleRow}>
                {appearanceMode === 'light' ? <Sun color={theme.colors.accent} size={20} /> : <Moon color={theme.colors.accent} size={20} />}
                <Text style={[styles.rowTitle, { color: readable.title }]}>Appearance</Text>
              </View>
              <Text style={[styles.rowValue, { color: readable.body }]}>{appearanceMode === 'system' ? 'System' : appearanceMode === 'light' ? 'Light' : 'Dark'}</Text>
            </View>
            <View style={[styles.segmentWrap, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
              {(['dark', 'light', 'system'] as const).map((mode) => {
                const active = appearanceMode === mode;
                return (
                  <PressScale key={mode} testID={`appearance-${mode}`} onPress={() => setAppearance(mode)} style={[styles.segmentBtn, active && { backgroundColor: theme.colors.primary }]}> 
                    <Text style={[styles.segmentText, { color: active ? theme.colors.primaryText : theme.colors.textMuted }]}>{mode[0].toUpperCase() + mode.slice(1)}</Text>
                  </PressScale>
                );
              })}
            </View>
            <Text style={[styles.note, { color: readable.body }]}>Light mode uses solid cards and higher contrast for comfortable family use.</Text>
            <Divider color={readable.border} />
            <PressScale testID="settings-lang" onPress={() => setShowLang(true)} style={styles.navRow}>
              <View style={styles.preferenceTitleRow}>
                <Globe color={theme.colors.accent} size={20} />
                <Text style={[styles.rowTitle, { color: readable.title }]}>{t('language')}</Text>
              </View>
              <View style={styles.navRight}><Text style={[styles.rowValue, { color: readable.body }]}>{LANG_NAMES[lang]}</Text><ChevronRight color={readable.muted} size={20} /></View>
            </PressScale>
          </GlassCard>

          <SectionTitle icon={<Users color={readable.body} size={18} />} label="Family" color={readable.body} />
          <GlassCard>
            {members.length === 0 ? <EmptyText text="No family members yet." color={readable.body} /> : members.map((member, index) => (
              <View key={member.member_id}>
                {index > 0 ? <Divider color={readable.border} /> : null}
                <View style={styles.memberRow}>
                  <View style={[styles.memberAvatar, { backgroundColor: theme.colors.bgSoft, borderColor: readable.border }]}><Text style={[styles.memberInitial, { color: readable.title }]}>{member.name[0]?.toUpperCase()}</Text></View>
                  <View style={styles.flex1}><Text style={[styles.memberName, { color: readable.title }]}>{member.name}</Text><Text style={[styles.memberRole, { color: readable.body }]}>{member.role}</Text></View>
                </View>
              </View>
            ))}
          </GlassCard>
          <SecondaryButton label="Invite co-parent" onPress={() => openInvite()} theme={theme} testID="open-invite" icon={<UserPlus color={theme.colors.text} size={20} />} />

          <GlassCard style={styles.topGap}>
            <Text style={[styles.cardTitle, { color: readable.title }]}>Invite status</Text>
            {invites.length === 0 ? <EmptyText text="No invites created yet." color={readable.body} /> : invites.map((invite) => (
              <View key={invite.invite_id} style={styles.inviteRow}>
                <View style={styles.flex1}>
                  <Text style={[styles.memberName, { color: readable.title }]}>{invite.email || 'Invite link'}</Text>
                  <Text style={[styles.memberRole, { color: readable.body }]}>{invite.status}</Text>
                  {invite.status === 'pending' && invite.invite_url ? <SecondaryButton label="Share link" onPress={() => shareInviteLink(invite.invite_url, invite.email)} theme={theme} testID={`share-invite-${invite.invite_id}`} compact icon={<Share2 color={theme.colors.text} size={16} />} /> : null}
                </View>
              </View>
            ))}
          </GlassCard>

          <SectionTitle icon={<CalendarDays color={readable.body} size={18} />} label="Calendar contacts" color={readable.body} />
          <GlassCard>
            {calendarContacts.length === 0 ? <EmptyText text="No calendar contacts found yet. Sync Google Calendar from the Calendar tab." color={readable.body} /> : calendarContacts.slice(0, 8).map((contact, index) => (
              <View key={contact.email}>
                {index > 0 ? <Divider color={readable.border} /> : null}
                <View style={styles.memberRow}>
                  <View style={[styles.memberAvatar, { backgroundColor: theme.colors.bgSoft, borderColor: readable.border }]}><Text style={[styles.memberInitial, { color: readable.title }]}>{(contact.name?.[0] || contact.email[0] || '?').toUpperCase()}</Text></View>
                  <View style={styles.flex1}><Text style={[styles.memberName, { color: readable.title }]}>{contact.name || contact.email}</Text><Text style={[styles.memberRole, { color: readable.body }]} numberOfLines={1}>{contact.email} · {contact.event_count} event{contact.event_count === 1 ? '' : 's'}</Text></View>
                  <PressScale testID={`invite-calendar-contact-${contact.email}`} onPress={() => openInvite(contact.email)} style={[styles.smallInvite, { borderColor: readable.border }]}><Text style={[styles.smallInviteText, { color: readable.title }]}>Invite</Text></PressScale>
                </View>
              </View>
            ))}
          </GlassCard>

          <SectionTitle icon={<Crown color={readable.body} size={18} />} label="Subscription" color={readable.body} />
          <GlassCard>
            <View style={styles.cardHeaderRow}>
              <View style={styles.flex1}>
                <Text style={[styles.cardTitle, { color: readable.title }]}>{subscription ? t(`plan_${subscription.plan}`) : t('loading')}</Text>
                <Text style={[styles.cardSub, { color: readable.body }]}>{subscription?.admin_unlocked ? 'Admin tester account · limits bypassed' : subscription ? t(`plan_${subscription.plan}_tag`) : ''}</Text>
              </View>
              {subscription?.admin_unlocked ? <View style={[styles.adminBadge, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}><Crown color={theme.colors.accent} size={15} /><Text style={[styles.adminBadgeText, { color: theme.colors.accent }]}>ADMIN</Text></View> : null}
            </View>
            {subscription && subscription.limits.ai_scans_per_month !== -1 ? (
              <View style={styles.usageWrap}>
                <Text style={[styles.usageCapsLabel, { color: readable.body }]}>{t('usage_this_month')}</Text>
                <View style={[styles.usageBarBg, { backgroundColor: theme.colors.bgSoft }]}><View style={[styles.usageBarFill, { backgroundColor: theme.colors.accent, width: `${Math.min(100, (subscription.ai_scans_used / subscription.limits.ai_scans_per_month) * 100)}%` }]} /></View>
                <Text style={[styles.note, { color: readable.body }]}>{t('ai_scans_used', { used: subscription.ai_scans_used, limit: subscription.limits.ai_scans_per_month })}</Text>
              </View>
            ) : null}
            <SecondaryButton label={t('manage_subscription')} onPress={() => router.push('/pricing')} theme={theme} testID="open-pricing-subscription" />
          </GlassCard>

          <SectionTitle icon={<Lock color={readable.body} size={18} />} label="Kid PINs" color={readable.body} />
          <GlassCard>
            {childMembers.length === 0 ? <EmptyText text="No children to secure." color={readable.body} /> : childMembers.map((member, index) => (
              <PressScale key={member.member_id} testID={`set-pin-${member.member_id}`} onPress={() => setPinMember(member)} style={styles.memberRow}>
                <View style={[styles.memberAvatar, { backgroundColor: theme.colors.bgSoft, borderColor: readable.border }]}><Text style={[styles.memberInitial, { color: readable.title }]}>{member.name[0]?.toUpperCase()}</Text></View>
                <View style={styles.flex1}><Text style={[styles.memberName, { color: readable.title }]}>{member.name}</Text><Text style={[styles.memberRole, { color: readable.body }]}>{member.has_pin ? 'PIN set · tap to change' : 'No PIN · tap to add'}</Text></View>
                {member.has_pin ? <Lock color={theme.colors.accent} size={18} /> : <ChevronRight color={readable.muted} size={20} />}
              </PressScale>
            ))}
          </GlassCard>

          <PressScale testID="logout" onPress={doLogout} style={[styles.logoutBtn, { borderColor: '#DC2626' }]}> 
            <LogOut color="#DC2626" size={22} />
            <Text style={styles.logoutText}>{t('log_out')}</Text>
          </PressScale>

          <View style={{ height: 150 }} />
        </ScrollView>
      </SafeAreaView>

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

      <KeyboardAwareBottomSheet visible={showInvite} onClose={() => setShowInvite(false)} contentStyle={[styles.sheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
        <View style={styles.sheetHeader}>
          <Text style={[styles.sheetTitle, { color: readable.title }]}>Invite co-parent</Text>
          <PressScale testID="close-invite" onPress={() => setShowInvite(false)} style={[styles.iconBtn, { borderColor: readable.border }]}><X color={readable.title} size={22} /></PressScale>
        </View>
        <Text style={[styles.sheetHelp, { color: readable.body }]}>They will receive a join link and can sign in to join your household.</Text>
        <Text style={[styles.label, { color: readable.body }]}>Email</Text>
        <TextInput
          testID="invite-email"
          value={inviteEmail}
          onChangeText={setInviteEmail}
          placeholder="partner@example.com"
          placeholderTextColor={theme.colors.textSoft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={[styles.input, { color: readable.title, backgroundColor: theme.colors.bgSoft, borderColor: readable.border }]}
          returnKeyType="send"
        />
        {memberLimitReached ? <Text style={[styles.warningText, { color: theme.colors.accent }]}>Your current plan has no free member slots.</Text> : null}
        {inviteResult ? <Text style={[styles.note, { color: readable.body }]}>{inviteResult}</Text> : null}
        {lastInviteUrl ? <SecondaryButton label="Share invite link" onPress={() => shareInviteLink(lastInviteUrl, lastInviteEmail)} theme={theme} testID="share-created-invite" icon={<Share2 color={theme.colors.text} size={18} />} /> : null}
        <View style={styles.sheetFooter}>
          <SecondaryButton label={t('cancel')} onPress={() => setShowInvite(false)} theme={theme} testID="cancel-invite" />
          <PressScale
            testID="send-invite"
            onPress={async () => {
              if (!inviteEmail.trim() || !inviteEmail.includes('@')) return;
              setSending(true);
              setInviteResult(null);
              try {
                const submittedEmail = inviteEmail.trim();
                const res = await api.invite(submittedEmail);
                if (res.invite_url) {
                  setLastInviteUrl(res.invite_url);
                  setLastInviteEmail(submittedEmail);
                }
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
            style={[styles.primaryButton, { backgroundColor: theme.colors.primary }, (!inviteEmail.trim() || sending) && { opacity: 0.5 }]}
          >
            <Send color={theme.colors.primaryText} size={18} />
            <Text style={[styles.primaryButtonText, { color: theme.colors.primaryText }]}>{sending ? 'Sending...' : 'Send invite'}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <KeyboardAwareBottomSheet visible={showPricing} onClose={() => setShowPricing(false)} contentStyle={styles.pricingSheet}>
        <PricingView embedded onClose={() => setShowPricing(false)} />
      </KeyboardAwareBottomSheet>
    </View>
  );
}

function SectionTitle({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return <View style={styles.sectionRow}>{icon}<Text style={[styles.sectionLabel, { color }]}>{label}</Text></View>;
}

function Divider({ color }: { color: string }) {
  return <View style={[styles.divider, { backgroundColor: color }]} />;
}

function EmptyText({ text, color }: { text: string; color: string }) {
  return <Text style={[styles.emptyText, { color }]}>{text}</Text>;
}

function StatBox({ label, value, theme }: { label: string; value: string; theme: any }) {
  return <View style={[styles.statBox, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}><Text style={[styles.statValue, { color: theme.colors.text }]}>{value}</Text><Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>{label}</Text></View>;
}

function PrimaryPill({ label, onPress, color, textColor }: { label: string; onPress: () => void; color: string; textColor: string }) {
  return <PressScale testID="open-pricing" onPress={onPress} style={[styles.primaryPill, { backgroundColor: color }]}><Text style={[styles.primaryPillText, { color: textColor }]}>{label}</Text><ArrowUpRight color={textColor} size={18} /></PressScale>;
}

function SecondaryButton({ label, onPress, theme, testID, icon, compact }: { label: string; onPress: () => void; theme: any; testID?: string; icon?: React.ReactNode; compact?: boolean }) {
  return <PressScale testID={testID} onPress={onPress} style={[styles.secondaryButton, compact && styles.secondaryButtonCompact, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>{icon}<Text style={[styles.secondaryButtonText, { color: theme.colors.text }]}>{label}</Text></PressScale>;
}

function SettingToggle({ title, description, value, onPress, disabled, theme, testID }: { title: string; description: string; value: boolean; onPress: () => void; disabled?: boolean; theme: any; testID: string }) {
  return <PressScale testID={testID} disabled={disabled} onPress={onPress} style={styles.toggleRow}><View style={styles.flex1}><Text style={[styles.rowTitle, { color: theme.colors.text }]}>{title}</Text><Text style={[styles.rowDescription, { color: theme.colors.textMuted }]}>{description}</Text></View><View style={[styles.switch, { backgroundColor: value ? theme.colors.success : theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}><View style={[styles.knob, value && styles.knobOn]} /></View></PressScale>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 18 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 38, lineHeight: 44, letterSpacing: -0.6 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23, marginTop: 6, marginBottom: 16 },
  profileCard: { marginBottom: 18 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 76, height: 76, borderRadius: 9999, borderWidth: 1 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 26 },
  profileTextWrap: { flex: 1, minWidth: 0 },
  name: { fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 28 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  email: { fontFamily: 'Inter_400Regular', fontSize: 15, flex: 1 },
  adminBadge: { alignSelf: 'flex-start', marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9999, borderWidth: 1 },
  adminBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20, marginBottom: 10 },
  sectionLabel: { fontFamily: 'Inter_700Bold', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  flex1: { flex: 1, minWidth: 0 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, lineHeight: 28 },
  cardSub: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22, marginTop: 4 },
  primaryPill: { minHeight: 48, borderRadius: 9999, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  primaryPillText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  statBox: { width: '48%', minHeight: 86, borderRadius: 18, borderWidth: 1, padding: 14, justifyContent: 'center' },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 21, lineHeight: 26 },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 18, marginTop: 5 },
  warningText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 21, marginTop: 14 },
  toggleRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingVertical: 8 },
  rowTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, lineHeight: 24 },
  rowDescription: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, marginTop: 3 },
  rowValue: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  switch: { width: 58, height: 34, borderRadius: 9999, borderWidth: 1, padding: 3, justifyContent: 'center' },
  knob: { width: 27, height: 27, borderRadius: 9999, backgroundColor: '#FFFFFF' },
  knobOn: { transform: [{ translateX: 23 }] },
  divider: { height: 1, marginVertical: 10, opacity: 0.75 },
  testButtonRow: { flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' },
  note: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22, marginTop: 12 },
  preferenceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  preferenceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  segmentWrap: { flexDirection: 'row', borderWidth: 1, borderRadius: 18, padding: 5, marginTop: 14, gap: 5 },
  segmentBtn: { flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  navRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  memberRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  memberAvatar: { width: 46, height: 46, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  memberInitial: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  memberName: { fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 23 },
  memberRole: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 19, marginTop: 2 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24, paddingVertical: 6 },
  secondaryButton: { minHeight: 52, borderRadius: 18, borderWidth: 1, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12 },
  secondaryButtonCompact: { alignSelf: 'flex-start', minHeight: 42, paddingHorizontal: 12, borderRadius: 14 },
  secondaryButtonText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  topGap: { marginTop: 12 },
  inviteRow: { paddingVertical: 12 },
  smallInvite: { minHeight: 40, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  smallInviteText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  usageWrap: { marginTop: 18 },
  usageCapsLabel: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 0.9, textTransform: 'uppercase' },
  usageBarBg: { height: 10, borderRadius: 9999, overflow: 'hidden', marginTop: 10 },
  usageBarFill: { height: '100%', borderRadius: 9999 },
  logoutBtn: { minHeight: 58, marginTop: 24, borderRadius: 18, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  logoutText: { color: '#DC2626', fontFamily: 'Inter_700Bold', fontSize: 18 },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, padding: 22, paddingBottom: 130 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 32 },
  iconBtn: { width: 44, height: 44, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sheetHelp: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23, marginTop: 4 },
  label: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', marginTop: 16, marginBottom: 8 },
  input: { minHeight: 54, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 17 },
  sheetFooter: { flexDirection: 'row', gap: 10, marginTop: 16 },
  primaryButton: { minHeight: 52, borderRadius: 18, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flex: 1 },
  primaryButtonText: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  pricingSheet: { padding: 0, paddingBottom: 24, maxHeight: '92%' },
});
