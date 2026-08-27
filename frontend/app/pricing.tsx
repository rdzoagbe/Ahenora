import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { PricingView } from '../src/components/PricingView';
import { PressScale } from '../src/components/PressScale';
import { AmbientBackground } from '../src/components/AmbientBackground';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';

export default function PricingScreen() {
  const router = useRouter();
  const { t, user } = useStore();
  const ui = useUI();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const goBack = () => {
    // Use the router's OWN stack, not window.history.length: on the web the
    // browser history counts entries from before the app loaded (arriving from
    // a search result, say), so length>1 was true while the router had nothing
    // to pop — router.back() then did nothing and the button looked dead. This
    // is the same pattern every other screen uses.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(user ? '/(tabs)/feed' : '/');
    }
  };

  const handleAuthRequired = () => {
    // Send user to landing to sign in; keep them on /pricing after
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.sessionStorage.setItem('post_auth_redirect', '/pricing');
    }
    router.replace('/');
  };

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <PressScale testID="pricing-back" onPress={goBack} style={styles.backBtn}>
            <ArrowLeft color={ui.text} size={16} />
            <Text style={styles.backText}>{t('back')}</Text>
          </PressScale>
        </View>
        <PricingView onAuthRequired={handleAuthRequired} />
      </SafeAreaView>
    </View>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: ui.bg },
  safe: { flex: 1 },
  topBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: ui.line,
    backgroundColor: ui.soft,
  },
  backText: {
    color: ui.text,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    letterSpacing: 0.4,
  },
});
