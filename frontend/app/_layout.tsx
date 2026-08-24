import React, { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
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
import { UpdateNotice } from '../src/components/UpdateNotice';
import { ensurePushRegistered, attachNotificationRouting } from '../src/notifications';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootNavigator() {
  const { resolvedAppearance, theme, user } = useStore();
  const router = useRouter();

  // Register this device for push as soon as someone is signed in — and again on
  // every launch, so a rotated Expo token is refreshed. Without this the token
  // was only ever sent when a user manually flipped a Settings toggle, so most
  // families had no registered device and no server push could reach them.
  useEffect(() => {
    if (user) ensurePushRegistered();
  }, [user]);

  // Route a tapped notification to where it belongs — the conversation for a
  // message, the Feed for a task, the Family hub for a star or a join — instead
  // of dropping the person on whatever screen they last saw.
  useEffect(() => {
    let cleanup = () => undefined as void;
    let active = true;
    attachNotificationRouting((t) => {
      if (user) router.push(t as never);
    }).then((fn) => { if (active) cleanup = fn; else fn(); });
    return () => { active = false; cleanup(); };
  }, [user, router]);

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
      {/* Native. One notice at a time: relaunch into a staged update, go to
          the store when this build can no longer be updated at all, or read
          what changed after a version lands. */}
      <UpdateNotice />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="oauthredirect" />
        <Stack.Screen name="oauth2redirect/google" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="pricing" />
        <Stack.Screen name="metrics" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="teen" />
        <Stack.Screen name="member" />
        <Stack.Screen name="conversation" />
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