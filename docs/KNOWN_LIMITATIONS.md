# Household COO Known Limitations

This file tracks items intentionally not completed by the Priority Fix Pack.

- Stripe Checkout, customer portal, and webhooks are not connected.
- Card detail/edit UI still needs to be built.
- Voice transcription should remain hidden or beta until fully tested.
- Vault still stores images as base64 in MongoDB; production should use object storage.
- Vault copy should not claim end-to-end encryption unless client-side encryption is implemented.
- Remote push notifications require real two-device testing.
- Invite acceptance must be tested with a second real Google account.
- Full light/dark UI audit is still required.