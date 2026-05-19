import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Platform, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Crown,
  FileText,
  Globe,
  Lock,
  LogOut,
  Mail,
  Moon,
  Send,
  Share2,
  ShieldCheck,
  Sun,
  Trash2,
  UserCircle,
  UserPlus,
  Users,
  X,
} from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { PressScale } from '../../src/components/PressScale';
import { LanguageModal } from '../../src/components/LanguageModal';
import { PinPadModal } from '../../src/components/PinPadModal';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import { useStore } from '../../src/store';
import { api, CalendarContact, Card, Entitlements, FamilyInvite, FamilyMember, NotificationSettings } from '../../src/api';
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
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [invites, setInvites] = useState<FamilyInvite[]>([]);
  const [calendarContacts, setCalendarContacts] = useState<CalendarContact[]>([]);
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
  const [completedCards, setCompletedCards] = useState<Card[]>([]);
  const [showCompletedHistory, setShowCompletedHistory] = useState(false);
  const [showHouseholdDetails, setShowHouseholdDetails] = useState(false);
  const [showNotificationDetails, setShowNotificationDetails] = useState(false);

  const load = useCallback(async () => {
    try {
      const [memberRows, inviteRows, contactRows, notificationRows, entitlementRows, completedRows] = await Promise.all([
        api.familyMembers(),
        api.listInvites(),
        api.listCalendarContacts().catch(() => []),
        api.getNotificationSettings().catch(() => ({ card_reminders: false, new_card_alerts: false })),
        api.getEntitlements().catch(() => null),
        api.listCards('DONE')
          .then(async (rows) => {
            const directDone = rows.filter((card) => card.status === 'DONE');
            if (directDone.length > 0) return directDone;
            const allCards = await api.listCards().catch(() => [] as Card[]);
            return allCards.filter((card) => card.status === 'DONE');
          })
          .catch(async () => {
            const allCards = await api.listCards().catch(() => [] as Card[]);
            return allCards.filter((card) => card.status === 'DONE');
          }),
      ]);
      setMembers(memberRows);
      setInvites(inviteRows);
      setCalendarContacts(contactRows);
      setNotificationPrefs(notificationRows);
      setEntitlements(entitlementRows);
      setCompletedCards(completedRows);
    } catch (error) {
      console.log('settings load failed', error);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const memberLimit = entitlements?.max_members ?? subscription?.limits?.max_members ?? 0;
  const memberSlotsUsed = entitlements?.member_slots_used ?? members.length + invites.filter((invite) => invite.status === 'pending').length;
  const childMembers = useMemo(() => members.filter((m) => m.role === 'Child'), [members]);
  const planLabel = subscription?.plan === 'family_office' ? 'Family Office' : subscription?.plan === 'executive' ? 'Executive Family' : 'Village';
  const pendingInvites = invites.filter((invite) => invite.status === 'pending').length;

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
      console.log('notification settings failed', error);
      setNotificationStatus(error?.message || 'Could not update notification settings.');
    } finally {
      setSavingNotifications(false);
    }
  }, [notificationPrefs]);

  const testReminderNotification = useCallback(async () => {
    const granted = await ensureNotificationPermissions();
    if (!granted) {
      setNotificationStatus('Notification permission was not granted.');
      return;
    }
    await sendTestScheduledReminderNotification();
    setNotificationStatus('Test reminder scheduled. It should appear in about 5 seconds.');
  }, []);

  const testNewCardAlert = useCallback(async () => {
    const granted = await ensureNotificationPermissions();
    if (!granted) {
      setNotificationStatus('Notification permission was not granted.');
      return;
    }
    await sendLocalNotification('New Household COO card', 'This is how a new-card alert will appear.');
    setNotificationStatus('Test new-card alert sent on this device.');
  }, []);

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
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <AmbientBackground />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, { color: theme.colors.text }]}>Settings<Text style={styles.titleDot}>.</Text></Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>Manage household access, alerts, and preferences.</Text>

          <View style={[styles.profileCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={[styles.profileAvatar, { borderColor: theme.colors.cardBorder }]} />
            ) : (
              <View style={[styles.profileAvatar, styles.avatarFallback, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
                <Text style={[styles.avatarText, { color: theme.colors.text }]}>{(user?.name?.[0] || 'C').toUpperCase()}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.profileName, { color: theme.colors.text }]} numberOfLines={1}>{user?.name || 'Household member'}</Text>
              <Text style={[styles.profileEmail, { color: theme.colors.textMuted }]} numberOfLines={1}>{user?.email}</Text>
              <View style={[styles.planPill, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}>
                <Crown color={theme.colors.accent} size={13} />
                <Text style={[styles.planPillText, { color: theme.colors.accent }]}>{user?.is_admin ? 'Admin / Tester' : planLabel}</Text>
              </View>
            </View>
          </View>

          <SectionLabel label="Plan & overview" />
          <View style={[styles.group, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <CompactRow
              icon={<ShieldCheck color={theme.colors.accent} size={18} />}
              title={user?.is_admin ? 'Admin / Tester' : planLabel}
              subtitle={user?.is_admin ? 'All feature gates are bypassed for testing.' : `${memberSlotsUsed}/${memberLimit || 'Unlimited'} member slots used`}
              value="Plans"
              onPress={() => router.push('/pricing')}
            />
            <Divider />
            <View style={styles.miniStatsRow}>
              <MiniStat label="Members" value={`${memberSlotsUsed}/${memberLimit || '∞'}`} />
              <MiniStat label="AI scans" value={entitlements ? `${entitlements.ai_scans_used}/${entitlements.ai_scans_limit}` : `${subscription?.ai_scans_used ?? 0}/${subscription?.limits?.ai_scans_per_month ?? '∞'}`} />
              <MiniStat label="Vault" value={formatBytes(entitlements?.vault_bytes_used ?? subscription?.vault_bytes_used)} />
            </View>
          </View>

          <SectionLabel label="Household" />
          <View style={[styles.group, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <CompactRow icon={<Users color={theme.colors.accent} size={18} />} title="Family members" subtitle={`${members.length} members · ${pendingInvites} pending invite${pendingInvites === 1 ? '' : 's'}`} value={showHouseholdDetails ? 'Hide' : 'Show'} onPress={() => setShowHouseholdDetails((value) => !value)} />
            <Divider />
            <CompactRow icon={<UserPlus color={theme.colors.accent} size={18} />} title="Invite member" subtitle={`${memberSlotsUsed} of ${memberLimit || 5} slots used`} value="Invite" onPress={() => openInvite()} />
            {showHouseholdDetails ? (
              <>
                <Divider />
                {members.length === 0 ? <EmptyText text="No family members yet." /> : members.map((member) => (
                  <MemberLine key={member.member_id} member={member} />
                ))}
                {invites.length > 0 ? <Divider /> : null}
                {invites.slice(0, 3).map((invite) => (
                  <View key={invite.invite_id} style={styles.inviteLine}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.memberName, { color: theme.colors.text }]} numberOfLines={1}>{invite.email || 'Invite link'}</Text>
                      <Text style={[styles.memberRole, { color: theme.colors.textMuted }]}>{invite.status}</Text>
                    </View>
                    {invite.status === 'pending' && invite.invite_url ? (
                      <PressScale onPress={() => shareInviteLink(invite.invite_url, invite.email)} style={[styles.inlinePill, { borderColor: theme.colors.cardBorder }]}>
                        <Share2 color={theme.colors.text} size={14} />
                        <Text style={[styles.inlinePillText, { color: theme.colors.text }]}>Share</Text>
                      </PressScale>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
          </View>

          <SectionLabel label="Notifications" />
          <View style={[styles.group, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <SettingSwitch
              icon={<Bell color={theme.colors.accent} size={18} />}
              title="Card reminders"
              value={notificationPrefs.card_reminders}
              disabled={savingNotifications}
              onValueChange={() => updateNotificationPrefs({ card_reminders: !notificationPrefs.card_reminders })}
            />
            <Divider />
            <SettingSwitch
              icon={<Bell color={theme.colors.accent} size={18} />}
              title="New card alerts"
              value={notificationPrefs.new_card_alerts}
              disabled={savingNotifications}
              onValueChange={() => updateNotificationPrefs({ new_card_alerts: !notificationPrefs.new_card_alerts })}
            />
            <Divider />
            <CompactRow icon={<Bell color={theme.colors.accent} size={18} />} title="Notification testing" subtitle={notificationStatus || 'Use a development build for full push notification testing.'} value={showNotificationDetails ? 'Hide' : 'Show'} onPress={() => setShowNotificationDetails((value) => !value)} />
            {showNotificationDetails ? (
              <View style={styles.testButtonRow}>
                <SecondaryButton label="Test reminder" onPress={testReminderNotification} compact />
                <SecondaryButton label="Test alert" onPress={testNewCardAlert} compact />
              </View>
            ) : null}
          </View>

          <SectionLabel label="Preferences" />
          <View style={[styles.group, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <View style={styles.appearanceHeader}>
              <View style={styles.rowTitleWrap}>
                <IconWrap>{appearanceMode === 'light' ? <Sun color={theme.colors.accent} size={18} /> : <Moon color={theme.colors.accent} size={18} />}</IconWrap>
                <View>
                  <Text style={[styles.rowTitle, { color: theme.colors.text }]}>Appearance</Text>
                  <Text style={[styles.rowSubtitle, { color: theme.colors.textMuted }]}>{appearanceMode === 'system' ? 'System' : appearanceMode === 'light' ? 'Light mode' : 'Dark mode'}</Text>
                </View>
              </View>
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
            <Divider />
            <CompactRow icon={<Globe color={theme.colors.accent} size={18} />} title={t('language')} subtitle={LANG_NAMES[lang]} value="Change" onPress={() => setShowLang(true)} />
          </View>

          <SectionLabel label="Account, privacy & history" />
          <View style={[styles.group, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <CompactRow icon={<UserCircle color={theme.colors.accent} size={18} />} title="Account" subtitle="Sign-in health, support, and session controls." onPress={() => router.push('/account')} />
            <Divider />
            <CompactRow icon={<ShieldCheck color={theme.colors.accent} size={18} />} title="Privacy Policy" subtitle="Data handling and privacy controls." onPress={() => router.push('/privacy')} />
            <Divider />
            <CompactRow icon={<FileText color={theme.colors.accent} size={18} />} title="Terms & Support" subtitle="Testing terms, limitations, and support contact." onPress={() => router.push('/terms')} />
            <Divider />
            <CompactRow icon={<FileText color={theme.colors.accent} size={18} />} title="Completed history" subtitle={`${completedCards.length} completed card${completedCards.length === 1 ? '' : 's'}`} value={showCompletedHistory ? 'Hide' : 'Show'} onPress={() => setShowCompletedHistory((value) => !value)} />
            {showCompletedHistory ? (
              <View>
                <Divider />
                {completedCards.length === 0 ? <EmptyText text="No completed cards yet." /> : completedCards.slice(0, 6).map((card) => (
                  <View key={card.card_id} style={styles.historyLine}>
                    <Text style={[styles.memberName, { color: theme.colors.text }]} numberOfLines={1}>{card.title}</Text>
                    <Text style={[styles.memberRole, { color: theme.colors.textMuted }]} numberOfLines={1}>Done · {card.assignee || 'Family'}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Divider />
            <CompactRow icon={<Trash2 color="#DC2626" size={18} />} title="Delete account" subtitle="Request deletion of your account data." destructive onPress={() => router.push('/delete-account')} />
          </View>

          <SectionLabel label="Calendar contacts & kid PINs" />
          <View style={[styles.group, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <CompactRow icon={<CalendarDays color={theme.colors.accent} size={18} />} title="Calendar contacts" subtitle={`${calendarContacts.length} contacts from calendar sync`} value="View" onPress={() => setShowHouseholdDetails(true)} />
            {calendarContacts.slice(0, 2).map((contact) => (
              <View key={contact.email} style={styles.contactLine}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.memberName, { color: theme.colors.text }]} numberOfLines={1}>{contact.name || contact.email}</Text>
                  <Text style={[styles.memberRole, { color: theme.colors.textMuted }]} numberOfLines={1}>{contact.email}</Text>
                </View>
                <PressScale onPress={() => openInvite(contact.email)} style={[styles.inlinePill, { borderColor: theme.colors.cardBorder }]}>
                  <Text style={[styles.inlinePillText, { color: theme.colors.text }]}>Invite</Text>
                </PressScale>
              </View>
            ))}
            {childMembers.length > 0 ? <Divider /> : null}
            {childMembers.slice(0, 3).map((member) => (
              <CompactRow key={member.member_id} icon={<Lock color={theme.colors.accent} size={18} />} title={`${member.name}'s PIN`} subtitle={member.has_pin ? 'PIN set - tap to change' : 'No PIN - tap to add'} value={member.has_pin ? 'Set' : 'Add'} onPress={() => setPinMember(member)} />
            ))}
          </View>

          <PressScale testID="logout" onPress={doLogout} style={styles.logoutBtn}>
            <LogOut color="#DC2626" size={20} />
            <Text style={styles.logoutText}>{t('log_out')}</Text>
          </PressScale>
          <View style={{ height: 70 }} />
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
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>Invite co-parent</Text>
          <PressScale testID="close-invite" onPress={() => setShowInvite(false)} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder }]}><X color={theme.colors.text} size={22} /></PressScale>
        </View>
        <Text style={[styles.sheetHelp, { color: theme.colors.textMuted }]}>They will receive a join link and can sign in to join your household.</Text>
        <TextInput
          testID="invite-email"
          value={inviteEmail}
          onChangeText={setInviteEmail}
          placeholder="partner@example.com"
          placeholderTextColor={theme.colors.textSoft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
          returnKeyType="send"
        />
        {inviteResult ? <Text style={[styles.note, { color: theme.colors.textMuted }]}>{inviteResult}</Text> : null}
        {lastInviteUrl ? <SecondaryButton label="Share invite link" onPress={() => shareInviteLink(lastInviteUrl, inviteEmail)} icon={<Share2 color={theme.colors.text} size={18} />} /> : null}
        <View style={styles.sheetFooter}>
          <SecondaryButton label={t('cancel')} onPress={() => setShowInvite(false)} />
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
            style={[styles.primaryButton, { backgroundColor: theme.colors.primary }, (!inviteEmail.trim() || sending) && { opacity: 0.5 }]}
          >
            <Send color={theme.colors.primaryText} size={18} />
            <Text style={[styles.primaryButtonText, { color: theme.colors.primaryText }]}>{sending ? 'Sending...' : 'Send invite'}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>
    </View>
  );
}

function SectionLabel({ label }: { label: string }) {
  const { theme } = useStore();
  return <Text style={[styles.sectionLabel, { color: theme.colors.textMuted }]}>{label}</Text>;
}

function Divider() {
  const { theme } = useStore();
  return <View style={[styles.divider, { backgroundColor: theme.colors.cardBorder }]} />;
}

function IconWrap({ children }: { children: React.ReactNode }) {
  const { theme } = useStore();
  return <View style={[styles.iconWrap, { backgroundColor: theme.colors.accentSoft }]}>{children}</View>;
}

function CompactRow({ icon, title, subtitle, value, onPress, destructive }: { icon: React.ReactNode; title: string; subtitle?: string; value?: string; onPress?: () => void; destructive?: boolean }) {
  const { theme } = useStore();
  const content = (
    <View style={styles.compactRow}>
      <IconWrap>{icon}</IconWrap>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: destructive ? '#DC2626' : theme.colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSubtitle, { color: theme.colors.textMuted }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{value}</Text> : <ChevronRight color={theme.colors.textSoft} size={18} />}
    </View>
  );
  return onPress ? <PressScale onPress={onPress}>{content}</PressScale> : content;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  const { theme } = useStore();
  return (
    <View style={[styles.miniStat, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
      <Text style={[styles.miniStatValue, { color: theme.colors.text }]}>{value}</Text>
      <Text style={[styles.miniStatLabel, { color: theme.colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function MemberLine({ member }: { member: FamilyMember }) {
  const { theme } = useStore();
  return (
    <View style={styles.memberLine}>
      <View style={[styles.memberAvatar, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
        <Text style={[styles.memberInitial, { color: theme.colors.text }]}>{member.name[0]?.toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.memberName, { color: theme.colors.text }]}>{member.name}</Text>
        <Text style={[styles.memberRole, { color: theme.colors.textMuted }]}>{member.role}</Text>
      </View>
    </View>
  );
}

function SettingSwitch({ icon, title, value, onValueChange, disabled }: { icon: React.ReactNode; title: string; value: boolean; onValueChange: () => void; disabled?: boolean }) {
  const { theme } = useStore();
  return (
    <View style={styles.switchRow}>
      <IconWrap>{icon}</IconWrap>
      <Text style={[styles.rowTitle, { color: theme.colors.text, flex: 1 }]}>{title}</Text>
      <Switch value={value} disabled={disabled} onValueChange={onValueChange} trackColor={{ false: theme.colors.bgSoft, true: theme.colors.success }} thumbColor="#FFFFFF" />
    </View>
  );
}

function SecondaryButton({ label, onPress, icon, compact }: { label: string; onPress: () => void; icon?: React.ReactNode; compact?: boolean }) {
  const { theme } = useStore();
  return (
    <PressScale onPress={onPress} style={[styles.secondaryButton, compact && styles.secondaryButtonCompact, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.card }]}>
      {icon}
      <Text style={[styles.secondaryButtonText, { color: theme.colors.text }]}>{label}</Text>
    </PressScale>
  );
}

function EmptyText({ text }: { text: string }) {
  const { theme } = useStore();
  return <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 96 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  titleDot: { color: '#F97316' },
  subtitle: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 18, marginTop: 2, marginBottom: 12 },
  profileCard: { borderWidth: 1, borderRadius: 24, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  profileAvatar: { width: 56, height: 56, borderRadius: 9999, borderWidth: 2 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 20 },
  profileName: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, lineHeight: 23 },
  profileEmail: { fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, marginTop: 2 },
  planPill: { alignSelf: 'flex-start', marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9999, borderWidth: 1 },
  planPillText: { fontFamily: 'Inter_800ExtraBold', fontSize: 11 },
  sectionLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 12, marginBottom: 6, paddingLeft: 4, opacity: 0.76 },
  group: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, marginBottom: 4 },
  compactRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 8 },
  rowTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, lineHeight: 19 },
  rowSubtitle: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16, marginTop: 2 },
  rowValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 11 },
  divider: { height: 1, opacity: 0.85 },
  miniStatsRow: { flexDirection: 'row', gap: 8, paddingVertical: 12 },
  miniStat: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 10 },
  miniStatValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 14, lineHeight: 18 },
  miniStatLabel: { fontFamily: 'Inter_700Bold', fontSize: 9, marginTop: 2 },
  memberLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  memberAvatar: { width: 34, height: 34, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  memberInitial: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  memberName: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, lineHeight: 18 },
  memberRole: { fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16, marginTop: 1 },
  inviteLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  contactLine: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  historyLine: { paddingVertical: 8 },
  inlinePill: { minHeight: 34, borderRadius: 9999, borderWidth: 1, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 },
  inlinePillText: { fontFamily: 'Inter_800ExtraBold', fontSize: 11 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, paddingVertical: 8 },
  testButtonRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', paddingBottom: 12 },
  appearanceHeader: { paddingVertical: 10 },
  segmentWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 18, padding: 5, gap: 5, borderWidth: 1, marginBottom: 10 },
  segmentBtn: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingHorizontal: 10 },
  segmentText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  logoutBtn: { minHeight: 54, borderRadius: 20, borderWidth: 1, borderColor: '#DC2626', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, marginTop: 18 },
  logoutText: { color: '#DC2626', fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, padding: 24, paddingBottom: 120 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 24 },
  iconBtn: { width: 42, height: 42, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sheetHelp: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, marginBottom: 18 },
  input: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, fontFamily: 'Inter_500Medium', fontSize: 16 },
  note: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginTop: 12 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 18 },
  primaryButton: { minHeight: 54, borderRadius: 9999, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, flex: 1 },
  primaryButtonText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  secondaryButton: { minHeight: 54, borderRadius: 9999, borderWidth: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, flex: 1 },
  secondaryButtonCompact: { flex: 0, minHeight: 42, paddingHorizontal: 14, marginTop: 10 },
  secondaryButtonText: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  emptyText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18, paddingVertical: 10 },
});
