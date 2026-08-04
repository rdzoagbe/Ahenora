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
- A photographed document is stored as an image and nothing else. No text is
  kept, so nothing you scan is searchable afterwards and a document filed in
  the wrong drawer cannot be re-sorted without re-scanning it — which costs
  another AI scan. Persisting the extracted text is the fix, and it is the
  natural next step after the capture router.