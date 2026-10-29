"""The Family tab's "This week" card counts the household's jobs.

The final design (2026-10-26) opens the Family tab on the people and, under
them, how the week is going: "Jobs done · 18 of 25". Done is every chore-wheel
completion since the week began; the week begins where the weekly star meter
resets, so the two numbers on the card count the same days. Total is what the
wheel asks for in a week: a daily chore seven times, a weekly one once.

Run with:  python3 -m pytest tests/test_the_family_tab_counts_the_week.py -q
"""
import asyncio
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase

PARENT = {"user_id": "u_parent", "family_id": "fam", "email": "parent@example.com", "name": "Jordan"}


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheWeeksJobs(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.week_start = server.current_week_start()

    def go(self, coro):
        return asyncio.run(coro)

    def chore(self, chore_id, frequency="daily", family="fam"):
        self.go(self.db["chores"].insert_one({
            "chore_id": chore_id, "family_id": family, "title": chore_id, "frequency": frequency,
            "assigned_members": ["m_ama"], "current_assignee": "m_ama", "rotate": False,
            "star_reward": 2, "created_at": datetime(2026, 10, 1, tzinfo=timezone.utc)}))

    def log(self, chore_id, when, family="fam", member="m_ama"):
        self.go(self.db["chore_logs"].insert_one({
            "log_id": f"clog_{chore_id}_{when.isoformat()}", "chore_id": chore_id, "family_id": family,
            "member_id": member, "completed_at": when, "stars_awarded": 2}))

    def week(self):
        return self.go(server.family_jobs_week(user=PARENT, database=self.db))

    def test_a_household_with_no_chores_has_nothing_to_count(self):
        self.assertEqual(self.week(), {"done": 0, "total": 0})

    def test_a_daily_chore_is_seven_jobs_a_week_and_a_weekly_one_is_one(self):
        self.chore("c_bed")
        self.chore("c_table", frequency="daily")
        self.chore("c_bins", frequency="weekly")
        self.assertEqual(self.week()["total"], 15)

    def test_done_counts_completions_since_the_week_began(self):
        self.chore("c_bed")
        self.log("c_bed", self.week_start + timedelta(hours=1))
        self.log("c_bed", self.week_start + timedelta(days=1, hours=8))
        self.log("c_bed", self.week_start - timedelta(hours=1))  # last week
        self.assertEqual(self.week(), {"done": 2, "total": 7})

    def test_the_week_begins_where_the_star_meter_resets(self):
        # Exactly at the boundary is this week: a job at Monday 00:00 UTC is
        # counted, the one a second before it is not.
        self.chore("c_bed")
        self.log("c_bed", self.week_start)
        self.log("c_bed", self.week_start - timedelta(seconds=1))
        self.assertEqual(self.week()["done"], 1)

    def test_another_households_week_is_not_this_ones(self):
        self.chore("c_bed")
        self.chore("c_other", family="fam_other")
        self.log("c_other", self.week_start + timedelta(hours=1), family="fam_other")
        self.assertEqual(self.week(), {"done": 0, "total": 7})

    def test_doing_more_than_asked_reads_over_the_total(self):
        self.chore("c_bins", frequency="weekly")
        self.log("c_bins", self.week_start + timedelta(hours=1))
        self.log("c_bins", self.week_start + timedelta(days=3))
        self.assertEqual(self.week(), {"done": 2, "total": 1})


if __name__ == "__main__":
    unittest.main()
