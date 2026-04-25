import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';

import { useStore } from '../src/store';
import { logger } from '../src/logger';

WebBrowser.maybeCompleteAuthSession();

export default function Landing() {
  const router = useRouter();
  const handledResponseRef = useRef(false);

  const { user, loading, setUserFromAuth } = useStore();

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    androidClientId,
    webClientId,
  });

  useEffect(() => {
    logger.debug('Google webClientId configured:', Boolean(webClientId));
    logger.debug('Google androidClientId configured:', Boolean(androidClientId));
    logger.debug('Google auth request ready:', Boolean(request));
  }, [request, webClientId, androidClientId]);

  useEffect(() => {
    if (!loading && user) {
      logger.info('Existing authenticated user found. Redirecting to feed.');
      router.replace('/feed');
    }
  }, [loading, user, router]);

  useEffect(() => {
    const handleGoogleResponse = async () => {
      if (!response) return;

      logger.debug('Google response type:', response.type);

      if (handledResponseRef.current) return;

      if (response.type !== 'success') {
        logger.debug('Google sign-in was not successful:', response.type);
        return;
      }

      handledResponseRef.current = true;

      try {
        const idToken =
          response.params?.id_token ||
          response.authentication?.idToken ||
          response.authentication?.rawResponse?.id_token;

        if (!idToken) {
          logger.warn('Google sign-in succeeded but no ID token was returned.');
          Alert.alert('Sign-in failed', 'Google did not return an ID token.');
          handledResponseRef.current = false;
          return;
        }

        logger.info('Google ID token received.');

        const { api } = await import('../src/api');
        const authResult = await api.exchangeSession(idToken);

        logger.info(
          'Signed in user:',
          authResult.user?.email || authResult.user?.user_id || 'unknown'
        );

        await setUserFromAuth(authResult.user, authResult.session_token);

        logger.info('Session saved. Redirecting to feed.');
        router.replace('/feed');
      } catch (error: any) {
        logger.error('google sign-in failed', error?.message || error);
        Alert.alert('Sign-in failed', error?.message || 'Please try again.');
        handledResponseRef.current = false;
      }
    };

    handleGoogleResponse();
  }, [response, router, setUserFromAuth]);

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

      handledResponseRef.current = false;

      await promptAsync();
    } catch (error: any) {
      logger.error('google prompt failed', error?.message || error);
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
