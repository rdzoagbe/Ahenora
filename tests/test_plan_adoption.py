"""Subscription adoption: who is actually paying vs. getting Premium for free.

"Lots of visits, no subscribers" has three possible populations the app's own
screens blur together — paying households, households handed Premium free (the
global testing window, or a tester/admin household), and genuinely-free ones.
This readout separates them, and surfaces the master switch: when billing is not
live, no gate fires anywhere, so zero subscribers is expected, not a leak.

Admin-only, counted per family and per active (has-a-device) family.

Run with:  python3 -m unittest discover -s tests -v
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

ADMIN = {"user_id": "u_admin", "family_id": "fam_admin", "email": "admin@x.com"}
PLAIN = {"user_id": "u_plain", "family_id": "fam1", "email": "someone@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class PlanAdoptionReadout(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self._admins = server.ADMIN_EMAILS
        self._secret = os.environ.get("RC_WEBHOOK_SECRET")
        server.ADMIN_EMAILS = {"admin@x.com"}
        server._ADMIN_FAMILY_CACHE.clear()
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        # Default these tests to "billing live" so gates fire; the testing-window
        # case sets it explicitly.
        os.environ["RC_WEBHOOK_SECRET"] = "whsec_test"

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins
        server._ADMIN_FAMILY_CACHE.clear()
        if self._secret is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._secret

    def _family(self, family_id, plan="village", admin_email=None,
                with_device=True, active=None):
        """Seed one household.

        `active` decides whether it counts as LIVE, and that is now measured by
        whether an adult opened the app — not by whether anyone owns a push
        token. Those were the same thing in this fixture until the endpoint
        stopped conflating them, which is exactly the conflation that made
        pct_active_paying read high: a household using the app daily with
        notifications declined was invisible.

        Defaults to `with_device` so the existing cases keep their meaning.
        """
        live = with_device if active is None else active

        async def seed():
            await self.db["families"].insert_one({"family_id": family_id, "plan": plan})
            # Every household has an adult account; whether it is RECENTLY
            # active is what decides the "live" population.
            doc = {"user_id": f"u_{family_id}", "family_id": family_id,
                   "email": admin_email or f"{family_id}@x.com"}
            if live:
                doc["last_active_at"] = server.utcnow()
            await self.db["users"].insert_one(doc)
            if with_device:
                await self.db["notification_tokens"].insert_one({
                    "token": f"tok_{family_id}", "family_id": family_id,
                    "user_id": f"dev_{family_id}", "active": True})
        asyncio.run(seed())

    def _run(self, user=ADMIN):
        return asyncio.run(server.plan_adoption(user=user))

    def test_only_an_admin_may_read_it(self):
        with self.assertRaises(HTTPException) as e:
            self._run(user=PLAIN)
        self.assertEqual(e.exception.status_code, 403)

    def test_paying_is_the_stored_paid_tier(self):
        self._family("f1", plan="village")
        self._family("f2", plan="executive")   # a real subscriber
        self._family("f3", plan="executive")
        out = self._run()
        self.assertTrue(out["billing_live"])
        self.assertEqual(out["total_families"], 3)
        self.assertEqual(out["paying_families"], 2)
        self.assertEqual(out["by_stored_plan"], {"executive": 2, "village": 1})
        self.assertEqual(out["pct_active_paying"], round(100 * 2 / 3, 1))

    def test_when_billing_live_only_tester_households_are_free_premium(self):
        self._family("f1", plan="village")                          # gated free user
        self._family("f2", plan="village", admin_email="admin@x.com")  # tester → free premium
        out = self._run()
        self.assertEqual(out["tester_households"], 1)
        self.assertEqual(out["free_premium_families"], 1)
        self.assertEqual(out["paying_families"], 0)

    def test_when_billing_off_everyone_is_free_premium(self):
        os.environ.pop("RC_WEBHOOK_SECRET", None)  # testing window ON
        self._family("f1", plan="village")
        self._family("f2", plan="village")
        self._family("f3", plan="village")
        out = self._run()
        self.assertFalse(out["billing_live"])
        # No gate fires: every non-paying family is effectively Premium for free.
        self.assertEqual(out["free_premium_families"], 3)
        self.assertEqual(out["paying_families"], 0)

    def test_conversion_is_measured_against_active_families(self):
        self._family("f1", plan="executive", active=True)    # active + paying
        self._family("f2", plan="village", active=True)      # active + free
        self._family("f3", plan="village", active=False)     # signed up, never opened
        out = self._run()
        self.assertEqual(out["total_families"], 3)
        self.assertEqual(out["active_families"], 2)
        self.assertEqual(out["active_paying_families"], 1)
        self.assertEqual(out["pct_active_paying"], 50.0)

    def test_a_live_household_that_declined_notifications_still_counts(self):
        """The reason the denominator moved off push tokens.

        Before the permission prompt shipped almost nobody had a token, so a
        household using the app every day was missing from the denominator —
        and pct_active_paying read HIGHER than the truth. Flattering errors are
        the ones nobody questions."""
        self._family("f1", plan="executive", with_device=True, active=True)
        self._family("f2", plan="village", with_device=False, active=True)
        self._family("f3", plan="village", with_device=False, active=True)
        out = self._run()
        self.assertEqual(out["active_families"], 3)
        self.assertEqual(out["families_with_a_device"], 1)
        # 1 of 3, not the 1 of 1 the old denominator would have reported.
        self.assertEqual(out["pct_active_paying"], 33.3)

    def test_empty_base_is_zero_not_a_crash(self):
        out = self._run()
        self.assertEqual(out["total_families"], 0)
        self.assertEqual(out["pct_active_paying"], 0.0)


if __name__ == "__main__":
    unittest.main()
