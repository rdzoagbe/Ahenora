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
import { Sparkles, Bell } from 'lucide-react-native';
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
  const { user, t } = useStore();
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
    setCards((prev) =>
      prev.map((c) => (c.card_id === card.card_id ? { ...c, status: next } : c))
    );
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
    <View style={styles.container}>
      <AmbientBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor="#fff"
            />
          }
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.greet}>{greeting}</Text>
              <Text style={styles.name}>{firstName}.</Text>
            </View>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}>
                <Text style={styles.avatarText}>{(firstName[0] || 'C').toUpperCase()}</Text>
              </View>
            )}
          </View>

          {/* Brief card */}
          <PressScale testID="open-brief" onPress={() => setShowBrief(true)} style={styles.briefCard}>
            <View style={styles.briefHeader}>
              <View style={styles.briefBadge}>
                <Sparkles color="#fff" size={12} />
                <Text style={styles.briefBadgeText}>{t('sunday_brief')}</Text>
              </View>
              <Text style={styles.briefCount}>
                {openCount} {openCount === 1 ? t('open_item') : t('open_items')}
              </Text>
            </View>
            <Text style={styles.briefTitle}>{t('on_your_desk')}</Text>
            <Text style={styles.briefSub}>{t('sunday_brief_subtitle')}</Text>
          </PressScale>

          {/* Reminders banner */}
          {upcomingReminders.length > 0 && (
            <View testID="reminders-banner" style={styles.remindersCard}>
              <View style={styles.remindersHeader}>
                <Bell color="#F97316" size={14} />
                <Text style={styles.remindersTitle}>
                  {t('reminders')} · {upcomingReminders.length}
                </Text>
              </View>
              {upcomingReminders.slice(0, 3).map((c) => {
                const due = new Date(c.due_date as string).getTime();
                const remindAt = due - (c.reminder_minutes || 0) * 60 * 1000;
                const mins = Math.max(0, Math.round((remindAt - Date.now()) / 60000));
                const label =
                  mins <= 1 ? 'now' : mins < 60 ? `in ${mins}m` : `in ${Math.round(mins / 60)}h`;
                return (
                  <View key={c.card_id} style={styles.remindersRow}>
                    <Text style={styles.remindersItem} numberOfLines={1}>
                      {c.title}
                    </Text>
                    <Text style={styles.remindersWhen}>{label}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Feed */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('this_week')}</Text>
          </View>

          {loading ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
          ) : cards.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{t('no_items')}</Text>
            </View>
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
  container: { flex: 1, backgroundColor: '#080910' },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 22,
    marginTop: 6,
  },
  greet: {
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
  },
  name: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: '#fff',
    fontSize: 32,
    lineHeight: 38,
  },
  avatar: { width: 44, height: 44, borderRadius: 9999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  avatarFallback: { backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  briefCard: {
    borderRadius: 24,
    padding: 22,
    backgroundColor: 'rgba(99,102,241,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(99,102,241,0.35)',
    marginBottom: 24,
    overflow: 'hidden',
  },
  briefHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  briefBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 9999,
  },
  briefBadgeText: { color: '#fff', fontFamily: 'Inter_500Medium', fontSize: 11, letterSpacing: 0.4 },
  briefCount: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Inter_500Medium', fontSize: 12 },
  briefTitle: {
    color: '#fff',
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 30,
    lineHeight: 36,
  },
  briefSub: {
    color: 'rgba(255,255,255,0.65)',
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 4,
  },
  remindersCard: {
    marginBottom: 20,
    padding: 16,
    borderRadius: 20,
    backgroundColor: 'rgba(249,115,22,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.3)',
  },
  remindersHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  remindersTitle: {
    color: '#F97316',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  remindersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  remindersItem: {
    flex: 1,
    color: '#fff',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    marginRight: 12,
  },
  remindersWhen: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  section: { marginBottom: 14 },
  sectionLabel: {
    fontFamily: 'Inter_500Medium',
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  empty: { paddingVertical: 60, alignItems: 'center' },
  emptyTitle: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    color: 'rgba(255,255,255,0.55)',
    fontSize: 22,
  },
});
