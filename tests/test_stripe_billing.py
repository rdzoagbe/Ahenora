"""Stripe web checkout: the second door into Premium.

Google Play reaches Android through RevenueCat; everyone else — an iPhone in
Safari, a laptop on ahenora.com — comes through here. What matters is that a
card payment grants the SAME per-family "executive" plan a Play purchase does,
that a cancellation takes it away, and that a forged or replayed webhook never
moves a plan at all.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import hashlib
import hmac
import json
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

SECRET = "whsec_test_secret"


def sign(body: bytes, ts: int, secret: str = SECRET) -> str:
    mac = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={mac}"


class FakeRequest:
    def __init__(self, body: bytes, headers: dict):
        self._body = body
        self.headers = headers

    async def body(self):
        return self._body


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class SignatureVerification(unittest.TestCase):
    def test_a_good_signature_passes(self):
        body = b'{"hello":"world"}'
        now = 1_700_000_000
        self.assertTrue(server.stripe_verify_signature(body, sign(body, now), SECRET, now))

    def test_a_tampered_body_fails(self):
        body = b'{"hello":"world"}'
        now = 1_700_000_000
        header = sign(body, now)
        self.assertFalse(
            server.stripe_verify_signature(b'{"hello":"evil"}', header, SECRET, now))

    def test_a_stale_timestamp_is_refused(self):
        body = b'{}'
        signed_at = 1_700_000_000
        self.assertFalse(
            server.stripe_verify_signature(body, sign(body, signed_at), SECRET,
                                           signed_at + 10_000))

    def test_the_wrong_secret_fails(self):
        body = b'{}'
        now = 1_700_000_000
        self.assertFalse(
            server.stripe_verify_signature(body, sign(body, now, "whsec_other"), SECRET, now))

    def test_a_garbage_header_fails(self):
        self.assertFalse(server.stripe_verify_signature(b'{}', "not-a-header", SECRET, 1))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class EventInterpretation(unittest.TestCase):
    def test_checkout_completed_grants_executive_and_names_the_family(self):
        event = {
            "type": "checkout.session.completed",
            "data": {"object": {
                "metadata": {"family_id": "fam1", "cycle": "yearly"},
                "customer": "cus_123", "subscription": "sub_123",
            }},
        }
        family_id, customer, changes = server.stripe_event_changes(event)
        self.assertEqual(family_id, "fam1")
        self.assertEqual(customer, "cus_123")
        self.assertEqual(changes["plan"], "executive")
        self.assertEqual(changes["billing_cycle"], "yearly")
        self.assertEqual(changes["stripe_customer_id"], "cus_123")
        self.assertEqual(changes["stripe_subscription_id"], "sub_123")

    def test_a_still_active_subscription_stays_premium(self):
        event = {"type": "customer.subscription.updated",
                 "data": {"object": {"status": "active", "customer": "cus_123"}}}
        _, customer, changes = server.stripe_event_changes(event)
        self.assertEqual(customer, "cus_123")
        self.assertEqual(changes["plan"], "executive")

    def test_a_lapsed_subscription_drops_to_free(self):
        event = {"type": "customer.subscription.updated",
                 "data": {"object": {"status": "past_due", "customer": "cus_123"}}}
        _, _, changes = server.stripe_event_changes(event)
        self.assertEqual(changes["plan"], "village")

    def test_a_deleted_subscription_drops_to_free(self):
        event = {"type": "customer.subscription.deleted",
                 "data": {"object": {"status": "canceled", "customer": "cus_123"}}}
        _, _, changes = server.stripe_event_changes(event)
        self.assertEqual(changes["plan"], "village")

    def test_an_unhandled_event_never_touches_the_plan(self):
        event = {"type": "invoice.paid", "data": {"object": {"customer": "cus_123"}}}
        _, _, changes = server.stripe_event_changes(event)
        self.assertNotIn("plan", changes)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WebhookEndToEnd(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        os.environ["STRIPE_WEBHOOK_SECRET"] = SECRET
        asyncio.run(self.db["families"].insert_one(
            {"family_id": "fam1", "plan": "village"}))

    def tearDown(self):
        server.get_db = self._get_db
        os.environ.pop("STRIPE_WEBHOOK_SECRET", None)

    def _post(self, event: dict, *, secret=SECRET, skew=0):
        body = json.dumps(event).encode()
        now = int(server.utcnow().timestamp())
        req = FakeRequest(body, {"stripe-signature": sign(body, now + skew, secret)})
        return asyncio.run(server.stripe_webhook(req))

    def _plan(self):
        return asyncio.run(self.db["families"].find_one({"family_id": "fam1"}))["plan"]

    def test_a_paid_checkout_lifts_the_family_to_premium(self):
        out = self._post({
            "type": "checkout.session.completed",
            "data": {"object": {"metadata": {"family_id": "fam1", "cycle": "monthly"},
                                "customer": "cus_1", "subscription": "sub_1"}},
        })
        self.assertTrue(out["matched"])
        self.assertEqual(self._plan(), "executive")

    def test_a_later_cancellation_found_by_customer_drops_the_plan(self):
        # First the checkout stores the customer on the family...
        self._post({
            "type": "checkout.session.completed",
            "data": {"object": {"metadata": {"family_id": "fam1", "cycle": "monthly"},
                                "customer": "cus_1", "subscription": "sub_1"}},
        })
        self.assertEqual(self._plan(), "executive")
        # ...then a deletion that carries ONLY the customer id still finds them.
        self._post({"type": "customer.subscription.deleted",
                    "data": {"object": {"status": "canceled", "customer": "cus_1"}}})
        self.assertEqual(self._plan(), "village")

    def test_a_forged_signature_is_rejected_and_changes_nothing(self):
        body = json.dumps({"type": "checkout.session.completed",
                           "data": {"object": {"metadata": {"family_id": "fam1"}}}}).encode()
        now = int(server.utcnow().timestamp())
        bad = FakeRequest(body, {"stripe-signature": f"t={now},v1=deadbeef"})
        with self.assertRaises(server.HTTPException) as e:
            asyncio.run(server.stripe_webhook(bad))
        self.assertEqual(e.exception.status_code, 400)
        self.assertEqual(self._plan(), "village")

    def test_an_event_for_an_unknown_family_is_acknowledged_not_applied(self):
        out = self._post({
            "type": "checkout.session.completed",
            "data": {"object": {"metadata": {"family_id": "ghost"}, "customer": "cus_x"}},
        })
        self.assertFalse(out["matched"])
        self.assertEqual(self._plan(), "village")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class CheckoutSessionCreation(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        os.environ["STRIPE_SECRET_KEY"] = "sk_test_x"
        os.environ["STRIPE_PRICE_MONTHLY"] = "price_month"
        os.environ["STRIPE_PRICE_YEARLY"] = "price_year"
        asyncio.run(self.db["families"].insert_one({"family_id": "fam1", "plan": "village"}))
        self._real_post = server.requests.post
        self.captured = {}

        class Resp:
            status_code = 200

            def json(self_inner):
                return {"id": "cs_1", "url": "https://checkout.stripe.com/c/cs_1"}

        def fake_post(url, data=None, auth=None, timeout=None):
            self.captured["url"] = url
            self.captured["data"] = dict(data)
            self.captured["auth"] = auth
            return Resp()

        server.requests.post = fake_post

    def tearDown(self):
        server.get_db = self._get_db
        server.requests.post = self._real_post
        for k in ("STRIPE_SECRET_KEY", "STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_YEARLY"):
            os.environ.pop(k, None)

    def _checkout(self, cycle):
        user = {"user_id": "u1", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
        return asyncio.run(server.stripe_checkout(payload={"cycle": cycle}, user=user))

    def test_it_returns_the_hosted_url(self):
        out = self._checkout("monthly")
        self.assertEqual(out["url"], "https://checkout.stripe.com/c/cs_1")

    def test_the_family_rides_in_the_metadata_so_the_webhook_can_find_them(self):
        self._checkout("yearly")
        data = self.captured["data"]
        self.assertEqual(data["metadata[family_id]"], "fam1")
        self.assertEqual(data["client_reference_id"], "fam1")
        self.assertEqual(data["line_items[0][price]"], "price_year")
        self.assertEqual(data["mode"], "subscription")

    def test_a_bad_cycle_is_refused(self):
        with self.assertRaises(server.HTTPException) as e:
            self._checkout("lifetime")
        self.assertEqual(e.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
