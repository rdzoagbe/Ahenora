# Household COO QA Review

## Included fixes in this package

### Pricing/user gating
- Added `GET /api/subscription/entitlements`.
- Invite gating now counts real members + pending invites.
- Admin/tester accounts still bypass gates.
- Settings now shows plan usage:
  - member slots
  - AI scan usage
  - vault usage
  - weekly brief availability
- Invite button opens pricing when member slots are full.

### Settings review
- Preferences restored:
  - Appearance selector
  - Language selector
- Notifications remain visible:
  - Reminder notifications
  - New-card alerts
  - Test buttons
- Plan & Access card added near the top.
- Pricing sheet embedded in Settings.

### Text / spacing / button action review
- Added `tools/audit-ui.ps1` to scan:
  - stubs/TODOs/placeholders
  - missing `testID` on `PressScale`
  - TextInput keyboard handling
  - backend feature gates
  - key Settings controls

## Known product limitations still intentionally pending

### Billing
Current plan changes are still an internal/testing mode. Stripe checkout/webhooks are not connected yet.

Recommended next package:
- Stripe checkout session
- Customer portal
- Webhook updates family plan
- Billing status in Settings

### Full light mode
The Appearance selector is restored and saved locally. Most screens still use hard-coded dark styling. A full light theme needs a theme provider and style refactor.

### New-card alerts
Real cross-device new-card alerts require:
- another signed-in family member/device
- Expo push token/project ID
- backend token registration

### Voice
Voice is currently parked. `expo-av` warning is expected; future migration should use `expo-audio`.
