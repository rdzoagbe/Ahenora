import { Platform } from 'react-native';

/**
 * The three Google OAuth client ids, one per platform, in one place.
 *
 * They were spread across two screens with two different policies. The
 * calendar hardcoded public fallbacks for web and Android; the sign-in screen
 * refused any fallback for iOS on principle. Both were reasonable alone and
 * together they produced a crash: on 2026-09-07, the first day an over-the-air
 * update reached an iPhone, the calendar screen threw on open for every iOS
 * user. The OTA is built by GitHub Actions, which had never been given the iOS
 * client id because no OTA had ever needed one — so on iOS the calendar called
 * Google.useAuthRequest with neither `iosClientId` nor `clientId`, and
 * expo-auth-session's invariant threw inside render.
 *
 * A Google client is bound to ONE platform. An Android client is tied to the
 * package name and signing fingerprint and Google rejects it from iOS — so the
 * one thing this file must never do is hand a platform someone else's id. The
 * fallbacks below are each platform's OWN client. They are public by nature:
 * they ship inside the binary and are already committed in eas.json.
 *
 * The environment still wins when set, so a rotated client takes effect
 * without a code change.
 */
function fromEnv(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const GOOGLE_WEB_CLIENT_ID =
  fromEnv(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) ||
  '243255248169-cei972lc7kmfig6tmjb6l2nlmgqkjf22.apps.googleusercontent.com';

export const GOOGLE_ANDROID_CLIENT_ID =
  fromEnv(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID) ||
  '243255248169-n4l7es5ecr3j85v00dia2icp9kjo7umh.apps.googleusercontent.com';

export const GOOGLE_IOS_CLIENT_ID =
  fromEnv(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID) ||
  '243255248169-hj776p5o5db76dn2q5562sflbfa6gvfh.apps.googleusercontent.com';

/**
 * The id this platform must present. Never another platform's — and never
 * empty, because expo-auth-session throws on an empty one inside render, and a
 * throw inside render is a screen that will not open.
 */
export function googleClientIdForPlatform(os: string = Platform.OS): string {
  if (os === 'ios') return GOOGLE_IOS_CLIENT_ID;
  if (os === 'android') return GOOGLE_ANDROID_CLIENT_ID;
  return GOOGLE_WEB_CLIENT_ID;
}

/**
 * The full config for either Google hook. Every platform key is set and
 * `clientId` is the platform's own, so the invariant inside expo-auth-session
 * can never fire whichever key it looks up first.
 */
export function googleClientIds(os: string = Platform.OS) {
  return {
    clientId: googleClientIdForPlatform(os),
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
  };
}
