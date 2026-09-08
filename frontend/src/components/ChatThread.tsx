import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Keyboard, Platform,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { ChatMessage } from '../api';
import { logger } from '../logger';

interface Props {
  /** `since` asks only for what arrived after that moment. Callers that
   *  ignore it still work — the merge below is keyed on message id. */
  load: (since?: string) => Promise<{ messages: ChatMessage[] }>;
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
  // The newest moment already on screen. Everything after it is what a poll
  // asks for, so a quiet thread costs an empty answer rather than its whole
  // history.
  const since = useRef<string | undefined>(undefined);
  // Whether the reader is at the live end. Someone scrolled up reading last
  // week's messages must not be yanked to the bottom because a new one landed.
  const atBottom = useRef(true);
  const insets = useSafeAreaInsets();

  // Measure the keyboard instead of asking KeyboardAvoidingView to guess. Under
  // Android's edge-to-edge the window no longer resizes the way that component
  // assumes: 'padding' counted the keyboard twice and pushed the composer off
  // the top of the screen, and no behavior at all left it sitting underneath the
  // keyboard. The height the OS reports is the one number that is true on both
  // platforms. The bottom inset is already paid by the SafeAreaView around this,
  // so it is taken off again here rather than counted twice.
  //
  // Android, second field report (2026-09-07, a Samsung): the composer was
  // STILL under the keyboard. Whether the window resizes for the keyboard
  // there depends on the OS version, edge-to-edge, and the keyboard app, and
  // no formula from the reported height is right in every case — pad when the
  // window already resized and the composer flies off the top; don't and it
  // drowns. So on Android the composer is measured against the keyboard's
  // top edge and only the actual overlap is padded, a few times through the
  // keyboard's animation. Either regime comes out right.
  const [keyboard, setKeyboard] = useState(0);
  const composerRef = useRef<View>(null);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const timers: ReturnType<typeof setTimeout>[] = [];
    const shown = Keyboard.addListener(showEvent, (e) => {
      if (Platform.OS !== 'android') {
        setKeyboard(Math.max((e.endCoordinates?.height ?? 0) - insets.bottom, 0));
        return;
      }
      const keyboardTop = e.endCoordinates?.screenY;
      if (typeof keyboardTop !== 'number') {
        setKeyboard(Math.max((e.endCoordinates?.height ?? 0) - insets.bottom, 0));
        return;
      }
      const settle = () => {
        composerRef.current?.measureInWindow((_x, y, _w, h) => {
          const overlap = Math.ceil(y + h - keyboardTop);
          if (overlap > 0) setKeyboard((prev) => prev + overlap);
        });
      };
      settle();
      for (const ms of [80, 250, 500]) timers.push(setTimeout(settle, ms));
    });
    const hidden = Keyboard.addListener(hideEvent, () => {
      timers.splice(0).forEach(clearTimeout);
      setKeyboard(0);
    });
    return () => { shown.remove(); hidden.remove(); timers.forEach(clearTimeout); };
  }, [insets.bottom]);

  // Opening the keyboard should not bury the newest message behind it.
  useEffect(() => {
    if (keyboard > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [keyboard]);

  const absorb = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return false;
    let added = false;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.message_id, m]));
      for (const m of incoming) {
        if (!byId.has(m.message_id)) added = true;
        byId.set(m.message_id, m);       // an edited message replaces its old self
      }
      return [...byId.values()].sort((a, b) =>
        (a.created_at || '').localeCompare(b.created_at || ''));
    });
    for (const m of incoming) {
      if (!since.current || (m.created_at || '') > since.current) since.current = m.created_at;
    }
    return added;
  }, []);

  const refresh = useCallback(async (delta = false) => {
    try {
      const res = await load(delta ? since.current : undefined);
      if (!delta) since.current = undefined;
      const added = absorb(res.messages);
      if (!delta || added) markRead?.().catch(() => undefined);
    } catch (e) {
      // A poll that fails is not worth telling anybody about: the next one is
      // a few seconds away. Only the first load decides what the screen shows.
      if (!delta) logger.warn('chat load failed', e);
    } finally {
      setLoading(false);
    }
  }, [load, markRead, absorb]);

  useEffect(() => { refresh(); }, [refresh]);

  // Messages arrive while you are looking at them.
  //
  // Until 2026-09-08 this screen loaded once and never again: a conversation
  // left open showed nothing new until you navigated away and back, so the
  // only way to read a reply was to tap its notification. Polling rather than
  // a socket because a household is two to five people — a few seconds of
  // latency is imperceptible, and there is no reconnection logic to get wrong
  // on a phone moving between networks.
  //
  // Paused while the app is in the background, where a timer would burn
  // battery to fetch a screen nobody is looking at, and resumed with an
  // immediate catch-up so returning to the app never shows a stale thread.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => { refresh(true); }, 4000);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') { refresh(true); start(); } else { stop(); }
    });
    return () => { stop(); sub.remove(); };
  }, [refresh]);

  const onSend = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await send(body);
      setText('');
      // Through the same merge, so the next poll returning this message
      // cannot show it twice.
      absorb([res.message]);
      atBottom.current = true;
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (e: any) {
      // A dropped message in a coordination app is worse than a visible error.
      // The draft is preserved (text is only cleared on success above), so tell
      // the user it didn't send and let them retry.
      logger.warn('chat send failed', e);
      Alert.alert(t('chat_send_failed_title'), t('chat_send_failed_msg'));
    } finally {
      setSending(false);
    }
  }, [text, sending, send, t, absorb]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={ui.orange} /></View>;
  }

  return (
    <View style={[styles.root, { paddingBottom: keyboard }]}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.message_id}
        contentContainerStyle={styles.listContent}
        onScroll={(e) => {
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          atBottom.current =
            layoutMeasurement.height + contentOffset.y >= contentSize.height - 40;
        }}
        scrollEventThrottle={80}
        onContentSizeChange={() => {
          if (atBottom.current) listRef.current?.scrollToEnd({ animated: false });
        }}
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
      <View ref={composerRef} style={styles.composer} collapsable={false}>
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
    </View>
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
