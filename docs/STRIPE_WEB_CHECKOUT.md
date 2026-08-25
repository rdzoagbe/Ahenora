# Stripe web checkout — setup

Google Play (via RevenueCat) reaches Android. Stripe is the **second door into
Premium**, for everyone who can't use store billing: an iPhone in Safari, a
laptop on ahenora.com. A card payment grants the *same* per-family `executive`
plan a Play purchase does; a cancellation takes it away. Both providers only
ever write the one shared `plan` field, each stamping its own marker (`rc_*`
vs `stripe_*`), so they never fight.

**Card checkout stays OFF until the four env vars below are set.** Until then
the pricing screen still works — it just points web users at Google Play, as
before.

## 1. In the Stripe Dashboard (one-time)

1. Create a **Product** — "Ahenora Premium".
2. Add **two recurring Prices** on it, both in **EUR** (the base currency):
   - **€6.99 / month** → copy its id, `price_...` → this is `STRIPE_PRICE_MONTHLY`
   - **€49.99 / year** → copy its id, `price_...` → this is `STRIPE_PRICE_YEARLY`
3. Copy your **Secret key** (Developers → API keys), `sk_live_...` →
   `STRIPE_SECRET_KEY`. Use the **live** key for production, `sk_test_...` while
   testing.
4. Add a **webhook endpoint** (Developers → Webhooks → Add endpoint):
   - URL: `https://<your-railway-backend>/api/billing/stripe/webhook`
   - Events to send: `checkout.session.completed`,
     `customer.subscription.updated`, `customer.subscription.deleted`
   - After creating it, copy the **Signing secret**, `whsec_...` →
     `STRIPE_WEBHOOK_SECRET`

## 2. In Railway (backend service → Variables)

```
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_MONTHLY=price_xxx
STRIPE_PRICE_YEARLY=price_xxx
PUBLIC_APP_URL=https://ahenora.com/app     # optional; this is the default
```

Redeploy. The backend's `/api/billing/stripe/config` now reports
`{"enabled": true}`, and the web pricing screen switches its Subscribe button to
Stripe automatically.

## 3. How it flows

1. Web user taps **Subscribe** → `POST /api/billing/stripe/checkout` creates a
   hosted Checkout session (family id carried in metadata) → browser redirects
   to Stripe's page.
2. They pay → Stripe redirects back to `…/app/pricing?checkout=success`.
3. Stripe calls the **webhook** → the family's `plan` becomes `executive`.
4. The returning screen polls the subscription for a few seconds until the plan
   flips, then says "Welcome to Premium".

Currency: Stripe charges in **EUR**. On the customer's card statement their bank
converts to their local currency — the same way any euro purchase works — so a
Kiwi or an Aussie pays their own money, no US figure involved.

## 4. Testing before going live

Use `sk_test_...`, a **test-mode** webhook secret, and test price ids. Stripe's
test card `4242 4242 4242 4242` (any future expiry, any CVC) completes a
payment. The [Stripe CLI](https://stripe.com/docs/stripe-cli) can forward
webhooks to a local backend: `stripe listen --forward-to
localhost:8000/api/billing/stripe/webhook`.

## Android Household (RevenueCat offering)

The native Android "Upgrade to Household" button buys from a RevenueCat
**offering named `household`** — separate from the default (Family) offering.
For the button to work on Android:

1. In RevenueCat → Offerings → create an offering with identifier **`household`**.
2. Add two packages to it: **Monthly** → `household:p1m`, **Annual** → `household:p1y`.
3. Make sure both `household:*` products are attached to the **`premium`**
   entitlement (Products → Attach).

Until that offering exists, the Android button fails soft: it detects the
missing offering and points the buyer to the web (Stripe), which always works.
The web path needs none of this — it uses Stripe directly.

## Notes

- No Stripe SDK is installed: checkout sessions are created with `requests`
  (already a dependency) and webhook signatures verified with stdlib `hmac`, so
  there's nothing extra to keep patched.
- Downgrades/cancellations are handled by the subscription webhooks. A customer
  can also manage their subscription from Stripe's customer portal if you enable
  it later.
