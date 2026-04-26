import React, { useCallback, useEffect, useState } from 'react';
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
import { CalendarDays, Globe, LogOut, Users, Mail, UserPlus, X, Send, Lock, Bell, Crown, Sparkles, Share2, Moon, Sun, ShieldCheck, ArrowUpRight } from 'lucide-react-native';
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
import { ensureNotificationPermissions, registerForPushNotificationsAsync, sendLocalNotification, sendTestScheduledReminderNotification, syncCardReminderNotifications } from '../../src/notifications';

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
  const [lastInviteEmail, setLastInviteEmail] = useState('');
  const [pinMember, setPinMember] = useState<FamilyMember | null>(null);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationSettings>({
    card_reminders: false,
    new_card_alerts: false,
  });
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
    } catch (e) {
      console.log(e);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doLogout = async () => {
    await logout();
    router.replace('/');
  };

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
            setSavingNotifications(false);
            return;
          }
        }

        let warning = '';

        if (nextPrefs.new_card_alerts) {
          try {
            const push = await registerForPushNotificationsAsync();

            if (push.expoPushToken) {
              await api.registerNotificationToken(push.expoPushToken, Platform.OS);
            } else if (push.error) {
              warning = push.error;
            }
          } catch (pushError: any) {
            warning = pushError?.message || 'Remote push registration failed. Local tests still work.';
          }
        }

        try {
          const saved = await api.updateNotificationSettings(nextPrefs);
          setNotificationPrefs(saved);
        } catch (backendError: any) {
          console.log('notification backend settings failed', backendError);
          setNotificationPrefs(nextPrefs);
          warning = warning || 'Backend notification preferences could not be saved, but local notifications can still be tested.';
        }

        if (nextPrefs.card_reminders) {
          try {
            const cards = await api.listCards();
            const result = await syncCardReminderNotifications(cards, true);
            setNotificationStatus(
              result.scheduled
                ? `${result.scheduled} reminder notification${result.scheduled === 1 ? '' : 's'} scheduled.`
                : warning || 'Reminder alerts are on. Add due dates and reminder times to schedule alerts.'
            );
          } catch (scheduleError: any) {
            console.log('local reminder scheduling failed', scheduleError);
            setNotificationStatus(scheduleError?.message || 'Could not schedule reminder notifications.');
          }
        } else {
          await syncCardReminderNotifications([], false).catch(() => undefined);
          setNotificationStatus(
            nextPrefs.new_card_alerts
              ? warning || 'New-card alerts are on. Use the test button to verify this device.'
              : 'Notifications are off.'
          );
        }
      } catch {
        console.log('notification settings failed', e);
        setNotificationStatus(e?.message || 'Could not update notification settings.');
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
    } catch (e: any) {
      console.log('test reminder notification failed', e);
      setNotificationStatus(e?.message || 'Could not send test notification.');
    }
  }, []);

  const testNewCardAlert = useCallback(async () => {
    try {
      const granted = await ensureNotificationPermissions();
      if (!granted) {
        setNotificationStatus('Notification permission was not granted.');
        return;
      }

      await sendLocalNotification(
        'New Household COO card',
        'This is how a new-card alert will appear.'
      );

      setNotificationStatus('Test new-card alert sent on this device.');
    } catch (e: any) {
      console.log('test new-card alert failed', e);
      setNotificationStatus(e?.message || 'Could not send test new-card alert.');
    }
  }, []);

  const memberLimit = entitlements?.max_members ?? subscription?.limits?.max_members ?? 0;
  const memberSlotsUsed =
    entitlements?.member_slots_used ??
    members.length + invites.filter((invite) => invite.status === 'pending').length;
  const memberLimitReached =
    !user?.is_admin && memberLimit > 0 && memberSlotsUsed >= memberLimit;

  const formatBytes = (bytes?: number | null) => {
    const value = bytes || 0;
    if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(0)} MB`;
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  };

  const planLabel =
    subscription?.plan === 'family_office'
      ? 'Family Office'
      : subscription?.plan === 'executive'
      ? 'Executive'
      : 'Village';

  const shareInviteLink = useCallback(
    async (inviteUrl: string, email?: string) => {
      try {
        if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(inviteUrl);
          setInviteResult(
            email
              ? `Invite link copied for ${email}.`
              : 'Invite link copied.'
          );
          return;
        }

        await Share.share({
          title: 'Join Household COO',
          message: `${user?.name || 'A family member'} invited you to join Household COO.\n\n${inviteUrl}`,
          url: inviteUrl,
        });
      } catch (e: any) {
        setInviteResult(`Could not open share sheet. Share this link manually: ${inviteUrl}`);
      }
    },
    [user?.name]
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]} >
      <AmbientBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, { color: theme.colors.text }]} >{t('settings')}</Text>

          {/* Profile */}
          <GlassCard style={{ marginTop: 12, marginBottom: 18 }}>
            <View style={styles.profileRow}>
              {user?.picture ? (
                <Image source={{ uri: user.picture }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarText}>{(user?.name?.[0] || 'C').toUpperCase()}</Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{user?.name}</Text>
                <View style={styles.emailRow}>
                  <Mail color="rgba(255,255,255,0.45)" size={11} />
                  <Text style={styles.email}>{user?.email}</Text>
                </View>

                {user?.is_admin ? (
                  <View testID="admin-badge" style={styles.adminBadge}>
                    <Crown color="#F59E0B" size={11} />
                    <Text style={styles.adminBadgeText}>Admin / Tester · all features unlocked</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </GlassCard>

          {/* Plan & access */}
          <View style={styles.sectionRow}>
            <ShieldCheck color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>Plan & access</Text>
          </View>
          <GlassCard>
            <View style={styles.planTopRow}>
              <View>
                <Text style={styles.planName}>{user?.is_admin ? 'Admin / Tester' : planLabel}</Text>
                <Text style={styles.planSub}>
                  {user?.is_admin
                    ? 'All feature gates bypassed for testing.'
                    : `${memberSlotsUsed}/${memberLimit || '∞'} member slots used`}
                </Text>
              </View>
              <PressScale
                testID="open-pricing"
                onPress={() => setShowPricing(true)}
                style={styles.upgradeMiniBtn}
              >
                <Text style={styles.upgradeMiniText}>
                  {user?.is_admin ? 'View plans' : memberLimitReached ? 'Upgrade' : 'Plans'}
                </Text>
                <ArrowUpRight color="#080910" size={13} />
              </PressScale>
            </View>

            <View style={styles.usageGrid}>
              <View style={styles.usageBox}>
                <Text style={styles.usageValue}>{memberSlotsUsed}/{memberLimit || '∞'}</Text>
                <Text style={styles.usageLabel}>Members + pending invites</Text>
              </View>
              <View style={styles.usageBox}>
                <Text style={styles.usageValue}>
                  {entitlements
                    ? `${entitlements.ai_scans_used}/${entitlements.ai_scans_limit}`
                    : `${subscription?.ai_scans_used ?? 0}/${subscription?.limits?.ai_scans_per_month ?? '∞'}`}
                </Text>
                <Text style={styles.usageLabel}>AI scans</Text>
              </View>
              <View style={styles.usageBox}>
                <Text style={styles.usageValue}>
                  {formatBytes(entitlements?.vault_bytes_used ?? subscription?.vault_bytes_used)}
                </Text>
                <Text style={styles.usageLabel}>
                  Vault / {formatBytes(entitlements?.vault_bytes_limit ?? subscription?.limits?.vault_bytes)}
                </Text>
              </View>
              <View style={styles.usageBox}>
                <Text style={styles.usageValue}>
                  {entitlements?.weekly_brief || subscription?.limits?.weekly_brief ? 'On' : 'Locked'}
                </Text>
                <Text style={styles.usageLabel}>Weekly brief</Text>
              </View>
            </View>

            {memberLimitReached ? (
              <Text style={styles.limitWarning}>
                You have reached your member limit. Upgrade before inviting another person.
              </Text>
            ) : null}
          </GlassCard>

          {/* Notifications */}
          <View style={styles.sectionRow}>
            <Bell color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>Notifications</Text>
          </View>
          <GlassCard>
            <PressScale
              testID="toggle-card-reminders"
              onPress={() =>
                updateNotificationPrefs({
                  card_reminders: !notificationPrefs.card_reminders,
                })
              }
              disabled={savingNotifications}
              style={styles.actionRow}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.actionLabel}>Reminder notifications</Text>
                <Text style={styles.actionHint}>Alerts before cards with due dates and reminder times.</Text>
              </View>
              <View style={[styles.switch, notificationPrefs.card_reminders && styles.switchOn]}>
                <View style={[styles.knob, notificationPrefs.card_reminders && styles.knobOn]} />
              </View>
            </PressScale>

            <View style={styles.memberBorder} />

            <PressScale
              testID="toggle-new-card-alerts"
              onPress={() =>
                updateNotificationPrefs({
                  new_card_alerts: !notificationPrefs.new_card_alerts,
                })
              }
              disabled={savingNotifications}
              style={styles.actionRow}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.actionLabel}>New-card alerts</Text>
                <Text style={styles.actionHint}>Alerts when another household member adds a card.</Text>
              </View>
              <View style={[styles.switch, notificationPrefs.new_card_alerts && styles.switchOn]}>
                <View style={[styles.knob, notificationPrefs.new_card_alerts && styles.knobOn]} />
              </View>
            </PressScale>

            <View style={styles.testButtonRow}>
              <PressScale
                testID="test-reminder-notification"
                onPress={testReminderNotification}
                style={styles.testBtn}
              >
                <Text style={styles.testBtnText}>Test reminder</Text>
              </PressScale>

              <PressScale
                testID="test-new-card-alert"
                onPress={testNewCardAlert}
                style={styles.testBtn}
              >
                <Text style={styles.testBtnText}>Test new-card alert</Text>
              </PressScale>
            </View>

            <Text style={styles.notifyNote}>
              {notificationStatus ||
                'Reminder alerts are scheduled on this device. New-card alerts are mainly for other signed-in family members/devices.'}
            </Text>
          </GlassCard>

          {/* Preferences */}
          <View style={styles.sectionRow}>
            <Globe color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>Preferences</Text>
          </View>
          <GlassCard>
            <View style={styles.preferenceBlock}>
              <View style={styles.preferenceHeader}>
                <View style={styles.preferenceTitleRow}>
                  {appearanceMode === 'light' ? (
                    <Sun color="#F59E0B" size={14} />
                  ) : (
                    <Moon color="#F59E0B" size={14} />
                  )}
                  <Text style={styles.actionLabel}>Appearance</Text>
                </View>
                <Text style={styles.actionValue}>
                  {appearanceMode === 'system'
                    ? 'System'
                    : appearanceMode === 'light'
                    ? 'Light'
                    : 'Dark'}
                </Text>
              </View>

              <View style={styles.segmentRow}>
                <PressScale
                  testID="appearance-dark"
                  onPress={() => setAppearance('dark')}
                  style={[styles.segmentBtn, appearanceMode === 'dark' && styles.segmentBtnActive]}
                >
                  <Text style={[styles.segmentText, appearanceMode === 'dark' && styles.segmentTextActive]}>
                    Dark
                  </Text>
                </PressScale>

                <PressScale
                  testID="appearance-light"
                  onPress={() => setAppearance('light')}
                  style={[styles.segmentBtn, appearanceMode === 'light' && styles.segmentBtnActive]}
                >
                  <Text style={[styles.segmentText, appearanceMode === 'light' && styles.segmentTextActive]}>
                    Light
                  </Text>
                </PressScale>

                <PressScale
                  testID="appearance-system"
                  onPress={() => setAppearance('system')}
                  style={[styles.segmentBtn, appearanceMode === 'system' && styles.segmentBtnActive]}
                >
                  <Text style={[styles.segmentText, appearanceMode === 'system' && styles.segmentTextActive]}>
                    System
                  </Text>
                </PressScale>
              </View>

              <Text style={styles.preferenceNote}>
                Theme preference is saved and now updates the global shell, tab bar, background glow, and landing experience.
              </Text>
            </View>

            <View style={styles.memberBorder} />

            <PressScale
              testID="settings-lang"
              onPress={() => setShowLang(true)}
              style={styles.actionRow}
            >
              <View style={styles.preferenceTitleRow}>
                <Globe color="#F59E0B" size={14} />
                <Text style={styles.actionLabel}>{t('language')}</Text>
              </View>
              <Text style={styles.actionValue}>{LANG_NAMES[lang]}</Text>
            </PressScale>
          </GlassCard>

          {/* Family */}
          <View style={styles.sectionRow}>
            <Users color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>{t('family')}</Text>
          </View>
          <GlassCard>
            {members.map((m, i) => (
              <View key={m.member_id} style={[styles.memberRow, i > 0 && styles.memberBorder]}>
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberInitial}>{m.name[0]?.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.name}</Text>
                  <Text style={styles.memberRole}>{m.role}</Text>
                </View>
              </View>
            ))}
            {members.length === 0 && (
              <Text style={styles.emptyRow}>No family members yet.</Text>
            )}
          </GlassCard>

          <PressScale
            testID="open-invite"
            onPress={() => {
              setInviteEmail('');
              setInviteResult(null);
              setLastInviteUrl(null);
              setLastInviteEmail('');
              setShowInvite(true);
            }}
            style={styles.inviteBtn}
          >
            <UserPlus color="#fff" size={16} />
            <Text style={styles.inviteBtnText}>Invite co-parent</Text>
          </PressScale>

          <GlassCard style={{ marginTop: 12 }}>
            <Text style={styles.inviteListTitle}>Invite status</Text>
            {invites.length === 0 ? (
              <Text style={styles.emptyRow}>No invites created yet.</Text>
            ) : (
              invites.map((invite) => (
                <View key={invite.invite_id} style={styles.inviteRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inviteEmailText}>{invite.email || 'Invite link'}</Text>
                    <Text style={styles.inviteStatusText}>
                      {invite.status === 'accepted'
                        ? `Accepted${invite.accepted_by_email ? ` by ${invite.accepted_by_email}` : ''}`
                        : invite.status === 'expired'
                        ? 'Expired'
                        : 'Pending'}
                    </Text>
                    {invite.status === 'pending' && invite.invite_url ? (
                      <>
                        <Text style={styles.inviteUrlText} numberOfLines={2}>
                          {invite.invite_url}
                        </Text>

                        <PressScale
                          testID={`share-invite-${invite.invite_id}`}
                          onPress={() => shareInviteLink(invite.invite_url, invite.email)}
                          style={styles.inlineShareBtn}
                        >
                          <Share2 color="#080910" size={12} />
                          <Text style={styles.inlineShareText}>Share link</Text>
                        </PressScale>
                      </>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.statusPill,
                      invite.status === 'accepted'
                        ? styles.statusAccepted
                        : invite.status === 'expired'
                        ? styles.statusExpired
                        : styles.statusPending,
                    ]}
                  >
                    <Text style={styles.statusPillText}>{invite.status}</Text>
                  </View>
                </View>
              ))
            )}
          </GlassCard>

          {/* Calendar contacts */}
          <View style={styles.sectionRow}>
            <CalendarDays color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>Calendar contacts</Text>
          </View>
          <GlassCard>
            {calendarContacts.length === 0 ? (
              <Text style={styles.emptyRow}>No calendar contacts found yet. Sync Google Calendar from the Calendar tab.</Text>
            ) : (
              calendarContacts.slice(0, 8).map((contact, index) => (
                <View key={contact.email} style={[styles.contactRow, index > 0 && styles.memberBorder]}>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberInitial}>{(contact.name?.[0] || contact.email[0] || '?').toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{contact.name || contact.email}</Text>
                    <Text style={styles.memberRole} numberOfLines={1}>
                      {contact.email} · {contact.event_count} event{contact.event_count === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <PressScale
                    testID={`invite-calendar-contact-${contact.email}`}
                    onPress={() => {
                      setInviteEmail(contact.email);
                      setInviteResult(null);
                      setLastInviteUrl(null);
                      setLastInviteEmail('');
                      setShowInvite(true);
                    }}
                    style={styles.contactInviteBtn}
                  >
                    <Text style={styles.contactInviteText}>Invite</Text>
                  </PressScale>
                </View>
              ))
            )}
          </GlassCard>

          {/* Subscription */}
          <View style={styles.sectionRow}>
            <Crown color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>{t('subscription')}</Text>
          </View>
          <GlassCard>
            <View style={styles.subRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subPlanName}>
                  {subscription ? t(`plan_${subscription.plan}`) : t('loading')}
                </Text>
                <Text style={styles.subPlanTag}>
                  {subscription?.admin_unlocked
                    ? 'Admin tester account · limits bypassed'
                    : subscription?.grandfathered
                    ? t('plan_grandfathered')
                    : subscription
                    ? t(`plan_${subscription.plan}_tag`)
                    : ''}
                </Text>
              </View>
              {subscription?.admin_unlocked ? (
                <View style={styles.adminPlanBadge}>
                  <Crown color="#F59E0B" size={10} />
                  <Text style={styles.adminPlanBadgeText}>ADMIN</Text>
                </View>
              ) : subscription?.plan === 'executive' || subscription?.plan === 'family_office' ? (
                <View style={styles.subBadge}>
                  <Sparkles color="#34D399" size={10} />
                  <Text style={styles.subBadgeText}>PRO</Text>
                </View>
              ) : null}
            </View>
            {subscription && subscription.limits.ai_scans_per_month !== -1 ? (
              <View style={styles.usageWrap}>
                <Text style={styles.usageCapsLabel}>{t('usage_this_month')}</Text>
                <View style={styles.usageBarBg}>
                  <View
                    style={[
                      styles.usageBarFill,
                      {
                        width: `${Math.min(
                          100,
                          (subscription.ai_scans_used / subscription.limits.ai_scans_per_month) * 100
                        )}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.usageText}>
                  {t('ai_scans_used', {
                    used: subscription.ai_scans_used,
                    limit: subscription.limits.ai_scans_per_month,
                  })}
                </Text>
              </View>
            ) : subscription ? (
              <View style={styles.usageWrap}>
                <Text style={styles.usageText}>{t('ai_scans_unlimited')}</Text>
              </View>
            ) : null}
            <PressScale
              testID="open-pricing"
              onPress={() => router.push('/pricing')}
              style={styles.manageBtn}
            >
              <Text style={styles.manageBtnText}>{t('manage_subscription')}</Text>
            </PressScale>
          </GlassCard>

          {/* Kid PINs */}
          <View style={styles.sectionRow}>
            <Lock color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>Kid PINs</Text>
          </View>
          <GlassCard>
            {members.filter((m) => m.role === 'Child').map((m, i) => (
              <PressScale
                key={m.member_id}
                testID={`set-pin-${m.member_id}`}
                onPress={() => setPinMember(m)}
                style={[styles.pinRow, i > 0 && styles.memberBorder]}
              >
                <View style={styles.memberAvatar}>
                  <Text style={styles.memberInitial}>{m.name[0]?.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.name}</Text>
                  <Text style={styles.memberRole}>{m.has_pin ? 'PIN set · tap to change' : 'No PIN · tap to add'}</Text>
                </View>
                {m.has_pin ? <Lock color="#F97316" size={14} /> : null}
              </PressScale>
            ))}
            {members.filter((m) => m.role === 'Child').length === 0 && (
              <Text style={styles.emptyRow}>No children to secure.</Text>
            )}
          </GlassCard>

          {/* Logout */}
          <PressScale testID="logout" onPress={doLogout} style={styles.logoutBtn}>
            <LogOut color="#EF4444" size={16} />
            <Text style={styles.logoutText}>{t('log_out')}</Text>
          </PressScale>

          <View style={{ height: 220 }} />
        </ScrollView>
      </SafeAreaView>
      <LanguageModal visible={showLang} onClose={() => setShowLang(false)} />

      {/* PIN setter */}
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

      {/* Invite modal */}
      <KeyboardAwareBottomSheet
        visible={showInvite}
        onClose={() => setShowInvite(false)}
        contentStyle={styles.sheet}
      >
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>Invite co-parent</Text>
          <PressScale testID="close-invite" onPress={() => setShowInvite(false)} style={styles.iconBtn}>
            <X color="#fff" size={18} />
          </PressScale>
        </View>

        <Text style={styles.inviteHelp}>
          They&apos;ll get an email with a join link. Signing in merges them into your family feed, calendar, vault, and kids.
        </Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          testID="invite-email"
          value={inviteEmail}
          onChangeText={setInviteEmail}
          placeholder="partner@example.com"
          placeholderTextColor="rgba(255,255,255,0.3)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={styles.input}
          returnKeyType="send"
        />

        {memberLimitReached ? (
          <Text style={styles.resultText}>
            Your current plan has no free member slots. Upgrade before sending another invite.
          </Text>
        ) : null}

        {inviteResult ? <Text style={styles.resultText}>{inviteResult}</Text> : null}

        {lastInviteUrl ? (
          <PressScale
            testID="share-created-invite"
            onPress={() => shareInviteLink(lastInviteUrl, lastInviteEmail)}
            style={styles.shareResultBtn}
          >
            <Share2 color="#080910" size={15} />
            <Text style={styles.shareResultText}>Share invite link</Text>
          </PressScale>
        ) : null}

        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-invite" onPress={() => setShowInvite(false)} style={styles.cancelBtn}>
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

                if (res.invite_url) {
                  setLastInviteUrl(res.invite_url);
                  setLastInviteEmail(submittedEmail);
                }

                if (res.sent) {
                  setInviteResult(`✓ Invitation email sent to ${submittedEmail}. Status: ${res.status}.`);
                } else if (res.invite_url) {
                  setInviteResult(
                    `⚠ Invite created, but email was not delivered. Share this link manually: ${res.invite_url}` +
                      (res.email_error ? `\n\nEmail error: ${res.email_error}` : '')
                  );
                } else {
                  setInviteResult(res.message || 'Invite created.');
                }

                setInviteEmail('');
                await load();
              } catch (e: any) {
                setInviteResult(e?.message || 'Error');
              } finally {
                setSending(false);
              }
            }}
            disabled={sending || !inviteEmail.trim()}
            style={[styles.saveBtn, (!inviteEmail.trim() || sending) && { opacity: 0.5 }]}
          >
            <Send color="#080910" size={14} />
            <Text style={styles.saveText}>{sending ? '...' : 'Send invite'}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>
      <KeyboardAwareBottomSheet
        visible={showPricing}
        onClose={() => setShowPricing(false)}
        contentStyle={styles.pricingSheet}
      >
        <PricingView embedded onClose={() => setShowPricing(false)} />
      </KeyboardAwareBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080910' },
  scroll: { paddingHorizontal: 20, paddingTop: 14 },
  title: { fontFamily: 'PlayfairDisplay_400Regular_Italic', color: '#fff', fontSize: 40, lineHeight: 46 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  avatarFallback: { backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 20 },
  name: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  email: { color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_400Regular', fontSize: 12 },
  adminBadge: {
    alignSelf: 'flex-start',
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9999,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.28)',
  },
  adminBadgeText: {
    color: '#FCD34D',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, marginBottom: 10 },
  sectionLabel: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.55)',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  memberBorder: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  memberInitial: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  memberName: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 15 },
  memberRole: { color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 2 },
  emptyRow: { color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter_400Regular', fontSize: 13, paddingVertical: 6 },
  planTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  planName: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
  },
  planSub: {
    color: 'rgba(255,255,255,0.58)',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    marginTop: 3,
  },
  upgradeMiniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  upgradeMiniText: {
    color: '#080910',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  usageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  usageBox: {
    width: '48%',
    minHeight: 74,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    padding: 12,
  },
  usageValue: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
  usageLabel: {
    color: 'rgba(255,255,255,0.48)',
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 6,
  },
  limitWarning: {
    color: '#F97316',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 14,
  },
  preferenceBlock: { paddingVertical: 2 },
  preferenceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  preferenceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preferenceNote: {
    color: 'rgba(255,255,255,0.52)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  segmentBtn: {
    flex: 1,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingVertical: 9,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  segmentText: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  segmentTextActive: { color: '#080910' },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  actionLabel: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 15 },
  actionValue: { color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter_400Regular', fontSize: 14 },
  logoutBtn: {
    marginTop: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  logoutText: { color: '#EF4444', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  inviteBtnLocked: {
    opacity: 0.72,
    backgroundColor: 'rgba(249,115,22,0.55)',
  },
  inviteBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  inviteBtnText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 14 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.5)' },
  pricingSheet: {
    padding: 0,
    paddingBottom: 24,
    maxHeight: '92%',
  },
  sheet: {
    backgroundColor: 'rgba(20,22,32,0.96)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 24,
    paddingBottom: 130,
  },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sheetTitle: { fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 26, color: '#fff' },
  iconBtn: { padding: 8, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  inviteHelp: {
    color: 'rgba(255,255,255,0.6)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 8,
  },
  label: {
    fontFamily: 'Inter_500Medium', fontSize: 11, color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase', letterSpacing: 1, marginTop: 12, marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', fontFamily: 'Inter_400Regular', fontSize: 15,
  },
  resultText: {
    marginTop: 12,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  shareResultBtn: {
    marginTop: 12,
    borderRadius: 9999,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareResultText: {
    color: '#080910',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  sheetFooter: { flexDirection: 'row', gap: 12, marginTop: 18 },
  cancelBtn: {
    flex: 1, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14, paddingVertical: 14, alignItems: 'center',
  },
  cancelText: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_500Medium', fontSize: 15 },
  saveBtn: {
    flex: 1, backgroundColor: '#fff', borderRadius: 14, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  saveText: { color: '#080910', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  pinRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10,
  },
  switch: {
    width: 44, height: 26, borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  switchOn: { backgroundColor: '#F59E0B', borderColor: '#F59E0B' },
  knob: {
    width: 20, height: 20, borderRadius: 9999, backgroundColor: '#fff',
  },
  knobOn: { alignSelf: 'flex-end' },
  testButtonRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  testBtn: {
    flex: 1,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 10,
    alignItems: 'center',
  },
  testBtnText: { color: '#FFFFFF', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  notifyNote: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
  // Subscription section
  subRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  subPlanName: { color: '#fff', fontFamily: 'PlayfairDisplay_400Regular_Italic', fontSize: 20 },
  subPlanTag: { color: 'rgba(255,255,255,0.6)', fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  subBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9999,
    backgroundColor: 'rgba(52,211,153,0.18)',
    borderWidth: 1, borderColor: 'rgba(52,211,153,0.4)',
  },
  subBadgeText: { color: '#34D399', fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.5 },
  adminPlanBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 9999,
    backgroundColor: 'rgba(245,158,11,0.16)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.38)',
  },
  adminPlanBadgeText: { color: '#FCD34D', fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.5 },
  usageWrap: { marginTop: 14, gap: 6 },
  usageCapsLabel: { color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
  usageBarBg: {
    height: 6, borderRadius: 9999, backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  usageBarFill: {
    height: '100%', borderRadius: 9999, backgroundColor: '#34D399',
  },
  usageText: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_400Regular', fontSize: 12 },
  manageBtn: {
    marginTop: 14, paddingVertical: 12, borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  manageBtnText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  inviteListTitle: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
    marginBottom: 10,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  inviteEmailText: {
    color: '#fff',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  inviteStatusText: {
    color: 'rgba(255,255,255,0.55)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    marginTop: 2,
  },
  inviteUrlText: {
    color: 'rgba(255,255,255,0.38)',
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
    marginTop: 4,
  },
  inlineShareBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderRadius: 9999,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineShareText: {
    color: '#080910',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  statusPill: {
    borderRadius: 9999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
  },
  statusPending: {
    backgroundColor: 'rgba(245,158,11,0.14)',
    borderColor: 'rgba(245,158,11,0.38)',
  },
  statusAccepted: {
    backgroundColor: 'rgba(16,185,129,0.14)',
    borderColor: 'rgba(16,185,129,0.38)',
  },
  statusExpired: {
    backgroundColor: 'rgba(239,68,68,0.14)',
    borderColor: 'rgba(239,68,68,0.38)',
  },
  statusPillText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    textTransform: 'uppercase',
  },
});
