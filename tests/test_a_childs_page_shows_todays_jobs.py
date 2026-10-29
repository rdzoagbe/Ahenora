"""A child's page shows their jobs today, and which are done.

The second kids'-page PR from the final design (2026-10-26): "Today's jobs —
1 of 3 done", a grid a parent can tick. The jobs are the chore wheel, which
is where onboarding puts a child's daily chores, read the way the wheel pays
them.

These hold the reading:

  * a chore sitting with this child is their job; a sibling's is not;
  * a chore finished today is done, with the stars it paid, and it stays on
    this child's list even once the wheel has turned it to the sibling —
    "1 of 3 done" must not shrink to "0 of 2" the moment a job is ticked;
  * yesterday's completion is not today's;
  * "today" is the parent's today, in the zone the request names;
  * another household's child is a 404, never a list.

Run with:  python3 -m pytest tests/test_a_childs_page_shows_todays_jobs.py -q
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
    from fastapi import HTTPException

PARENT = {"user_id": "u_parent", "family_id": "fam", "email": "parent@example.com", "name": "Jordan"}
OTHER = {"user_id": "u_other", "family_id": "fam_other", "email": "other@example.com", "name": "Sam"}


@unittest.skipUnless(HAVE, "backend deps not installed")
class AChildsJobsToday(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.go(self.db["family_members"].insert_one(
            {"family_id": "fam", "member_id": "m_ama", "name": "Ama", "role": "child", "stars": 54}))
        self.go(self.db["family_members"].insert_one(
            {"family_id": "fam", "member_id": "m_leo", "name": "Leo", "role": "child", "stars": 12}))

    def go(self, coro):
        return asyncio.run(coro)

    def chore(self, chore_id, title, assignee, stars=2, members=None, rotate=True):
        self.go(self.db["chores"].insert_one({
            "chore_id": chore_id, "family_id": "fam", "title": title, "frequency": "daily",
            "assigned_members": members or [assignee], "current_assignee": assignee,
            "rotate": rotate, "star_reward": stars, "icon": "bed",
            "created_at": datetime(2026, 10, 1, tzinfo=timezone.utc)}))

    def earlier_today(self, hours=0, minutes=0, zone="UTC"):
        """A moment already past that is still today in the request's zone.

        "Two hours ago" is yesterday when the suite runs just after midnight,
        which is not what these tests mean by "this morning". Clamped to the
        start of today, which the endpoint counts as today.
        """
        now = server.utcnow()
        day_start = (server._local_now(zone, now)
                     .replace(hour=0, minute=0, second=0, microsecond=0)
                     .astimezone(timezone.utc))
        return max(now - timedelta(hours=hours, minutes=minutes), day_start)

    def log(self, chore_id, member_id, when, stars=2):
        self.go(self.db["chore_logs"].insert_one({
            "log_id": f"clog_{chore_id}_{member_id}", "chore_id": chore_id, "family_id": "fam",
            "member_id": member_id, "completed_at": when, "stars_awarded": stars}))

    def jobs(self, member_id="m_ama", zone="UTC", user=PARENT):
        return self.go(server.member_jobs_today(member_id, zone, user=user, database=self.db))

    def test_a_chore_sitting_with_the_child_is_their_job(self):
        self.chore("c_bed", "Make bed", "m_ama")
        self.chore("c_table", "Set table", "m_ama", stars=3)
        self.chore("c_bins", "Bins", "m_leo")
        out = self.jobs()
        self.assertEqual([j["title"] for j in out["jobs"]], ["Make bed", "Set table"])
        self.assertEqual((out["done"], out["total"]), (0, 2))
        self.assertEqual(out["jobs"][1]["star_reward"], 3)
        self.assertFalse(out["jobs"][0]["done"])

    def test_a_chore_finished_today_is_done_with_what_it_paid(self):
        self.chore("c_bed", "Make bed", "m_ama")
        self.chore("c_read", "Read 20 min", "m_ama", stars=3)
        self.log("c_bed", "m_ama", self.earlier_today(minutes=5))
        out = self.jobs()
        done = [j for j in out["jobs"] if j["done"]]
        self.assertEqual([j["title"] for j in done], ["Make bed"])
        self.assertEqual(done[0]["stars_awarded"], 2)
        self.assertEqual((out["done"], out["total"]), (1, 2))

    def test_a_done_job_stays_on_the_list_after_the_wheel_turns(self):
        # Finished by Ama this morning; the wheel has moved it to Leo since.
        self.chore("c_bed", "Make bed", "m_leo", members=["m_ama", "m_leo"])
        self.chore("c_read", "Read 20 min", "m_ama")
        self.log("c_bed", "m_ama", self.earlier_today(hours=2))
        out = self.jobs()
        self.assertEqual(sorted(j["title"] for j in out["jobs"]), ["Make bed", "Read 20 min"])
        self.assertEqual((out["done"], out["total"]), (1, 2))
        # and Leo, who holds it now, sees it as his, not done
        leo = self.jobs("m_leo")
        self.assertEqual([(j["title"], j["done"]) for j in leo["jobs"]], [("Make bed", False)])

    def test_yesterdays_completion_is_not_todays(self):
        self.chore("c_bed", "Make bed", "m_ama")
        self.log("c_bed", "m_ama", server.utcnow() - timedelta(days=1, hours=1))
        out = self.jobs()
        self.assertEqual((out["done"], out["total"]), (0, 1))

    def test_a_siblings_completion_does_not_count_for_this_child(self):
        self.chore("c_bed", "Make bed", "m_ama")
        self.log("c_bed", "m_leo", self.earlier_today(minutes=5))
        out = self.jobs()
        self.assertEqual((out["done"], out["total"]), (0, 1))

    def test_today_is_the_parents_today(self):
        # 01:00 in Tokyo is still yesterday evening in UTC. A job finished at
        # 23:30 Tokyo time last night is yesterday's in Tokyo and today's in
        # Greenwich; the parent in Tokyo should see it as yesterday's.
        self.chore("c_bed", "Make bed", "m_ama")
        now = server.utcnow()
        tokyo_midnight_utc = (server._local_now("Asia/Tokyo", now)
                              .replace(hour=0, minute=0, second=0, microsecond=0)
                              .astimezone(timezone.utc))
        self.log("c_bed", "m_ama", tokyo_midnight_utc - timedelta(minutes=30))
        self.assertEqual(self.jobs(zone="Asia/Tokyo")["done"], 0)
        self.assertEqual(self.jobs(zone="Asia/Tokyo")["total"], 1)

    def test_still_to_do_come_first(self):
        self.chore("c_bed", "Make bed", "m_ama")
        self.chore("c_read", "Read 20 min", "m_ama")
        self.chore("c_table", "Set table", "m_ama")
        self.log("c_bed", "m_ama", self.earlier_today(minutes=5))
        self.assertEqual([j["title"] for j in self.jobs()["jobs"]], ["Read 20 min", "Set table", "Make bed"])

    def test_another_households_child_is_not_found(self):
        self.chore("c_bed", "Make bed", "m_ama")
        with self.assertRaises(HTTPException) as caught:
            self.jobs(user=OTHER)
        self.assertEqual(caught.exception.status_code, 404)

    def test_a_child_with_no_jobs_gets_an_empty_list(self):
        self.assertEqual(self.jobs(), {"jobs": [], "done": 0, "total": 0})


if __name__ == "__main__":
    unittest.main()
