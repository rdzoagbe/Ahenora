import React, { useEffect, useRef } from 'react';
import { Alert, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useStore } from '../../src/store';

// Complete any pending auth session opened in a Chrome Custom Tab.
WebBrowser.maybeCompleteAuthSession();

function extractIdToken(url: string): string | null {
  // id_token lives in the URL fragment (#) for implicit/hybrid flows.
  const afterHash = url.split('#')[1] ?? '';
  const afterQuery = url.split('?')[1]?.split('#')[0] ?? '';
  for (const part of [afterHash, afterQuery]) {
    if (!part) continue;
    try {
      const token = new URLSearchParams(part).get('id_token');
      if (token) return token;
    } catch {
      // URLSearchParams should exist on RN, but guard against any engine gap.
      const match = part.match(/[?&#]?id_token=([^&#]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
  }
  return null;
}

export default function OAuthGoogleRedirect() {
  const router = useRouter();
  const { setUserFromAuth, t } = useStore();
  const handledRef = useRef(false);
  const url = Linking.useURL();

  useEffect(() => {
    if (!url || handledRef.current) return;

    const idToken = extractIdToken(url);

    if (!idToken) {
      // URL arrived but had no token — go back to login so user can retry.
      router.replace('/');
      return;
    }

    handledRef.current = true;

    (async () => {
      try {
        const { api } = await import('../../src/api');
        const { user, session_token } = await api.exchangeSession(idToken);
        await setUserFromAuth(user, session_token);
        router.replace('/feed');
      } catch (err: any) {
        Alert.alert(t('land_signin_failed'), err?.message || t('land_try_again'));
        handledRef.current = false;
        router.replace('/');
      }
    })();
  }, [url, router, setUserFromAuth]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#fff" size="large" />
      <Text style={styles.text}>{t('land_completing_signin')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  text: {
    color: '#fff',
    marginTop: 16,
    fontSize: 16,
  },
});
