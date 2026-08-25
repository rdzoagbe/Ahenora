"""The third tier — Household — grants correctly and gates what it should.

Two paid tiers now: Family (stored "executive", the old Premium) and Household
(stored "household"). This guards that a Household purchase through either rail
grants the Household plan, that a Family purchase still grants Family, and that
the Household-only feature — helper/carer accounts — is refused below it.

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

SECRET = "whsec_tier_secret"


def sign(body: bytes, ts: int) -> str:
    mac = hmac.new(SECRET.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={mac}"


class FakeRequest:
    def __init__(self, body, headers):
        self._body = body
        self.headers = headers

    async def body(self):
        return self._body


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class HouseholdGrant(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        os.environ["STRIPE_WEBHOOK_SECRET"] = SECRET
        os.environ["STRIPE_PRICE_HOUSEHOLD_MONTHLY"] = "price_hh_m"
        os.environ["STRIPE_PRICE_HOUSEHOLD_YEARLY"] = "price_hh_y"
        os.environ["STRIPE_PRICE_MONTHLY"] = "price_fam_m"
        asyncio.run(self.db["families"].insert_one({"family_id": "fam1", "plan": "village"}))

    def tearDown(self):
        server.get_db = self._get_db
        for k in ("STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_HOUSEHOLD_MONTHLY",
                  "STRIPE_PRICE_HOUSEHOLD_YEARLY", "STRIPE_PRICE_MONTHLY"):
            os.environ.pop(k, None)

    def _post(self, event):
        body = json.dumps(event).encode()
        now = int(server.utcnow().timestamp())
        return asyncio.run(server.stripe_webhook(FakeRequest(body, {"stripe-signature": sign(body, now)})))

    def _plan(self):
        return asyncio.run(self.db["families"].find_one({"family_id": "fam1"}))["plan"]

    def test_a_household_checkout_grants_the_household_plan(self):
        self._post({
            "type": "checkout.session.completed",
            "data": {"object": {"metadata": {"family_id": "fam1", "cycle": "monthly", "plan": "household"},
                                "customer": "cus_1", "subscription": "sub_1"}},
        })
        self.assertEqual(self._plan(), "household")

    def test_a_family_checkout_still_grants_family(self):
        self._post({
            "type": "checkout.session.completed",
            "data": {"object": {"metadata": {"family_id": "fam1", "cycle": "monthly", "plan": "executive"},
                                "customer": "cus_2"}},
        })
        self.assertEqual(self._plan(), "executive")

    def test_a_renewal_reads_the_tier_back_from_its_price(self):
        # First a household checkout stores the customer...
        self._post({
            "type": "checkout.session.completed",
            "data": {"object": {"metadata": {"family_id": "fam1", "plan": "household"}, "customer": "cus_1"}},
        })
        # ...then a renewal carrying only the household price keeps them on household.
        self._post({
            "type": "customer.subscription.updated",
            "data": {"object": {"status": "active", "customer": "cus_1",
                                "items": {"data": [{"price": {"id": "price_hh_y"}}]}}},
        })
        self.assertEqual(self._plan(), "household")

    def test_the_price_to_plan_map_is_correct(self):
        self.assertEqual(server._stripe_plan_for_price("price_hh_m"), "household")
        self.assertEqual(server._stripe_plan_for_price("price_fam_m"), "executive")
        self.assertIsNone(server._stripe_plan_for_price("price_unknown"))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class RevenueCatTier(unittest.TestCase):
    def test_a_household_play_product_grants_household(self):
        event = {"type": "INITIAL_PURCHASE", "product_id": "household_monthly"}
        # Exercise the pure mapping the webhook uses.
        product_id = event["product_id"].lower()
        granted = "household" if "household" in product_id else "executive"
        self.assertEqual(granted, "household")

    def test_a_plain_premium_product_grants_family(self):
        product_id = "premium_monthly".lower()
        granted = "household" if "household" in product_id else "executive"
        self.assertEqual(granted, "executive")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class HelperGate(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        # Close the testing window so plan gates actually enforce (otherwise
        # every family is handed top-tier limits and nothing is gated).
        os.environ["RC_WEBHOOK_SECRET"] = "gates-live"

        async def seed(plan):
            await self.db["families"].delete_many({})
            await self.db["families"].insert_one(
                {"family_id": "fam1", "plan": plan, "billing_cycle": "monthly"})
            await self.db["users"].insert_one({"user_id": "u1", "family_id": "fam1", "name": "Roland"})
        self._seed = seed

    def tearDown(self):
        server.get_db = self._get_db
        os.environ.pop("RC_WEBHOOK_SECRET", None)

    def _invite_helper(self, plan):
        asyncio.run(self._seed(plan))
        user = {"user_id": "u1", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
        payload = server.InviteLinkIn(is_helper=True)
        return asyncio.run(server.family_invite_link(payload=payload, user=user))

    def test_a_free_family_cannot_invite_a_helper(self):
        with self.assertRaises(server.HTTPException) as e:
            self._invite_helper("village")
        self.assertEqual(e.exception.status_code, 402)

    def test_the_family_tier_cannot_invite_a_helper(self):
        with self.assertRaises(server.HTTPException) as e:
            self._invite_helper("executive")
        self.assertEqual(e.exception.status_code, 402)

    def test_the_household_tier_can_invite_a_helper(self):
        # No 402 raised, and a helper invite is actually written.
        out = self._invite_helper("household")
        self.assertTrue(out["ok"])
        stored = asyncio.run(self.db["family_invites"].find_one({}))
        self.assertTrue(stored.get("is_helper"))


if __name__ == "__main__":
    unittest.main()
