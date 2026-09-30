"""The tester/admin override is household-level, like every real plan.

Field case: the founder's co-parent joined his family and saw the Free
plan next to his full access — the override was tied to his email while
subscriptions belong to the family.

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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class HouseholdPlan(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admins = server.ADMIN_EMAILS
        server.ADMIN_EMAILS = {"admin@x.com"}
        self._rc = os.environ.get("RC_WEBHOOK_SECRET")
        os.environ["RC_WEBHOOK_SECRET"] = "live"  # billing on: no free window
        server._ADMIN_FAMILY_CACHE.clear()

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins
        if self._rc is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._rc
        server._ADMIN_FAMILY_CACHE.clear()

    def _seed(self, family_id, emails):
        for i, email in enumerate(emails):
            asyncio.run(self.db["users"].insert_one(
                {"user_id": f"u{i}", "email": email, "family_id": family_id}))

    def test_everyone_in_an_admin_household_shares_the_top_plan(self):
        self._seed("fam1", ["admin@x.com", "wife@x.com"])
        sub = asyncio.run(server.build_subscription("fam1"))
        self.assertEqual(sub["plan"], "household")
        self.assertEqual(sub["limits"], server.PLAN_CATALOG["household"]["limits"])

    def test_a_household_without_an_admin_keeps_its_real_plan(self):
        self._seed("fam2", ["someone@x.com"])
        sub = asyncio.run(server.build_subscription("fam2"))
        self.assertEqual(sub["plan"], "village")
        self.assertNotEqual(sub["limits"], server.PLAN_CATALOG["executive"]["limits"])

    def test_a_grandfathered_family_keeps_premium_after_billing(self):
        """The grace-period exemption: a family flagged grandfathered keeps the
        top limits once billing is live, even with no admin and a Village plan."""
        self._seed("fam3", ["founding@x.com"])
        asyncio.run(self.db["families"].insert_one({
            "family_id": "fam3", "plan": "village", "billing_cycle": "monthly",
            "grandfathered": True}))
        sub = asyncio.run(server.build_subscription("fam3"))
        self.assertTrue(sub["grandfathered"])
        self.assertEqual(sub["limits"], server.PLAN_CATALOG["household"]["limits"])


    def test_an_admin_household_that_bought_a_plan_is_shown_that_plan(self):
        # Field case, 2026-09-30: the founder bought Duo and the Plans page
        # still said Household — Household marked current, every other plan
        # "Downgrade", and the purchase looking as if it had not landed. The
        # plan bought is reported as itself; the top limits stay.
        self._seed("fam4", ["admin@x.com", "wife@x.com"])
        for bought in ("duo", "executive", "household"):
            asyncio.run(self.db["families"].delete_many({"family_id": "fam4"}))
            asyncio.run(self.db["families"].insert_one({
                "family_id": "fam4", "plan": bought, "billing_cycle": "monthly"}))
            server._ADMIN_FAMILY_CACHE.clear()
            sub = asyncio.run(server.build_subscription("fam4"))
            self.assertEqual(sub["plan"], bought)
            self.assertEqual(sub["limits"], server.PLAN_CATALOG["household"]["limits"])
            # Duo hides the children's sections for customers, never for the
            # household testing everything.
            self.assertFalse(sub["kids_sections_hidden"])

    def test_the_admin_himself_sees_the_plan_he_bought(self):
        admin = {"plan": "duo", "billing_cycle": "monthly",
                 "limits": dict(server.PLAN_CATALOG["duo"]["limits"])}
        shown = server.apply_admin_subscription(admin)
        self.assertEqual(shown["plan"], "duo")
        self.assertTrue(shown["admin_unlocked"])
        self.assertEqual(shown["limits"]["max_children"], 999)
        # Nothing bought: the top tier, whose limits he has.
        self.assertEqual(server.apply_admin_subscription(
            {"plan": "village", "limits": {}})["plan"], "household")
        self.assertEqual(server.apply_admin_subscription(
            {"plan": "family_office", "limits": {}})["plan"], "household")


if __name__ == "__main__":
    unittest.main()
