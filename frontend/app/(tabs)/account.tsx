import React, { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  CalendarCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  KeyRound,
  LifeBuoy,
  LogOut,
  ShieldCheck,
  Trash2,
} from 'lucide-react-native';

import { PressScale } from '../../src/components/PressScale';
import { Badge, Card, IconTile, SectionTitle, UI } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { AuthDiagnosticResult, runAuthDiagnostics } from '../../src/authDiagnostics';

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
  return (
    <PressScale testID={testID} onPress={onPress} style={[styles.row, divider && styles.rowDivider]}>
      {tile}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowTitle, danger && { color: UI.danger }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.rowSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right !== undefined ? right : <ChevronRight color={UI.muted} size={18} />}
    </PressScale>
  );
}

export default function AccountScreen() {
  const router = useRouter();
  const { user, logout, refreshUser } = useStore();
  const [diagnostics, setDiagnostics] = useState<AuthDiagnosticResult | null>(null);
  const [checking, setChecking] = useState(false);

  const name = user?.name || 'Household member';
  const email = user?.email || 'Not signed in';
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

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.navRow}>
            <PressScale testID="account-back" onPress={goBack} style={styles.backBtn}>
              <ChevronLeft color={UI.text} size={22} />
            </PressScale>
            <Text style={styles.navTitle}>Account</Text>
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
              <Badge label="OWNER" bg={UI.soft} color={UI.muted} />
              <Badge label="VERIFIED" bg={UI.mint} color={UI.mintText} />
            </View>
          </Card>

          {/* Sign-in & connections */}
          <SectionTitle style={styles.sectionGap}>Sign-in &amp; connections</SectionTitle>
          <Card style={styles.cardPad}>
            <ListRow
              tile={<IconTile bg={UI.blue}><Text style={styles.googleG}>G</Text></IconTile>}
              title="Google account"
              subtitle={user?.email ? `Connected · ${user.email}` : 'Not connected'}
              right={<CheckCircle2 color={UI.mintText} size={20} />}
            />
            <ListRow
              tile={<IconTile bg={UI.mint}><CalendarCheck color={UI.mintText} size={18} /></IconTile>}
              title="Calendar sync"
              subtitle={diagnostics?.session_valid ? 'Session healthy' : 'Open the family calendar'}
              onPress={() => router.navigate('/(tabs)/calendar')}
            />
            <ListRow
              testID="run-auth-diagnostics"
              tile={<IconTile bg={UI.orangeSoft}><ShieldCheck color={UI.orange} size={18} /></IconTile>}
              title="Sign-in health"
              subtitle={checking ? 'Checking…' : 'Verify token, backend & session'}
              right={
                <Text style={styles.actionLink}>{checking ? '…' : 'Check'}</Text>
              }
              onPress={checkSession}
            />
            <ListRow
              tile={<IconTile bg={UI.soft}><KeyRound color={UI.text} size={18} /></IconTile>}
              title="Change password"
              subtitle="Managed by your Google sign-in"
              divider={false}
            />
          </Card>

          {diagnostics ? (
            <Card style={[styles.cardPad, styles.diagCard]}>
              <DiagLine label="Local token" value={diagnostics.local_token ? 'Stored' : 'Missing'} good={diagnostics.local_token} />
              <DiagLine label="Backend" value={diagnostics.backend_online ? 'Online' : 'Unavailable'} good={diagnostics.backend_online} />
              <DiagLine label="Session" value={diagnostics.session_valid ? 'Valid' : 'Invalid'} good={diagnostics.session_valid} />
              {diagnostics.session_email ? <DiagLine label="Email" value={diagnostics.session_email} /> : null}
              {diagnostics.session_is_admin ? <DiagLine label="Admin" value="Tester bypass active" good /> : null}
              {diagnostics.error ? <Text style={styles.diagError}>{diagnostics.error}</Text> : null}
            </Card>
          ) : null}

          {/* Legal & support */}
          <SectionTitle style={styles.sectionGap}>Legal &amp; support</SectionTitle>
          <Card style={styles.cardPad}>
            <ListRow
              tile={<IconTile bg={UI.orangeSoft}><LifeBuoy color={UI.orange} size={18} /></IconTile>}
              title="Contact support"
              onPress={() => Linking.openURL('mailto:rolanddzoagbe@gmail.com').catch(() => undefined)}
            />
            <ListRow
              testID="open-terms-support"
              tile={<IconTile bg={UI.orangeSoft}><FileText color={UI.orange} size={18} /></IconTile>}
              title="Terms of service"
              onPress={() => router.push('/terms')}
            />
            <ListRow
              testID="open-privacy-policy"
              tile={<IconTile bg={UI.orangeSoft}><ShieldCheck color={UI.orange} size={18} /></IconTile>}
              title="Privacy policy"
              onPress={() => router.push('/privacy')}
              divider={false}
            />
          </Card>

          {/* Account actions */}
          <SectionTitle style={[styles.sectionGap, { color: UI.danger }]}>Account actions</SectionTitle>
          <Card style={[styles.cardPad, { borderColor: 'rgba(220,38,38,0.18)' }]}>
            <ListRow
              testID="account-logout"
              tile={<IconTile bg={UI.dangerSoft}><LogOut color={UI.danger} size={18} /></IconTile>}
              title="Log out"
              danger
              right={null}
              onPress={doLogout}
            />
            <ListRow
              testID="open-account-deletion"
              tile={<IconTile bg={UI.dangerSoft}><Trash2 color={UI.danger} size={18} /></IconTile>}
              title="Delete account"
              danger
              right={null}
              onPress={() => router.push('/delete-account')}
              divider={false}
            />
          </Card>

          <View style={{ height: 150 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function DiagLine({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <View style={styles.diagLine}>
      <Text style={styles.diagLabel}>{label}</Text>
      <Text style={[styles.diagValue, { color: good === false ? UI.danger : good === true ? UI.mintText : UI.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: UI.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 190 },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginBottom: 14 },
  backBtn: { width: 40, height: 40, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  navTitle: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 20, letterSpacing: -0.3 },

  profileCard: { alignItems: 'center', paddingVertical: 22, paddingHorizontal: 18, marginBottom: 18 },
  avatar: { width: 66, height: 66, borderRadius: 99, backgroundColor: UI.orange, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 26 },
  name: { color: UI.text, fontFamily: 'Inter_800ExtraBold', fontSize: 19, lineHeight: 24 },
  email: { color: UI.muted, fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 3 },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },

  sectionGap: { marginTop: 6, marginBottom: 10 },
  cardPad: { paddingHorizontal: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 13 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: UI.line },
  rowTitle: { color: UI.text, fontFamily: 'Inter_700Bold', fontSize: 14.5 },
  rowSub: { color: UI.muted, fontFamily: 'Inter_500Medium', fontSize: 12.5, marginTop: 2 },
  googleG: { color: UI.blueText, fontFamily: 'Inter_800ExtraBold', fontSize: 18 },
  actionLink: { color: UI.orange, fontFamily: 'Inter_800ExtraBold', fontSize: 14 },

  diagCard: { marginTop: 12, paddingVertical: 14, gap: 9 },
  diagLine: { flexDirection: 'row', justifyContent: 'space-between', gap: 14 },
  diagLabel: { color: UI.muted, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  diagValue: { flex: 1, textAlign: 'right', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  diagError: { color: UI.danger, fontFamily: 'Inter_700Bold', fontSize: 13, lineHeight: 19, marginTop: 4 },
});
