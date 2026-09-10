# Releasing: the cloud workflow is the only way to build

Store builds are made by GitHub Actions, on Expo's servers, from the exact
commit on `main`. Not from a laptop.

## Why

`eas build` uploads **the directory you run it in**. It does not fetch
anything from GitHub. On 2026-09-08 a production bundle was built inside
`Household-COO-main` — the folder GitHub's **Download ZIP** button produces —
which was a copy taken on 2 September. Google Play therefore received the app
as it had been six days earlier:

* the five-seat tab bar with the centre ＋, replaced on 3 September;
* the microphone, deleted on 3 September;
* no Firebase, because the Gradle wiring added that morning was not in the
  folder — so the build did not refuse, and every Android install was silent.

Nothing failed. The build went green, the store accepted it, and the only
symptom was a phone that looked wrong and never buzzed.

## How to build

**Actions → "EAS Build (Android)" → Run workflow.** Choose:

| Input | Use |
| --- | --- |
| `profile` | `production` for the store, `preview` for an installable APK |
| `submit` | on, to send it to Google Play automatically |
| `track` | `internal` to test it yourself first, `production` to release |

It checks out `main`, installs dependencies and runs `eas build` on Expo. The
keystore and the FCM key live on Expo, so nothing about them is needed here.

Auto-submit needs a `GOOGLE_SERVICE_ACCOUNT_KEY` repository secret (Play
Console → Setup → API access). Without it the run still builds and says so in
its summary; download the `.aab` from the build page and upload it in Play
Console by hand.

iOS has its own workflow, `ios-build.yml`.

## What stops a local build

`frontend/scripts/check-release-source.js` runs on Expo's build server as the
`eas-build-pre-install` hook, before anything else. For a release profile it
refuses when:

* the upload carries no git commit — a downloaded folder has no history, so
  its age cannot be known; or
* on Android, `android/app/google-services.json` is missing.

`development` builds are exempt. Building a dev client from a scratch
directory is ordinary work and reaches nobody.

This catches the mistake that happened. It cannot stop someone building from
a genuine but out-of-date clone. If you want that closed too, the enforcement
is to hold the Expo token only in CI: revoke the local login
(`eas logout` / rotate the token at expo.dev → Settings → Access tokens) and
leave the `EXPO_TOKEN` repository secret as the only copy.

## After a release

1. Play Console → Production → check the release rolled out.
2. Install it, then Settings → Notifications → **Send a test notification**.
   It should name one device.
3. Admin panel → Notifications: phones are counted per platform, with the
   delivery errors Google and Apple reported. `Android 0` means no Android
   phone has registered a push token yet.
