import React, { useEffect, useRef, useState } from 'react';
import { Alert, ImageBackground, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { GoogleSignin, isErrorWithCode, isSuccessResponse } from '@react-native-google-signin/google-signin';
import * as Linking from 'expo-linking';
import { Globe, Sparkles, ShieldCheck, Crown, ArrowRight } from 'lucide-react-native';

import { AmbientBackground } from '../src/components/AmbientBackground';
import { LanguageModal } from '../src/components/LanguageModal';
import { PressScale } from '../src/components/PressScale';
import { useStore } from '../src/store';
import { logger } from '../src/logger';

WebBrowser.maybeCompleteAuthSession();

const BG_URL =
  'https://static.prod-images.emergentagent.com/jobs/096ff1e5-0337-4e7f-a0c1-6a43a75126d3/images/6b243a1cf4a6ac9e40857ce24db4ef57d5831d303169f63507bb73111fe11fac.png';

function extractInviteToken(rawUrl?: string | null) {
  if (!rawUrl) return null;

  try {
    const parsed = Linking.parse(rawUrl);
    const token = parsed.queryParams?.invite;
    if (typeof token === 'string' && token.trim()) return token.trim();
  } catch {
    // Fall back to URL parsing below.
  }

  try {
    const url = new URL(rawUrl.replace('#', '?'));
    const token = url.searchParams.get('invite');
    return token?.trim() || null;
  } catch {
    const match = rawUrl.match(/[?#&]invite=([^&#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

function isExpoGoAndroid() {
  return Platform.OS === 'android' && Constants.appOwnership === 'expo';
}

function isDeveloperError(error: any) {
  const code = isErrorWithCode(error) ? error.code : error?.code;
  const message = String(error?.message || error || '');
  return code === '10' || code === 'DEVELOPER_ERROR' || message.includes('DEVELOPER_ERROR');
}

function shortClientId(value?: string) {
  if (!value) return 'missing';
  if (!value.includes('.apps.googleusercontent.com')) return 'set-but-not-google-client-format';
  const compact = value.replace('.apps.googleusercontent.com', '');
  return `${compact.slice(0, 8)}...${compact.slice(-6)}.apps.googleusercontent.com`;
}

export default function Landing() {
  const router = useRouter();
  const handledResponseRef = useRef(false);
  const { user, loading, t, lang, setUserFromAuth, theme } = useStore();

  const [showLang, setShowLang] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitedBy, setInvitedBy] = useState<string | null>(null);

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?.trim();

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    androidClientId,
    webClientId,
  });

  useEffect(() => {
    if (!loading && user) {
      router.replace('/feed');
    }
  }, [loading, user, router]);

  useEffect(() => {
    const loadInvite = async (token: string | null) => {
      if (!token) return;
      setInviteToken(token);

      try {
        const { api } = await import('../src/api');
        const invite = await api.getInvite(token);
        setInvitedBy(invite.inviter_name);
      } catch (e: any) {
        logger.warn('Invite lookup failed:', e?.message || e);
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const token = extractInviteToken(window.location.href);
      if (token) {
        try {
          window.sessionStorage.setItem('pending_invite', token);
        } catch {
          // Ignore storage failure.
        }
        loadInvite(token);
      } else {
        try {
          loadInvite(window.sessionStorage.getItem('pending_invite'));
        } catch {
          // Ignore storage failure.
        }
      }
      return;
    }

    Linking.getInitialURL().then((url) => loadInvite(extractInviteToken(url)));
    const subscription = Linking.addEventListener('url', ({ url }) => {
      loadInvite(extractInviteToken(url));
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const handleGoogleResponse = async () => {
      if (!response || handledResponseRef.current) return;
      if (response.type !== 'success') return;

      handledResponseRef.current = true;

      try {
        const idToken =
          response.params?.id_token ||
          response.authentication?.idToken ||
          (response.authentication as any)?.rawResponse?.id_token;

        if (!idToken) {
          Alert.alert('Sign-in failed', 'Google did not return an ID token.');
          handledResponseRef.current = false;
          return;
        }

        let token = inviteToken || undefined;
        if (!token && Platform.OS === 'web' && typeof window !== 'undefined') {
          try {
            token = window.sessionStorage.getItem('pending_invite') || undefined;
          } catch {
            // Ignore storage failure.
          }
        }

        const { api } = await import('../src/api');
        const authResult = await api.exchangeSession(idToken, token);
        await setUserFromAuth(authResult.user, authResult.session_token);

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          try {
            window.sessionStorage.removeItem('pending_invite');
          } catch {
            // Ignore storage failure.
          }
        }

        router.replace('/feed');
      } catch (error: any) {
        logger.error('google sign-in failed', error?.message || error);
        Alert.alert('Sign-in failed', error?.message || 'Please try again.');
        handledResponseRef.current = false;
      }
    };

    handleGoogleResponse();
  }, [response, inviteToken, router, setUserFromAuth]);

  const startAuthSessionFallback = async () => {
    if (!androidClientId) {
      Alert.alert('Google Sign-In not configured', 'Missing EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID in .env.');
      return;
    }

    if (!request) {
      Alert.alert('Google Sign-In not ready', 'Please try again in a moment.');
      return;
    }

    handledResponseRef.current = false;
    await promptAsync();
  };

  const signIn = async () => {
    try {
      if (isExpoGoAndroid()) {
        Alert.alert(
          'Development build required',
          'Google sign-in cannot be tested in Expo Go on Android because the OAuth redirect belongs to Expo Go, not Household COO. Use a Household COO development build to test sign-in.'
        );
        return;
      }

      if (!webClientId) {
        Alert.alert('Google Sign-In not configured', 'Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env.');
        return;
      }

      if (Platform.OS === 'android') {
        try {
          GoogleSignin.configure({
            webClientId,
            offlineAccess: false,
            profileImageSize: 120,
            scopes: ['profile', 'email'],
          });

          await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

          const nativeResponse = await GoogleSignin.signIn();

          if (!isSuccessResponse(nativeResponse)) {
            return;
          }

          const idToken = nativeResponse.data?.idToken;

          if (!idToken) {
            Alert.alert(
              'Google Sign-In failed',
              'Native Google Sign-In did not return an ID token. Check that EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is a Web OAuth client ID.'
            );
            return;
          }

          const { api } = await import('../src/api');
          const authResult = await api.exchangeSession(idToken, inviteToken || undefined);
          await setUserFromAuth(authResult.user, authResult.session_token);

          router.replace('/feed');
          return;
        } catch (nativeError: any) {
          logger.error('native google sign-in failed', nativeError?.message || nativeError);

          if (isDeveloperError(nativeError)) {
            Alert.alert(
              'Google Sign-In configuration issue',
              `Native Google Sign-In returned DEVELOPER_ERROR (10). I will try the browser fallback next.\n\nIf the fallback also fails, verify Google Cloud has Android OAuth package com.householdcoo.app with the EAS SHA-1, and that EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is a Web client.\n\nWeb client: ${shortClientId(webClientId)}\nAndroid client: ${shortClientId(androidClientId)}`,
              [{ text: 'Continue', onPress: startAuthSessionFallback }]
            );
            return;
          }

          throw nativeError;
        }
      }

      if (!androidClientId) {
        Alert.alert('Google Sign-In not configured', 'Missing EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID in .env.');
        return;
      }

      if (!request) {
        Alert.alert('Google Sign-In not ready', 'Please try again in a moment.');
        return;
      }

      handledResponseRef.current = false;
      await promptAsync();
    } catch (error: any) {
      const code = isErrorWithCode(error) ? ` (${error.code})` : '';
      logger.error('google prompt failed', error?.message || error);
      Alert.alert('Google Sign-In failed', `${error?.message || 'Please try again.'}${code}`);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <ImageBackground source={{ uri: BG_URL }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View
        style={[
          styles.overlay,
          { backgroundColor: theme.mode === 'light' ? 'rgba(246,247,251,0.56)' : 'rgba(8,9,16,0.48)' },
        ]}
        pointerEvents="none"
      />
      <AmbientBackground />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <View style={styles.logoRow}>
            <View style={[styles.logoDot, { backgroundColor: theme.colors.accent }]} />
            <Text style={[styles.logoText, { color: theme.colors.text }]}>COO</Text>
          </View>

          <PressScale
            testID="landing-lang"
            onPress={() => setShowLang(true)}
            style={[styles.langBtn, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
          >
            <Globe color={theme.colors.textMuted} size={14} />
            <Text style={[styles.langText, { color: theme.colors.textMuted }]}>{lang.toUpperCase()}</Text>
          </PressScale>
        </View>

        <View style={styles.center}>
          <View style={[styles.badge, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
            <Sparkles color={theme.colors.text} size={12} />
            <Text style={[styles.badgeText, { color: theme.colors.text }]}>{t('app_name')}</Text>
          </View>

          {invitedBy ? (
            <View
              style={[styles.inviteBanner, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}
              testID="invite-banner"
            >
              <Text style={[styles.inviteText, { color: theme.colors.textMuted }]}> 
                <Text style={[styles.inviteStrong, { color: theme.colors.text }]}>{invitedBy}</Text>
                {' invited you to join their Household COO.'}
              </Text>
            </View>
          ) : null}

          <Text style={[styles.heading, { color: theme.colors.text }]}>{t('tagline')}</Text>
          <Text style={[styles.sub, { color: theme.colors.textMuted }]}>A calmer household dashboard with priorities, reminders, secure vaulting, and elegant coordination.</Text>

          <View style={styles.buttonStack}>
            <PressScale
              testID="google-signin"
              onPress={signIn}
              disabled={Platform.OS === 'web' && !request}
              style={[
                styles.cta,
                { backgroundColor: theme.colors.primary },
                Platform.OS === 'web' && !request && styles.ctaDisabled,
              ]}
            >
              <View style={styles.googleDot}>
                <Text style={styles.googleText}>G</Text>
              </View>
              <Text style={[styles.ctaText, { color: theme.colors.primaryText }]}>{t('sign_in')}</Text>
            </PressScale>

            <PressScale
              testID="landing-pricing-link"
              onPress={() => router.push('/pricing')}
              style={[styles.secondaryCta, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
            >
              <Text style={[styles.secondaryCtaText, { color: theme.colors.text }]}>Explore plans</Text>
              <ArrowRight color={theme.colors.text} size={14} />
            </PressScale>
          </View>

          <View style={styles.secureRow}>
            <ShieldCheck color={theme.colors.textSoft} size={12} />
            <Text style={[styles.secureText, { color: theme.colors.textSoft }]}>{t('sign_in_secure')}</Text>
          </View>

          <View style={styles.adminNote}>
            <Crown color="#F59E0B" size={12} />
            <Text style={[styles.adminNoteText, { color: theme.colors.textSoft }]}>Admin testers unlock after sign-in via backend policy.</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.foot, { color: theme.colors.textSoft }]}>Household COO · beautifully organised family operations</Text>
        </View>
      </SafeAreaView>

      <LanguageModal visible={showLang} onClose={() => setShowLang(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject },
  safe: { flex: 1, paddingHorizontal: 22 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoDot: { width: 15, height: 15, borderRadius: 9999 },
  logoText: { fontFamily: 'Inter_700Bold', fontSize: 15, letterSpacing: 1.5 },
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 9999,
    borderWidth: 1,
  },
  langText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  center: { flex: 1, justifyContent: 'center' },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9999,
    borderWidth: 1,
    marginBottom: 14,
  },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  inviteBanner: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    marginBottom: 14,
  },
  inviteText: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  inviteStrong: { fontFamily: 'Inter_600SemiBold' },
  heading: {
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 47,
    lineHeight: 53,
    maxWidth: 330,
  },
  sub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    marginBottom: 24,
    maxWidth: 340,
  },
  buttonStack: { gap: 12 },
  cta: {
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  ctaDisabled: { opacity: 0.55 },
  secondaryCta: {
    alignSelf: 'stretch',
    height: 50,
    borderRadius: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
  },
  secondaryCtaText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  googleDot: {
    width: 26,
    height: 26,
    borderRadius: 9999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(8,9,16,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleText: { fontWeight: '800', color: '#4285F4' },
  ctaText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  secureText: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  adminNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  adminNoteText: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'center' },
  footer: { alignItems: 'center', paddingBottom: 10, gap: 10 },
  foot: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'center' },
});
