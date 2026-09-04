import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ImageBackground, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as Linking from 'expo-linking';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { Globe, Sparkles, ShieldCheck, Crown, ArrowRight, Mail } from 'lucide-react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import { AmbientBackground } from '../src/components/AmbientBackground';
import { EmailAuthModal } from '../src/components/EmailAuthModal';
import { LanguageModal } from '../src/components/LanguageModal';
import { PressScale } from '../src/components/PressScale';
import { ValueTour } from '../src/components/ValueTour';
import { useStore } from '../src/store';
import { logger } from '../src/logger';
import { extractInviteToken, rememberInvite, readStoredInvite, clearStoredInvite } from '../src/invite';
import { getLoginHint, clearLoginHint, maskEmail, LoginHint } from '../src/loginHint';

WebBrowser.maybeCompleteAuthSession();

const BG_URL =
  'https://static.prod-images.emergentagent.com/jobs/096ff1e5-0337-4e7f-a0c1-6a43a75126d3/images/6b243a1cf4a6ac9e40857ce24db4ef57d5831d303169f63507bb73111fe11fac.png';

function authErrorMessage(error: unknown, params?: Record<string, string>, fallback?: string) {
  const candidate = error as { description?: string; code?: string; name?: string } | null | undefined;
  return (
    candidate?.description ||
    candidate?.code ||
    candidate?.name ||
    params?.error_description ||
    params?.error ||
    fallback ||
    'Google returned an authentication error.'
  );
}

export default function Landing() {
  const router = useRouter();
  const handledResponseRef = useRef(false);
  const { user, loading, t, lang, setUserFromAuth, theme } = useStore();

  const [showLang, setShowLang] = useState(false);
  const [showEmailAuth, setShowEmailAuth] = useState(false);
  // The landing has two doors: Log in (returning) and Create account (new).
  // Whichever is tapped opens the email form on that form.
  const [emailMode, setEmailMode] = useState<'login' | 'signup'>('login');
  const [emailPrefill, setEmailPrefill] = useState<string | undefined>(undefined);
  const openEmailAuth = (m: 'login' | 'signup', prefill?: string) => {
    setEmailMode(m); setEmailPrefill(prefill); setShowEmailAuth(true);
  };
  // "Welcome back" recognition: a locally-remembered last sign-in (email +
  // method, never a token). Present → greet the returning user; absent (new or
  // reinstalled device) → the cold create/log-in landing.
  const [loginHint, setLoginHint] = useState<LoginHint | null>(null);
  useEffect(() => { getLoginHint().then(setLoginHint).catch(() => undefined); }, []);
  const forgetHint = () => { clearLoginHint().catch(() => undefined); setLoginHint(null); };
  const continueAsHint = () => {
    if (!loginHint) return;
    if (loginHint.method === 'google') signIn();
    else openEmailAuth('login', loginHint.email);
  };
  const [signingIn, setSigningIn] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitedBy, setInvitedBy] = useState<string | null>(null);
  const [showTour, setShowTour] = useState(false);

  // First-launch value tour: shown once before the sign-in screen. Invited
  // users skip it — they already know why they're here.
  useEffect(() => {
    AsyncStorage.getItem('coo_value_tour_seen')
      .then((seen) => {
        if (!seen) setShowTour(true);
      })
      .catch(() => {
        // Storage unavailable — just show the sign-in screen.
      });
  }, []);

  const dismissTour = () => {
    setShowTour(false);
    AsyncStorage.setItem('coo_value_tour_seen', '1').catch(() => {
      // Best-effort; worst case the tour shows again next launch.
    });
  };

  const FALLBACK_WEB = '243255248169-cei972lc7kmfig6tmjb6l2nlmgqkjf22.apps.googleusercontent.com';
  const FALLBACK_ANDROID = '243255248169-n4l7es5ecr3j85v00dia2icp9kjo7umh.apps.googleusercontent.com';

  const webClientId =
    (typeof process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID === 'string' && process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.trim())
    || FALLBACK_WEB;
  const androidClientId =
    (typeof process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID === 'string' && process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID.trim())
    || FALLBACK_ANDROID;
  // A Google OAuth client is bound to ONE platform: an Android client is tied to
  // the package name and signing fingerprint and is rejected outright when a
  // request comes from iOS. This was passed as the generic `clientId`, so on iOS
  // the Google button would have opened a sheet that failed every time — and a
  // sign-in door that cannot open is an App Review rejection, not a papercut.
  // No fallback constant on purpose: an empty value must HIDE the button, not
  // quietly reuse a client that belongs to another platform.
  const iosClientId =
    (typeof process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID === 'string' && process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.trim())
    || '';
  // Every other platform keeps working exactly as before.
  const googleAvailable = Platform.OS !== 'ios' || Boolean(iosClientId);
  const webRedirectUri = Platform.OS !== 'android' ? AuthSession.makeRedirectUri({ scheme: 'householdcoo', path: 'oauthredirect' }) : undefined;

  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: Platform.OS === 'ios' ? (iosClientId || androidClientId) : androidClientId,
    webClientId,
    androidClientId,
    ...(iosClientId ? { iosClientId } : {}),
    redirectUri: webRedirectUri,
  });

  useEffect(() => {
    logger.info('Google AuthSession redirect URI', webRedirectUri || 'missing');
  }, [webRedirectUri]);

  useEffect(() => {
    if (!loading && user) {
      // A teen account gets the restricted teen view, never the full app.
      router.replace(user.is_teen ? '/teen' : '/feed');
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

    // A link's token is put somewhere durable the moment it arrives, because
    // signing in is what loses it: a new tab on web, a re-created activity on
    // Android. When no link is at hand, whatever was stored earlier is used.
    const arrive = async (token: string | null) => {
      if (token) {
        await rememberInvite(token);
        loadInvite(token);
      } else {
        loadInvite(await readStoredInvite());
      }
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      arrive(extractInviteToken(window.location.href));
      return;
    }

    Linking.getInitialURL().then((url) => arrive(extractInviteToken(url)));
    const subscription = Linking.addEventListener('url', ({ url }) => {
      const fromLink = extractInviteToken(url);
      if (fromLink) arrive(fromLink);
    });

    return () => subscription.remove();
  }, []);

  /** Turn a Google id_token into a session and land in the app. Shared by the
   *  native popup result and the web redirect return, so both finish identically. */
  const completeWithIdToken = useCallback(async (idToken: string) => {
    // Not `Platform.OS === 'web'` any more. Android tears the activity down
    // behind Google's sheet often enough that component state is the one place
    // the token cannot be trusted to survive.
    const token = inviteToken || (await readStoredInvite()) || undefined;

    const { api } = await import('../src/api');
    const authResult = await api.exchangeSession(idToken, token);
    await setUserFromAuth(authResult.user, authResult.session_token, 'google');

    await clearStoredInvite();

    router.replace('/feed');
  }, [inviteToken, router, setUserFromAuth]);

  /** Sign in with Apple. Required by the App Store in any app that also offers
   *  Google sign-in, and on iOS it is the button most people reach for. Apple
   *  returns the person's name ONLY on the first authorisation, so it is passed
   *  along when present and never sent blank on later sign-ins. */
  const signInWithApple = useCallback(async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      const AppleAuthentication = await import('expo-apple-authentication');
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('No identity token from Apple');
      const full = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean).join(' ').trim();
      const { api } = await import('../src/api');
      const authResult = await api.exchangeAppleSession(
        credential.identityToken, full || undefined, inviteToken || undefined);
      await setUserFromAuth(authResult.user, authResult.session_token, 'apple');
      router.replace('/feed');
    } catch (e: any) {
      // Cancelling the sheet is a choice, not an error.
      if (e?.code === 'ERR_REQUEST_CANCELED') return;
      logger.warn('apple sign-in failed', e);
      Alert.alert(t('land_apple_failed_title'), t('land_apple_failed_msg'));
    } finally {
      setSigningIn(false);
    }
  }, [signingIn, inviteToken, router, setUserFromAuth, t]);

  // Apple's button belongs only where Apple sign-in exists.
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let alive = true;
    import('expo-apple-authentication')
      .then((m) => m.isAvailableAsync())
      .then((ok) => { if (alive) setAppleAvailable(!!ok); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const handleGoogleResponse = async () => {
      if (!response || handledResponseRef.current) return;

      if (response.type === 'error') {
        logger.error('google auth-session error', response.error || response.params);
        Alert.alert(t('land_google_signin_failed'), authErrorMessage(response.error, response.params, t('land_google_auth_error')));
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
          Alert.alert(t('land_signin_failed'), t('land_no_id_token'));
          handledResponseRef.current = false;
          return;
        }

        await completeWithIdToken(idToken);
      } catch (error: any) {
        logger.error('google sign-in failed', error?.message || error);
        Alert.alert(t('land_signin_failed'), error?.message || t('land_try_again'));
        handledResponseRef.current = false;
        setSigningIn(false);
      }
    };

    handleGoogleResponse();
  }, [response, inviteToken, router, setUserFromAuth]);

  /** Web: finish a redirect-based sign-in. Google hands the token back in the
   *  URL fragment of whichever page it returned to, so read it here and complete.
   *  The fragment is cleared first: a spent token replayed on refresh just errors. */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw.includes('id_token=')) return;

    const idToken = new URLSearchParams(raw).get('id_token');
    if (!idToken || handledResponseRef.current) return;
    handledResponseRef.current = true;

    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      // Ignore history failure — the sign-in below still runs.
    }

    setSigningIn(true);
    completeWithIdToken(idToken).catch((error: any) => {
      logger.error('google redirect sign-in failed', error?.message || error);
      Alert.alert(t('land_signin_failed'), error?.message || t('land_try_again'));
      handledResponseRef.current = false;
      setSigningIn(false);
    });
    // t is intentionally omitted: it changes identity on every language render
    // and this must run once for the token in the URL, not again on each change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completeWithIdToken]);

  const signIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    try {
      if (Platform.OS === 'android') {
        if (!webClientId) {
          Alert.alert(t('land_signin_unavailable'), t('land_google_not_configured'));
          setSigningIn(false);
          return;
        }

        GoogleSignin.configure({ webClientId, scopes: ['profile', 'email'], offlineAccess: false });
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const userInfo = await GoogleSignin.signIn();
        const idToken = userInfo?.data?.idToken || (userInfo as any)?.idToken;

        if (!idToken) {
          Alert.alert(t('land_signin_failed'), t('land_no_id_token'));
          setSigningIn(false);
          return;
        }

        const token = inviteToken || (await readStoredInvite()) || undefined;

        const { api: apiModule } = await import('../src/api');
        const authResult = await apiModule.exchangeSession(idToken, token);
        await setUserFromAuth(authResult.user, authResult.session_token, 'google');
        await clearStoredInvite();
        router.replace('/feed');
        return;
      }

      if (!webClientId) {
        Alert.alert(t('land_signin_unavailable'), t('land_google_not_configured'));
        setSigningIn(false);
        return;
      }

      if (!request) {
        Alert.alert(t('land_signin_not_ready'), t('land_try_again_moment'));
        setSigningIn(false);
        return;
      }

      handledResponseRef.current = false;

      // Web takes a full-page redirect rather than promptAsync's popup. A popup
      // returns the token through window.opener, and Cross-Origin-Opener-Policy
      // severs that link — the page never learned sign-in had finished, so every
      // click just opened another window and nothing completed. Navigating the
      // tab itself has no opener to lose; the token comes back in the URL
      // fragment and the effect above finishes the job. Uses the request's own
      // URL, so client id, scopes, nonce and redirect_uri stay exactly what
      // Google already accepts.
      if (Platform.OS === 'web' && typeof window !== 'undefined' && request.url) {
        window.location.assign(request.url);
        return;
      }

      const result = await promptAsync();
      // The success case is finished by the response effect (which navigates);
      // for any other outcome (dismiss/cancel) clear the busy state here.
      if (!result || result.type !== 'success') {
        setSigningIn(false);
      }
    } catch (error: any) {
      setSigningIn(false);
      if (error?.code === 'SIGN_IN_CANCELLED') return;
      logger.error('google sign-in failed', error?.message || error);
      Alert.alert(t('land_signin_failed'), error?.message || t('land_try_again'));
    }
  };

  const handleEmailSuccess = () => {
    setShowEmailAuth(false);
    clearStoredInvite();
    router.replace('/feed');
  };

  // While the saved session is being restored (or a signed-in user is about to
  // be redirected to the app), show a plain splash instead of the sign-in page —
  // otherwise the connect/create screen flashes for already-logged-in users.
  if (loading || user) {
    return (
      <View style={[styles.container, styles.splash, { backgroundColor: theme.colors.bg }]}>
        <ActivityIndicator color={theme.colors.accent} size="large" />
      </View>
    );
  }

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
            <Text style={[styles.logoText, { color: theme.colors.text }]}>Ahenora</Text>
          </View>

          <PressScale
            testID="landing-lang"
            onPress={() => setShowLang(true)}
            style={[styles.langBtn, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
            accessibilityLabel={t('land_change_language')}
            accessibilityRole="button"
            hitSlop={8}
          >
            <Globe color={theme.colors.textMuted} size={14} />
            <Text style={[styles.langText, { color: theme.colors.textMuted }]}>{lang.toUpperCase()}</Text>
          </PressScale>
        </View>

        <View style={styles.center}>
          <View style={[styles.badge, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}> 
            <Sparkles color={theme.colors.text} size={12} />
            <Text style={[styles.badgeText, { color: theme.colors.text }]}>{t('land_badge_google_play')}</Text>
          </View>

          {invitedBy ? (
            <View
              style={[styles.inviteBanner, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent }]}
              testID="invite-banner"
            >
              <Text style={[styles.inviteText, { color: theme.colors.textMuted }]}> 
                <Text style={[styles.inviteStrong, { color: theme.colors.text }]}>{invitedBy}</Text>
                {t('land_invite_suffix')}
              </Text>
            </View>
          ) : null}

          <Text style={[styles.heading, { color: theme.colors.text }]}>
            {loginHint && !inviteToken ? t('land_welcome_back') : t('land_heading')}
          </Text>
          <Text style={[styles.sub, { color: theme.colors.textMuted }]}>
            {loginHint && !inviteToken ? t('land_welcome_back_sub') : t('land_sub')}
          </Text>

          {/* An always-available door into the value tour — the first-launch
              auto-show happens once, but anyone can (re)watch how it works
              before deciding to sign in. */}
          <PressScale
            testID="landing-see-how"
            onPress={() => setShowTour(true)}
            style={[styles.tourBtn, { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.cardBorder }]}
            accessibilityRole="button"
            accessibilityLabel={t('land_see_how')}
          >
            <Sparkles color={theme.colors.accentInk} size={16} />
            <Text style={[styles.tourBtnText, { color: theme.colors.accentInk }]}>{t('land_see_how')}</Text>
          </PressScale>

          <View style={[styles.testingCard, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
            <ShieldCheck color={theme.colors.accent} size={16} />
            <Text style={[styles.testingText, { color: theme.colors.textMuted }]}>{t('land_privacy_note')}</Text>
          </View>

          <View style={styles.buttonStack}>
            {loginHint && !inviteToken && !(loginHint.method === 'google' && !googleAvailable) ? (
              /* Returning user: greet them and offer one tap back in as the
                 account they last used. "Not you?" drops to the full doors. */
              <>
                <PressScale
                  testID="continue-as-hint"
                  onPress={continueAsHint}
                  disabled={signingIn || (Platform.OS === 'web' && loginHint.method === 'google' && !request)}
                  style={[
                    styles.cta,
                    { backgroundColor: theme.colors.primary },
                    (signingIn || (Platform.OS === 'web' && loginHint.method === 'google' && !request)) && styles.ctaDisabled,
                  ]}
                  accessibilityLabel={`${t('land_continue_as')} ${maskEmail(loginHint.email)}`}
                  accessibilityRole="button"
                >
                  {signingIn ? (
                    <ActivityIndicator color={theme.colors.primaryText} />
                  ) : (
                    <>
                      {loginHint.method === 'google' ? (
                        <View style={styles.googleDot}><Text style={styles.googleText}>G</Text></View>
                      ) : (
                        <View style={[styles.emailDot, { backgroundColor: theme.colors.accentSoft }]}>
                          <Mail color={theme.colors.accent} size={15} />
                        </View>
                      )}
                      <Text style={[styles.ctaText, { color: theme.colors.primaryText }]} numberOfLines={1}>
                        {t('land_continue_as')} {maskEmail(loginHint.email)}
                      </Text>
                    </>
                  )}
                </PressScale>

                <PressScale
                  testID="not-you"
                  onPress={forgetHint}
                  disabled={signingIn}
                  style={[styles.secondaryCta, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }, signingIn && styles.ctaDisabled]}
                  accessibilityLabel={t('land_not_you')}
                  accessibilityRole="button"
                >
                  <Text style={[styles.secondaryCtaText, { color: theme.colors.textMuted }]}>{t('land_not_you')}</Text>
                </PressScale>
              </>
            ) : (
              /* New or unrecognised device: the full set of doors. */
              <>
                {appleAvailable ? (
                  <PressScale
                    testID="apple-signin"
                    onPress={signInWithApple}
                    disabled={signingIn}
                    style={[styles.cta, styles.appleCta, signingIn && styles.ctaDisabled]}
                    accessibilityLabel={t('land_apple_signin')}
                    accessibilityRole="button"
                  >
                    <Text style={styles.appleGlyph}></Text>
                    <Text style={[styles.ctaText, { color: '#FFFFFF' }]}>{t('land_apple_signin')}</Text>
                  </PressScale>
                ) : null}

                {googleAvailable ? (
                <PressScale
                  testID="google-signin"
                  onPress={signIn}
                  disabled={signingIn || (Platform.OS === 'web' && !request)}
                  style={[
                    styles.cta,
                    { backgroundColor: theme.colors.primary },
                    (signingIn || (Platform.OS === 'web' && !request)) && styles.ctaDisabled,
                  ]}
                  accessibilityLabel={t('land_a11y_google')}
                  accessibilityRole="button"
                >
                  {signingIn ? (
                    <ActivityIndicator color={theme.colors.primaryText} />
                  ) : (
                    <>
                      <View style={styles.googleDot}>
                        <Text style={styles.googleText}>G</Text>
                      </View>
                      <Text style={[styles.ctaText, { color: theme.colors.primaryText }]}>{t('sign_in')}</Text>
                    </>
                  )}
                </PressScale>
                ) : null}

                <PressScale
                  testID="email-login"
                  onPress={() => openEmailAuth('login')}
                  disabled={signingIn}
                  style={[styles.cta, styles.emailCta, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }, signingIn && styles.ctaDisabled]}
                  accessibilityLabel={t('land_email_login')}
                  accessibilityRole="button"
                >
                  <View style={[styles.emailDot, { backgroundColor: theme.colors.accentSoft }]}>
                    <Mail color={theme.colors.accent} size={15} />
                  </View>
                  <Text style={[styles.ctaText, { color: theme.colors.text }]}>{t('land_email_login')}</Text>
                </PressScale>

                {/* Separate door for new users — no returning user is ever asked
                    to create a second account, and a new user has an obvious way in. */}
                <PressScale
                  testID="email-signup"
                  onPress={() => openEmailAuth('signup')}
                  disabled={signingIn}
                  style={[styles.secondaryCta, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }, signingIn && styles.ctaDisabled]}
                  accessibilityLabel={t('land_email_signup')}
                  accessibilityRole="button"
                >
                  <Text style={[styles.secondaryCtaText, { color: theme.colors.textMuted }]}>
                    {t('land_new_here')} <Text style={{ color: theme.colors.accent, fontFamily: 'Inter_700Bold' }}>{t('land_email_signup')}</Text>
                  </Text>
                </PressScale>
              </>
            )}

            <PressScale
              testID="landing-pricing-link"
              onPress={() => router.push('/pricing')}
              disabled={signingIn}
              style={[styles.secondaryCta, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }, signingIn && styles.ctaDisabled]}
              accessibilityLabel={t('land_view_plans')}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryCtaText, { color: theme.colors.text }]}>{t('land_view_plans')}</Text>
              <ArrowRight color={theme.colors.text} size={14} />
            </PressScale>
          </View>

          <View style={styles.secureRow}>
            <ShieldCheck color={theme.colors.textSoft} size={12} />
            <Text style={[styles.secureText, { color: theme.colors.textMuted }]}>{t('land_secure_note')}</Text>
          </View>

          <View style={styles.adminNote}>
            <Crown color="#F59E0B" size={12} />
            <Text style={[styles.adminNoteText, { color: theme.colors.textMuted }]}>{t('land_premium_note')}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={[styles.foot, { color: theme.colors.textMuted }]}>{t('land_footer')}</Text>
        </View>
      </SafeAreaView>

      {showTour && !inviteToken ? <ValueTour onDone={dismissTour} /> : null}

      <LanguageModal visible={showLang} onClose={() => setShowLang(false)} />
      <EmailAuthModal
        visible={showEmailAuth}
        onClose={() => setShowEmailAuth(false)}
        onSuccess={handleEmailSuccess}
        inviteToken={inviteToken}
        initialMode={emailMode}
        initialEmail={emailPrefill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  splash: { alignItems: 'center', justifyContent: 'center' },
  overlay: { ...StyleSheet.absoluteFill },
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
  appleCta: { backgroundColor: '#000000', borderWidth: 0 },
  appleGlyph: { color: '#FFFFFF', fontSize: 17, marginTop: -2 },
  tourBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  tourBtnText: {
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 14,
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
  emailCta: { borderWidth: 1 },
  emailDot: {
    width: 26,
    height: 26,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  secureText: { fontFamily: 'Inter_400Regular', fontSize: 11, flex: 1, textAlign: 'center' },
  adminNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10 },
  adminNoteText: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'center' },
  footer: { alignItems: 'center', paddingBottom: 10, gap: 10 },
  foot: { fontFamily: 'Inter_400Regular', fontSize: 11, textAlign: 'center' },
});
