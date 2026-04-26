import React, { useEffect, useRef, useState } from 'react';
import { Alert, ImageBackground, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as Linking from 'expo-linking';
import { Globe, Sparkles, ShieldCheck, Crown } from 'lucide-react-native';

import { AmbientBackground } from '../src/components/AmbientBackground';
import { LanguageModal } from '../src/components/LanguageModal';
import { PressScale } from '../src/components/PressScale';
import { useStore } from '../src/store';
import { logger } from '../src/logger';

WebBrowser.maybeCompleteAuthSession();

const BG_URL = 'https://static.prod-images.emergentagent.com/jobs/096ff1e5-0337-4e7f-a0c1-6a43a75126d3/images/6b243a1cf4a6ac9e40857ce24db4ef57d5831d303169f63507bb73111fe11fac.png';

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

export default function Landing() {
  const router = useRouter();
  const handledResponseRef = useRef(false);
  const { user, loading, t, lang, setUserFromAuth } = useStore();

  const [showLang, setShowLang] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitedBy, setInvitedBy] = useState<string | null>(null);

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

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
          response.authentication?.rawResponse?.id_token;

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

  const signIn = async () => {
    try {
      if (isExpoGoAndroid()) {
        Alert.alert(
          'Development build required',
          'Google sign-in cannot be tested in Expo Go on Android because the OAuth redirect belongs to Expo Go, not Household COO. Use a Household COO development build to test sign-in.'
        );
        return;
      }

      if (!webClientId || !androidClientId) {
        Alert.alert('Google Sign-In not configured', 'Missing Google OAuth client IDs in .env.');
        return;
      }

      if (!request) {
        Alert.alert('Google Sign-In not ready', 'Please try again in a moment.');
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
      <ImageBackground source={{ uri: BG_URL }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <View style={styles.overlay} pointerEvents="none" />
      <AmbientBackground />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <View style={styles.logoRow}>
            <View style={styles.logoDot} />
            <Text style={styles.logoText}>COO</Text>
          </View>

          <PressScale testID="landing-lang" onPress={() => setShowLang(true)} style={styles.langBtn}>
            <Globe color="rgba(255,255,255,0.7)" size={14} />
            <Text style={styles.langText}>{lang.toUpperCase()}</Text>
          </PressScale>
        </View>

        <View style={styles.center}>
          <View style={styles.badge}>
            <Sparkles color="#fff" size={12} />
            <Text style={styles.badgeText}>{t('app_name')}</Text>
          </View>

          {invitedBy ? (
            <View style={styles.inviteBanner} testID="invite-banner">
              <Text style={styles.inviteText}>
                <Text style={styles.inviteStrong}>{invitedBy}</Text>
                {' invited you to join their Household COO.'}
              </Text>
            </View>
          ) : null}

          <Text style={styles.heading}>{t('tagline')}</Text>
          <Text style={styles.sub}>{t('subtitle')}</Text>

          <PressScale
            testID="google-signin"
            onPress={signIn}
            disabled={!request}
            style={[styles.cta, !request && styles.ctaDisabled]}
          >
            <View style={styles.googleDot}>
              <Text style={styles.googleText}>G</Text>
            </View>
            <Text style={styles.ctaText}>{t('sign_in')}</Text>
          </PressScale>

          <View style={styles.secureRow}>
            <ShieldCheck color="rgba(255,255,255,0.5)" size={12} />
            <Text style={styles.secureText}>{t('sign_in_secure')}</Text>
          </View>

          <View style={styles.adminNote}>
            <Crown color="#F59E0B" size={12} />
            <Text style={styles.adminNoteText}>Admin testers unlock after sign-in via backend policy.</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <PressScale
            testID="landing-pricing-link"
            onPress={() => router.push('/pricing')}
            style={styles.footerPricingBtn}
          >
            <Text style={styles.footerPricingText}>{t('pricing_link')}</Text>
          </PressScale>
          <Text style={styles.foot}>Household COO · v1</Text>
        </View>
      </SafeAreaView>

      <LanguageModal visible={showLang} onClose={() => setShowLang(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080910' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(8,9,16,0.48)' },
  safe: { flex: 1, paddingHorizontal: 22 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logoDot: { width: 15, height: 15, borderRadius: 9999, backgroundColor: '#F97316' },
  logoText: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 15, letterSpacing: 1.5 },
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  langText: { color: 'rgba(255,255,255,0.75)', fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  center: { flex: 1, justifyContent: 'center' },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    marginBottom: 14,
  },
  badgeText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  inviteBanner: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(249,115,22,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(249,115,22,0.32)',
    marginBottom: 14,
  },
  inviteText: { color: 'rgba(255,255,255,0.78)', fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  inviteStrong: { color: '#fff', fontFamily: 'Inter_600SemiBold' },
  heading: {
    color: '#fff',
    fontFamily: 'PlayfairDisplay_400Regular_Italic',
    fontSize: 47,
    lineHeight: 53,
    maxWidth: 330,
  },
  sub: {
    color: 'rgba(255,255,255,0.68)',
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    marginBottom: 24,
    maxWidth: 330,
  },
  cta: {
    alignSelf: 'stretch',
    height: 54,
    borderRadius: 9999,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  ctaDisabled: { opacity: 0.55 },
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
  ctaText: { color: '#080910', fontFamily: 'Inter_700Bold', fontSize: 15 },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  secureText: { color: 'rgba(255,255,255,0.5)', fontFamily: 'Inter_400Regular', fontSize: 11 },
  adminNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  adminNoteText: { color: 'rgba(255,255,255,0.45)', fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'center' },
  footer: { alignItems: 'center', paddingBottom: 10, gap: 10 },
  footerPricingBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  footerPricingText: { color: 'rgba(255,255,255,0.72)', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  foot: { color: 'rgba(255,255,255,0.35)', fontFamily: 'Inter_400Regular', fontSize: 11 },
});
