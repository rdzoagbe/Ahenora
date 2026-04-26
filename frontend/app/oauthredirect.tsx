import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export default function OAuthRedirect() {
  const router = useRouter();

  useEffect(() => {
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
