import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight, Bell, Search, SlidersHorizontal, Sparkles } from 'lucide-react-native';
import { useFocusEffect } from 'expo-router';
import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
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

      api
        .getNotificationSettings()
        .then((prefs) => {
          if (prefs.card_reminders) {
            return syncCardReminderNotifications(res, true);
          }
          return syncCardReminderNotifications([], false);
        })
        .catch(() => undefined);
    } catch (e) {
      console.log('load cards error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (card: Card) => {
    const next = card.status === 'DONE' ? 'OPEN' : 'DONE';
    setCards((prev) => prev.map((c) => (c.card_id === card.card_id ? { ...c, status: next } : c)));
    try {
      await api.updateCard(card.card_id, { status: next });
    } catch {
      load();
    }
  };

  const remove = async (card: Card) => {
    setCards((prev) => prev.filter((c) => c.card_id !== card.card_id));
    try {
      await api.deleteCard(card.card_id);
    } catch {
      load();
    }
  };

  const openCount = cards.filter((c) => c.status === 'OPEN').length;

  const upcomingReminders = useMemo(() => {
    const now = Date.now();
    const in24h = now + 24 * 60 * 60 * 1000;
    return cards
      .filter((c) => c.status === 'OPEN' && c.due_date && (c.reminder_minutes || 0) > 0)
      .filter((c) => {
        try {
          const due = new Date(c.due_date as string).getTime();
          const remindAt = due - (c.reminder_minutes || 0) * 60 * 1000;
          return remindAt >= now - 60 * 60 * 1000 && remindAt <= in24h;
        } catch {
          return false;
        }
      })
      .sort((a, b) => {
        const da = new Date(a.due_date as string).getTime() - (a.reminder_minutes || 0) * 60 * 1000;
        const dbv = new Date(b.due_date as string).getTime() - (b.reminder_minutes || 0) * 60 * 1000;
        return da - dbv;
      });
  }, [cards]);

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
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={theme.colors.text}
            />
          }
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.greet, { color: theme.colors.textMuted }]}>{greeting}</Text>
              <Text style={[styles.name, { color: theme.colors.text }]}>{firstName || 'Family'}.</Text>
            </View>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={[styles.avatar, { borderColor: theme.colors.cardBorder }]} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
                <Text style={[styles.avatarText, { color: theme.colors.text }]}>{(firstName[0] || 'C').toUpperCase()}</Text>
              </View>
            )}
          </View>

          <View style={[styles.searchShell, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <Search color={theme.colors.textSoft} size={21} />
            <Text style={[styles.searchText, { color: theme.colors.textMuted }]}>Search</Text>
            <View style={[styles.filterButton, { backgroundColor: theme.colors.primary }]}>
              <SlidersHorizontal color={theme.colors.primaryText} size={19} />
            </View>
          </View>

          <PressScale testID="open-brief" onPress={() => setShowBrief(true)} style={[styles.heroCard, { backgroundColor: theme.colors.primary }]}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroBadge}>
                <Sparkles color="#202323" size={13} />
                <Text style={styles.heroBadgeText}>{t('sunday_brief')}</Text>
              </View>
              <Text style={styles.heroCount}>
                {openCount} {openCount === 1 ? t('open_item') : t('open_items')}
              </Text>
            </View>
            <Text style={styles.heroTitle}>{t('on_your_desk')}</Text>
            <Text style={styles.heroSub}>{t('sunday_brief_subtitle')}</Text>
            <View style={styles.heroAction}>
              <Text style={styles.heroActionText}>See more</Text>
              <View style={styles.heroArrow}>
                <ArrowRight color="#202323" size={20} />
              </View>
            </View>
          </PressScale>

          {upcomingReminders.length > 0 && (
            <GlassCard testID="reminders-banner" style={styles.remindersCard}>
              <View style={styles.remindersHeader}>
                <Bell color={theme.colors.accent} size={16} />
                <Text style={[styles.remindersTitle, { color: theme.colors.text }]}>
                  {t('reminders')} · {upcomingReminders.length}
                </Text>
              </View>
              {upcomingReminders.slice(0, 3).map((c) => {
                const due = new Date(c.due_date as string).getTime();
                const remindAt = due - (c.reminder_minutes || 0) * 60 * 1000;
                const mins = Math.max(0, Math.round((remindAt - Date.now()) / 60000));
                const label = mins <= 1 ? 'now' : mins < 60 ? `in ${mins}m` : `in ${Math.round(mins / 60)}h`;
                return (
                  <View key={c.card_id} style={styles.remindersRow}>
                    <Text style={[styles.remindersItem, { color: theme.colors.text }]} numberOfLines={1}>
                      {c.title}
                    </Text>
                    <Text style={[styles.remindersWhen, { color: theme.colors.textMuted }]}>{label}</Text>
                  </View>
                );
              })}
            </GlassCard>
          )}

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>{t('this_week')}</Text>
            <Text style={[styles.sectionSub, { color: theme.colors.textMuted }]}>{openCount} active</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={theme.colors.text} style={{ marginTop: 40 }} />
          ) : cards.length === 0 ? (
            <GlassCard style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>{t('no_items')}</Text>
            </GlassCard>
          ) : (
            cards.map((c) => (
              <SmartCard
                key={c.card_id}
                card={c}
                onComplete={() => toggle(c)}
                onDelete={() => remove(c)}
              />
            ))
          )}

          <View style={{ height: 220 }} />
        </ScrollView>
      </SafeAreaView>

      <FloatingActionBar
        onManual={() => {
          setVoiceDraft(null);
          setAddSource('MANUAL');
          setShowAdd(true);
        }}
        onCamera={() => {
          setShowCamera(true);
        }}
        onVoice={() => {
          setShowVoice(true);
        }}
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

      <VoiceCaptureModal
        visible={showVoice}
        onClose={() => setShowVoice(false)}
        onDraft={(d) => {
          setVoiceDraft(d);
          setAddSource('VOICE');
          setShowVoice(false);
          setShowAdd(true);
        }}
      />

      <AddCardModal
        visible={showAdd}
        onClose={() => {
          setShowAdd(false);
          setVoiceDraft(null);
        }}
        onCreated={load}
        initialSource={addSource}
        initialDraft={voiceDraft}
      />
      <SundayBriefModal visible={showBrief} onClose={() => setShowBrief(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
    marginTop: 6,
  },
  greet: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  name: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
  },
  avatar: { width: 48, height: 48, borderRadius: 9999, borderWidth: 1 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  searchShell: {
    minHeight: 58,
    borderRadius: 9999,
    borderWidth: 1,
    paddingLeft: 18,
    paddingRight: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 22,
  },
  searchText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  filterButton: { width: 46, height: 46, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
  heroCard: {
    borderRadius: 32,
    padding: 22,
    marginBottom: 24,
    overflow: 'hidden',
  },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#FFFFFF',
    borderRadius: 9999,
  },
  heroBadgeText: { color: '#202323', fontFamily: 'Inter_800ExtraBold', fontSize: 12, letterSpacing: 0.4 },
  heroCount: { color: 'rgba(255,255,255,0.72)', fontFamily: 'Inter_700Bold', fontSize: 13 },
  heroTitle: {
    color: '#FFFFFF',
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.5,
  },
  heroSub: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
  },
  heroAction: {
    marginTop: 22,
    minHeight: 54,
    borderRadius: 9999,
    paddingLeft: 22,
    paddingRight: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroActionText: { color: '#FFFFFF', fontFamily: 'Inter_800ExtraBold', fontSize: 16, flex: 1, textAlign: 'center' },
  heroArrow: { width: 42, height: 42, borderRadius: 9999, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  remindersCard: { marginBottom: 20 },
  remindersHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  remindersTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  remindersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  remindersItem: {
    flex: 1,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
    marginRight: 12,
  },
  remindersWhen: {
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
  },
  section: { marginBottom: 14, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  sectionTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 22,
    letterSpacing: -0.3,
  },
  sectionSub: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
  },
  empty: { paddingVertical: 36, alignItems: 'center' },
  emptyTitle: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 21,
  },
});
