"""The retention read-out: does a second ADULT keep a household alive?"""
import asyncio
import os
import sys
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fastapi import HTTPException


class FakeColl:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def find(self, q=None, *a, **k):
        rows = list(self.rows)

        class Cursor:
            def __aiter__(self):
                async def gen():
                    for r in rows:
                        yield r
                return gen()
        return Cursor()


class FakeDB:
    def __init__(self, **colls):
        self.colls = colls

    def __getitem__(self, name):
        return self.colls.setdefault(name, FakeColl())


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Retention(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db

    def _run(self, users, admin=True, weeks=8):
        db = FakeDB(users=FakeColl(users))
        server.get_db = lambda: db
        caller = {"user_id": "u_admin",
                  "email": "boss@ahenora.test" if admin else "nobody@ahenora.test"}
        server.ADMIN_EMAILS.add("boss@ahenora.test")
        return asyncio.run(server.metrics_retention(weeks=weeks, user=caller, database=db))

    def _acct(self, uid, fam, days_old=1, seen_days_ago=0):
        return {"user_id": uid, "family_id": fam,
                "created_at": self.now - timedelta(days=days_old),
                "last_active_at": (self.now - timedelta(days=seen_days_ago)
                                   if seen_days_ago is not None else None)}

    def test_only_an_admin_may_read_it(self):
        db = FakeDB(users=FakeColl([]))
        server.get_db = lambda: db
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.metrics_retention(
                user={"user_id": "u1", "email": "someone@example.com"}, database=db))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_a_household_of_one_adult_and_two_kids_is_not_shared(self):
        """The trap the existing funnel falls into.

        Child profiles live in family_members and have no account, so counting
        members makes a lone parent look like a shared household. Adults are
        accounts, and only accounts are counted here.
        """
        res = self._run([self._acct("u1", "famA")])
        self.assertEqual(res["households"]["solo_adult"], 1)
        self.assertEqual(res["households"]["two_plus_adults"], 0)

    def test_second_adult_makes_the_household_shared_and_live(self):
        res = self._run([
            self._acct("u1", "famA", seen_days_ago=0),
            self._acct("u2", "famA", seen_days_ago=3),
        ])
        self.assertEqual(res["households"]["two_plus_adults"], 1)
        self.assertEqual(res["households"]["two_plus_adults_active_7d"], 1)
        self.assertEqual(res["weekly_return_rate"]["two_plus_adults_pct"], 100.0)

    def test_a_household_is_live_if_any_adult_returned(self):
        """The household is the unit that churns. One parent still opening it
        means the household has not gone."""
        res = self._run([
            self._acct("u1", "famA", seen_days_ago=40),
            self._acct("u2", "famA", seen_days_ago=2),
        ])
        self.assertEqual(res["households"]["two_plus_adults_active_7d"], 1)

    def test_the_two_return_rates_are_reported_side_by_side(self):
        """Solo churned, shared alive — the comparison the endpoint exists for."""
        res = self._run([
            self._acct("solo1", "famS1", seen_days_ago=30),
            self._acct("solo2", "famS2", seen_days_ago=30),
            self._acct("a", "famM", seen_days_ago=1),
            self._acct("b", "famM", seen_days_ago=1),
        ])
        self.assertEqual(res["weekly_return_rate"]["solo_adult_pct"], 0.0)
        self.assertEqual(res["weekly_return_rate"]["two_plus_adults_pct"], 100.0)

    def test_an_account_that_never_returned_counts_as_churned(self):
        res = self._run([{"user_id": "u1", "family_id": "famA",
                          "created_at": self.now - timedelta(days=5)}])
        self.assertEqual(res["accounts"]["active_7d"], 0)
        self.assertEqual(res["weekly_return_rate"]["solo_adult_pct"], 0.0)

    def test_the_day_stamp_counts_when_the_timestamp_is_missing(self):
        """The 9-vs-1 bug: last_active_at was written only by /auth/me, while
        require_user stamped last_active_day on every authenticated request.
        Anyone who has not opened the app since the fix has only the day stamp,
        and reading the timestamp alone reported a churn that never happened."""
        day = (self.now - timedelta(days=2)).strftime("%Y-%m-%d")
        res = self._run([{"user_id": "u1", "family_id": "famA",
                          "created_at": self.now - timedelta(days=10),
                          "last_active_day": day}])
        self.assertEqual(res["accounts"]["active_7d"], 1)
        self.assertEqual(res["weekly_return_rate"]["solo_adult_pct"], 100.0)

    def test_an_old_day_stamp_is_still_churn(self):
        """The fallback must not resurrect everyone who ever signed in."""
        day = (self.now - timedelta(days=40)).strftime("%Y-%m-%d")
        res = self._run([{"user_id": "u1", "family_id": "famA",
                          "created_at": self.now - timedelta(days=60),
                          "last_active_day": day}])
        self.assertEqual(res["accounts"]["active_7d"], 0)
        self.assertEqual(res["accounts"]["active_30d"], 0)

    def test_the_timestamp_wins_when_both_are_present(self):
        """A fresh timestamp is the better signal; the day stamp is a floor."""
        stale = (self.now - timedelta(days=40)).strftime("%Y-%m-%d")
        res = self._run([{"user_id": "u1", "family_id": "famA",
                          "created_at": self.now - timedelta(days=60),
                          "last_active_at": self.now,
                          "last_active_day": stale}])
        self.assertEqual(res["accounts"]["active_1d"], 1)

    def test_cohorts_are_bucketed_by_signup_week_and_windowed(self):
        # Both newcomers must land in ONE cohort for the 50% below to mean
        # anything, and "1 and 2 days old" does not guarantee that: cohorts
        # bucket by the Monday of created_at, so on a Tuesday those two dates
        # straddle a week boundary and split into two cohorts of one. Anchor
        # them to the Monday of last week instead — same bucket on every day of
        # every week, and still comfortably inside the 8-week horizon.
        last_monday = (self.now - timedelta(days=7 + self.now.weekday()))
        days_to = lambda dt: (self.now - dt).days
        res = self._run([
            self._acct("new1", "f1", days_old=days_to(last_monday), seen_days_ago=0),
            self._acct("new2", "f2",
                       days_old=days_to(last_monday + timedelta(days=1)),
                       seen_days_ago=30),
            # Older than the window: excluded from cohorts, still an account.
            self._acct("old", "f3", days_old=400, seen_days_ago=0),
        ], weeks=8)
        self.assertEqual(res["accounts"]["total"], 3)
        signups = sum(c["signups"] for c in res["cohorts"])
        self.assertEqual(signups, 2)
        recent = res["cohorts"][0]
        self.assertEqual(recent["still_active"], 1)
        self.assertEqual(recent["retained_pct"], 50.0)

    def test_rates_are_none_rather_than_zero_when_there_is_nothing_to_divide(self):
        """An empty population has no rate. Reporting 0% would read as
        'everyone churned' and send the roadmap somewhere false."""
        res = self._run([])
        self.assertIsNone(res["weekly_return_rate"]["solo_adult_pct"])
        self.assertIsNone(res["weekly_return_rate"]["two_plus_adults_pct"])


if __name__ == "__main__":
    unittest.main()
