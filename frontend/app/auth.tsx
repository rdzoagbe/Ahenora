import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useStore } from '../src/store';

// Redirect target for the Microsoft/Outlook OAuth flow (householdcoo://auth).
// Completing the auth session here hands the code back to the pending
// promptAsync on the Calendar screen; then we bounce back to it. Without this
// route, expo-router treated /auth as an unknown screen ("Page not found").
WebBrowser.maybeCompleteAuthSession();

export default function AuthRedirect() {
  const router = useRouter();
  const { t } = useStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace('/(tabs)/calendar');
    }, 1200);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#fff" />
      <Text style={styles.text}>{t('auth_finishing')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { color: '#fff', marginTop: 16, fontSize: 16 },
});
