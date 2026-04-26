import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Platform, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Bell, CalendarDays, ChevronRight, Crown, Globe, Lock, LogOut, Mail, Moon, Send, Share2, ShieldCheck, Sun, UserPlus, Users, X } from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { PressScale } from '../../src/components/PressScale';
import { LanguageModal } from '../../src/components/LanguageModal';
import { PinPadModal } from '../../src/components/PinPadModal';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import { useStore } from '../../src/store';
import { api, CalendarContact, Entitlements, FamilyInvite, FamilyMember, NotificationSettings } from '../../src/api';
import { LANG_NAMES } from '../../src/i18n';
import { ensureNotificationPermissions, registerForPushNotificationsAsync, sendLocalNotification, sendTestScheduledReminderNotification, syncCardReminderNotifications } from '../../src/notifications';

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

  useEffect(() => { load(); }, [load]);

  const memberLimit = entitlements?.max_members ?? subscription?.limits?.max_members ?? 0;
  const memberSlotsUsed = entitlements?.member_slots_used ?? members.length + invites.filter((invite) => invite.status === 'pending').length;
  const childMembers = useMemo(() => members.filter((m) => m.role === 'Child'), [members]);
  const planLabel = subscription?.plan === 'family_office' ? 'Family Office' : subscription?.plan === 'executive' ? 'Executive Family' : 'Village';

  const shareInviteLink = useCallback(async (inviteUrl: string, email?: string | null) => {
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
        if (push.expoPushToken) await api.registerNotificationToken(push.expoPushToken, Platform.OS);
        else if (push.error) warning = push.error;
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
          <Text style={[styles.title, { color: theme.colors.text }]}>Settings</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>Manage your household, access, alerts, and preferences.</Text>

          <GlassCard style={styles.profileCard}>
            <View style={styles.profileRow}>
              {user?.picture ? (
                <Image source={{ uri: user.picture }} style={[styles.avatar, { borderColor: theme.colors.cardBorder }]} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
                  <Text style={[styles.avatarText, { color: theme.colors.text }]}>{(user?.name?.[0] || 'C').toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: theme.colors.text }]} numberOfLines={1}>{user?.name || 'Household member'}</Text>
                <View style={styles.emailRow}>
                  <Mail color={theme.colors.textSoft} size={16} />
                  <Text style={[styles.email, { color: theme.colors.textMuted }]} numberOfLines={1}>{user?.email}</Text>
                </View>
                {user?.is_admin ? (
                  <View style={[styles.badge, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}>
                    <Crown color={theme.colors.accent} size={16} />
                    <Text style={[styles.badgeText, { color: theme.colors.accent }]}>Admin / Tester · all features unlocked</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </GlassCard>

          <SectionTitle icon={<ShieldCheck color={theme.colors.textMuted} size={18} />} label="Plan & access" color={theme.colors.textMuted} />
          <GlassCard>
            <View style={styles.cardHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: theme.colors.text }]}>{user?.is_admin ? 'Admin / Tester' : planLabel}</Text>
                <Text style={[styles.cardSub, { color: theme.colors.textMuted }]}>{user?.is_admin ? 'All feature gates are bypassed for testing.' : `${memberSlotsUsed}/${memberLimit || '∞'} member slots used`}</Text>
              </View>
              <PressScale testID="open-pricing" onPress={() => router.push('/pricing')} style={[styles.primaryPill, { backgroundColor: theme.colors.primary }]}>
                <Text style={[styles.primaryPillText, { color: theme.colors.primaryText }]}>View plans</Text>
              </PressScale>
            </View>
            <View style={styles.statGrid}>
              <StatBox label="Members" value={`${memberSlotsUsed}/${memberLimit || '∞'}`} />
              <StatBox label="AI scans" value={entitlements ? `${entitlements.ai_scans_used}/${entitlements.ai_scans_limit}` : `${subscription?.ai_scans_used ?? 0}/${subscription?.limits?.ai_scans_per_month ?? '∞'}`} />
              <StatBox label="Vault" value={formatBytes(entitlements?.vault_bytes_used ?? subscription?.vault_bytes_used)} />
              <StatBox label="Weekly brief" value={entitlements?.weekly_brief || subscription?.limits?.weekly_brief ? 'On' : 'Locked'} />
            </View>
          </GlassCard>

          <SectionTitle icon={<Bell color={theme.colors.textMuted} size={18} />} label="Notifications" color={theme.colors.textMuted} />
          <GlassCard>
            <SettingSwitch
              title="Reminder notifications"
              description="Alerts before cards with due dates and reminder times."
              value={notificationPrefs.card_reminders}
              disabled={savingNotifications}
              onValueChange={() => updateNotificationPrefs({ card_reminders: !notificationPrefs.card_reminders })}
            />
            <Divider />
            <SettingSwitch
              title="New-card alerts"
              description="Alerts when another household member adds a card."
              value={notificationPrefs.new_card_alerts}
              disabled={savingNotifications}
              onValueChange={() => updateNotificationPrefs({ new_card_alerts: !notificationPrefs.new_card_alerts })}
            />
            <View style={styles.testButtonRow}>
              <SecondaryButton label="Test reminder" onPress={testReminderNotification} />
              <SecondaryButton label="Test new-card alert" onPress={testNewCardAlert} />
            </View>
            <Text style={[styles.note, { color: theme.colors.textMuted }]}>{notificationStatus || 'Use a development build for full push notification testing.'}</Text>
          </GlassCard>

          <SectionTitle icon={<Globe color={theme.colors.textMuted} size={18} />} label="Preferences" color={theme.colors.textMuted} />
          <GlassCard>
            <View style={styles.preferenceHeader}>
              <View style={styles.preferenceTitleRow}>
                {appearanceMode === 'light' ? <Sun color={theme.colors.accent} size={22} /> : <Moon color={theme.colors.accent} size={22} />}
                <Text style={[styles.rowTitle, { color: theme.colors.text }]}>Appearance</Text>
              </View>
              <Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{appearanceMode === 'system' ? 'System' : appearanceMode === 'light' ? 'Light' : 'Dark'}</Text>
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
            <Text style={[styles.note, { color: theme.colors.textMuted }]}>Light mode uses solid cards, dark text, and open spacing for comfortable family use.</Text>
            <Divider />
            <PressScale testID="settings-lang" onPress={() => setShowLang(true)} style={styles.navRow}>
              <View style={styles.preferenceTitleRow}>
                <Globe color={theme.colors.accent} size={22} />
                <Text style={[styles.rowTitle, { color: theme.colors.text }]}>{t('language')}</Text>
              </View>
              <View style={styles.navRight}>
                <Text style={[styles.rowValue, { color: theme.colors.textMuted }]}>{LANG_NAMES[lang]}</Text>
                <ChevronRight color={theme.colors.textSoft} size={22} />
              </View>
            </PressScale>
          </GlassCard>

          <SectionTitle icon={<Users color={theme.colors.textMuted} size={18} />} label="Family" color={theme.colors.textMuted} />
          <GlassCard>
            {members.length === 0 ? <EmptyText text="No family members yet." /> : members.map((member, index) => (
              <View key={member.member_id}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.memberRow}>
                  <View style={[styles.memberAvatar, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                    <Text style={[styles.memberInitial, { color: theme.colors.text }]}>{member.name[0]?.toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.memberName, { color: theme.colors.text }]}>{member.name}</Text>
                    <Text style={[styles.memberRole, { color: theme.colors.textMuted }]}>{member.role}</Text>
                  </View>
                </View>
              </View>
            ))}
          </GlassCard>
          <SecondaryButton label="Invite co-parent" onPress={() => openInvite()} icon={<UserPlus color={theme.colors.text} size={20} />} />

          <GlassCard style={styles.topGap}>
            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Invite status</Text>
            {invites.length === 0 ? <EmptyText text="No invites created yet." /> : invites.map((invite) => (
              <View key={invite.invite_id} style={styles.inviteRow}>
                <Text style={[styles.memberName, { color: theme.colors.text }]}>{invite.email || 'Invite link'}</Text>
                <Text style={[styles.memberRole, { color: theme.colors.textMuted }]}>{invite.status}</Text>
                {invite.status === 'pending' && invite.invite_url ? (
                  <SecondaryButton label="Share link" onPress={() => shareInviteLink(invite.invite_url, invite.email)} icon={<Share2 color={theme.colors.text} size={16} />} compact />
                ) : null}
              </View>
            ))}
          </GlassCard>

          <SectionTitle icon={<CalendarDays color={theme.colors.textMuted} size={18} />} label="Calendar contacts" color={theme.colors.textMuted} />
          <GlassCard>
            {calendarContacts.length === 0 ? <EmptyText text="No calendar contacts found yet. Sync Google Calendar from the Calendar tab." /> : calendarContacts.slice(0, 8).map((contact, index) => (
              <View key={contact.email}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.memberRow}>
                  <View style={[styles.memberAvatar, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                    <Text style={[styles.memberInitial, { color: theme.colors.text }]}>{(contact.name?.[0] || contact.email[0] || '?').toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.memberName, { color: theme.colors.text }]}>{contact.name || contact.email}</Text>
                    <Text style={[styles.memberRole, { color: theme.colors.textMuted }]} numberOfLines={1}>{contact.email}</Text>
                  </View>
                  <PressScale testID={`invite-calendar-contact-${contact.email}`} onPress={() => openInvite(contact.email)} style={[styles.smallInvite, { borderColor: theme.colors.cardBorder }]}>
                    <Text style={[styles.smallInviteText, { color: theme.colors.text }]}>Invite</Text>
                  </PressScale>
                </View>
              </View>
            ))}
          </GlassCard>

          <SectionTitle icon={<Lock color={theme.colors.textMuted} size={18} />} label="Kid PINs" color={theme.colors.textMuted} />
          <GlassCard>
            {childMembers.length === 0 ? <EmptyText text="No children to secure." /> : childMembers.map((member) => (
              <PressScale key={member.member_id} testID={`set-pin-${member.member_id}`} onPress={() => setPinMember(member)} style={styles.memberRow}>
                <View style={[styles.memberAvatar, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                  <Text style={[styles.memberInitial, { color: theme.colors.text }]}>{member.name[0]?.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.memberName, { color: theme.colors.text }]}>{member.name}</Text>
                  <Text style={[styles.memberRole, { color: theme.colors.textMuted }]}>{member.has_pin ? 'PIN set · tap to change' : 'No PIN · tap to add'}</Text>
                </View>
                {member.has_pin ? <Lock color={theme.colors.accent} size={18} /> : <ChevronRight color={theme.colors.textSoft} size={22} />}
              </PressScale>
            ))}
          </GlassCard>

          <PressScale testID="logout" onPress={doLogout} style={styles.logoutBtn}>
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
          <Text style={[styles.sheetTitle, { color: theme.colors.text }]}>Invite co-parent</Text>
          <PressScale testID="close-invite" onPress={() => setShowInvite(false)} style={[styles.iconBtn, { borderColor: theme.colors.cardBorder }]}>
            <X color={theme.colors.text} size={22} />
          </PressScale>
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

function SectionTitle({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return <View style={styles.sectionRow}>{icon}<Text style={[styles.sectionLabel, { color }]}>{label}</Text></View>;
}

function Divider() {
  const { theme } = useStore();
  return <View style={[styles.divider, { backgroundColor: theme.colors.cardBorder }]} />;
}

function EmptyText({ text }: { text: string }) {
  const { theme } = useStore();
  return <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>{text}</Text>;
}

function StatBox({ label, value }: { label: string; value: string }) {
  const { theme } = useStore();
  return (
    <View style={[styles.statBox, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
      <Text style={[styles.statValue, { color: theme.colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.colors.textMuted }]}>{label}</Text>
    </View>
  );
}

function SecondaryButton({ label, onPress, testID, icon, compact }: { label: string; onPress: () => void; testID?: string; icon?: React.ReactNode; compact?: boolean }) {
  const { theme } = useStore();
  return (
    <PressScale testID={testID} onPress={onPress} style={[styles.secondaryButton, compact && styles.secondaryButtonCompact, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.card }]}>
      {icon}
      <Text style={[styles.secondaryButtonText, { color: theme.colors.text }]}>{label}</Text>
    </PressScale>
  );
}

function SettingSwitch({ title, description, value, onValueChange, disabled }: { title: string; description: string; value: boolean; onValueChange: () => void; disabled?: boolean }) {
  const { theme } = useStore();
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: theme.colors.text }]}>{title}</Text>
        <Text style={[styles.rowDescription, { color: theme.colors.textMuted }]}>{description}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.bgSoft, true: theme.colors.success }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 18 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 40, lineHeight: 46, letterSpacing: -0.9 },
  subtitle: { fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 23, marginTop: 6, marginBottom: 18 },
  profileCard: { marginBottom: 18 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 76, height: 76, borderRadius: 9999, borderWidth: 1 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 26 },
  name: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, lineHeight: 28 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  email: { fontFamily: 'Inter_500Medium', fontSize: 15, flex: 1 },
  badge: { alignSelf: 'flex-start', marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9999, borderWidth: 1 },
  badgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 12 },
  sectionLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1.2 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  cardTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 21, lineHeight: 27 },
  cardSub: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, marginTop: 4 },
  primaryPill: { minHeight: 48, borderRadius: 9999, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  primaryPillText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 18 },
  statBox: { width: '48%', minHeight: 92, borderRadius: 22, borderWidth: 1, padding: 16, justifyContent: 'center' },
  statValue: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, lineHeight: 27 },
  statLabel: { fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 4 },
  rowTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, lineHeight: 24 },
  rowDescription: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, marginTop: 5 },
  testButtonRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 20 },
  note: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, marginTop: 16 },
  preferenceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  preferenceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowValue: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  segmentWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 24, padding: 7, gap: 8, borderWidth: 1, minHeight: 64 },
  segmentBtn: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: 18, paddingHorizontal: 12 },
  segmentText: { fontFamily: 'Inter_800ExtraBold', fontSize: 16 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56 },
  navRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  divider: { height: 1, opacity: 0.9, marginVertical: 18 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  memberAvatar: { width: 58, height: 58, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  memberInitial: { fontFamily: 'Inter_800ExtraBold', fontSize: 18 },
  memberName: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, lineHeight: 23 },
  memberRole: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginTop: 2 },
  secondaryButton: { minHeight: 54, borderRadius: 9999, borderWidth: 1, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: 14 },
  secondaryButtonCompact: { alignSelf: 'flex-start', minHeight: 46, marginTop: 10 },
  secondaryButtonText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  topGap: { marginTop: 18 },
  inviteRow: { paddingVertical: 14 },
  emptyText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 23 },
  smallInvite: { borderWidth: 1, borderRadius: 9999, paddingHorizontal: 14, paddingVertical: 9 },
  smallInviteText: { fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  logoutBtn: { minHeight: 58, borderRadius: 22, borderWidth: 1, borderColor: '#DC2626', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, marginTop: 24 },
  logoutText: { color: '#DC2626', fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, padding: 24, paddingBottom: 120 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 24 },
  iconBtn: { width: 42, height: 42, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sheetHelp: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, marginBottom: 18 },
  input: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, fontFamily: 'Inter_500Medium', fontSize: 16 },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 18 },
  primaryButton: { minHeight: 54, borderRadius: 9999, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, flex: 1 },
  primaryButtonText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
