# Household COO Auth Testing Checklist

Run these tests only in the installed development build, not Expo Go.

- Confirm Android OAuth client ID.
- Confirm SHA-1 fingerprint.
- Confirm SHA-256 fingerprint.
- Confirm `GOOGLE_ANDROID_CLIENT_ID` in Railway.
- Confirm `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` in frontend environment.
- Confirm `EXPO_PUBLIC_BACKEND_URL` points to Railway.

## Device tests

1. Fresh install.
2. Open app.
3. Sign in with Google.
4. Confirm session token is stored.
5. Confirm authenticated user lands on Feed.
6. Kill app.
7. Reopen app.
8. Confirm session persists.
9. Sign out.
10. Sign in again.
11. Repeat with a second non-admin account.