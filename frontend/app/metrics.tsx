import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, Users, TrendingUp } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { AmbientBackground } from '../src/components/AmbientBackground';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { api, MetricRow } from '../src/api';
import { logger } from '../src/logger';

// Admin-only screen — plain English labels are fine (only the owner sees it).
const EVENT_LABELS: Record<string, string> = {
  feed_open: 'Feed opens',
  kids_open: 'Kids screen opens',
  calendar_open: 'Calendar opens',
  scan_used: 'Document scans',
  card_created: 'Tasks created',
  vault_added: 'Documents saved',
  vault_shared: 'Documents shared',
  onboarding_done: 'Onboardings finished',
};
const EVENT_ORDER = Object.keys(EVENT_LABELS);

export default function MetricsScreen() {
  const router = useRouter();
  const { t, user } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [rows, setRows] = useState<MetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.getMetricsSummary(14);
      setRows(res.rows || []);
      setError(null);
    } catch (e: any) {
      logger.warn('metrics load failed', e?.message || e);
      setError(e?.message || 'Could not load metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const goBack = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.replace('/(tabs)/settings');
  };

  const today = new Date().toISOString().slice(0, 10);

  const stats = useMemo(() => {
    const dauByDay = new Map<string, number>();
    const eventTotals = new Map<string, number>();
    for (const r of rows) {
      if (r.name === 'active_users') dauByDay.set(r.date, r.count);
      else eventTotals.set(r.name, (eventTotals.get(r.name) || 0) + r.count);
    }
    const dauValues = [...dauByDay.values()];
    const activeToday = dauByDay.get(today) || 0;
    const peakDau = dauValues.length ? Math.max(...dauValues) : 0;
    const activeDays = dauValues.length;
    return { activeToday, peakDau, activeDays, eventTotals };
  }, [rows, today]);

  if (user && !user.is_admin) {
    return (
      <View style={styles.container}>
        <AmbientBackground />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.topBar}>
            <PressScale testID="metrics-back" onPress={goBack} style={styles.backBtn}>
              <ArrowLeft color={ui.text} size={16} />
              <Text style={styles.backText}>{t('back')}</Text>
            </PressScale>
          </View>
          <Text style={styles.adminOnly}>This screen is available to admins only.</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <PressScale testID="metrics-back" onPress={goBack} style={styles.backBtn}>
            <ArrowLeft color={ui.text} size={16} />
            <Text style={styles.backText}>{t('back')}</Text>
          </PressScale>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={ui.muted} />}
        >
          <Text style={styles.title}>Usage</Text>
          <Text style={styles.subtitle}>Last 14 days · first-party, count-only</Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {loading && rows.length === 0 && !error ? <Text style={styles.muted}>Loading…</Text> : null}

          {/* DAU tiles */}
          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <Users color={ui.orange} size={18} />
              <Text style={styles.tileNum}>{stats.activeToday}</Text>
              <Text style={styles.tileLabel}>Active today</Text>
            </View>
            <View style={styles.tile}>
              <TrendingUp color={ui.mintText} size={18} />
              <Text style={styles.tileNum}>{stats.peakDau}</Text>
              <Text style={styles.tileLabel}>Peak day</Text>
            </View>
            <View style={styles.tile}>
              <Text style={[styles.tileNum, { marginTop: 22 }]}>{stats.activeDays}</Text>
              <Text style={styles.tileLabel}>Active days</Text>
            </View>
          </View>

          {/* Event totals */}
          <Text style={styles.sectionTitle}>Feature usage (totals)</Text>
          <View style={styles.card}>
            {EVENT_ORDER.map((name, i) => (
              <View key={name} style={[styles.eventRow, i === 0 && { borderTopWidth: 0 }]}>
                <Text style={styles.eventLabel}>{EVENT_LABELS[name]}</Text>
                <Text style={styles.eventCount}>{stats.eventTotals.get(name) || 0}</Text>
              </View>
            ))}
          </View>

          {!loading && rows.length === 0 && !error ? (
            <Text style={styles.muted}>No activity recorded yet. Numbers appear as testers use the app.</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  safe: { flex: 1 },
  topBar: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { color: ui.text, fontFamily: 'Inter_700Bold', fontSize: 15 },
  scroll: { paddingHorizontal: 20, paddingBottom: 60 },
  title: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 32, letterSpacing: -0.5, marginTop: 8 },
  subtitle: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 4, marginBottom: 22 },
  error: { color: ui.danger, fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 16 },
  muted: { color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 16, lineHeight: 20 },
  adminOnly: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 15, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  tileRow: { flexDirection: 'row', gap: 12 },
  tile: { flex: 1, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 18, padding: 16, gap: 6 },
  tileNum: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 30, letterSpacing: -0.5 },
  tileLabel: { color: ui.muted, fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  sectionTitle: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 18, marginTop: 28, marginBottom: 12 },
  card: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 18, paddingHorizontal: 16 },
  eventRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderTopWidth: 1, borderTopColor: ui.line },
  eventLabel: { color: ui.text, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  eventCount: { color: ui.text, fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
});
