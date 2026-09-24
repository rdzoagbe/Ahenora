"""A card subscriber can cancel online, from the app, without writing to anyone.

The App Store and Google Play each have a cancel screen of their own. A card
subscription bought on the web had none — nothing in the app or on the site let
a card payer cancel, while the site promised "cancel any time, wherever you
subscribed". French law has required an online cancellation function for
contracts made online since June 2023, and the terms now promise one.

The function is Stripe's hosted customer portal. These pin the route that opens
it, the flag that tells the Plans page to offer it, and the fallback when the
portal cannot open — cancelling must always have a route.
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase
    from fastapi import HTTPException

ROOT = os.path.join(os.path.dirname(__file__), "..")


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, str(body)

    def json(self):
        return self._body


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ThePortalRoute(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db, self._post = server.get_db, server.requests.post
        self._env = os.environ.get("STRIPE_SECRET_KEY")
        server.get_db = lambda: self.db
        os.environ["STRIPE_SECRET_KEY"] = "sk_test_fake"
        self.sent = []

        async def seed():
            await self.db["families"].insert_one({
                "family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
                "stripe_customer_id": "cus_123", "stripe_subscription_status": "active"})
            await self.db["families"].insert_one({
                "family_id": "fam2", "plan": "village", "billing_cycle": "monthly"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db, server.requests.post = self._get_db, self._post
        if self._env is None:
            os.environ.pop("STRIPE_SECRET_KEY", None)
        else:
            os.environ["STRIPE_SECRET_KEY"] = self._env

    def stripe_answers(self, status, body):
        def fake(url, data=None, auth=None, timeout=None):
            self.sent.append((url, dict(data or [])))
            return _Resp(status, body)
        server.requests.post = fake

    def open(self, family_id):
        return asyncio.run(server.stripe_portal(user={"user_id": "u", "family_id": family_id}))

    def test_a_card_subscriber_gets_the_portal(self):
        self.stripe_answers(200, {"url": "https://billing.stripe.com/p/session_abc"})
        self.assertEqual(self.open("fam1"), {"url": "https://billing.stripe.com/p/session_abc"})
        url, form = self.sent[0]
        self.assertTrue(url.endswith("/billing_portal/sessions"))
        self.assertEqual(form["customer"], "cus_123")
        self.assertIn("/pricing", form["return_url"])

    def test_no_card_subscription_is_not_a_portal(self):
        self.stripe_answers(200, {"url": "https://example"})
        with self.assertRaises(HTTPException) as caught:
            self.open("fam2")
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self.sent, [], "nothing is sent to Stripe for a household with no customer")

    def test_a_portal_not_switched_on_says_so(self):
        """Stripe refuses until the portal is saved once in the dashboard. The
        app turns this into the written route, so the refusal must be clear."""
        self.stripe_answers(400, {"error": {"message": "No configuration provided"}})
        with self.assertRaises(HTTPException) as caught:
            self.open("fam1")
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(caught.exception.detail, "card_portal_unavailable")

    def test_no_stripe_at_all(self):
        os.environ.pop("STRIPE_SECRET_KEY", None)
        with self.assertRaises(HTTPException) as caught:
            self.open("fam1")
        self.assertEqual(caught.exception.status_code, 503)

    def test_a_helper_cannot_reach_it(self):
        src = open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8").read()
        sig = src[src.index('@app.post("/api/billing/stripe/portal")'):][:200]
        self.assertIn("require_full_member", sig)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhoIsBilledByCard(unittest.TestCase):
    def test_a_paying_card_customer(self):
        self.assertTrue(server.billed_by_card(
            {"plan": "executive", "stripe_customer_id": "cus", "stripe_subscription_status": "active"}))

    def test_a_card_subscription_already_over(self):
        self.assertFalse(server.billed_by_card(
            {"plan": "executive", "stripe_customer_id": "cus", "stripe_subscription_status": "canceled"}))

    def test_a_store_subscriber(self):
        self.assertFalse(server.billed_by_card({"plan": "executive", "rc_product_id": "premium_monthly"}))

    def test_a_free_household_that_once_paid_by_card(self):
        self.assertFalse(server.billed_by_card({"plan": "village", "stripe_customer_id": "cus"}))

    def test_the_subscription_carries_the_flag(self):
        db = FakeDatabase()
        original = server.get_db
        server.get_db = lambda: db
        try:
            async def run():
                await db["families"].insert_one({
                    "family_id": "f", "plan": "executive", "billing_cycle": "monthly",
                    "stripe_customer_id": "cus", "stripe_subscription_status": "active"})
                return await server.build_subscription("f")
            self.assertIs(asyncio.run(run())["billed_by_card"], True)
        finally:
            server.get_db = original


class ThePlansPageOffersIt(unittest.TestCase):
    def test_the_button_and_the_downgrade_both_lead_to_it(self):
        src = open(os.path.join(ROOT, "frontend", "src", "components", "PricingView.tsx"), encoding="utf-8").read()
        self.assertIn("onWeb && subscription?.billed_by_card ?", src)
        self.assertIn('testID="pricing-manage-card"', src)
        self.assertIn("if (onWeb && subscription?.billed_by_card) {\n        await openCardPortal();", src)

    def test_a_failed_portal_still_says_how_to_cancel(self):
        src = open(os.path.join(ROOT, "frontend", "src", "components", "PricingView.tsx"), encoding="utf-8").read()
        body = src[src.index("const openCardPortal"):][:900]
        self.assertIn("price_downgrade_msg_web", body)

    def test_the_terms_describe_the_online_route(self):
        terms = open(os.path.join(ROOT, "docs", "terms.html"), encoding="utf-8").read()
        self.assertIn("Manage or cancel your card subscription", terms)


if __name__ == "__main__":
    unittest.main()
