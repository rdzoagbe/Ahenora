# Store build checklist

For any change that needs a **new binary on both stores**. Over-the-air updates
cannot carry it (see `runbooks/RUNBOOK-ota.md` for why, and for the two times it
went wrong). Fill in the header, then tick the boxes in order.

**Date:** ____ | **App version:** 1.2.2 → ____ | **Runtime:** 3.0.0 → ____
**What changes natively:** ____ (paste the diff from step 2)

## When this applies

Use this checklist when any of these is true:

- a new package with native code is added (`check-native-deps.js` fails until
  `frontend/native-modules.json` is updated);
- **a native package we already ship changes version**. The guard does NOT
  catch this, so step 2 checks it by hand. Example: expo 57.0.8 → 57.0.32
  (the zod fix) moves expo-modules-core 57.0.7 → 57.0.25, plus expo-asset,
  expo-constants, expo-file-system, expo-font and expo-keep-awake;
- an Expo SDK upgrade (58 is planned for January 2027).

## 1. Before building (on a branch; nothing merged)

Merging to `main` publishes an over-the-air update straight away, so all of
this happens on a branch.

- [ ] **1.1** Branch from `main`. Write down the update group id of the last
      update published to runtime 3.0.0 (the latest "Frontend CI and Expo
      update" run on main, job summary). Phones still on the old store build
      keep running exactly that update.
- [ ] **1.2** Make the change. For an Expo patch: `cd frontend && npx expo
      install expo@<version>`, then `npx expo install --check`.
- [ ] **1.3** Compare native packages before and after. On `main`, then on
      the branch:
      `cd frontend && node ../scripts/list-native-versions.js > /tmp/native-<main|branch>.txt`,
      then `diff /tmp/native-main.txt /tmp/native-branch.txt`.
      Every changed line is a native change. Paste the diff in the header. If
      nothing changed, this is not a store build: stop here.
- [ ] **1.4** If a package was added, add it to `frontend/native-modules.json`.
- [ ] **1.5** Bump `runtimeVersion` in `frontend/app.json` (e.g. 3.0.0 → 4.0.0)
      **and** the app `version` (e.g. 1.2.2 → 1.3.0). Bumping the runtime is
      what makes this safe: from then on, updates built for the new native code
      can only reach phones that have it.
- [ ] **1.6** Local checks, all green:
      `npx tsc --noEmit`, `npx jest`, `npm run lint`,
      `node scripts/check-native-deps.js`, `node scripts/check-android-permissions.js`,
      and `python3 -m pytest -q tests` from the repo root.
      For the zod fix also run `npm audit`: zod should no longer appear under
      `@expo/cli`.
- [ ] **1.7** Open a **draft** PR. CI green, review done. **Do not merge yet.**

## 2. Build and test on real phones

CI never runs native code. The browser tests cannot see a missing native
module, so this section is the only real test.

- [ ] **2.1** Android: Actions → **EAS Build (Android)** → "Use workflow from"
      = your branch, profile `production`, submit ✔, track `internal`.
- [ ] **2.2** iOS: Actions → **EAS Build (iOS)** → your branch, profile
      `production`, submit ✔ (goes to App Store Connect / TestFlight).
- [ ] **2.3** On a real Android phone (internal track) and a real iPhone
      (TestFlight), check:
  - [ ] the app opens, from fully closed, twice;
  - [ ] sign in; the Feed loads;
  - [ ] Cuisine: Liste, Repas, Dépenses;
  - [ ] **scan a receipt with the camera** (native path; CI never runs it);
  - [ ] the document scanner in the Coffre;
  - [ ] a notification arrives;
  - [ ] the plans screen opens (no purchase needed).
- [ ] **2.4** A second phone still on the current store build (1.2.2) keeps
      working, unchanged. It must not receive anything from this branch.

**Stop here if anything in 2.3 fails.** Nothing has reached a family yet.

## 3. Release

- [ ] **3.1** Google Play: in Play Console, promote the internal release to
      Production as a **staged rollout** (e.g. 20%), not 100%. A staged
      rollout can be halted (see section 5).
- [ ] **3.2** App Store: submit for review and choose **phased release**, so it
      can be paused (see section 5).
- [ ] **3.3** Wait until both stores show the new version as live.
- [ ] **3.4** Merge the PR. Check that "Publish EAS update" on the merge
      commit succeeded. It publishes to the **new** runtime only. Phones on the
      old build are untouched and stay on the update from 1.1.
      From now on, every merge reaches only the new runtime. Families who have
      not updated from the store get nothing new until they do.
- [ ] **3.5** Server, separate PR (`backend/server.py`):
      `CURRENT_STORE_VERSION` = the new version.
      Raise `MIN_SUPPORTED_RUNTIME` to the new runtime **only when both stores
      serve the new build at 100%**. That value is what makes old phones show
      "update from the store" (`UpdateNotice.tsx`). Raised too early, it sends
      people to an update their store does not have yet.
- [ ] **3.6** Update the 6-hour stability routine's facts: store version,
      runtime, the date.
- [ ] **3.7** Raise the Play rollout to 100% and let the Apple phased release
      finish, once section 4 stays clean.

## 4. Watch (first 48 hours)

- [ ] Play Console → Android vitals: crash rate and ANRs for the new version.
- [ ] App Store Connect / TestFlight: crashes for the new build.
- [ ] Actions → **OTA watch** with the group id from 3.4: launches and crashes,
      per platform.
- [ ] **Error watch** and **Production smoke test** stay green.

## 5. If it goes wrong

Decide before releasing: **any crash on launch, or any item in 2.3 broken for
real users, means stop.**

| What is wrong | What to do | What it does and does not do |
|---|---|---|
| The new Android build | Play Console → Production → Releases → **Manage rollout → Halt rollout** | A staged rollout stops reaching more people. Halting a fully rolled-out release makes the previous version available again to new and eligible users ([Google, staged rollouts](https://support.google.com/googleplay/android-developer/answer/6346149), [halting a full rollout](https://support.google.com/googleplay/android-developer/answer/16285429)). Phones that already updated keep the new build until a fix arrives. |
| The new iOS build | App Store Connect → **pause the phased release** | Pauses for up to 30 days in total ([Apple, phased release](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases/)). Phones that already updated keep it. The fix is a new build and a new review. |
| The JavaScript update on the new build (3.4) | Actions → **OTA rollback**, group id, type `ROLLBACK` | Only phones on the new runtime are affected; old-runtime phones never received it. Roll back before anything else merges (see `RUNBOOK-ota.md`). |
| The server change (3.5) | Revert the PR | Railway redeploys from `main`. |

Nothing can return a phone that has already installed a new binary to the old
one. The way out is forward: an over-the-air fix for a JavaScript problem, or a
new build for a native one. That is why section 2 tests on real phones before
anything ships.
