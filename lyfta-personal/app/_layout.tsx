import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from '../src/store';

function ThemedStack() {
  const { theme, ready } = useStore();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      {ready ? (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.bg },
            animation: 'slide_from_bottom',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ animation: 'default' }} />
          <Stack.Screen
            name="pick-exercise"
            options={{ presentation: 'modal' }}
          />
          <Stack.Screen name="workout/[id]" options={{ presentation: 'card' }} />
        </Stack>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StoreProvider>
          <ThemedStack />
        </StoreProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
