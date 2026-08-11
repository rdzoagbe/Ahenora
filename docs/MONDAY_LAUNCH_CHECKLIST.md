# Monday 17th Launch Checklist — 1.1.0 → Production

_Tracks task #13. Launch brand = **Household COO** (the Ahenora rename is post-launch, task #8)._

## Situation (as prepped)
- ✅ Managed publishing **ON** (holds everything until you press Publish)
- ✅ Store listing (icon, 6 screenshots, feature graphic — EN + FR) + Data safety fix = **approved, held** in "ready to publish"
- ✅ Policy status **green**; developer verification **done**
- ⏳ **1.1.0 AAB** is on the internal track — still needs promoting to production + review

---

## PART 1 — DO THIS WEEK (make Monday a single click)

**Why:** a production release must pass Google review (hours to a day+). Submit it now; managed publishing holds it, so by Monday 1.1.0 sits **approved & ready** next to the listing.

1. Play Console → **Test and release → Production → Create new release** (or **Promote** the internal 1.1.0 build → Production).
2. Confirm the attached **App bundle = 1.1.0**, **versionCode > 48** (current live is 1.0.3 / code 48).
3. Paste **release notes** (EN + FR) — the block from earlier / the rename plan.
4. **Rollout %:** recommend a **staged rollout (e.g. 50%)** for a first rebrand update, or 100% — your call.
5. **Save** (managed publishing shows "Save," not "rollout").
6. **Publishing overview → Send changes for review.**
7. Within a few days it flips to **"ready to publish," held.** ✅ Now 1.1.0 + listing + data-safety all sit ready together.

---

## PART 2 — MONDAY (the launch, ~10 min)

### Pre-flight (2 min)
- [ ] **Policy status** = "No issues found"
- [ ] **Managed publishing** = ON
- [ ] **Publishing overview** shows ALL ready: 1.1.0 production **+** 6 listing changes **+** data-safety
- [ ] You accept the screenshots still say **"Household COO"** (Ahenora = later)

### Publish (1 click)
- [ ] **Publishing overview → Publish → confirm**
- [ ] Everything goes live together 🎉

### Verify (allow propagation — can take 1–2h)
- [ ] Listing shows the **new icon + 6 screenshots + feature graphic**
- [ ] Version reads **1.1.0**
- [ ] Open your Play Store page on a phone and eyeball it

### Code hygiene — ⚠️ TIMING-CRITICAL
- [ ] **Merge PR #389 → main *only as part of this publish moment* — NOT before.**
  Merging pushes `frontend/**` to main, which triggers `frontend-ci-eas-update` →
  `eas update --branch production`. Live users share runtime **2.0.0**, so the merge
  **OTAs the Ahenora rebrand into the app for real users immediately**, before/independent
  of the Play native update. Merge it in the SAME window you press Publish, so the in-app
  rebrand (OTA) and the icon/name/splash (native v55) land together. Merging early = live
  users get "Ahenora" inside a "Household COO" shell + an early leak.
- Note: the "+" quick-capture (task #19) is on this same branch, so **it OTAs at this merge
  too** — i.e. it goes live *with* the launch, not as a separate later step. That's fine as
  long as you've validated it on the preview build first. If you'd rather ship it days later,
  it must be split onto its own post-launch branch/PR before you merge #389.

---

## PART 3 — First 24–48h
- [ ] Watch **Statistics / Android vitals** (crashes, ANRs)
- [ ] If staged, **bump to 100%** once stable
- [ ] Watch **reviews & ratings**
- [ ] Confirm the OTA/preview loop is unaffected

## If something breaks
- **Staged rollout** → halt the rollout in Play Console (limits blast radius).
- You can't "unpublish" a version — you **supersede** it with a hotfix (new versionCode).
- If staged, users not yet updated stay on 1.0.3.

## Post-launch queue (NOT Monday)
- Turn on **domain auto-renew** (ahenora.com/.fr)
- **#8** Ahenora rename (plan ready)
- **#17 / #18** Teen mode + pricing
- **#10** image-size security alert
- Optional: switch **Pages source → GitHub Actions** (activates the 404-guard workflow)
