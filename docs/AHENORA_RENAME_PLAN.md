# Ahenora Rename Plan — "Household COO" → "Ahenora"

_Status: ready to execute · **Post-launch** · Gated on trademark sanity check · Tracks task #8._

**New brand:** Ahenora
**New tagline:** _Ahenora — a better home base for family life._
**Domains secured:** `ahenora.com` + `ahenora.fr` (+ free `hello@ahenora.com` / `@ahenora.fr`)

---

## 0. GOLDEN RULE — what must **NEVER** change

Renaming the *brand* is not the same as renaming the *app identity*. These are **permanent** and changing them creates a brand-new app that loses all installs, reviews, ratings, and breaks sign-in:

| Field | Value — **keep exactly** | Why |
|---|---|---|
| Android `package` / `applicationId` | `com.householdcoo.app` | Permanent Play Store identity; change = new app, lose everything |
| iOS `bundleIdentifier` | `com.householdcoo.app` | Same, for App Store |
| Expo `scheme` | `householdcoo` | Deep-link + **Google OAuth redirect** scheme — changing it breaks sign-in |
| Expo `slug` | `household-coo` | Ties to the EAS project + OTA updates; internal only, not user-visible |
| Native package path | `android/.../java/com/householdcoo/app/…` | Part of the package name — leave the folders/`.kt` package lines |
| `.ps1` diag scripts, `google-services` package refs | `householdcoo` | Reference the package, not the brand |

**Rule of thumb:** if `householdcoo` is **lowercase / a package / a scheme / a URL slug**, it **stays**. If it's the **display string "Household COO"** a user reads, it **changes to "Ahenora."** The brand is Ahenora; the technical identity stays householdcoo forever. Users never see the package name.

---

## 1. What changes (user-visible brand) — the checklist

### A. App display name — the headline change
- `frontend/app.json` → `expo.name`: `"Household COO"` → `"Ahenora"` (line ~3). This is the label under the icon.

### B. Permission strings — `frontend/app.json`
Replace "Household COO" in the 4 permission descriptions (NSCamera, NSPhotoLibrary, `photosPermission`, `cameraPermission`) → "Ahenora". (lines ~18, 19, 49, 50)

### C. In-app strings — the bulk (~50 refs)
| File | Refs | Notes |
|---|---|---|
| `frontend/src/i18n.ts` | 44 | All locales (en/es/fr). Includes price copy, `land_footer`, `set_join_household_coo`, `set_invited_you`, scan/landing/invite strings |
| `frontend/app/terms.tsx` | 4 | In-app terms screen |
| `frontend/app/privacy.tsx` | 4 | In-app privacy screen |
| `frontend/src/notifications.ts` | 2 | Notification copy |
| `frontend/src/components/SundayBriefModal.tsx` | 2 | |
| `frontend/src/components/LegalPage.tsx` | 1 | |
| `frontend/app/(tabs)/feed.tsx` | 1 | **The Feed subtitle** (`styles.subtitle`) — the one users see on the home screen |
| `frontend/src/components/PricingView.tsx` | `householdcoo` URL/ref — check if display vs link |

### D. Web / meta
- `frontend/app/+html.tsx` (2) — the web page `<title>` / meta
- `docs/index.html` (7) — hand-authored landing page
- `docs/404.html` (2) — hand-authored

### E. Legal pages (public, hosted on GitHub Pages)
- `docs/privacy.html` (6) — incl. footer tagline + contact email
- `docs/delete-account.html` (8) — incl. "Household COO, by Dzoagbe Labs" + tagline + emails
- Company line: decide whether the **legal entity** stays "Dzoagbe Labs" (recommended — that's the registered developer) while the **product** becomes Ahenora.

### F. Email address
- `rolanddzoagbe@gmail.com` → **`hello@ahenora.com`** (now that OVH email exists).
- Appears in `frontend/src/i18n.ts`, `docs/privacy.html`, `docs/delete-account.html` (mailto + contact text).
- Keep gmail as a fallback until the new inbox is confirmed working.

### G. Tagline
- Old: `Household COO · household operations for families`
- New: **`Ahenora · a better home base for family life`**
- Update in: `i18n.ts` (`land_footer`), `docs/privacy.html` footer, `docs/delete-account.html` footer.

### H. Store listing (Play Console — done in the console, not code)
- **App title** → "Ahenora"
- **Short + full description** → rewrite around Ahenora + new tagline
- Update the source-of-truth docs: `docs/PLAY_STORE_LISTING.md`, `docs/aso-listing.md`
- Note: title change goes through Play review (managed publishing holds it).

### I. Store visual assets — regenerate with "Ahenora"
- **Screenshots** — the Feed subtitle now reads "Ahenora"; regenerate all 6 via `scripts/store_capture.py` + `scripts/frame_store.py` (same pipeline used for the current set).
- **Feature graphic** — swap "Household COO" wordmark → "Ahenora".
- **Icon** — unchanged unless you want a new mark (the rebrand icon already shipped).

---

## 2. Do **NOT** hand-edit — auto-generated

`docs/app/**` (all the `*.html`, `manifest.json`, `entry-*.js`) are the **compiled web export** from `npx expo export`. They contain "Household COO" only because they were built from the old strings. **Don't edit them by hand** — they regenerate automatically once B–D are changed and you re-export (the CI `browser-harnesses.yml` workflow already rebuilds `docs/app`).

---

## 3. Suggested order of work

1. Change the **app config** (A, B) — display name + permissions.
2. Sweep **in-app strings** (C) + **web/meta** (D).
3. Update **legal pages + email + tagline** (E, F, G) — and re-host (Pages auto-deploys).
4. **Re-export** the web build so `docs/app` regenerates (or let CI do it).
5. **Regenerate store assets** (I) with the new name.
6. Update **Play Console** listing (H) — title, descriptions, upload new screenshots/graphic.
7. Ship as an **app update** (new versionCode) + an **OTA update** for the JS strings.

## 4. Verify — two greps

**Should return (near) zero after the rename** (user-facing brand gone):
```
grep -rn "Household COO" frontend/src frontend/app docs/*.html docs/*.md
```
**Should STILL match — proof you didn't break the package** (leave these):
```
grep -rn "com.householdcoo.app\|\"scheme\": \"householdcoo\"\|\"slug\": \"household-coo\"" frontend/app.json frontend/android
```

---

## 5. Gate & sequencing
- **Do the trademark sanity check on "Ahenora" first** — buying the domain was low-risk; publicly rebranding is the committing step.
- This is **post-launch** — Monday ships as Household COO. Start the rename only after launch is stable.
- Legal-page URLs can stay on `github.io` (Google doesn't require the domain to match the name); moving them to `ahenora.com` is optional polish for later.
