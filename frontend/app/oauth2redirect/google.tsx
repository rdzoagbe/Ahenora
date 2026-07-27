import React, { useEffect } from 'react';
import { StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useStore } from '../../src/store';

// Complete any pending auth session opened in a Chrome Custom Tab, then bounce
// home. This route is intentionally inert: the live Google flow uses the
// `oauthredirect` path (web) and the native Google SDK (Android), and neither
// lands here. It previously auto-exchanged any `id_token` from the deep-link
// fragment for a session, which let a crafted link sign a victim into an
// attacker-controlled account (session fixation). We no longer trust an
// unsolicited token: sign-in only completes through the in-app request that
// owns the matching PKCE/state, never from a raw inbound link.
WebBrowser.maybeCompleteAuthSession();

export default function OAuthGoogleRedirect() {
  const router = useRouter();
  const { t } = useStore();

  useEffect(() => {
    const timer = setTimeout(() => router.replace('/'), 400);
    return () => clearTimeout(timer);
  }, [router]);

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
