# ⚠️ Native Android config — read before changing icons, permissions, or splash

This project commits a native `android/` folder (bare/prebuild workflow). That
has one consequence that has already caused **five production incidents**:

> **`app.json` is NOT the source of truth for anything native.** The committed
> files under `android/app/src/main/` are what actually ship. Editing `app.json`
> (icons, `blockedPermissions`, splash, adaptive icon) changes **nothing** in the
> build — it is silently ignored.

## Incidents this caused
1. **Play rejection (Photo/Video Permissions):** `app.json.blockedPermissions`
   listed the media permissions, but the committed `AndroidManifest.xml` still
   declared `READ_MEDIA_IMAGES` / `READ_EXTERNAL_STORAGE`. Every build shipped
   them. Fixed by editing the manifest directly + `tools:node="remove"`.
2. **Wrong app icon on device:** the Spark Portal icon updated `app.json` and the
   `assets/images/*.png` only. The committed `res/mipmap-*/` launcher icons were
   never regenerated, so every build shipped the old mascot while the Play *store
   listing* icon (uploaded separately in Console) showed the new one.
3. **Old splash logo flashing on launch:** the `expo-splash-screen` plugin in
   `app.json` correctly pointed at the new `monochrome.png`, but the committed
   `res/drawable-*/splashscreen_logo.png` files still held the old house-and-headset
   mascot. Every build showed the old logo for the second the app took to boot,
   even with the new launcher icon. Fixed by regenerating all five density PNGs
   directly from the Spark Portal glyph.

4. **Nine days of updates that reached nobody (the worst one):** `app.json`
   went to `runtimeVersion: "2.0.0"` for the SDK 57 upgrade on 2026-07-28. The
   committed `res/values/strings.xml` stayed at `1.0.0`, and that string — not
   `app.json` — is what `AndroidManifest.xml` feeds to expo-updates. So every
   `eas update` published at 2.0.0 while every installed phone reported 1.0.0,
   and expo-updates applies an update **only** when the two match. It does not
   warn, error, or retry: the update is published successfully and silently
   arrives nowhere. Three separate bug fixes were shipped, hand-tested, and
   reported broken over those nine days, because the phone was still running a
   bundle from July. Now guarded by `scripts/check-runtime-version.js`.
5. **The store showed the wrong version:** `app.json` said `1.0.2`; every
   uploaded bundle reported `1.0.0`, because Play reads `versionName` from
   `app/build.gradle`. Same guard covers it.

## The rule
When you change any of the following, you MUST edit the **native files**, not
`app.json` — and it needs a **new AAB** (native change, never OTA):

| Change | Native files to edit |
|---|---|
| App icon | `res/mipmap-*/ic_launcher*.webp` (all 5 densities) + `res/mipmap-anydpi-v26/ic_launcher*.xml` |
| Permissions | `AndroidManifest.xml` (use `tools:node="remove"` to strip lib-injected perms) |
| Splash color | `res/values/colors.xml` (`splashscreen_background`) + `res/values/styles.xml` |
| Splash image | `res/drawable*/splashscreen*.*` |
| Status bar color | `res/values/styles.xml` (`statusBarColor`) |
| **OTA runtime** | `res/values/strings.xml` (`expo_runtime_version`) — must equal `app.json`'s `runtimeVersion` or updates reach nobody |
| **Store version** | `app/build.gradle` (`versionName`) — must equal `app.json`'s `version` |

Icon regeneration script: `scratchpad/iconregen/gen.js` (sharp) generates every
density from `assets/images/{icon,adaptive-foreground,adaptive-background}.png`.

## The guards (CI)
Both now run in `frontend-ci-eas-update.yml` on every push. They used to be a
line in this file asking a human to remember, which is how incidents 1, 4 and 5
happened.

- `scripts/check-runtime-version.js` — fails if `expo_runtime_version` in
  `strings.xml` disagrees with `runtimeVersion` in `app.json`, or if
  `versionName` in `build.gradle` disagrees with `version`. Either mismatch is
  invisible at build time and catastrophic afterwards.
- `scripts/check-android-permissions.js` — fails if the manifest declares a
  forbidden broad permission (media/storage) without `tools:node="remove"`.

Run both before every AAB.

## The real long-term fix (do in the Expo 57 session)
Make `app.json` authoritative again by regenerating `android/` from it. BUT the
committed manifest has **hand-added Google OAuth `com.googleusercontent.apps.*`
intent filters** with no matching config plugin — a blind `expo prebuild --clean`
would drop them and **break Google sign-in**. So prebuild must be paired with a
config plugin (or manual re-add) for those intent filters, and tested on a device.
Until then: edit native files directly and keep this checklist.
