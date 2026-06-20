import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ImageBackground, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as Linking from 'expo-linking';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Globe, Sparkles, ShieldCheck, Crown, ArrowRight } from 'lucide-react-native';

const FB_APP_ID = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID?.trim();
const FB_DISCOVERY = { authorizationEndpoint: 'https://www.facebook.com/v19.0/dialog/oauth' };

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

function authErrorMessage(error: unknown, params?: Record<string, string>) {
  const candidate = error as { description?: string; code?: string; name?: string } | null | undefined;
  return (
    candidate?.description ||
    candidate?.code ||
    candidate?.name ||
    params?.error_description ||
    params?.error ||
    'Google returned an authentication error.'
  );
}

export default function Landing() {
  const router = useRouter();
  const handledResponseRef = useRef(false);
  const handledFbRef = useRef(false);
  const { user, loading, t, lang, setUserFromAuth, theme } = useStore();

  const [showLang, setShowLang] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitedBy, setInvitedBy] = useState<string | null>(null);

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();
  const webRedirectUri = Platform.OS !== 'android' ? AuthSession.makeRedirectUri({ scheme: 'householdcoo', path: 'oauthredirect' }) : undefined;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId,
    redirectUri: webRedirectUri,
  });

  const fbRedirectUri = useMemo(() => AuthSession.makeRedirectUri({
    scheme: 'householdcoo',
    path: 'oauth2redirect/facebook',
  }), []);

  const [fbRequest, fbResponse, promptFacebook] = AuthSession.useAuthRequest(
    {
      clientId: FB_APP_ID || '',
      scopes: ['public_profile', 'email'],
      responseType: AuthSession.ResponseType.Token,
      redirectUri: fbRedirectUri,
    },
    FB_DISCOVERY
  );

  useEffect(() => {
    logger.info('Google AuthSession redirect URI', redirectUri || 'missing');
  }, [redirectUri]);

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

      if (response.type === 'error') {
        logger.error('google auth-session error', response.error || response.params);
        Alert.alert('Google Sign-In failed', authErrorMessage(response.error, response.params));
        return;
      }

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

  useEffect(() => {
    const handleFacebookResponse = async () => {
      if (!fbResponse || handledFbRef.current) return;
      if (fbResponse.type === 'error') {
        Alert.alert('Facebook Sign-In failed', fbResponse.error?.description || 'Facebook returned an error.');
        return;
      }
      if (fbResponse.type !== 'success') return;

      handledFbRef.current = true;
      const accessToken = fbResponse.params?.access_token || (fbResponse.authentication as any)?.accessToken;

      if (!accessToken) {
        Alert.alert('Sign-in failed', 'Facebook did not return an access token.');
        handledFbRef.current = false;
        return;
      }

      let token = inviteToken || undefined;
      if (!token && Platform.OS === 'web' && typeof window !== 'undefined') {
        try { token = window.sessionStorage.getItem('pending_invite') || undefined; } catch { /* ignore */ }
      }

      try {
        const { api } = await import('../src/api');
        const authResult = await api.exchangeFacebookSession(accessToken, token);
        await setUserFromAuth(authResult.user, authResult.session_token);
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          try { window.sessionStorage.removeItem('pending_invite'); } catch { /* ignore */ }
        }
        router.replace('/feed');
      } catch (error: any) {
        Alert.alert('Facebook sign-in failed', error?.message || 'Please try again.');
        handledFbRef.current = false;
      }
    };
    handleFacebookResponse();
  }, [fbResponse, inviteToken, router, setUserFromAuth]);

  const signIn = async () => {
    try {
      if (Platform.OS === 'android') {
        if (!webClientId) {
          Alert.alert('Sign-in unavailable', 'Google Sign-In is not configured.');
          return;
        }

        GoogleSignin.configure({ webClientId, scopes: ['profile', 'email'], offlineAccess: false });
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const userInfo = await GoogleSignin.signIn();
        const idToken = userInfo?.data?.idToken || (userInfo as any)?.idToken;

        if (!idToken) {
          Alert.alert('Sign-in failed', 'Google did not return an ID token.');
          return;
        }

        let token = inviteToken || undefined;
        if (!token && Platform.OS === 'web' && typeof window !== 'undefined') {
          try { token = window.sessionStorage.getItem('pending_invite') || undefined; } catch { /* ignore */ }
        }

        const { api: apiModule } = await import('../src/api');
        const authResult = await apiModule.exchangeSession(idToken, token);
        await setUserFromAuth(authResult.user, authResult.session_token);
        router.replace('/feed');
        return;
      }

      if (!webClientId) {
        Alert.alert('Sign-in unavailable', 'Google Sign-In is not configured.');
        return;
      }

      if (!request) {
        Alert.alert('Sign-in not ready', 'Please try again in a moment.');
        return;
      }

      handledResponseRef.current = false;
      await promptAsync();
    } catch (error: any) {
      if (error?.code === 'SIGN_IN_CANCELLED') return;
      logger.error('google sign-in failed', error?.message || error);
      Alert.alert('Sign-in failed', error?.message || 'Please try again.');
    }
  };

  const signInFacebook = async () => {
    if (!FB_APP_ID) {
      Alert.alert('Facebook Sign-In not configured', 'Missing EXPO_PUBLIC_FACEBOOK_APP_ID in .env.');
      return;
    }
    if (!fbRequest) {
      Alert.alert('Facebook Sign-In not ready', 'Please try again in a moment.');
      return;
    }
    handledFbRef.current = false;
    try {
      await promptFacebook();
    } catch (error: any) {
      Alert.alert('Facebook Sign-In failed', error?.message || 'Please try again.');
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
            <Text style={[styles.badgeText, { color: theme.colors.text }]}>Play Store testing release</Text>
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

          <Text style={[styles.heading, { color: theme.colors.text }]}>Organise your household, calmly.</Text>
          <Text style={[styles.sub, { color: theme.colors.textMuted }]}>Manage family tasks, reminders, scanned documents, calendar events, and secure vault items in one place.</Text>

          <View style={[styles.testingCard, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
            <ShieldCheck color={theme.colors.accent} size={16} />
            <Text style={[styles.testingText, { color: theme.colors.textMuted }]}>Testing release: paid plans are disabled, no payment is collected, and account/privacy controls are available in Settings.</Text>
          </View>

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
              testID="facebook-signin"
              onPress={signInFacebook}
              disabled={!fbRequest}
              style={[styles.cta, styles.fbCta, !fbRequest && styles.ctaDisabled]}
            >
              <View style={styles.fbDot}>
                <Text style={styles.fbText}>f</Text>
              </View>
              <Text style={[styles.ctaText, { color: '#fff' }]}>Continue with Facebook</Text>
            </PressScale>

            <PressScale
              testID="landing-pricing-link"
              onPress={() => router.push('/pricing')}
              style={[styles.secondaryCta, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
            >
              <Text style={[styles.secondaryCtaText, { color: theme.colors.text }]}>View testing plans</Text>
              <ArrowRight color={theme.colors.text} size={14} />
            </PressScale>
          </View>

          <View style={styles.secureRow}>
            <ShieldCheck color={theme.colors.textSoft} size={12} />
            <Text style={[styles.secureText, { color: theme.colors.textSoft }]}>Secure sign-in · Family data stays inside your Household COO account</Text>
          </View>

          <View style={styles.adminNote}>
            <Crown color="#F59E0B" size={12} />
            <Text style={[styles.adminNoteText, { color: theme.colors.textSoft }]}>Tester/admin access may unlock extra features for validation only.</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.foot, { color: theme.colors.textSoft }]}>Household COO · household operations for families</Text>
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
    marginBottom: 14,
    maxWidth: 340,
  },
  testingCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: 1,
    borderRadius: 18,
    padding: 12,
    marginBottom: 18,
  },
  testingText: {
    flex: 1,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    lineHeight: 18,
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
  fbCta: { backgroundColor: '#1877F2' },
  fbDot: {
    width: 26,
    height: 26,
    borderRadius: 9999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fbText: { fontWeight: '900', color: '#fff', fontSize: 16 },
  ctaText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  secureText: { fontFamily: 'Inter_400Regular', fontSize: 11, flex: 1, textAlign: 'center' },
  adminNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  adminNoteText: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'center' },
  footer: { alignItems: 'center', paddingBottom: 10, gap: 10 },
  foot: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'center' },
});
