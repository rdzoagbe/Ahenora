# ⚠️ Native Android config — read before changing icons, permissions, or splash

This project commits a native `android/` folder (bare/prebuild workflow). That
has one consequence that has already caused **two production incidents**:

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

Icon regeneration script: `scratchpad/iconregen/gen.js` (sharp) generates every
density from `assets/images/{icon,adaptive-foreground,adaptive-background}.png`.

## The permissions guard (CI)
`scripts/check-android-permissions.js` fails the build if the manifest declares a
forbidden broad permission (media/storage) without a `tools:node="remove"`. Run
it before every AAB: `node scripts/check-android-permissions.js`.

## The real long-term fix (do in the Expo 57 session)
Make `app.json` authoritative again by regenerating `android/` from it. BUT the
committed manifest has **hand-added Google OAuth `com.googleusercontent.apps.*`
intent filters** with no matching config plugin — a blind `expo prebuild --clean`
would drop them and **break Google sign-in**. So prebuild must be paired with a
config plugin (or manual re-add) for those intent filters, and tested on a device.
Until then: edit native files directly and keep this checklist.
