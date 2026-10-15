"""Free keeps a taste of the paid features, and a trial ends in a thank-you.

Roland, 2026-10-15: "I do not want users to feel trapped about having to jump
straight to payment after trial." Two things follow, and this file holds both:

1. Monthly tastes. A household on Free can add 7 meals to the planner and read
   one week's report every month, without a timer and without a card. They
   come back on the 1st. The AI parts of the planner stay paid: each costs real
   money to run.

2. The trial recap. When a trial ends, the app thanks the family and shows what
   it actually used, counted inside the trial's own dates, instead of a wall.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    from fastapi import HTTPException
    import server
    from fake_mongo import FakeDatabase
    HAVE = True
except ImportError:
    HAVE = False


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def at(y, m, d, h=12):
    return datetime(y, m, d, h, tzinfo=timezone.utc)


USER = {"user_id": "u1", "family_id": "fam1", "name": "Ama", "email": "ama@example.com"}


@unittest.skipUnless(HAVE, "backend deps not installed")
class _Base(unittest.TestCase):
    PLAN = "village"

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db, self._utcnow = server.get_db, server.utcnow
        server.get_db = lambda: self.db
        # Billing live, so Free is really Free and not the testing window.
        self._rc = os.environ.get("RC_WEBHOOK_SECRET")
        os.environ["RC_WEBHOOK_SECRET"] = "test-live"
        self.now = at(2026, 10, 14)          # a Wednesday, ISO week 42
        server.utcnow = lambda: self.now
        run(self.db["families"].insert_one({
            "family_id": "fam1", "plan": self.PLAN, "billing_cycle": "monthly",
            "grandfathered": False, "updated_at": self.now}))
        run(self.db["family_members"].insert_one(
            {"member_id": "m1", "family_id": "fam1", "user_id": "u1", "name": "Ama", "role": "Parent"}))

    def tearDown(self):
        server.get_db, server.utcnow = self._get_db, self._utcnow
        if self._rc is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._rc

    def sub(self):
        return run(server.build_subscription("fam1"))

    def add_meal(self, day="monday", title="Jollof"):
        return run(server.create_meal(server.MealPlanIn(day=day, title=title), user=USER, database=self.db))

    def refused(self, fn):
        with self.assertRaises(HTTPException) as ctx:
            fn()
        self.assertEqual(ctx.exception.status_code, 402)
        return ctx.exception


class FreeHasATaste(_Base):
    def test_free_is_told_what_it_has_this_month(self):
        tastes = self.sub()["tastes"]
        self.assertEqual(tastes["meal_planner"]["limit"], 7)
        self.assertEqual(tastes["meal_planner"]["left"], 7)
        self.assertEqual(tastes["weekly_report"]["left"], 1)
        self.assertEqual(tastes["meal_planner"]["resets_on"][:10], "2026-11-01")

    def test_seven_meals_then_a_wall_that_says_they_come_back(self):
        for i in range(7):
            self.add_meal(title=f"Dinner {i}")
        self.assertEqual(self.sub()["tastes"]["meal_planner"]["left"], 0)
        err = self.refused(lambda: self.add_meal(title="Eighth"))
        self.assertIn("come back on the 1st", str(err.detail))
        self.assertEqual(run(self.db["meals"].count_documents({"family_id": "fam1"})), 7)

    def test_they_come_back_on_the_first(self):
        for i in range(7):
            self.add_meal(title=f"Dinner {i}")
        self.now = at(2026, 11, 1, 9)
        self.assertEqual(self.sub()["tastes"]["meal_planner"]["left"], 7)
        self.add_meal(title="November")

    def test_a_refused_meal_spends_nothing(self):
        with self.assertRaises(HTTPException) as ctx:
            self.add_meal(day="someday")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(self.sub()["tastes"]["meal_planner"]["left"], 7)

    def test_the_last_meal_cannot_be_taken_twice(self):
        """Two parents at once: the count is checked inside the update."""
        run(self.db["feature_tastes"].insert_one(
            {**server._taste_key("fam1", "meal_planner", "2026-10"), "used": 7}))
        self.refused(lambda: self.add_meal())

    def test_planned_meals_can_go_to_the_shopping_list_without_spending(self):
        sync = lambda: run(server.sync_meals_to_shopping(user=USER, database=self.db))
        self.refused(sync)                      # nothing planned this month yet
        run(self.db["meals"].delete_many({}))
        self.add_meal()
        left = self.sub()["tastes"]["meal_planner"]["left"]
        sync()
        self.assertEqual(self.sub()["tastes"]["meal_planner"]["left"], left)

    def test_one_weekly_report_a_month_counted_by_week(self):
        report = lambda: run(server.weekly_report(user=USER, database=self.db))
        report()                                # spends October's taste on week 42
        report()                                # the same week again: free
        self.assertEqual(self.sub()["tastes"]["weekly_report"]["week"], "2026-W42")
        self.now = at(2026, 10, 21)             # week 43, still October
        self.refused(report)
        self.now = at(2026, 11, 4)              # November: a new one
        report()

    def test_a_week_that_straddles_the_first_stays_open(self):
        report = lambda: run(server.weekly_report(user=USER, database=self.db))
        self.now = at(2026, 10, 30)             # Friday of week 44
        report()
        self.now = at(2026, 11, 1)              # Sunday, same week 44
        report()
        self.assertEqual(self.sub()["tastes"]["weekly_report"]["left"], 1,
                         "reopening the same week must not spend November's report")

    def test_the_ai_parts_stay_paid(self):
        """Each AI call costs money to run: tastes cover adding and listing meals only."""
        src = open(os.path.join(os.path.dirname(__file__), "..", "backend", "server.py"), encoding="utf-8").read()
        taste_routes = {"create_meal", "sync_meals_to_shopping", "weekly_report"}
        for fn in re.findall(r'async def (\w+)\([^)]*\):\n(?:.*\n){0,8}?\s+await require_feature_or_taste\(', src):
            self.assertIn(fn, taste_routes, f"{fn} uses a Free taste and is not meant to")
        for route in ("/api/meals/suggest-ai", "/api/recipes/generate", "/api/recipes/chef",
                      "/api/recipes/capture", "/api/meals/from-capture", "/api/meals/save"):
            block = src[src.index(f'"{route}"'):][:900]
            self.assertIn('await require_feature(user, "meal_planner")', block, route)


class PaidAndTrialHouseholdsHaveNoTastes(_Base):
    PLAN = "executive"

    def test_a_plan_that_includes_them_has_nothing_to_count(self):
        self.assertEqual(self.sub()["tastes"], {})
        for i in range(9):
            self.add_meal(title=f"Dinner {i}")
        self.assertEqual(run(self.db["feature_tastes"].count_documents({})), 0)


class TheTrialEndsInAThankYou(_Base):
    def start_trial(self, started, ends):
        run(self.db["families"].update_one({"family_id": "fam1"}, {"$set": {
            "trial_plan": "household", "trial_used": True,
            "trial_started_at": started, "trial_ends_at": ends}}))

    def test_a_trial_in_force_has_no_tastes(self):
        self.start_trial(self.now - timedelta(days=2), self.now + timedelta(days=12))
        s = self.sub()
        self.assertEqual(s["tastes"], {})
        self.assertIsNone(s["trial_ended_at"])

    def test_the_month_after_a_trial_says_so_once_then_stops(self):
        ends = self.now - timedelta(days=1)
        self.start_trial(ends - timedelta(days=14), ends)
        self.assertEqual(self.sub()["trial_ended_at"][:10], ends.date().isoformat())
        self.now = ends + timedelta(days=31)
        self.assertIsNone(self.sub()["trial_ended_at"])

    def test_a_household_that_bought_a_plan_is_not_thanked_for_trying(self):
        ends = self.now - timedelta(days=1)
        self.start_trial(ends - timedelta(days=14), ends)
        run(self.db["families"].update_one({"family_id": "fam1"}, {"$set": {"plan": "executive"}}))
        self.assertIsNone(self.sub()["trial_ended_at"])

    def test_the_recap_counts_only_what_happened_in_the_trial(self):
        started, ends = self.now - timedelta(days=15), self.now - timedelta(days=1)
        self.start_trial(started, ends)
        meals = self.db["meals"]
        run(meals.insert_one({"family_id": "fam1", "meal_id": "a", "created_at": started - timedelta(days=1)}))
        for i in range(3):
            run(meals.insert_one({"family_id": "fam1", "meal_id": f"m{i}", "created_at": started + timedelta(days=i)}))
        run(meals.insert_one({"family_id": "fam1", "meal_id": "z", "created_at": self.now}))
        run(meals.insert_one({"family_id": "other", "meal_id": "x", "created_at": started + timedelta(days=1)}))
        run(self.db["star_transactions"].insert_one({"family_id": "fam1", "delta": 3, "created_at": started + timedelta(days=2)}))
        run(self.db["star_transactions"].insert_one({"family_id": "fam1", "delta": -2, "created_at": started + timedelta(days=3)}))
        recap = run(server.trial_recap(user=USER, database=self.db))
        self.assertTrue(recap["ended"])
        self.assertEqual(recap["recommended_plan"], "duo", "one adult, no children")
        self.assertEqual({i["key"]: i["count"] for i in recap["items"]}, {"meals": 3, "stars": 1},
                         "before, after, another household, a spent star and zero counts all left out")

    def test_no_trial_no_recap(self):
        recap = run(server.trial_recap(user=USER, database=self.db))
        self.assertEqual(recap["items"], [])
        self.assertIsNone(recap["started_at"])


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheCountersGoWithTheHousehold(unittest.TestCase):
    def test_deleting_a_household_deletes_its_taste_counters(self):
        self.assertIn("feature_tastes", server._FAMILY_SCOPED_COLLECTIONS)


if __name__ == "__main__":
    unittest.main()
