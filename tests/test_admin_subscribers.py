"""The founder's subscriber list: who is on what, and how they pay.

plan-adoption answers "how many pay"; this answers "who" — with a contact and
the rail the money came through — so a founder can actually follow up. It reads
across every household, so it must be admin-only, and it must put the paying
households first.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
from datetime import timedelta
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

ADMIN = {"user_id": "u_admin", "family_id": "fam_admin", "name": "Roland", "email": "boss@ahenora.com"}
PLAIN = {"user_id": "u_plain", "family_id": "fam_plain", "name": "Nobody", "email": "n@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AdminSubscribers(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admins = server.ADMIN_EMAILS
        server.ADMIN_EMAILS = {"boss@ahenora.com"}

        async def seed():
            # A paying family (Stripe), a paying family (Play), and a free one.
            await self.db["families"].insert_one({
                "family_id": "fam_stripe", "plan": "executive", "billing_cycle": "yearly",
                "stripe_last_event": "checkout.session.completed"})
            await self.db["families"].insert_one({
                "family_id": "fam_play", "plan": "executive", "billing_cycle": "monthly",
                "rc_last_event": "INITIAL_PURCHASE"})
            await self.db["families"].insert_one({"family_id": "fam_free", "plan": "village"})
            await self.db["users"].insert_one(
                {"user_id": "us1", "family_id": "fam_stripe", "name": "Chrissie", "email": "c@x.com"})
            await self.db["users"].insert_one(
                {"user_id": "us2", "family_id": "fam_play", "name": "Ama", "email": "a@x.com"})
            await self.db["users"].insert_one(
                {"user_id": "us3", "family_id": "fam_free", "name": "Free Fred", "email": "f@x.com"})
            await self.db["notification_tokens"].insert_one(
                {"family_id": "fam_stripe", "active": True})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins

    def _list(self, user):
        return asyncio.run(server.admin_subscribers(user=dict(user)))

    def test_a_non_admin_is_refused(self):
        with self.assertRaises(server.HTTPException) as e:
            self._list(PLAIN)
        self.assertEqual(e.exception.status_code, 403)

    def test_it_lists_every_household_with_a_contact(self):
        out = self._list(ADMIN)
        self.assertEqual(out["total"], 3)
        self.assertEqual(out["paying"], 2)
        by_id = {r["family_id"]: r for r in out["subscribers"]}
        self.assertEqual(by_id["fam_stripe"]["owner_email"], "c@x.com")
        self.assertEqual(by_id["fam_stripe"]["owner_name"], "Chrissie")

    def test_it_names_the_rail_the_money_came_through(self):
        by_id = {r["family_id"]: r for r in self._list(ADMIN)["subscribers"]}
        self.assertEqual(by_id["fam_stripe"]["billing_source"], "stripe")
        self.assertEqual(by_id["fam_play"]["billing_source"], "google_play")
        self.assertIsNone(by_id["fam_free"]["billing_source"])

    def test_paying_households_come_first(self):
        rows = self._list(ADMIN)["subscribers"]
        # The two paying families lead; the free one is last.
        self.assertTrue(rows[0]["paying"] and rows[1]["paying"])
        self.assertFalse(rows[-1]["paying"])
        self.assertEqual(rows[-1]["family_id"], "fam_free")

    def test_it_marks_a_live_household(self):
        by_id = {r["family_id"]: r for r in self._list(ADMIN)["subscribers"]}
        self.assertTrue(by_id["fam_stripe"]["has_active_device"])
        self.assertFalse(by_id["fam_play"]["has_active_device"])



@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhenTheyLastUsedIt(unittest.TestCase):
    """"Never opened" was reading a push token, not usage.

    The list built its idea of an active household from notification_tokens and
    printed "Never opened" when there was none. Anyone who declined the
    notification prompt, or used the web app, was reported as never having
    opened it — Roland found himself in his own list that way.

    What it reports now is when somebody last used the app, taken from the two
    fields that record it. Reading only the newer of the two would report
    everyone who last opened it before today as never having opened it, which
    is the same mistake wearing different clothes.
    """

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        self._admins = server.ADMIN_EMAILS
        server.get_db = lambda: self.db
        server.ADMIN_EMAILS = {"boss@ahenora.com"}
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins

    def _run(self, member):
        asyncio.run(self.db["families"].insert_one(
            {"family_id": "fam1", "plan": "village"}))
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u1", "family_id": "fam1", "name": "Roland",
             "email": "r@x.test", "created_at": self.now, **member}))
        out = asyncio.run(server.admin_subscribers(
            user={"user_id": "u_a", "family_id": "famA", "email": "boss@ahenora.com"}))
        return out["subscribers"][0]

    def test_someone_who_uses_the_app_is_not_called_never_opened(self):
        """The reported case. No push token, real usage."""
        row = self._run({"last_active_at": self.now})
        self.assertIsNotNone(row["last_active"])
        self.assertFalse(row["has_active_device"])

    def test_the_older_date_field_still_counts(self):
        """last_active_at only began being written on every request today.
        Before that, the daily counter wrote last_active_day. Ignoring it would
        erase everyone's history at a stroke."""
        day = (self.now - timedelta(days=9)).strftime("%Y-%m-%d")
        row = self._run({"last_active_day": day})
        self.assertIsNotNone(row["last_active"])
        self.assertIn(day[:10], row["last_active"])

    def test_the_timestamp_wins_when_both_are_there(self):
        row = self._run({
            "last_active_at": self.now,
            "last_active_day": (self.now - timedelta(days=30)).strftime("%Y-%m-%d"),
        })
        seen = server.ensure_aware_utc(server.parse_dt(row["last_active"]))
        self.assertGreater(seen, self.now - timedelta(days=1))

    def test_a_household_reports_its_most_recent_member(self):
        """One person going quiet does not make the household quiet."""
        asyncio.run(self.db["families"].insert_one(
            {"family_id": "fam2", "plan": "village"}))
        for uid, days in (("a", 40), ("b", 2)):
            asyncio.run(self.db["users"].insert_one({
                "user_id": uid, "family_id": "fam2", "email": f"{uid}@x.test",
                "created_at": self.now,
                "last_active_at": self.now - timedelta(days=days)}))
        out = asyncio.run(server.admin_subscribers(
            user={"user_id": "u_a", "family_id": "famA", "email": "boss@ahenora.com"}))
        row = next(r for r in out["subscribers"] if r["family_id"] == "fam2")
        seen = server.ensure_aware_utc(server.parse_dt(row["last_active"]))
        self.assertGreater(seen, self.now - timedelta(days=3))

    def test_nothing_recorded_reports_nothing_rather_than_a_claim(self):
        row = self._run({})
        self.assertIsNone(row["last_active"])

    def test_an_unparseable_day_does_not_break_the_screen(self):
        row = self._run({"last_active_day": "sometime last spring"})
        self.assertIsNone(row["last_active"])


if __name__ == "__main__":
    unittest.main()
