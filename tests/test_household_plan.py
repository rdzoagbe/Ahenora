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
        self.assertEqual(sub["plan"], "family_office")
        self.assertEqual(sub["limits"], server.PLAN_CATALOG["executive"]["limits"])

    def test_a_household_without_an_admin_keeps_its_real_plan(self):
        self._seed("fam2", ["someone@x.com"])
        sub = asyncio.run(server.build_subscription("fam2"))
        self.assertEqual(sub["plan"], "village")
        self.assertNotEqual(sub["limits"], server.PLAN_CATALOG["executive"]["limits"])


if __name__ == "__main__":
    unittest.main()
