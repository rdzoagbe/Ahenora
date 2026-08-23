import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { SpendingView } from '../src/components/SpendingView';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';

/**
 * House expenses as its own address.
 *
 * The screen people actually use is the Spending tab inside Kitchen — that is
 * where someone already is when they come home from the shop. This route stays
 * so links made before the move still open something real, and it renders the
 * very same component rather than a second copy that could drift.
 */
export default function HouseExpensesRoute() {
  const ui = useUI();
  const router = useRouter();
  const { t } = useStore();
  const styles = createStyles(ui);

  // Expo Router prerenders this route, where there is no session and no data.
  // Rendering an empty frame until the client has mounted keeps the served HTML
  // and the first client render identical.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']} />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <PressScale testID="expenses-back" onPress={() => router.back()} style={styles.backBtn} accessibilityLabel={t('back')}>
          <ChevronLeft color={ui.text} size={22} />
        </PressScale>
        <Text style={styles.headTitle} numberOfLines={1}>{t('exp_title')}</Text>
        <View style={{ width: 36 }} />
      </View>
      <SpendingView />
    </SafeAreaView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: ui.line,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: ui.text },
});
