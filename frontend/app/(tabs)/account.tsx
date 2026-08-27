import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import {
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  KeyRound,
  LifeBuoy,
  LogOut,
  Mail,
  ShieldCheck,
  Trash2,
  X,
  Send,
} from 'lucide-react-native';

import { PressScale } from '../../src/components/PressScale';
import { PasswordInput } from '../../src/components/PasswordInput';
import { Badge, Card, IconTile, SectionTitle, useUI, UIColors } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { AuthDiagnosticResult, runAuthDiagnostics } from '../../src/authDiagnostics';
import { api } from '../../src/api';

function ListRow({
  tile,
  title,
  subtitle,
  right,
  danger,
  onPress,
  testID,
  divider = true,
}: {
  tile: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  danger?: boolean;
  onPress?: () => void;
  testID?: string;
  divider?: boolean;
}) {
  const ui = useUI();
  const styles = createStyles(ui);
  return (
    <PressScale testID={testID} onPress={onPress} style={[styles.row, divider && styles.rowDivider]}>
      {tile}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowTitle, danger && { color: ui.danger }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right !== undefined ? right : <ChevronRight color={ui.muted} size={18} />}
    </PressScale>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const { user, logout, refreshUser, t } = useStore();
  const { theme } = useStore();
  const ui = useUI();
  const styles = createStyles(ui);
  const [diagnostics, setDiagnostics] = useState<AuthDiagnosticResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportSending, setSupportSending] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const name = user?.name || t('acc_default_name');
  const email = user?.email || t('acc_not_signed_in');
  const initial = (name.trim()[0] || 'H').toUpperCase();

  const doLogout = async () => {
    await logout();
    router.replace('/');
  };

  const checkSession = async () => {
    setChecking(true);
    try {
      const result = await runAuthDiagnostics();
      setDiagnostics(result);
      if (result.session_valid) await refreshUser();
    } finally {
      setChecking(false);
    }
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/settings');
  };

  const submitChangePassword = async () => {
    if (pwSaving) return;
    if (pwNew.length < 8) {
      Alert.alert(t('acc_pw_weak_title'), t('acc_pw_weak_msg'));
      return;
    }
    setPwSaving(true);
    try {
      await api.changePassword({ current_password: pwCurrent, new_password: pwNew });
      setPwOpen(false);
      setPwCurrent('');
      setPwNew('');
      Alert.alert(t('acc_pw_done_title'), t('acc_pw_done_msg'));
    } catch (e: any) {
      Alert.alert(t('acc_pw_error_title'), e?.message || t('acc_pw_error_msg'));
    } finally {
      setPwSaving(false);
    }
  };

  const submitSupport = async () => {
    if (supportSending) return;
    const subj = supportSubject.trim();
    const msg = supportMessage.trim();
    if (!subj || !msg) {
      Alert.alert(t('acc_missing_fields_title'), t('acc_missing_fields_msg'));
      return;
    }
    setSupportSending(true);
    try {
      await api.submitSupportRequest({ subject: subj, message: msg });
      setSupportOpen(false);
      setSupportSubject('');
      setSupportMessage('');
      Alert.alert(t('acc_sent_title'), t('acc_sent_msg'));
    } catch {
      Alert.alert(t('acc_error_title'), t('acc_send_error_msg'));
    } finally {
      setSupportSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.navRow}>
            <PressScale testID="account-back" accessibilityRole="button" accessibilityLabel={t('a11y_back')} onPress={goBack} style={styles.backBtn}>
              <ChevronLeft color={ui.text} size={22} />
            </PressScale>
            <Text style={styles.navTitle}>{t('acc_title')}</Text>
            <View style={styles.backBtn} />
          </View>

          {/* Profile */}
          <Card style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <Text style={styles.email} numberOfLines={1}>{email}</Text>
            <View style={styles.badgeRow}>
              <Badge label={t('acc_badge_owner')} bg={ui.soft} color={ui.muted} />
              <Badge label={t('acc_badge_verified')} bg={ui.mint} color={ui.mintText} />
            </View>
          </Card>

          {/* Sign-in & connections */}
          <SectionTitle style={styles.sectionGap}>{t('acc_section_signin')}</SectionTitle>
          <Card style={styles.cardPad}>
            <ListRow
              tile={
                user?.has_password
                  ? <IconTile bg={ui.blue}><Mail color={ui.blueText} size={18} /></IconTile>
                  : <IconTile bg={ui.blue}><Text style={styles.googleG}>G</Text></IconTile>
              }
              title={user?.has_password ? t('acc_email_account') : t('acc_google_account')}
              subtitle={user?.email ? `${t('acc_connected')} · ${user.email}` : t('acc_not_connected')}
              right={<CheckCircle2 color={ui.mintText} size={20} />}
            />
            <ListRow
              tile={<IconTile bg={ui.mint}><CalendarCheck color={ui.mintText} size={18} /></IconTile>}
              title={t('acc_calendar_sync')}
              subtitle={diagnostics?.session_valid ? t('acc_session_healthy') : t('acc_open_calendar')}
              onPress={() => router.navigate('/(tabs)/calendar')}
            />
            <ListRow
              testID="run-auth-diagnostics"
              tile={<IconTile bg={ui.orangeSoft}><ShieldCheck color={ui.orange} size={18} /></IconTile>}
              title={t('acc_signin_health')}
              subtitle={checking ? t('acc_checking') : t('acc_verify_session')}
              right={
                <Text style={styles.actionLink}>{checking ? '…' : t('acc_check')}</Text>
              }
              onPress={checkSession}
            />
            {user?.has_password ? (
              <ListRow
                testID="change-password"
                tile={<IconTile bg={ui.soft}><KeyRound color={ui.text} size={18} /></IconTile>}
                title={t('acc_change_password')}
                subtitle={t('acc_change_password_sub')}
                right={<Text style={styles.actionLink}>{t('acc_change')}</Text>}
                onPress={() => setPwOpen(true)}
                divider={false}
              />
            ) : null}
          </Card>

          {diagnostics ? (
            <Card style={[styles.cardPad, styles.diagCard]}>
              <DiagLine label={t('acc_diag_local_token')} value={diagnostics.local_token ? t('acc_diag_stored') : t('acc_diag_missing')} good={diagnostics.local_token} />
              <DiagLine label={t('acc_diag_backend')} value={diagnostics.backend_online ? t('acc_diag_online') : t('acc_diag_unavailable')} good={diagnostics.backend_online} />
              <DiagLine label={t('acc_diag_session')} value={diagnostics.session_valid ? t('acc_diag_valid') : t('acc_diag_invalid')} good={diagnostics.session_valid} />
              {diagnostics.session_email ? <DiagLine label={t('acc_diag_email')} value={diagnostics.session_email} /> : null}
              {diagnostics.session_is_admin ? <DiagLine label={t('acc_diag_admin')} value={t('acc_diag_tester_bypass')} good /> : null}
              {diagnostics.error ? <Text style={styles.diagError}>{diagnostics.error}</Text> : null}
            </Card>
          ) : null}

          {/* Legal & support */}
          <SectionTitle style={styles.sectionGap}>{t('acc_section_legal')}</SectionTitle>
          <Card style={styles.cardPad}>
            <ListRow
              tile={<IconTile bg={ui.orangeSoft}><LifeBuoy color={ui.orange} size={18} /></IconTile>}
              title={t('acc_contact_support')}
              onPress={() => setSupportOpen(true)}
            />
            <ListRow
              testID="open-terms-support"
              tile={<IconTile bg={ui.orangeSoft}><FileText color={ui.orange} size={18} /></IconTile>}
              title={t('acc_terms')}
              onPress={() => router.push('/terms')}
            />
            <ListRow
              testID="open-privacy-policy"
              tile={<IconTile bg={ui.orangeSoft}><ShieldCheck color={ui.orange} size={18} /></IconTile>}
              title={t('acc_privacy')}
              onPress={() => router.push('/privacy')}
              divider={false}
            />
          </Card>

          {/* Account actions */}
          <SectionTitle style={[styles.sectionGap, { color: ui.danger }]}>{t('acc_section_actions')}</SectionTitle>
          <Card style={[styles.cardPad, { borderColor: 'rgba(220,38,38,0.18)' }]}>
            <ListRow
              testID="account-logout"
              tile={<IconTile bg={ui.dangerSoft}><LogOut color={ui.danger} size={18} /></IconTile>}
              title={t('acc_logout')}
              danger
              right={null}
              onPress={doLogout}
            />
            <ListRow
              testID="open-account-deletion"
              tile={<IconTile bg={ui.dangerSoft}><Trash2 color={ui.danger} size={18} /></IconTile>}
              title={t('acc_delete_account')}
              danger
              right={null}
              onPress={() => router.push('/delete-account')}
              divider={false}
            />
          </Card>

          <View style={{ height: 150 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Support Contact Form Modal */}
      <Modal visible={supportOpen} transparent animationType="fade" onRequestClose={() => setSupportOpen(false)}>
        <BlurView intensity={40} tint={theme.mode === 'light' ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
        <View style={[styles.modalBackdrop, { backgroundColor: theme.mode === 'light' ? 'rgba(255,255,255,0.52)' : 'rgba(8,9,16,0.6)' }]} />
        <KeyboardAvoidingView style={styles.modalCenter} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{t('acc_contact_support')}</Text>
              <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={() => setSupportOpen(false)} style={[styles.modalCloseBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
                <X color={theme.colors.text} size={18} />
              </PressScale>
            </View>

            <Text style={[styles.modalLabel, { color: theme.colors.textMuted }]}>{t('acc_subject')}</Text>
            <TextInput
              style={[styles.modalInput, { color: theme.colors.text, borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
              value={supportSubject}
              onChangeText={setSupportSubject}
              placeholder={t('acc_subject_placeholder')}
              placeholderTextColor={theme.colors.textMuted}
              maxLength={200}
              returnKeyType="next"
            />

            <Text style={[styles.modalLabel, { color: theme.colors.textMuted }]}>{t('acc_message')}</Text>
            <TextInput
              style={[styles.modalInput, styles.modalTextArea, { color: theme.colors.text, borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
              value={supportMessage}
              onChangeText={setSupportMessage}
              placeholder={t('acc_message_placeholder')}
              placeholderTextColor={theme.colors.textMuted}
              maxLength={5000}
              multiline
              textAlignVertical="top"
            />

            <PressScale
              onPress={submitSupport}
              disabled={supportSending}
              style={[styles.modalSendBtn, { backgroundColor: theme.colors.primary, opacity: supportSending ? 0.6 : 1 }]}
            >
              <Send color={theme.colors.primaryText} size={16} />
              <Text style={[styles.modalSendText, { color: theme.colors.primaryText }]}>
                {supportSending ? t('acc_sending') : t('acc_send_message')}
              </Text>
            </PressScale>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={pwOpen} transparent animationType="fade" onRequestClose={() => setPwOpen(false)}>
        <BlurView intensity={40} tint={theme.mode === 'light' ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
        <View style={[styles.modalBackdrop, { backgroundColor: theme.mode === 'light' ? 'rgba(255,255,255,0.52)' : 'rgba(8,9,16,0.6)' }]} />
        <KeyboardAvoidingView style={styles.modalCenter} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalSheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>{t('acc_change_password')}</Text>
              <PressScale
                accessibilityRole="button"
                accessibilityLabel={t('close')} onPress={() => setPwOpen(false)} style={[styles.modalCloseBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
                <X color={theme.colors.text} size={18} />
              </PressScale>
            </View>

            <Text style={[styles.modalLabel, { color: theme.colors.textMuted }]}>{t('acc_pw_current')}</Text>
            <PasswordInput
              testID="pw-current"
              style={[styles.modalInput, { color: theme.colors.text, borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
              value={pwCurrent}
              onChangeText={setPwCurrent}
              placeholder={t('acc_pw_current_ph')}
              placeholderTextColor={theme.colors.textMuted}
              eyeColor={theme.colors.textMuted}
              showLabel={t('a11y_show_password')}
              hideLabel={t('a11y_hide_password')}
            />

            <Text style={[styles.modalLabel, { color: theme.colors.textMuted }]}>{t('acc_pw_new')}</Text>
            <PasswordInput
              testID="pw-new"
              style={[styles.modalInput, { color: theme.colors.text, borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}
              value={pwNew}
              onChangeText={setPwNew}
              placeholder={t('acc_pw_new_ph')}
              placeholderTextColor={theme.colors.textMuted}
              eyeColor={theme.colors.textMuted}
              showLabel={t('a11y_show_password')}
              hideLabel={t('a11y_hide_password')}
            />

            <PressScale
              testID="pw-submit"
              onPress={submitChangePassword}
              disabled={pwSaving || !pwCurrent || pwNew.length < 8}
              style={[styles.modalSendBtn, { backgroundColor: theme.colors.primary, opacity: pwSaving || !pwCurrent || pwNew.length < 8 ? 0.6 : 1 }]}
            >
              <KeyRound color={theme.colors.primaryText} size={16} />
              <Text style={[styles.modalSendText, { color: theme.colors.primaryText }]}>
                {pwSaving ? t('acc_pw_saving') : t('acc_pw_update')}
              </Text>
            </PressScale>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function DiagLine({ label, value, good }: { label: string; value: string; good?: boolean }) {
  const ui = useUI();
  const styles = createStyles(ui);
  return (
    <View style={styles.diagLine}>
      <Text style={styles.diagLabel}>{label}</Text>
      <Text style={[styles.diagValue, { color: good === false ? ui.danger : good === true ? ui.mintText : ui.text }]}>{value}</Text>
    </View>
  );
}

const createStyles = (ui: UIColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 190 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginBottom: 14 },
  backBtn: { width: 40, height: 40, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  navTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 20, letterSpacing: -0.3 },

  profileCard: { alignItems: 'center', paddingVertical: 22, paddingHorizontal: 18, marginBottom: 18 },
  avatar: { width: 66, height: 66, borderRadius: 99, backgroundColor: ui.orangeDeep, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 26 },
  name: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, lineHeight: 24 },
  email: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 3 },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },

  sectionGap: { marginTop: 6, marginBottom: 10 },
  cardPad: { paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: ui.line },
  rowTitle: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 14.5 },
  rowSub: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  googleG: { color: ui.blueText, fontFamily: 'Inter_800ExtraBold', fontSize: 18 },
  actionLink: { color: ui.orangeText, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  diagCard: { marginTop: 12, paddingVertical: 14, gap: 9 },
  diagLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 14 },
  diagLabel: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  diagValue: { flex: 1, textAlign: 'right', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  diagError: { color: ui.danger, fontFamily: 'Inter_700Bold', fontSize: 13, lineHeight: 19, marginTop: 4 },

  modalBackdrop: { ...StyleSheet.absoluteFill },
  modalCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24 },
  modalSheet: { width: '100%', maxWidth: 400, borderRadius: 22, borderWidth: 1, padding: 24, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 20, letterSpacing: -0.3 },
  modalCloseBtn: { width: 34, height: 34, borderRadius: 99, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modalLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13, marginBottom: 6 },
  modalInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 15, marginBottom: 16 },
  modalTextArea: { minHeight: 120 },
  modalSendBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, marginTop: 4 },
  modalSendText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
