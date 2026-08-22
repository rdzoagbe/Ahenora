import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export default function OAuthRedirect() {
  const router = useRouter();

  useEffect(() => {
    // If Google returned the token to THIS page, carry the fragment across to
    // the landing screen, which knows how to finish the sign-in. router.replace
    // drops the fragment, which would silently throw the token away — so hand
    // over through the URL itself.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      if (hash.includes('id_token=')) {
        window.location.replace(`/app/${hash}`);
        return;
      }
    }

    const timer = setTimeout(() => {
      router.replace('/');
    }, 1200);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#fff" />
      <Text style={styles.text}>Completing Google sign-in...</Text>
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
