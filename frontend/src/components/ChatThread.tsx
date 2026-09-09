import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Animated, AppState, FlatList, Keyboard, Modal, Platform,
  Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Reply, Send, X } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useUI, UIColors } from './Kit';
import { useStore } from '../store';
import { ChatMessage, CHAT_REACTIONS, chatCanEdit } from '../api';
import { logger } from '../logger';

interface Props {
  /** `since` asks only for what arrived after that moment. Callers that
   *  ignore it still work — the merge below is keyed on message id. */
  load: (since?: string) => Promise<{ messages: ChatMessage[] }>;
  /** `replyTo` is the id of the message being answered, when there is one. */
  send: (text: string, replyTo?: string) => Promise<{ message: ChatMessage }>;
  markRead?: () => Promise<unknown>;
  /** Absent where reactions do not apply (the teen thread has no endpoint of
   *  its own yet); the emoji row is then simply not offered. */
  react?: (messageId: string, emoji: string) => Promise<{ message: ChatMessage }>;
  /** Correct a message you sent, within the window the server enforces. */
  edit?: (messageId: string, text: string) => Promise<{ message: ChatMessage }>;
  emptyHint: string;
}

interface RowProps {
  item: ChatMessage;
  styles: ReturnType<typeof createStyles>;
  ui: UIColors;
  t: (key: string, params?: Record<string, string | number>) => string;
  showSender: boolean;
  onHold: (m: ChatMessage) => void;
  onSwipeReply: (m: ChatMessage) => void;
  receipt: string | null;
}

/** How far a message has to travel before letting go answers it. */
const SWIPE_REPLY_THRESHOLD = 52;
const SWIPE_REPLY_MAX = 76;

/**
 * One message.
 *
 * Its own component because each row owns an Animated.Value for the
 * swipe-to-reply gesture, and a hook cannot live inside a renderItem closure.
 *
 * Two ways to answer, deliberately: dragging the message to the right, which
 * is the gesture WhatsApp taught everybody and the one Roland asked for, and
 * holding it, which is discoverable, works for somebody who cannot make a
 * precise drag, and is the only way to reach the other actions.
 */
function MessageRow({ item, styles, ui, t, showSender, onHold, onSwipeReply, receipt }: RowProps) {
  const dx = useRef(new Animated.Value(0)).current;
  const armed = useRef(false);

  const spring = useCallback(() => {
    Animated.spring(dx, { toValue: 0, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  }, [dx]);

  // Right only: dragging left is how a list is dismissed elsewhere on both
  // platforms, and the vertical guards keep an ordinary scroll a scroll.
  const pan = Gesture.Pan()
    .activeOffsetX([-1000, 12])
    .failOffsetY([-8, 8])
    .onUpdate((e) => {
      if (e.translationX <= 0) { dx.setValue(0); armed.current = false; return; }
      const travel = Math.min(e.translationX * 0.55, SWIPE_REPLY_MAX);
      dx.setValue(travel);
      armed.current = travel >= SWIPE_REPLY_THRESHOLD;
    })
    .onEnd(() => {
      if (armed.current) onSwipeReply(item);
      armed.current = false;
      spring();
    })
    .onFinalize(spring);

  return (
    <View>
      {/* Sits behind the bubble and is uncovered BY the drag. Its opacity is
          driven by the drag itself: parked at full strength it put a reply
          arrow beside every message in the thread, which reads as an unread
          marker or a send failure rather than a hint. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.swipeHint, {
          opacity: dx.interpolate({
            inputRange: [0, SWIPE_REPLY_THRESHOLD],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          }),
        }]}
      >
        <Reply color={ui.orangeText} size={16} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={{ transform: [{ translateX: dx }] }}>
          <View style={[styles.bubbleRow, item.mine ? styles.rowMine : styles.rowTheirs]}>
            {/* The width cap lives HERE, on a plain View, and not on the
                PressScale below. PressScale splits a style into layout and
                visual halves and gives the layout half to BOTH the outer
                Pressable and the inner animated view — so `maxWidth: '82%'`
                was applied twice: 82% of a box whose own width came from its
                child. Yoga answers a circular constraint like that by
                collapsing, which is why "Hi baby" wrapped onto two lines and a
                sender's name broke as "Kei / gh". */}
            <View style={styles.bubbleCap}>
            <PressScale
              testID={`chat-msg-${item.message_id}`}
              // Long-press, not tap: the convention every messenger already
              // taught people, and a tap-to-reply would fire by accident
              // every time a thumb catches a bubble while scrolling.
              onLongPress={() => onHold(item)}
              accessibilityLabel={item.text}
              accessibilityHint={t('chat_reply_hint')}
              style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleTheirs]}
            >
              {!item.mine && showSender
                ? <Text style={styles.sender}>{item.sender_name}</Text> : null}
              {item.reply_to ? (
                <View style={[styles.quote, item.mine && styles.quoteMine]}>
                  <Text
                    numberOfLines={1}
                    style={[styles.quoteName, item.mine && styles.quoteTextMine]}
                  >
                    {item.reply_to_name}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={[styles.quoteText, item.mine && styles.quoteTextMine]}
                  >
                    {item.reply_to_text}
                  </Text>
                </View>
              ) : null}
              <Text style={[styles.msgText, item.mine && styles.msgTextMine]}>{item.text}</Text>
              {item.edited ? (
                <Text
                  testID="chat-edited"
                  style={[styles.editedMark, item.mine && styles.editedMarkMine]}
                >
                  {t('chat_edited')}
                </Text>
              ) : null}
            </PressScale>
            </View>
          </View>
          {item.reactions?.length ? (
            <View style={[styles.reactionRow, item.mine ? styles.rowMine : styles.rowTheirs]}>
              {item.reactions.map((r) => (
                <View
                  key={r.emoji}
                  testID={`chat-reaction-${r.emoji}`}
                  style={[styles.reaction, r.mine && styles.reactionMine]}
                >
                  <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                  {r.count > 1 ? <Text style={styles.reactionCount}>{r.count}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}
          {receipt ? (
            <Text testID="chat-receipt" style={styles.receipt}>{receipt}</Text>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}


/**
 * A conversation: the message list plus a composer. Reused by the parent chat
 * (adults + per-teen threads) and the teen's own thread — the caller supplies
 * the load/send functions, so the same UI serves both sides with the server
 * enforcing who can see what.
 */
export function ChatThread({ load, send, markRead, react, edit, emptyHint }: Props) {
  const ui = useUI();
  const { t } = useStore();
  const styles = createStyles(ui);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // The message being answered, if any. Held as the whole message rather than
  // its id so the quote above the composer needs no lookup.
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  // The message a long press opened the actions for, if any.
  const [acting, setActing] = useState<ChatMessage | null>(null);
  // The message being corrected, if any. Mutually exclusive with replyTo:
  // you are either writing something new or fixing something old.
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  // Whatever was half-typed when the edit box took over the composer, so
  // changing your mind about an edit does not throw away a real message.
  const draftBeforeEdit = useRef('');
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
    // Advanced on changed_at, not created_at. A message that has just been
    // READ has changed without becoming newer; a cursor pinned to send time
    // could never move past it and every poll would ship it again forever.
    for (const m of incoming) {
      const at = m.changed_at || m.created_at || '';
      if (at && (!since.current || at > since.current)) since.current = at;
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
      const res = editing && edit
        ? await edit(editing.message_id, body)
        : await send(body, replyTo?.message_id);
      setText('');
      setReplyTo(null);
      setEditing(null);
      draftBeforeEdit.current = '';
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
  }, [text, sending, send, edit, t, absorb, replyTo, editing]);

  // Only the newest thing you sent carries a receipt. A column of "Seen"
  // under every bubble is noise; the one that answers "did that land?" is the
  // last one. Found by id rather than index so it survives the merge re-sort.
  const lastMineId = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].mine) return messages[i].message_id;
    }
    return null;
  })();

  const receipt = (m: ChatMessage): string | null => {
    // A thread the server did not price (it does not know the roster) says
    // nothing at all, rather than claiming "Sent" about a message that may
    // well have been read.
    if (typeof m.audience !== 'number') return null;
    if (m.audience === 0) return null;              // nobody else is in here yet
    if (m.seen) return t('chat_seen');
    if (!m.seen_by) return t('chat_sent');
    // Three people in a household chat: "who exactly" matters less than
    // "not everyone yet".
    return t('chat_seen_partial', { count: m.seen_by, total: m.audience });
  };

  const onReact = async (emoji: string) => {
    const target = acting;
    setActing(null);
    if (!target || !react) return;
    try {
      // Through the same merge as everything else, so the row appears at once
      // and the next poll cannot duplicate it.
      absorb([(await react(target.message_id, emoji)).message]);
    } catch (e) {
      logger.warn('chat react failed', e);
    }
  };

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
        renderItem={({ item, index }) => (
          <MessageRow
            item={item}
            // A name above every line makes six replies in a row read as six
            // separate announcements. Shown only when the speaker changes,
            // which is what every messenger does and what the eye expects.
            showSender={index === 0 || messages[index - 1]?.sender_name !== item.sender_name}
            styles={styles}
            ui={ui}
            t={t}
            onHold={setActing}
            onSwipeReply={(m) => { setReplyTo(m); setEditing(null); }}
            receipt={item.mine && item.message_id === lastMineId ? receipt(item) : null}
          />
        )}
      />
      <Modal
        visible={!!acting}
        transparent
        animationType="fade"
        onRequestClose={() => setActing(null)}
      >
        <Pressable
          testID="chat-actions-dismiss"
          style={styles.sheetBackdrop}
          onPress={() => setActing(null)}
        >
          <View testID="chat-actions" style={styles.sheet}>
            {react ? (
              <>
                {/* Labelled, because six emoji sitting above a Reply button
                    read as "reply with this emoji" rather than "react". */}
                <Text style={styles.sheetLabel}>{t('chat_react_label')}</Text>
              </>
            ) : null}
            {react ? (
              <View style={styles.sheetEmoji}>
                {CHAT_REACTIONS.map((emoji) => (
                  <PressScale
                    key={emoji}
                    testID={`chat-react-${emoji}`}
                    onPress={() => onReact(emoji)}
                    accessibilityLabel={emoji}
                    style={styles.sheetEmojiBtn}
                  >
                    <Text style={styles.sheetEmojiText}>{emoji}</Text>
                  </PressScale>
                ))}
              </View>
            ) : null}
            {react ? <View style={styles.sheetRule} /> : null}
            <Text style={styles.sheetLabel}>{t('chat_actions_label')}</Text>
            <PressScale
              testID="chat-action-reply"
              onPress={() => { setReplyTo(acting); setEditing(null); setActing(null); }}
              style={styles.sheetAction}
            >
              <Text style={styles.sheetActionText}>{t('chat_reply')}</Text>
            </PressScale>
            {edit && acting && chatCanEdit(acting) ? (
              <PressScale
                testID="chat-action-edit"
                onPress={() => {
                  draftBeforeEdit.current = text;
                  setEditing(acting);
                  setReplyTo(null);
                  setText(acting.text);
                  setActing(null);
                }}
                style={styles.sheetAction}
              >
                <Text style={styles.sheetActionText}>{t('chat_edit')}</Text>
              </PressScale>
            ) : null}
          </View>
        </Pressable>
      </Modal>
      {editing ? (
        <View testID="chat-editing" style={styles.replyBar}>
          <View style={styles.replyBarText}>
            <Text numberOfLines={1} style={styles.quoteName}>{t('chat_editing')}</Text>
            <Text numberOfLines={1} style={styles.quoteText}>{editing.text}</Text>
          </View>
          <PressScale
            testID="chat-edit-cancel"
            onPress={() => { setEditing(null); setText(draftBeforeEdit.current); }}
            accessibilityLabel={t('chat_edit_cancel')}
            style={styles.replyCancel}
          >
            <X color={ui.muted} size={18} />
          </PressScale>
        </View>
      ) : null}
      {replyTo ? (
        <View testID="chat-replying-to" style={styles.replyBar}>
          <View style={styles.replyBarText}>
            <Text numberOfLines={1} style={styles.quoteName}>
              {t('chat_replying_to', { name: replyTo.sender_name })}
            </Text>
            <Text numberOfLines={1} style={styles.quoteText}>{replyTo.text}</Text>
          </View>
          <PressScale
            testID="chat-reply-cancel"
            onPress={() => setReplyTo(null)}
            accessibilityLabel={t('chat_reply_cancel')}
            style={styles.replyCancel}
          >
            <X color={ui.muted} size={18} />
          </PressScale>
        </View>
      ) : null}
      <View ref={composerRef} style={styles.composer} collapsable={false}>
        <TextInput
          testID="chat-input"
          // Starting to type takes you to the newest message. The keyboard
          // effect below only fires when the OS reports a height, which does
          // not happen with a hardware keyboard, when the keyboard is already
          // open from another field, or on the web — so tapping the box left
          // you looking at wherever you had scrolled to.
          onFocus={() => {
            atBottom.current = true;
            requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
          }}
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
  listContent: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { flex: 1, textAlign: 'center', color: ui.muted, fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 40 },
  bubbleRow: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubbleCap: { maxWidth: '82%' },
  bubble: { borderRadius: 18, paddingHorizontal: 15, paddingVertical: 10 },
  bubbleMine: { backgroundColor: ui.orange, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderBottomLeftRadius: 4 },
  sender: { fontFamily: 'Inter_700Bold', fontSize: 12, color: ui.orangeText, marginBottom: 3 },
  // 16/23 rather than 15/21. A chat is read at arm's length, often one-handed
  // and often by somebody older than the person who built it; the old size was
  // legible in a screenshot and tiring on a phone. Font scaling from the OS
  // still applies on top of this.
  msgText: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 23, color: ui.text },
  msgTextMine: { color: '#fff' },
  receipt: {
    alignSelf: 'flex-end', marginTop: 3, marginRight: 4,
    fontFamily: 'Inter_500Medium', fontSize: 12, color: ui.muted,
  },
  editedMark: {
    fontFamily: 'Inter_400Regular', fontSize: 10, color: ui.muted,
    marginTop: 2, alignSelf: 'flex-end',
  },
  editedMarkMine: { color: 'rgba(255,255,255,0.8)' },
  // Behind the bubble, revealed by dragging it right.
  swipeHint: {
    position: 'absolute', left: 10, top: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetLabel: {
    fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 0.6,
    textTransform: 'uppercase', color: ui.muted,
    paddingHorizontal: 16, paddingTop: 4,
  },
  sheetRule: { height: 1, backgroundColor: ui.line, marginVertical: 4 },
  reactionRow: { flexDirection: 'row', gap: 4, marginTop: -2, paddingHorizontal: 4 },
  reaction: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line,
    borderRadius: 11, paddingHorizontal: 6, paddingVertical: 2,
  },
  reactionMine: { borderColor: ui.orange },
  reactionEmoji: { fontSize: 12 },
  reactionCount: { fontFamily: 'Inter_500Medium', fontSize: 11, color: ui.muted },
  sheetBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  sheet: {
    backgroundColor: ui.bg, borderRadius: 20, borderWidth: 1, borderColor: ui.line,
    paddingVertical: 10, paddingHorizontal: 8, gap: 6, maxWidth: '100%',
  },
  // Wraps rather than overflowing: six emoji plus padding is wider than a
  // 320px phone once the sheet's own margins are paid.
  sheetEmoji: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  sheetEmojiBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetEmojiText: { fontSize: 24 },
  sheetAction: { paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  sheetActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: ui.text },
  quote: {
    borderLeftWidth: 3, borderLeftColor: ui.orange, paddingLeft: 8,
    marginBottom: 6, opacity: 0.9,
  },
  quoteMine: { borderLeftColor: '#fff' },
  quoteName: { fontFamily: 'Inter_700Bold', fontSize: 11, color: ui.orangeText },
  quoteText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: ui.muted },
  quoteTextMine: { color: '#fff' },
  replyBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 14, paddingTop: 8, backgroundColor: ui.bg,
  },
  // minWidth 0: without it the quoted line refuses to shrink below its own
  // text and pushes the cancel button off the side of a narrow phone.
  replyBarText: { flex: 1, minWidth: 0 },
  replyCancel: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
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
