import React, { useEffect, useRef } from 'react';
import { Alert, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { useStore } from '../../src/store';

WebBrowser.maybeCompleteAuthSession();

function extractAccessToken(url: string): string | null {
  const afterHash = url.split('#')[1] ?? '';
  const afterQuery = url.split('?')[1]?.split('#')[0] ?? '';
  for (const part of [afterHash, afterQuery]) {
    if (!part) continue;
    const token = new URLSearchParams(part).get('access_token');
    if (token) return token;
  }
  return null;
}

export default function OAuthFacebookRedirect() {
  const router = useRouter();
  const { setUserFromAuth } = useStore();
  const handledRef = useRef(false);
  const url = Linking.useURL();

  useEffect(() => {
    if (!url || handledRef.current) return;

    const accessToken = extractAccessToken(url);

    if (!accessToken) {
      router.replace('/');
      return;
    }

    handledRef.current = true;

    (async () => {
      try {
        const { api } = await import('../../src/api');
        const { user, session_token } = await api.exchangeFacebookSession(accessToken);
        await setUserFromAuth(user, session_token);
        router.replace('/feed');
      } catch (err: any) {
        Alert.alert('Facebook sign-in failed', err?.message || 'Please try again.');
        handledRef.current = false;
        router.replace('/');
      }
    })();
  }, [url, router, setUserFromAuth]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#fff" size="large" />
      <Text style={styles.text}>Completing Facebook sign-in…</Text>
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
