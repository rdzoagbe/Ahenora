import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

WebBrowser.maybeCompleteAuthSession();

export default function Landing() {
  const router = useRouter();

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    androidClientId,
    webClientId,
  });

  useEffect(() => {
    console.log('Google webClientId:', webClientId);
    console.log('Google androidClientId:', androidClientId);
    console.log('Google auth request:', request);
  }, [request, webClientId, androidClientId]);

  useEffect(() => {
    const handleGoogleResponse = async () => {
      if (!response) return;

      console.log('Google response:', response);

      if (response.type !== 'success') {
        console.log('Google sign-in was not successful:', response.type);
        return;
      }

      try {
        const idToken = response.params?.id_token;

        if (!idToken) {
          console.log('Google response params:', response.params);
          Alert.alert('Sign-in failed', 'Google did not return an ID token.');
          return;
        }

        console.log('Google ID token received.');

        const { api } = await import('../src/api');
        const result = await api.exchangeSession(idToken);

        console.log('Signed in user:', result.user);

        router.replace('/(tabs)/feed');
      } catch (error: any) {
        console.error('google sign-in failed', error);
        Alert.alert('Sign-in failed', error?.message || 'Please try again.');
      }
    };

    handleGoogleResponse();
  }, [response, router]);

  const signIn = async () => {
    try {
      if (!webClientId || !androidClientId) {
        Alert.alert(
          'Google Sign-In not configured',
          'Missing Google OAuth client IDs in .env.'
        );
        return;
      }

      if (!request) {
        Alert.alert(
          'Google Sign-In not ready',
          'The Google auth request is still loading. Please try again in a moment.'
        );
        return;
      }

      await promptAsync();
    } catch (error: any) {
      console.error('google prompt failed', error);
      Alert.alert('Sign-in failed', error?.message || 'Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Household COO</Text>
      <Text style={styles.subtitle}>Your household chief of staff</Text>

      <Pressable
        onPress={signIn}
        disabled={!request}
        style={[styles.button, !request && styles.disabled]}
      >
        <Text style={styles.buttonText}>Sign in with Google</Text>
      </Pressable>

      <Text style={styles.note}>Landing page test</Text>
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
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#bbb',
    fontSize: 16,
    marginBottom: 24,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 999,
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#111',
    fontWeight: '700',
  },
  note: {
    color: '#888',
    marginTop: 18,
  },
});