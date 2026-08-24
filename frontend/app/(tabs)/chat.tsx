import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MessageCircle, Users } from 'lucide-react-native';

import { PressScale } from '../../src/components/PressScale';
import { TabScreen } from '../../src/components/TabScreen';
import { ScreenHeader, useUI, UIColors } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { api, ChatThreadSummary } from '../../src/api';
import { logger } from '../../src/logger';

/**
 * Family messaging tab: the adults thread + one per teen. Tapping a thread opens
 * the conversation as its own full-screen route (so the floating tab bar never
 * sits over the composer). A teen never lands here — they get their own thread
 * on the teen screen; the server refuses this route to a teen token.
 */
export default function ChatTab() {
  const ui = useUI();
  const router = useRouter();
  const { t } = useStore();
  const styles = createStyles(ui);
  const [threads, setThreads] = useState<ChatThreadSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadThreads = useCallback(async () => {
    try {
      setThreads((await api.chatThreads()).threads);
    } catch (e) {
      logger.warn('chat threads failed', e);
      setThreads([]);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadThreads();
    setRefreshing(false);
  }, [loadThreads]);

  useFocusEffect(useCallback(() => { loadThreads(); }, [loadThreads]));

  // The adults room carries the co-parent's name when there is one, so it reads
  // as "message your co-parent" rather than a generic "Parents" room. It falls
  // back to the group label only when a parent has no co-parent yet.
  const title = (th: ChatThreadSummary) => (th.is_adults ? (th.title || t('chat_adults_thread')) : th.title || t('chat_teen'));

  const open = (th: ChatThreadSummary) => {
    router.push({
      pathname: '/conversation',
      params: { thread: th.thread, title: title(th), adults: th.is_adults ? '1' : '0' },
    });
  };

  return (
    <TabScreen tab="Chat" refreshing={refreshing} onRefresh={onRefresh} scrollViewProps={{ contentContainerStyle: styles.list }}>
      <ScreenHeader eyebrow={t('nav_more_chat_sub')} title={t('chat_title')} />
      {threads === null ? (
        <View style={styles.center}><ActivityIndicator color={ui.orange} /></View>
      ) : (
        <View style={{ gap: 8, marginTop: 8 }}>
          {threads.map((th) => (
            <PressScale
              key={th.thread}
              testID={`chat-thread-${th.thread}`}
              onPress={() => open(th)}
              style={styles.row}
            >
              <View style={[styles.avatar, { backgroundColor: th.is_adults ? ui.mint : ui.orangeSoft }]}>
                {th.is_adults
                  ? <Users color={ui.mintText} size={18} />
                  : <MessageCircle color={ui.orangeText} size={18} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{title(th)}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{th.last_text || t('chat_no_messages')}</Text>
              </View>
              {th.unread > 0 ? (
                <View style={styles.badge}><Text style={styles.badgeText}>{th.unread}</Text></View>
              ) : null}
            </PressScale>
          ))}
        </View>
      )}
    </TabScreen>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  center: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 120 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ui.card,
    borderWidth: 1, borderColor: ui.line, borderRadius: 16, padding: 14,
  },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: ui.text },
  rowSub: { fontFamily: 'Inter_400Regular', fontSize: 13, color: ui.muted, marginTop: 2 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: ui.orange, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#fff', fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
});
