# Android push: what has to exist for a phone to receive one

Expo's push service delivers to Android through Firebase Cloud Messaging.
Three things must be true, and until 2026-09-08 none of them were, which is
why an iPhone got every notification with the app closed and an Android
phone got none.

## 1. `frontend/android/app/google-services.json` (committed)

From the Firebase console: create (or open) a project, add an **Android app**
with package name `com.householdcoo.app`, and download `google-services.json`.
Put it at `frontend/android/app/google-services.json` and commit it. It is
safe to commit: it ships inside every APK and contains only public
identifiers. The build now **fails without it** (the `google-services` Gradle
plugin is applied unconditionally), because a build that installs and never
receives a push is worse than a build that refuses.

## 2. FCM V1 credentials on EAS (never committed, never in chat)

In the Firebase console → Project settings → Service accounts → **Generate
new private key**. Then, from `frontend/`:

    eas credentials -p android

Choose the production build profile → *Google Service Account Key for FCM V1*
→ upload the key file. Delete the local copy afterwards. This key can send
notifications as the app; it never goes in the repo or in a chat.

## 3. A new Android binary

Push capability is native. Over-the-air updates cannot add it. After 1 and 2,
build it from the repository — **Actions → "EAS Build (Android)" → Run
workflow**, profile `production`.

Do NOT run `eas build` on a laptop. It uploads the folder you run it in, not
the code on `main`, and a downloaded ZIP silently ships whatever it happened
to contain. That is how build 56 reached Google Play with no Firebase in it.
The build server now refuses such an upload; see `docs/RELEASING.md`.

Every Android phone needs the resulting store version before it can register
a token.

## How to see whether it worked

- On the phone: Settings → Notifications → **Send a test notification**. The
  reply names how many devices were reached; "no device registered" means
  the token never got to the server.
- In the app's admin panel → Notifications: phones are counted **per
  platform**. Zero Android tokens with Android users in the household is the
  symptom. Below it, the last delivery errors Expo reported (fetched from push
  receipts about fifteen minutes after each send): `InvalidCredentials` means
  step 2 is missing or wrong; `DeviceNotRegistered` means the token is stale
  and has been retired automatically.
- A phone that cannot get a token reports the reason to the admin panel's
  client errors as `push-register` (for example *Default FirebaseApp is not
  initialized*, which is exactly step 1 missing).
