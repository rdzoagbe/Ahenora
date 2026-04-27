import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StoreProvider, useStore } from '../src/store';

function RootNavigator() {
  const { resolvedAppearance, theme } = useStore();

  return (
    <>
      <StatusBar style={resolvedAppearance === 'light' ? 'dark' : 'light'} backgroundColor={theme.colors.bg} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="oauthredirect" />
        <Stack.Screen name="pricing" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <StoreProvider>
      <RootNavigator />
    </StoreProvider>
  );
}
