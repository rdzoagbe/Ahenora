import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FileText, LifeBuoy, LogOut, RefreshCw, ShieldCheck, Trash2, UserCircle } from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { PressScale } from '../../src/components/PressScale';
import { useStore } from '../../src/store';
import { AuthDiagnosticResult, runAuthDiagnostics } from '../../src/authDiagnostics';

function Row({ icon, title, subtitle, danger, onPress, testID }: { icon: React.ReactNode; title: string; subtitle: string; danger?: boolean; onPress: () => void; testID: string }) {
  const { theme } = useStore();
  const color = danger ? '#DC2626' : theme.colors.text;
  return (
    <PressScale testID={testID} onPress={onPress} style={[styles.row, { borderColor: theme.colors.cardBorder }]}> 
      <View style={[styles.iconBox, { backgroundColor: danger ? 'rgba(220,38,38,0.10)' : theme.colors.bgSoft, borderColor: danger ? 'rgba(220,38,38,0.25)' : theme.colors.cardBorder }]}> 
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color }]}>{title}</Text>
        <Text style={[styles.rowSub, { color: theme.colors.textMuted }]}>{subtitle}</Text>
      </View>
    </PressScale>
  );
}

function DiagnosticLine({ label, value, good }: { label: string; value: string; good?: boolean }) {
  const { theme } = useStore();
  return (
    <View style={styles.diagnosticLine}>
      <Text style={[styles.diagnosticLabel, { color: theme.colors.textMuted }]}>{label}</Text>
      <Text style={[styles.diagnosticValue, { color: good === false ? '#DC2626' : good === true ? theme.colors.success : theme.colors.text }]}>{value}</Text>
    </View>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const { user, logout, refreshUser, theme } = useStore();
  const [diagnostics, setDiagnostics] = useState<AuthDiagnosticResult | null>(null);
  const [checking, setChecking] = useState(false);

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

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}> 
      <AmbientBackground />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, { color: theme.colors.text }]}>Account</Text>
          <Text style={[styles.subtitle, { color: theme.colors.textMuted }]}>Privacy, support, deletion, and sign-in health checks for Play Store readiness.</Text>

          <GlassCard style={styles.profileCard}>
            <View style={styles.profileRow}>
              <View style={[styles.avatar, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
                <UserCircle color={theme.colors.text} size={34} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: theme.colors.text }]} numberOfLines={1}>{user?.name || 'Household member'}</Text>
                <Text style={[styles.email, { color: theme.colors.textMuted }]} numberOfLines={1}>{user?.email || 'Not signed in'}</Text>
              </View>
            </View>
          </GlassCard>

          <GlassCard style={styles.topGap}>
            <View style={styles.supportHeader}>
              <ShieldCheck color={theme.colors.accent} size={22} />
              <Text style={[styles.supportTitle, { color: theme.colors.text }]}>Sign-in health</Text>
            </View>
            <Text style={[styles.supportText, { color: theme.colors.textMuted }]}>Use this after sign-in, app restart, or logout testing to confirm the local token, backend, and session are all healthy.</Text>
            <PressScale testID="run-auth-diagnostics" onPress={checkSession} style={[styles.checkBtn, { backgroundColor: theme.colors.primary }]}>
              <RefreshCw color={theme.colors.primaryText} size={18} />
              <Text style={[styles.checkBtnText, { color: theme.colors.primaryText }]}>{checking ? 'Checking...' : 'Check session'}</Text>
            </PressScale>
            {diagnostics ? (
              <View style={[styles.diagnosticBox, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
                <DiagnosticLine label="Local token" value={diagnostics.local_token ? 'Stored' : 'Missing'} good={diagnostics.local_token} />
                <DiagnosticLine label="Backend" value={diagnostics.backend_online ? 'Online' : 'Unavailable'} good={diagnostics.backend_online} />
                <DiagnosticLine label="Session" value={diagnostics.session_valid ? 'Valid' : 'Invalid'} good={diagnostics.session_valid} />
                {diagnostics.session_email ? <DiagnosticLine label="Email" value={diagnostics.session_email} /> : null}
                {diagnostics.session_is_admin ? <DiagnosticLine label="Admin" value="Tester bypass active" good /> : null}
                {diagnostics.error ? <Text style={styles.diagnosticError}>{diagnostics.error}</Text> : null}
              </View>
            ) : null}
          </GlassCard>

          <GlassCard style={styles.topGap}>
            <Row
              testID="open-privacy-policy"
              icon={<ShieldCheck color={theme.colors.accent} size={22} />}
              title="Privacy Policy"
              subtitle="How Household COO handles sign-in, family, calendar, vault, and notification data."
              onPress={() => router.push('/privacy')}
            />
            <Row
              testID="open-terms-support"
              icon={<FileText color={theme.colors.accent} size={22} />}
              title="Terms & Support"
              subtitle="Testing terms, limitations, and support contact information."
              onPress={() => router.push('/terms')}
            />
            <Row
              testID="open-account-deletion"
              icon={<Trash2 color="#DC2626" size={22} />}
              title="Delete account"
              subtitle="Request deletion of your account and associated Household COO data."
              danger
              onPress={() => router.push('/delete-account')}
            />
          </GlassCard>

          <GlassCard style={styles.topGap}>
            <View style={styles.supportHeader}>
              <LifeBuoy color={theme.colors.accent} size={22} />
              <Text style={[styles.supportTitle, { color: theme.colors.text }]}>Support contact</Text>
            </View>
            <Text style={[styles.supportText, { color: theme.colors.textMuted }]}>For Play Store testing, privacy questions, auth issues, or deletion requests, contact rolanddzoagbe@gmail.com.</Text>
          </GlassCard>

          <PressScale testID="account-logout" onPress={doLogout} style={styles.logoutBtn}>
            <LogOut color="#DC2626" size={22} />
            <Text style={styles.logoutText}>Log out</Text>
          </PressScale>
          <View style={{ height: 150 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 34, paddingBottom: 190 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 38, lineHeight: 44, letterSpacing: -0.8 },
  subtitle: { fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 23, marginTop: 6, marginBottom: 18 },
  profileCard: { marginBottom: 18 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  avatar: { width: 70, height: 70, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, lineHeight: 28 },
  email: { fontFamily: 'Inter_500Medium', fontSize: 15, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  iconBox: { width: 48, height: 48, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, lineHeight: 23 },
  rowSub: { fontFamily: 'Inter_500Medium', fontSize: 14, lineHeight: 20, marginTop: 3 },
  topGap: { marginTop: 18 },
  supportHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  supportTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 19 },
  supportText: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22 },
  checkBtn: { minHeight: 50, borderRadius: 9999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 14 },
  checkBtnText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  diagnosticBox: { borderWidth: 1, borderRadius: 18, padding: 14, marginTop: 14, gap: 9 },
  diagnosticLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 14 },
  diagnosticLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  diagnosticValue: { flex: 1, textAlign: 'right', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  diagnosticError: { color: '#DC2626', fontFamily: 'Inter_700Bold', fontSize: 13, lineHeight: 19, marginTop: 4 },
  logoutBtn: { marginTop: 24, minHeight: 58, borderRadius: 9999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: 'rgba(220,38,38,0.10)' },
  logoutText: { color: '#DC2626', fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
});
