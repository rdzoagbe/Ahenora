import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Send } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { ChatMessage } from '../api';
import { logger } from '../logger';

interface Props {
  load: () => Promise<{ messages: ChatMessage[] }>;
  send: (text: string) => Promise<{ message: ChatMessage }>;
  markRead?: () => Promise<unknown>;
  emptyHint: string;
}

/**
 * A conversation: the message list plus a composer. Reused by the parent chat
 * (adults + per-teen threads) and the teen's own thread — the caller supplies
 * the load/send functions, so the same UI serves both sides with the server
 * enforcing who can see what.
 */
export function ChatThread({ load, send, markRead, emptyHint }: Props) {
  const ui = useUI();
  const { t } = useStore();
  const styles = createStyles(ui);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await load();
      setMessages(res.messages);
      markRead?.().catch(() => undefined);
    } catch (e) {
      logger.warn('chat load failed', e);
    } finally {
      setLoading(false);
    }
  }, [load, markRead]);

  useEffect(() => { refresh(); }, [refresh]);

  const onSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await send(body);
      setText('');
      setMessages((prev) => [...prev, res.message]);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      logger.warn('chat send failed', e);
    } finally {
      setSending(false);
    }
  }, [text, sending, send]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={ui.orange} /></View>;
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.message_id}
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={<Text style={styles.empty}>{emptyHint}</Text>}
        renderItem={({ item }) => (
          <View style={[styles.bubbleRow, item.mine ? styles.rowMine : styles.rowTheirs]}>
            <View style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleTheirs]}>
              {!item.mine ? <Text style={styles.sender}>{item.sender_name}</Text> : null}
              <Text style={[styles.msgText, item.mine && styles.msgTextMine]}>{item.text}</Text>
            </View>
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          testID="chat-input"
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={t('chat_placeholder')}
          placeholderTextColor={ui.muted}
          multiline
          maxLength={2000}
        />
        <PressScale
          testID="chat-send"
          onPress={onSend}
          disabled={!text.trim() || sending}
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnOff]}
          accessibilityLabel={t('chat_send')}
        >
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Send color="#fff" size={18} />}
        </PressScale>
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, gap: 8, flexGrow: 1 },
  empty: { flex: 1, textAlign: 'center', color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 40 },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMine: { backgroundColor: ui.orange, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderBottomLeftRadius: 4 },
  sender: { fontFamily: 'Inter_700Bold', fontSize: 11, color: ui.orangeText, marginBottom: 2 },
  msgText: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, color: ui.text },
  msgTextMine: { color: '#fff' },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14,
    paddingVertical: 10, borderTopWidth: 1, borderTopColor: ui.line, backgroundColor: ui.bg,
  },
  input: {
    flex: 1, maxHeight: 120, minHeight: 44, borderRadius: 22, backgroundColor: ui.card,
    borderWidth: 1, borderColor: ui.line, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11,
    fontFamily: 'Inter_400Regular', fontSize: 15, color: ui.text,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: ui.orange,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.5 },
});
