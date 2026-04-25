import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TextInput,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
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
} from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { PressScale } from '../../src/components/PressScale';
import { LanguageModal } from '../../src/components/LanguageModal';
import { PinPadModal } from '../../src/components/PinPadModal';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import AppToast, { ToastTone } from '../../src/components/AppToast';
import EmptyState from '../../src/components/EmptyState';
import ErrorState from '../../src/components/ErrorState';
import LoadingOverlay from '../../src/components/LoadingOverlay';

import { useStore } from '../../src/store';
import { api, FamilyMember } from '../../src/api';
import { LANG_NAMES } from '../../src/i18n';
import { logger } from '../../src/logger';

type ToastState = {
  message: string;
  tone: ToastTone;
};

export default function SettingsScreen() {
  const { user, t, lang, logout, subscription } = useStore();
  const router = useRouter();

  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [memberError, setMemberError] = useState<string | null>(null);

  const [showLang, setShowLang] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);

  const [pinMember, setPinMember] = useState<FamilyMember | null>(null);
  const [notifyOn, setNotifyOn] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'info') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2300);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        setNotifyOn(window.localStorage.getItem('coo_notify') === '1');
      } catch {
        // Ignore web storage failure.
      }
    }
  }, []);

  const load = useCallback(async () => {
    try {
      setMemberError(null);

      const res = await api.familyMembers();

      setMembers(res);
    } catch (e: any) {
      logger.warn('Settings members load failed:', e?.message || e);
      setMemberError(e?.message || 'Could not load family members.');
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const doLogout = async () => {
    await logout();
    router.replace('/');
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) return;

    setSending(true);
    setInviteResult(null);

    try {
      const res = await api.invite(inviteEmail.trim());

      if (res.sent) {
        setInviteResult(`✓ Invitation sent to ${inviteEmail}`);
        setInviteEmail('');
        showToast('Invitation sent.', 'success');
      } else {
        const message = res.error || 'Email not sent, but invite link created.';
        setInviteResult(message);
        showToast(message, 'info');
      }
    } catch (e: any) {
      logger.warn('Invite failed:', e?.message || e);
      const message = e?.message || 'Could not send invite.';
      setInviteResult(message);
      showToast(message, 'error');
    } finally {
      setSending(false);
    }
  };

  const childMembers = members.filter((m) => m.role === 'Child');

  return (
    <View style={styles.container}>
      <AmbientBackground />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>{t('settings')}</Text>

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
              </View>
            </View>
          </GlassCard>

          <View style={styles.sectionRow}>
            <Users color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>{t('family')}</Text>
          </View>

          <GlassCard>
            {memberError && members.length === 0 ? (
              <ErrorState
                title="Family unavailable"
                message={memberError}
                onRetry={load}
              />
            ) : members.length === 0 && !loadingMembers ? (
              <EmptyState
                title="No family members yet"
                message="Invite your co-parent or add children to unlock family workflows."
              />
            ) : (
              members.map((m, i) => (
                <View key={m.member_id} style={[styles.memberRow, i > 0 && styles.memberBorder]}>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberInitial}>{m.name[0]?.toUpperCase()}</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{m.name}</Text>
                    <Text style={styles.memberRole}>{m.role}</Text>
                  </View>
                </View>
              ))
            )}
          </GlassCard>

          <PressScale
            testID="open-invite"
            onPress={() => {
              setInviteEmail('');
              setInviteResult(null);
              setShowInvite(true);
            }}
            style={styles.inviteBtn}
          >
            <UserPlus color="#fff" size={16} />
            <Text style={styles.inviteBtnText}>Invite co-parent</Text>
          </PressScale>

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
                  {subscription?.grandfathered
                    ? t('plan_grandfathered')
                    : subscription
                    ? t(`plan_${subscription.plan}_tag`)
                    : ''}
                </Text>
              </View>

              {subscription?.plan === 'executive' || subscription?.plan === 'family_office' ? (
                <View style={styles.subBadge}>
                  <Sparkles color="#34D399" size={10} />
                  <Text style={styles.subBadgeText}>PRO</Text>
                </View>
              ) : null}
            </View>

            {subscription && subscription.limits.ai_scans_per_month !== -1 ? (
              <View style={styles.usageWrap}>
                <Text style={styles.usageLabel}>{t('usage_this_month')}</Text>

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

          <View style={styles.sectionRow}>
            <Lock color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>Kid PINs</Text>
          </View>

          <GlassCard>
            {childMembers.length === 0 ? (
              <Text style={styles.emptyRow}>No children to secure.</Text>
            ) : (
              childMembers.map((m, i) => (
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
                    <Text style={styles.memberRole}>
                      {m.has_pin ? 'PIN set · tap to change' : 'No PIN · tap to add'}
                    </Text>
                  </View>

                  {m.has_pin ? <Lock color="#F97316" size={14} /> : null}
                </PressScale>
              ))
            )}
          </GlassCard>

          <View style={styles.sectionRow}>
            <Bell color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>Notifications</Text>
          </View>

          <GlassCard>
            <PressScale
              testID="toggle-notify"
              onPress={async () => {
                if (Platform.OS !== 'web' || typeof window === 'undefined') {
                  showToast('Native push notifications will be enabled in the production build.', 'info');
                  return;
                }

                if (!notifyOn) {
                  if ('Notification' in window) {
                    const perm = await Notification.requestPermission();

                    if (perm === 'granted') {
                      window.localStorage.setItem('coo_notify', '1');
                      setNotifyOn(true);
                      showToast('Notifications enabled.', 'success');

                      new Notification('Household COO', {
                        body: "You'll get a ping when new cards arrive.",
                      });
                    }
                  }
                } else {
                  window.localStorage.removeItem('coo_notify');
                  setNotifyOn(false);
                  showToast('Notifications disabled.', 'info');
                }
              }}
              style={styles.actionRow}
            >
              <Text style={styles.actionLabel}>New-card alerts</Text>

              <View style={[styles.switch, notifyOn && styles.switchOn]}>
                <View style={[styles.knob, notifyOn && styles.knobOn]} />
              </View>
            </PressScale>

            <Text style={styles.notifyNote}>
              In-browser pings while the app is open. For background push, a native build + FCM is required.
            </Text>
          </GlassCard>

          <View style={styles.sectionRow}>
            <Globe color="rgba(255,255,255,0.6)" size={14} />
            <Text style={styles.sectionLabel}>{t('language')}</Text>
          </View>

          <GlassCard>
            <PressScale
              testID="settings-lang"
              onPress={() => setShowLang(true)}
              style={styles.actionRow}
            >
              <Text style={styles.actionLabel}>{t('language')}</Text>
              <Text style={styles.actionValue}>{LANG_NAMES[lang]}</Text>
            </PressScale>
          </GlassCard>

          <PressScale testID="logout" onPress={doLogout} style={styles.logoutBtn}>
            <LogOut color="#EF4444" size={16} />
            <Text style={styles.logoutText}>{t('log_out')}</Text>
          </PressScale>

          <View style={{ height: 220 }} />
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
            await load();
            showToast('PIN saved.', 'success');
            return true;
          } catch {
            showToast('Could not save PIN.', 'error');
            return false;
          }
        }}
      />

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

        {inviteResult ? <Text style={styles.resultText}>{inviteResult}</Text> : null}

        <View style={styles.sheetFooter}>
          <PressScale testID="cancel-invite" onPress={() => setShowInvite(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </PressScale>

          <PressScale
            testID="send-invite"
            onPress={sendInvite}
            disabled={sending || !inviteEmail.trim()}
            style={[styles.saveBtn, (!inviteEmail.trim() || sending) && { opacity: 0.5 }]}
          >
            <Send color="#080910" size={14} />
            <Text style={styles.saveText}>{sending ? '...' : 'Send invite'}</Text>
          </PressScale>
        </View>
      </KeyboardAwareBottomSheet>

      <LoadingOverlay visible={loadingMembers || sending} label={sending ? 'Sending invite...' : 'Loading settings...'} />

      <AppToast
        visible={Boolean(toast)}
        message={toast?.message || null}
        tone={toast?.tone || 'info'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080910' },
  safeArea: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 14 },
  title: { fontFamily: 'PlayfairDisplay_400Regular_Italic', color: '#fff', fontSize: 40, lineHeight: 46 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  avatarFallback: { backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 20 },
  name: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 17 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  email: { color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_400Regular', fontSize: 12 },
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
  sheet: {
    backgroundColor: 'rgba(20,22,32,0.98)',
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
  notifyNote: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 16,
  },
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
  usageWrap: { marginTop: 14, gap: 6 },
  usageLabel: { color: 'rgba(255,255,255,0.55)', fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase' },
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
});
