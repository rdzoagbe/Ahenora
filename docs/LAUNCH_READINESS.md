# Launch readiness sign-off — Ahenora 1.1.0

_End-to-end pre-launch verification for the night-of-16-Aug launch. Snapshot taken 15 Aug against branch `claude/review-android-app-7ptEM` (PR #389). Companion to `MONDAY_LAUNCH_CHECKLIST.md`._

## Verdict: 🟢 GO (code side)
No code-level blockers. The app shipping is byte-identical to a state that passed full CI. Remaining work is Play Console + Railway actions on launch night, all documented in the launch checklist.

## What was verified

| Check | Result | Evidence |
|---|---|---|
| **Provenance** | ✅ | No app-code (`frontend/`, `backend/`) changed since the last fully-green CI run — only docs, store assets, and two image-generator scripts. |
| **CI functional suite** | ✅ | All 13 browser harnesses + CodeQL + lint + backend checks ran green on this exact code (13 Aug). |
| **Diff-risk review** | ✅ | `tsc --noEmit` clean (0 errors); no debug/TODO leftovers; OTA meta-data (`EXPO_UPDATE_URL`, `EXPO_RUNTIME_VERSION`) intact; both secure-store rules (`fullBackupContent`, `dataExtractionRules`) present and wired; no credentials committed (only the standard shared `debug.keystore`); every new "+"-capture reference (i18n keys, icons, store fields, testIDs) resolves. |
| **Rename completeness** | ✅ | Zero user-facing "Household COO" misses. app.json name, Android `app_name`, backend `APP_NAME` + health message, all 3 legal pages, and the tagline all read Ahenora across 4 languages. Remaining `household-coo` hits are all intentional infra keeps. |
| **Config guards** | ✅ | runtime `2.0.0` / version `1.1.0` agree across app.json / strings.xml / build.gradle; permissions guard green. |
| **OTA merge path** | ✅ | `frontend-ci-eas-update` active on `main`, guards pass → publish job runs; channel `production`, runtime `2.0.0` consistent with v55. |

## Intentional keeps (correct to leave as "household-coo")
Android package `com.householdcoo.app`, slug `household-coo`, deep-link scheme `householdcoo`, `DB_NAME=household_coo`, logger name, the Railway service URL `household-coo-production.up.railway.app` (baked into shipped builds — changing it breaks every install), and store links. **None are user-visible.**

## Non-blocking notes (post-launch)
- **Stale web export:** committed `docs/app` (GitHub Pages web app) has the rebrand + new nav but not the "+" redesign. Does NOT affect the Android app (OTA/AAB build from source, never from `docs/app`). Rebuild + commit post-launch with the production backend URL.
- **`settings.gradle`** `rootProject.name = 'Household COO'` — build-time label only, never user-visible. Optional tidy.
- **`docs/AHENORA_RENAME_PLAN.md`** still labels the rename "post-launch" — stale wording; the rename ships at launch. Doc-only.
- **12 High DoS-class dependency vulns** — documented, post-launch (task #10).

## Open items — Play Console / Railway (not code)
These are the only launch-gating actions left; verify on the night:
1. **Legal URLs resolve 200** — open `https://rdzoagbe.github.io/Ahenora/privacy.html` and `/delete-account.html` in a browser (the exact thing that caused the first rejection). _Could not verify from the build env — outbound blocked._
2. **Held "ready to publish" batch includes the Ahenora listing** (assets + text + repointed URLs), not just the AAB.
3. **PR #389 is a draft** — mark "Ready for review" before merging.
4. **Backend code redeploy is AFTER the merge** — a redeploy before the merge only re-ships old `main` (verified 15 Aug: health still read "Household COO Backend is live"). Env vars already set; deploy latest commit post-merge, then confirm health reads "Ahenora Backend is live".
5. **OTA published, not skipped** — after merge, confirm the "Publish Android update to Expo production branch" step printed an update URL; pre-check the 4 Expo Actions secrets exist.

## Launch-night sequence (≈10 min)
Pre-flight → **Publish** (Play) + **merge #389** (same window) → verify OTA published → Railway **Deploy Latest Commit** + health smoke check → verify listing + app. Full detail in `MONDAY_LAUNCH_CHECKLIST.md`.
