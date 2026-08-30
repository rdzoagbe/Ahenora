"""The funnel and the retention read-out must answer the same question.

Two numbers on the Usage screen were measuring something other than their
label, which is the same shape of mistake as "Never opened" reading a push
token:

  * "Households with 2+ members" counted rows in family_members, and a child
    profile is a row. A lone parent with two kids read as a shared household —
    overstating the one thing the product depends on, and contradicting the
    retention section directly below it, which had counted ADULTS from the
    start.

  * "Active today/this week" read only last_active_at, which require_user began
    writing on every request today. Before that only /auth/me set it. Anyone
    who last opened the app before the fix looked gone.

Both now use the definitions retention already used.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest
from datetime import timedelta

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

ADMIN_EMAIL = "boss@ahenora.com"
ADMIN = {"user_id": "u_admin", "family_id": "famA", "email": ADMIN_EMAIL}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class FunnelCounts(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        self._admins = server.ADMIN_EMAILS
        server.get_db = lambda: self.db
        server.ADMIN_EMAILS = {ADMIN_EMAIL}
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins

    def account(self, uid, fam, **extra):
        asyncio.run(self.db["users"].insert_one(
            {"user_id": uid, "family_id": fam, "email": f"{uid}@x.test",
             "created_at": self.now, **extra}))

    def member(self, fam, name, role="Child"):
        asyncio.run(self.db["family_members"].insert_one(
            {"family_id": fam, "member_id": f"m_{name}", "name": name, "role": role}))

    def funnel(self):
        return asyncio.run(server.metrics_funnel(
            days=30, user=dict(ADMIN), database=self.db))

    def test_a_lone_parent_with_children_is_not_a_shared_household(self):
        """The reported shape. One adult, two kids — three member rows."""
        self.account("u1", "fam1", last_active_at=self.now)
        self.member("fam1", "Parent", role="Parent")
        self.member("fam1", "Amara")
        self.member("fam1", "Kofi")
        self.assertEqual(self.funnel()["two_plus_adult_households"], 0)

    def test_two_adults_is_a_shared_household(self):
        self.account("u1", "fam1", last_active_at=self.now)
        self.account("u2", "fam1", last_active_at=self.now)
        self.assertEqual(self.funnel()["two_plus_adult_households"], 1)

    def test_it_agrees_with_the_retention_read_out(self):
        """The two lived on one screen and disagreed. A household with one adult
        and children must be solo in both."""
        self.account("u1", "fam_solo", last_active_at=self.now)
        self.member("fam_solo", "Amara")
        self.account("u2", "fam_pair", last_active_at=self.now)
        self.account("u3", "fam_pair", last_active_at=self.now)

        funnel = self.funnel()
        retention = asyncio.run(server.metrics_retention(
            weeks=8, user=dict(ADMIN), database=self.db))
        self.assertEqual(funnel["two_plus_adult_households"],
                         retention["households"]["two_plus_adults"])

    def test_someone_last_seen_before_the_timestamp_existed_still_counts(self):
        """last_active_day is the only record for anyone who has not opened the
        app since the timestamp began being written. Ignoring it reports a
        churn that did not happen."""
        yesterday = (self.now - timedelta(days=1)).strftime("%Y-%m-%d")
        self.account("u1", "fam1", last_active_day=yesterday)
        self.assertEqual(self.funnel()["active_7d"], 1)

    def test_the_timestamp_is_used_when_it_is_there(self):
        self.account("u1", "fam1", last_active_at=self.now)
        out = self.funnel()
        self.assertEqual(out["active_1d"], 1)
        self.assertEqual(out["active_7d"], 1)

    def test_somebody_long_gone_is_not_counted_active(self):
        self.account("u1", "fam1", last_active_at=self.now - timedelta(days=40))
        out = self.funnel()
        self.assertEqual(out["active_1d"], 0)
        self.assertEqual(out["active_7d"], 0)

    def test_an_account_that_never_opened_it_counts_as_neither(self):
        self.account("u1", "fam1")
        out = self.funnel()
        self.assertEqual(out["active_7d"], 0)
        self.assertEqual(out["total_users"], 1)

    def test_a_non_admin_cannot_read_it(self):
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.metrics_funnel(
                days=30, user={"user_id": "u9", "family_id": "f", "email": "x@x.test"},
                database=self.db))
        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
