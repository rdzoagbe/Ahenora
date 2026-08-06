import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
// Side effect: maps Alert.alert onto browser dialogs on web, where the RN
// implementation is a no-op and every confirm button silently did nothing.
import '../src/webAlert';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import {
  PlayfairDisplay_400Regular_Italic,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_800ExtraBold,
} from '@expo-google-fonts/playfair-display';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StoreProvider, useStore } from '../src/store';
import { UpgradeModal } from '../src/components/UpgradeModal';
import { WebUpdateBanner } from '../src/components/WebUpdateBanner';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootNavigator() {
  const { resolvedAppearance, theme } = useStore();

  return (
    <>
      {/* SDK 57 removed `translucent`/`backgroundColor`: Android is always
          edge-to-edge now, so the status bar is inherently transparent. */}
      <StatusBar style={resolvedAppearance === 'light' ? 'dark' : 'light'} />
      <UpgradeModal />
      {/* Web only. A browser tab runs the JavaScript it loaded until someone
          reloads it, so iOS/web users can sit on a days-old build with no
          way to know — the native apps restart into updates, the web app
          cannot. This tells them, and reloads on request. */}
      <WebUpdateBanner />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="oauthredirect" />
        <Stack.Screen name="oauth2redirect/google" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="pricing" />
        <Stack.Screen name="metrics" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StoreProvider>
        <RootNavigator />
      </StoreProvider>
    </GestureHandlerRootView>
  );
}