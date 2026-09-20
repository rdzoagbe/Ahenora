import React, { useEffect, useRef, useState } from 'react';
import { reportColdStart } from '../src/perf';
import { Stack, usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { InviteJoinPrompt } from '../src/components/InviteJoinPrompt';
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
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StoreProvider, useStore } from '../src/store';
import { RootErrorBoundary } from '../src/components/RootErrorBoundary';
import { UpgradeModal } from '../src/components/UpgradeModal';
import { WebUpdateBanner } from '../src/components/WebUpdateBanner';
import { UpdateNotice } from '../src/components/UpdateNotice';
import { ensurePushRegistered, attachNotificationRouting, targetForNotification } from '../src/notifications';
import { routeMatchesTarget } from '../src/notificationRouting';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootNavigator() {
  const { resolvedAppearance, theme, user } = useStore();
  const router = useRouter();

  // Register this device for push as soon as someone is signed in — and again on
  // every launch, so a rotated Expo token is refreshed. Without this the token
  // was only ever sent when a user manually flipped a Settings toggle, so most
  // families had no registered device and no server push could reach them.
  useEffect(() => {
    if (user) ensurePushRegistered(!!user.is_teen);
  }, [user]);

  // Route a tapped notification to where it belongs — the conversation for a
  // message, the Feed for a task, the Family hub for a star or a join — instead
  // of dropping the person on whatever screen they last saw.
  //
  // Reported as "no notification I click on takes me to the place where it's
  // located", and a single router.push is not enough to fix it, for two
  // reasons that both only bite at startup.
  //
  // READINESS. Tapping the 07:30 digest after a night with the app closed is a
  // cold start every time. `user` hydrates from a cached session, and it can do
  // so before the root navigator has mounted its screens — a push issued in
  // that window is dropped on the floor. Because the cold-start response is
  // consumed exactly once (and latched so a later refreshUser cannot re-route
  // to it), that dropped push is the tap gone for good: the person lands on
  // the default tab and the notification looks like it did nothing at all.
  // Waiting for the navigation state to carry a key is what "there is a
  // navigator to push onto" means.
  //
  // ARRIVAL. Startup runs redirects of its own — index.tsx sends a signed-in
  // person to the Feed, the tabs layout can divert to onboarding — so a push
  // that lands correctly can still be replaced a tick later by a redirect that
  // was already in flight. Holding the target and checking where we ended up
  // turns a stomped navigation into one that is simply re-issued.
  const navigationState = useRootNavigationState();
  const navigatorReady = !!navigationState?.key;
  const pathname = usePathname();
  // The tap waiting to be honoured, with how many times we have tried. A ref
  // rather than state so the applier below never sets state from an effect
  // body; `targetTick` is what actually re-runs it.
  const heldTarget = useRef<{ target: { pathname: string; params?: Record<string, string> }; attempts: number } | null>(null);
  const [targetTick, setTargetTick] = useState(0);

  useEffect(() => {
    if (!user || !navigatorReady) return;
    let cleanup = () => undefined as void;
    let active = true;
    attachNotificationRouting((t) => {
      heldTarget.current = { target: t, attempts: 0 };
      setTargetTick((n) => n + 1);
    }).then((fn) => { if (active) cleanup = fn; else fn(); });
    return () => { active = false; cleanup(); };
  }, [user, navigatorReady]);

  // Push the held target, then keep checking we got there. Bounded on purpose:
  // four attempts over about two seconds covers a startup redirect landing
  // after us, and then it stops. A notification must never be able to fight
  // somebody who has decided to go somewhere else.
  useEffect(() => {
    const held = heldTarget.current;
    if (!held) return;
    if (routeMatchesTarget(pathname, held.target.pathname)) {
      heldTarget.current = null;
      return;
    }
    if (held.attempts >= 4) {
      heldTarget.current = null;
      return;
    }
    held.attempts += 1;
    router.push(held.target as never);
    const timer = setTimeout(() => setTargetTick((n) => n + 1), 500);
    return () => clearTimeout(timer);
  }, [targetTick, pathname, router]);

  // The web twin of the tap routing above. The service worker posts the payload
  // of a tapped browser notification to the focused tab; without a listener the
  // tap just focused whatever screen was already open, so a "Roland handed you
  // the school run" notification never actually opened the task.
  useEffect(() => {
    if (Platform.OS !== 'web' || !user) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const payload = (event as MessageEvent<{ type?: string; data?: Record<string, unknown> }>).data;
      if (!payload || payload.type !== 'push-notification-tap') return;
      const target = targetForNotification(payload.data || {});
      // Held and verified like the native tap above, not pushed and forgotten:
      // a browser tab that was reloaded by the click runs its own startup
      // redirects too, and they land after this.
      if (target) {
        heldTarget.current = { target, attempts: 0 };
        setTargetTick((n) => n + 1);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
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
      {/* An invite waiting for this email must be offered BEFORE the app
          walks the person into building a household of their own. Mounted
          here rather than inside (tabs) — where it used to live — because
          registration lands on onboarding first, and by the time the tabs
          rendered the new household already existed. Six of nine invitees
          signed up on the invited address and ended up alone because of
          exactly that ordering. It renders nothing without a session. */}
      <InviteJoinPrompt />
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
        <Stack.Screen name="gift-pot" />
        <Stack.Screen name="pot/[token]" />
        <Stack.Screen name="santa" />
        <Stack.Screen name="santa-match/[token]" />
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
      // Cold start ends when the splash comes down, because that is the first
      // moment a person can see and touch anything. Measuring to "the bundle
      // finished evaluating" would report a number nobody experiences, and
      // measuring to a screen's data arriving would blame the network for a
      // launch that felt fine.
      reportColdStart();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* OUTSIDE StoreProvider on purpose. A boundary inside it cannot render
          when the store is what threw, and the store is where a bad update is
          most likely to land. Everything below this line — router, providers,
          every modal — now fails into a panel instead of into a phone that
          will not open the app. */}
      <RootErrorBoundary>
        <StoreProvider>
          <RootNavigator />
        </StoreProvider>
      </RootErrorBoundary>
    </GestureHandlerRootView>
  );
}