# Household COO — Unimplemented / Next Fixes Report

Generated from the latest files available in this build package and the app state discussed during implementation.

## Implemented in this package

### 1. Admin/tester access

Files patched:

- `backend/server.py`
- `frontend/src/api.ts`
- `frontend/app/(tabs)/settings.tsx`

What changes:

- Adds `ADMIN_EMAILS` Railway variable support.
- Returns `is_admin` in `/api/auth/session` and `/api/auth/me`.
- Bypasses feature limits for admin users.
- Shows `Admin / Tester · all features unlocked` in Settings.
- Admin subscription response is upgraded to `family_office` with high test limits.

Railway variable to add:

```text
ADMIN_EMAILS=rolanddzoagbe@gmail.com
```

### 2. Improved landing page

File patched:

- `frontend/app/index.tsx`

What changes:

- Restores a premium landing page.
- Keeps Google sign-in flow.
- Supports invite links using `householdcoo:///?invite={token}`.
- Displays inviter name when opening an invite link.
- Redirects existing authenticated users to Feed.

## Still not implemented / recommended next fixes

### A. Voice transcription backend

Current status:

- Backend route `/api/voice/transcribe` still returns HTTP 501.

Impact:

- Voice capture cannot create real cards from audio yet.

Recommended fix:

- Add a speech-to-text provider. Options:
  - OpenAI Whisper / transcription endpoint.
  - Google Speech-to-Text.
  - Device-side speech recognition if you want lower backend cost.

Files likely involved:

- `backend/server.py`
- `frontend/src/components/VoiceCaptureModal.tsx`
- `frontend/src/api.ts`

### B. Real payment/subscription provider

Current status:

- Subscription change endpoint changes plan in MongoDB, but there is no Stripe/RevenueCat checkout yet.

Impact:

- Plans are product-visible but not commercially billable.

Recommended fix:

- Add Stripe Checkout or RevenueCat depending on web/mobile purchase strategy.

Files likely involved:

- `backend/server.py`
- `frontend/src/components/PricingView.tsx`
- `frontend/app/pricing.tsx`

### C. Push notifications

Current status:

- Settings has a lightweight local/browser notification concept, but no real push delivery.

Impact:

- Reminders exist in card data but no background push notification is delivered.

Recommended fix:

- Add Expo Notifications + backend scheduled reminder checks.

Files likely involved:

- `frontend/app/_layout.tsx`
- `frontend/src/api.ts`
- `backend/server.py`

### D. Email domain verification

Current status:

- Resend code is implemented. DNS verification is still pending.

Impact:

- Email invites may fail until Resend verifies `householdcoo.app`.

Recommended fix:

- Complete OVH DNS records.
- Wait for Resend verification.
- Set `INVITE_FROM_EMAIL=Household COO <invite@householdcoo.app>`.

### E. Admin console

Current status:

- Admin/tester access unlocks features for your own account only.
- It does not expose other families’ data.

Recommended fix:

- Later build a protected admin route for support/audit only:
  - user lookup
  - family lookup
  - invite status
  - backend health
  - feature flags

## Local scan command

After copying this package, run:

```powershell
cd "C:\coo"
.\tools\find-unimplemented.ps1
```

This scans your local repository for markers like `TODO`, `stub`, `placeholder`, `not implemented`, and `501`.
