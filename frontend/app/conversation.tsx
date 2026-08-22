import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { ChatThread } from '../src/components/ChatThread';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { api } from '../src/api';

/**
 * A single conversation, opened full-screen from the Messages tab. It is a
 * pushed route (not a tab sub-view) on purpose: the bottom tab bar floats over
 * its own screen, so an in-tab chat put the composer *under* the bar with no
 * room for the keyboard. As a pushed screen the bar is gone, and the safe-area
 * inset keeps the composer clear of the phone's navigation bar.
 */
export default function Conversation() {
  const ui = useUI();
  const router = useRouter();
  const { t } = useStore();
  const styles = createStyles(ui);
  const params = useLocalSearchParams<{ thread?: string; title?: string; adults?: string }>();

  const thread = String(params.thread || '');
  const title = String(params.title || t('chat_title'));
  const isAdults = params.adults === '1';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <PressScale testID="conversation-back" onPress={() => router.back()} style={styles.back} accessibilityLabel={t('back')}>
          <ChevronLeft color={ui.text} size={22} />
        </PressScale>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>
      <ChatThread
        load={() => api.chatGet(thread)}
        send={(text) => api.chatSend(thread, text)}
        markRead={() => api.chatRead(thread)}
        emptyHint={isAdults ? t('chat_empty_adults') : t('chat_empty_teen')}
      />
    </SafeAreaView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: ui.line,
  },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontFamily: 'Inter_800ExtraBold', fontSize: 17, color: ui.text },
});
