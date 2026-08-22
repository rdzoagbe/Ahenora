import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ChevronLeft, MessageCircle, Users } from 'lucide-react-native';

import { PressScale } from '../../src/components/PressScale';
import { ChatThread } from '../../src/components/ChatThread';
import { TabScreen } from '../../src/components/TabScreen';
import { ScreenHeader, useUI, UIColors } from '../../src/components/Kit';
import { useStore } from '../../src/store';
import { api, ChatThreadSummary } from '../../src/api';
import { logger } from '../../src/logger';

/**
 * Family messaging tab: the adults thread + one per teen. Tapping a thread opens
 * the conversation. A teen never lands here — they get their own thread on the
 * teen screen; the server refuses this route to a teen token.
 */
export default function ChatTab() {
  const ui = useUI();
  const { t } = useStore();
  const styles = createStyles(ui);
  const [threads, setThreads] = useState<ChatThreadSummary[] | null>(null);
  const [active, setActive] = useState<ChatThreadSummary | null>(null);
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

  useFocusEffect(useCallback(() => { if (!active) loadThreads(); }, [active, loadThreads]));

  const title = (th: ChatThreadSummary) => (th.is_adults ? t('chat_adults_thread') : th.title || t('chat_teen'));

  // A thread is open — full-height conversation with a back-to-list header.
  if (active) {
    return (
      <View style={styles.convo}>
        <View style={styles.convoHeader}>
          <PressScale testID="chat-back" onPress={() => setActive(null)} style={styles.backBtn} accessibilityLabel={t('back')}>
            <ChevronLeft color={ui.text} size={22} />
          </PressScale>
          <Text style={styles.convoTitle} numberOfLines={1}>{title(active)}</Text>
          <View style={{ width: 36 }} />
        </View>
        <ChatThread
          load={() => api.chatGet(active.thread)}
          send={(text) => api.chatSend(active.thread, text)}
          markRead={() => api.chatRead(active.thread)}
          emptyHint={active.is_adults ? t('chat_empty_adults') : t('chat_empty_teen')}
        />
      </View>
    );
  }

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
              onPress={() => setActive(th)}
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
  convo: { flex: 1, backgroundColor: ui.bg },
  convoHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 52, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: ui.line,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  convoTitle: { flex: 1, textAlign: 'center', fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: ui.text },
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
