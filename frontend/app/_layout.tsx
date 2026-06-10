import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
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
import { PlayfairDisplay_400Regular_Italic } from '@expo-google-fonts/playfair-display';
import { StoreProvider, useStore } from '../src/store';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function RootNavigator() {
  const { resolvedAppearance, theme } = useStore();

  return (
    <>
      <StatusBar style={resolvedAppearance === 'light' ? 'dark' : 'light'} backgroundColor={theme.colors.bg} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="oauthredirect" />
        <Stack.Screen name="oauth2redirect/google" />
        <Stack.Screen name="oauth2redirect/facebook" />
        <Stack.Screen name="pricing" />
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
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <StoreProvider>
      <RootNavigator />
    </StoreProvider>
  );
}