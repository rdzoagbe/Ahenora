# Launch Checklist — Ahenora 1.1.0 → Production (night of Sun 16 Aug)

_Tracks task #13. **Launch brand = Ahenora** (full rebrand ships at launch — new name, icon, splash, nav, "+" capture, all in one coordinated moment). Today = Tue 11 Aug._

## The one thing that makes launch night a single click
A production release must pass Google review (hours to ~a day). **Submit it this week**; managed publishing holds it. By Sun night, 1.1.0 + the Ahenora listing + data-safety all sit **approved & held**, and launch is: press Publish + merge PR #389, same window.

---

## PART 1 — THIS WEEK (Tue 11 → Fri 15 Aug)

### A. Get the native build submitted & held (do first — it's the long pole)
1. Confirm the **v55 (1.1.0) AAB** is on the internal track and validated on your phone (Ahenora name, house icon, splash, "+" capture).
2. Play Console → **Test and release → Production → Create new release** (or **Promote** internal 1.1.0 → Production).
3. Confirm attached **App bundle = 1.1.0**, **versionCode > 48** (current live = 1.0.3 / code 48).
4. Paste **release notes** (EN + FR) — the rebrand block from the rename plan.
5. **Rollout %:** recommend **staged 50%** for a rebrand (limits blast radius); or 100% — your call.
6. **Save** → **Publishing overview → Send changes for review.**
7. Wait for it to flip to **"ready to publish," held.** ✅

### B. Swap the store listing to Ahenora (can run in parallel with A)
- [ ] **App icon** → new house/family icon (512×512).
- [ ] **Feature graphic** → `feature-graphic-1024x500.png` (EN) + `feature-graphic-fr-1024x500.png` (FR) — "A better home base for family life" / "Un meilleur port d'attache pour la vie de famille".
- [ ] **Screenshots (6)** → regenerated Ahenora set, EN + FR.
- [ ] **App name / short & full description** → Ahenora + tagline "a better home base for family life."
- [ ] These changes join the same held review batch.

### C. Repoint the legal URLs (App Content) — CRITICAL for policy
- [ ] **Privacy policy URL** → `https://<user>.github.io/Ahenora/app/privacy.html` (repo renamed to Ahenora → old Household-COO path 404s).
- [ ] **Account/data deletion URL** → `.../Ahenora/app/delete-account.html`.
- [ ] Open both in a browser first — confirm **200, not 404**. (This is the exact thing that caused the original rejection.)

### D. Rename the subscription display names (task #21)
- [ ] Play Console → **Monetize with Play → Products → Subscriptions**.
- [ ] Edit each subscription's **display name + benefit/description**: "Household COO" → "Ahenora".
- [ ] ⚠️ **Change display text ONLY. NEVER touch the product ID / base plan ID / SKU** — that breaks existing subscribers and the RevenueCat mapping.
- [ ] The purchase pop-up app-name updates automatically with the listing rename.

### E. Backend redeploy (so notifications/invites say Ahenora)
- [ ] Redeploy **backend/server.py** on Railway (APP_NAME + notification bodies + INVITE_BASE_URL → `.../Ahenora/app/`). Already committed; just needs a deploy.

---

## PART 2 — LAUNCH NIGHT (Sun 16 Aug, ~10 min)

### Pre-flight (2 min)
- [ ] **Policy status** = "No issues found"
- [ ] **Managed publishing** = ON
- [ ] **Publishing overview** shows ALL held & ready: 1.1.0 production **+** listing changes **+** data-safety
- [ ] Privacy + deletion URLs return 200
- [ ] Subscription display names read "Ahenora"

### Publish + merge — ⚠️ TIMING-CRITICAL, same window
- [ ] **Publishing overview → Publish → confirm** (native v55 goes live: name, icon, splash).
- [ ] **In the same window, merge PR #389 → main.**
  Merging pushes `frontend/**` → main → triggers `frontend-ci-eas-update` → `eas update --branch production`.
  Live users share runtime **2.0.0**, so this **OTAs the Ahenora in-app rebrand + the "+" capture to real users immediately.**
  Merge it *with* Publish so the in-app rebrand (OTA) and the shell (native v55) land together.
  **Merging early = live users get "Ahenora" inside a "Household COO" shell + an early brand leak.**
- [ ] 🎉 Everything Ahenora, together.

### Verify (allow 1–2h propagation)
- [ ] Listing shows new icon + 6 screenshots + feature graphic + Ahenora name
- [ ] Version reads **1.1.0**
- [ ] Open the Play Store page on a phone and eyeball it
- [ ] Open the app → OTA lands → in-app says Ahenora, "+" capture works

---

## PART 3 — First 24–48h
- [ ] Watch **Android vitals** (crashes, ANRs)
- [ ] If staged, **bump to 100%** once stable
- [ ] Watch **reviews & ratings**
- [ ] Confirm subscribers' billing still maps (RevenueCat dashboard)

## If something breaks
- **Staged rollout** → halt in Play Console (limits blast radius).
- Can't "unpublish" a version — **supersede** with a hotfix (new versionCode).
- If staged, users not yet updated stay on 1.0.3.

## Post-launch queue (NOT launch night)
- Turn on **domain auto-renew** (ahenora.com / .fr)
- **#10** dependency DoS vulns (Expo/metro bump) + enable GitHub Advanced Security
- **#20** backend authorization surface review
- **#17 / #18** Teen mode + pricing
- Optional: switch **Pages source → GitHub Actions** (activates the 404-guard workflow)
