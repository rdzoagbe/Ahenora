# iOS launch — what's ready, and what to do when the account arrives

Everything that can be done without an Apple Developer account is done and on
`main`. This is the ordered runbook for the day the account is active.

## Already in place (no action needed)

- **Sign in with Apple** — required by App Store rule 4.8 for any app that also
  offers Google sign-in, so without it the app is rejected. Backend verifier
  (`backend/apple_auth.py`, RS256 against Apple's JWKS), endpoint
  `POST /api/auth/apple`, and the black **Sign in with Apple** button on the
  landing screen, shown only on iOS where it is available. 15 tests cover it,
  including forged signatures, wrong audience, wrong issuer, expiry and
  `alg:none`. Hide My Email relay addresses work; an Apple sign-in over an
  existing email **links** to that account rather than creating a second.
- **iOS app config** (`frontend/app.json`) — bundle id `com.householdcoo.app`,
  `usesAppleSignIn`, camera/photo usage strings, `buildNumber`, tablet support,
  and `ITSAppUsesNonExemptEncryption: false` so every upload skips the
  export-compliance question (we use only standard HTTPS).
- **EAS iOS profiles** (`frontend/eas.json`) — `preview` and `production` build
  profiles plus `submit` profiles with placeholders to fill in (below).
- **Billing is platform-aware** (`frontend/src/billing.ts`) — iOS reads
  `EXPO_PUBLIC_REVENUECAT_IOS_KEY`. Empty today, so iOS billing reports
  "unavailable" rather than misconfiguring itself; it lights up when keyed.

## Day 1 — Apple account, ~30 minutes

1. **Enrol** in the Apple Developer Program ($99/yr) and wait for activation.
2. **App Store Connect → My Apps → +** → New App:
   - Platform iOS · Name **Ahenora** · Primary language English
   - Bundle ID **com.householdcoo.app** (register it in the Developer portal
     first if it isn't listed)
   - SKU: anything unique, e.g. `ahenora-ios-001`
3. Note three values and put them in `frontend/eas.json` → `submit`:
   - `appleId` — your Apple ID email
   - `ascAppId` — the App ID number from App Store Connect
   - `appleTeamId` — Membership → Team ID
4. **Enable Sign in with Apple** for the App ID (Developer portal →
   Identifiers → your bundle id → check "Sign In with Apple"). The app already
   sends the button; this is the server-side half.

## Day 1 — first build

```
cd frontend
eas build --platform ios --profile preview     # a TestFlight-able build
```
EAS will offer to create the signing certificate and provisioning profile for
you — say yes; that is the part that needs the account. Then:
```
eas submit --platform ios --profile internal   # uploads to TestFlight
```
Install via TestFlight on a real iPhone and check: sign in with Apple, sign in
with Google, notifications permission, camera scan, and the plans screen.

## Before submitting for review

- [ ] **Screenshots** — required sizes: 6.7" (1290×2796) and 6.5" (1242×2688).
      iPad shots too if you keep `supportsTablet: true` (13" 2064×2752);
      otherwise set it to false and skip them.
- [ ] **Privacy nutrition label** — declare what's collected: name, email,
      user content (household data), and that it is not used for tracking.
      Matches the existing privacy policy on ahenora.com.
- [ ] **Age rating** — 4+ is right; there is no user-generated public content.
- [ ] **Account deletion** — Apple requires an in-app path. Already built
      (`/delete-account`); point the review notes at it.
- [ ] **Demo account** for the reviewer, with a household that has data in it.
      Reviewers reject apps they cannot get into.
- [ ] **Review notes** — mention that Premium is a subscription, that a
      demo account is provided, and where account deletion lives.

## In-app purchases (when you want iOS Premium)

1. App Store Connect → your app → Subscriptions → create a group, then
   **premium_monthly** (€6.99) and **premium_yearly** (€49.99); optionally
   **household** (€14.99 / €149.99).
2. RevenueCat → add an **App Store** app to the existing project, paste the
   shared secret, import the products, attach them to the **`premium`**
   entitlement (the same one Android uses).
3. Copy RevenueCat's **public iOS SDK key** into `frontend/eas.json` →
   `EXPO_PUBLIC_REVENUECAT_IOS_KEY` for both profiles, and rebuild.
4. Apple requires IAP for digital goods bought **inside** the app, and forbids
   pointing users to outside payment from inside it. The Stripe web checkout
   stays as-is on the web; it must not be linked to from the iOS app.

## Notes

- **Web push on iOS** only works when the site is added to the Home Screen as a
  PWA — Apple does not deliver background push to a plain Safari tab. Native
  iOS push (APNs) comes with the real app and needs an APNs key uploaded to
  Expo, which EAS will prompt for on the first push-enabled build.
- **App icon transparency** — Apple rejects icons with an alpha channel.
  Checked: `assets/images/icon.png` is 1024×1024 RGB with no alpha, so it is
  already compliant. Nothing to do.
