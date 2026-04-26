import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Image, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkles, Bell, SlidersHorizontal } from 'lucide-react-native';
import { useFocusEffect } from 'expo-router';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { PressScale } from '../../src/components/PressScale';
import { SmartCard } from '../../src/components/SmartCard';
import { FloatingActionBar } from '../../src/components/FloatingActionBar';
import { AddCardModal } from '../../src/components/AddCardModal';
import { SundayBriefModal } from '../../src/components/SundayBriefModal';
import { VoiceCaptureModal } from '../../src/components/VoiceCaptureModal';
import { CameraCaptureModal } from '../../src/components/CameraCaptureModal';
import { useStore } from '../../src/store';
import { api, Card, CardType } from '../../src/api';
import { syncCardReminderNotifications } from '../../src/notifications';

interface VoiceDraft {
  transcript: string;
  type: CardType;
  title: string;
  description: string;
  assignee: string;
  due_date?: string | null;
  image_base64?: string | null;
  vault_category?: string;
  save_to_vault?: boolean;
}

export default function FeedScreen() {
  const { user, t, theme } = useStore();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showBrief, setShowBrief] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [addSource, setAddSource] = useState<'MANUAL' | 'VOICE' | 'CAMERA'>('MANUAL');
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraft | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listCards();
      setCards(res);
      api.getNotificationSettings()
        .then((prefs) => prefs.card_reminders ? syncCardReminderNotifications(res, true) : syncCardReminderNotifications([], false))
        .catch(() => undefined);
    } catch (error) {
      console.log('load cards error', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  const toggle = async (card: Card) => {
    const next = card.status === 'DONE' ? 'OPEN' : 'DONE';
    setCards((prev) => prev.map((c) => (c.card_id === card.card_id ? { ...c, status: next } : c)));
    try { await api.updateCard(card.card_id, { status: next }); } catch { load(); }
  };

  const remove = async (card: Card) => {
    setCards((prev) => prev.filter((c) => c.card_id !== card.card_id));
    try { await api.deleteCard(card.card_id); } catch { load(); }
  };

  const openCards = cards.filter((c) => c.status === 'OPEN');
  const openCount = openCards.length;

  const upcomingReminders = useMemo(() => {
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    return openCards
      .filter((c) => c.due_date && (c.reminder_minutes || 0) > 0)
      .filter((c) => {
        const due = new Date(c.due_date as string).getTime();
        const remindAt = due - (c.reminder_minutes || 0) * 60 * 1000;
        return remindAt >= now - 60 * 60 * 1000 && remindAt <= in24h;
      })
      .sort((a, b) => new Date(a.due_date as string).getTime() - new Date(b.due_date as string).getTime());
  }, [openCards]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t('greeting_morning');
    if (h < 18) return t('greeting_afternoon');
    return t('greeting_evening');
  })();

  const firstName = (user?.name || '').split(' ')[0] || '';

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <AmbientBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={theme.colors.text}
            />
          }
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.greet, { color: theme.colors.textMuted }]}>{greeting}</Text>
              <Text style={[styles.name, { color: theme.colors.text }]}>{firstName}.</Text>
            </View>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={[styles.avatar, { borderColor: theme.colors.cardBorder }]} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                <Text style={[styles.avatarText, { color: theme.colors.text }]}>{(firstName[0] || 'C').toUpperCase()}</Text>
              </View>
            )}
          </View>

          <PressScale testID="open-brief" onPress={() => setShowBrief(true)} style={[styles.heroCard, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
            <View style={styles.heroTop}>
              <View style={[styles.heroBadge, { backgroundColor: theme.colors.bgSoft }]}>
                <Sparkles color={theme.colors.accent} size={15} />
                <Text style={[styles.heroBadgeText, { color: theme.colors.text }]}>{t('sunday_brief')}</Text>
              </View>
              <Text style={[styles.heroCount, { color: theme.colors.textMuted }]}>{openCount} {openCount === 1 ? t('open_item') : t('open_items')}</Text>
            </View>
            <Text style={[styles.heroTitle, { color: theme.colors.text }]}>{t('on_your_desk')}</Text>
            <Text style={[styles.heroSub, { color: theme.colors.textMuted }]}>{t('sunday_brief_subtitle')}</Text>
          </PressScale>

          {upcomingReminders.length > 0 && (
            <View testID="reminders-banner" style={[styles.remindersCard, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}>
              <View style={styles.remindersHeader}>
                <Bell color={theme.colors.accent} size={17} />
                <Text style={[styles.remindersTitle, { color: theme.colors.accent }]}>{t('reminders')} · {upcomingReminders.length}</Text>
              </View>
              {upcomingReminders.slice(0, 3).map((c) => (
                <View key={c.card_id} style={styles.remindersRow}>
                  <Text style={[styles.remindersItem, { color: theme.colors.text }]} numberOfLines={1}>{c.title}</Text>
                  <Text style={[styles.remindersWhen, { color: theme.colors.textMuted }]}>{new Date(c.due_date as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{t('this_week')}</Text>
            <View style={[styles.filterBtn, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
              <SlidersHorizontal color={theme.colors.text} size={18} />
            </View>
          </View>

          {loading ? (
            <ActivityIndicator color={theme.colors.text} style={{ marginTop: 40 }} />
          ) : cards.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{t('no_items')}</Text>
              <Text style={[styles.emptySub, { color: theme.colors.textMuted }]}>Add a task, scan a document, or capture a voice note.</Text>
            </View>
          ) : (
            cards.map((c) => <SmartCard key={c.card_id} card={c} onComplete={() => toggle(c)} onDelete={() => remove(c)} />)
          )}

          <View style={{ height: 220 }} />
        </ScrollView>
      </SafeAreaView>

      <FloatingActionBar
        onManual={() => { setVoiceDraft(null); setAddSource('MANUAL'); setShowAdd(true); }}
        onCamera={() => setShowCamera(true)}
        onVoice={() => setShowVoice(true)}
      />

      <CameraCaptureModal
        visible={showCamera}
        onClose={() => setShowCamera(false)}
        onDraft={(d) => {
          setVoiceDraft({
            transcript: '',
            type: d.type,
            title: d.title,
            description: d.description,
            assignee: d.assignee,
            due_date: d.due_date || null,
            image_base64: d.image_base64 || null,
            vault_category: d.vault_category || 'School',
            save_to_vault: d.save_to_vault !== false,
          });
          setAddSource('CAMERA');
          setShowCamera(false);
          setShowAdd(true);
        }}
      />
      <VoiceCaptureModal visible={showVoice} onClose={() => setShowVoice(false)} onDraft={(d) => { setVoiceDraft(d); setAddSource('VOICE'); setShowVoice(false); setShowAdd(true); }} />
      <AddCardModal visible={showAdd} onClose={() => { setShowAdd(false); setVoiceDraft(null); }} onCreated={load} initialSource={addSource} initialDraft={voiceDraft} />
      <SundayBriefModal visible={showBrief} onClose={() => setShowBrief(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, marginTop: 4 },
  greet: { fontFamily: 'Inter_500Medium', fontSize: 15 },
  name: { fontFamily: 'Inter_800ExtraBold', fontSize: 36, lineHeight: 42, letterSpacing: -0.8 },
  avatar: { width: 54, height: 54, borderRadius: 9999, borderWidth: 1 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 18 },
  heroCard: { borderRadius: 30, padding: 22, borderWidth: 1, marginBottom: 22, shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.08, shadowRadius: 22, elevation: 4 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, gap: 12 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 9999 },
  heroBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  heroCount: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  heroTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 32, lineHeight: 38, letterSpacing: -0.6 },
  heroSub: { fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22, marginTop: 6 },
  remindersCard: { marginBottom: 20, padding: 18, borderRadius: 24, borderWidth: 1 },
  remindersHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  remindersTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' },
  remindersRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 7 },
  remindersItem: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 15, marginRight: 12 },
  remindersWhen: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, letterSpacing: -0.2 },
  filterBtn: { width: 44, height: 44, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  empty: { paddingVertical: 56, alignItems: 'center' },
  emptyTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, textAlign: 'center' },
  emptySub: { fontFamily: 'Inter_500Medium', fontSize: 15, textAlign: 'center', marginTop: 8 },
});
