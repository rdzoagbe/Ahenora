"""A child sees their chore-wheel jobs in kid mode, and ticking one waits for a grown-up.

Kid mode used to show only tasks with the child's name on them. The daily
jobs onboarding sets up for a child (bed, table, homework) live on the chore
wheel, so a child holding the phone saw "nothing to do" while their parent's
page listed three jobs. These hold the new rules:

  * the child's home lists their jobs today, done ones with what they paid;
  * a sibling's job never reaches their screen;
  * ticking one pays nothing: it waits in the parents' approval list, the
    same rule as a finished task, and a double tap queues it once;
  * approving pays what the parent chose, logs it done today and turns the
    wheel; declining pays nothing;
  * a parent ticking the job themselves settles the waiting tick, so it can
    never be paid twice;
  * a child cannot tick a job that is not sitting with them.

Run with:  python3 -m unittest tests.test_a_child_ticks_their_own_jobs -v
"""
import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone

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

ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}


@unittest.skipUnless(HAVE, "backend deps not installed")
class AChildTicksTheirOwnJobs(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        server._auth_fail.clear()
        self.go(self.db["users"].insert_one({**ROLAND, "language": "en"}))
        self.go(self.db["family_members"].insert_one({
            "member_id": "m_parent", "family_id": "fam1", "user_id": "u_r",
            "name": "Roland", "role": "Parent", "stars": 0, "pin_hash": server.sha256("9999")}))
        self.go(self.db["family_members"].insert_one({
            "member_id": "m_ama", "family_id": "fam1", "name": "Ama",
            "role": "Child", "stars": 20, "pin_hash": server.sha256("1234")}))
        self.go(self.db["family_members"].insert_one({
            "member_id": "m_leo", "family_id": "fam1", "name": "Leo",
            "role": "Child", "stars": 5, "pin_hash": server.sha256("4321")}))
        self.chore("c_bed", "Make bed", "m_ama", members=["m_ama", "m_leo"])
        self.chore("c_bins", "Bins", "m_leo")

    def tearDown(self):
        server.get_db = self._get_db

    def go(self, coro):
        return asyncio.run(coro)

    def chore(self, chore_id, title, assignee, stars=2, members=None):
        self.go(self.db["chores"].insert_one({
            "chore_id": chore_id, "family_id": "fam1", "title": title, "frequency": "daily",
            "assigned_members": members or [assignee], "current_assignee": assignee,
            "rotate": True, "star_reward": stars, "icon": "bed",
            "created_at": datetime(2026, 10, 1, tzinfo=timezone.utc)}))

    def child(self, member="m_ama", pin="1234"):
        token = self.go(server.start_kid_session(
            server.ChildSessionIn(member_id=member, pin=pin), user=dict(ROLAND)))["session_token"]
        return self.go(server.require_child(authorization=f"Bearer {token}"))

    def home(self, child):
        return self.go(server.kid_home("UTC", child=child))

    def stars(self, member="m_ama"):
        return self.go(self.db["family_members"].find_one({"member_id": member}))["stars"]

    def approvals(self):
        return self.go(server.teen_approvals(user=dict(ROLAND)))["approvals"]

    def test_the_childs_home_lists_their_jobs_and_not_a_siblings(self):
        jobs = self.home(self.child())["jobs"]
        self.assertEqual([(j["title"], j["done"], j["waiting"]) for j in jobs], [("Make bed", False, False)])
        self.assertEqual(jobs[0]["star_reward"], 2)

    def test_ticking_a_job_pays_nothing_and_waits_for_a_grown_up(self):
        ama = self.child()
        out = self.go(server.kid_finish_job("c_bed", child=ama))
        self.assertTrue(out["awaiting_approval"])
        self.assertEqual(self.stars(), 20)
        self.assertEqual([r["card_id"] for r in self.approvals()], ["job:c_bed"])
        self.assertEqual(self.approvals()[0]["who"], "Ama")
        job = self.home(ama)["jobs"][0]
        self.assertTrue(job["waiting"])
        self.assertFalse(job["done"])

    def test_a_double_tap_queues_it_once(self):
        ama = self.child()
        self.go(server.kid_finish_job("c_bed", child=ama))
        self.go(server.kid_finish_job("c_bed", child=ama))
        self.assertEqual(len(self.approvals()), 1)

    def test_approving_pays_what_the_parent_chose_and_turns_the_wheel(self):
        ama = self.child()
        self.go(server.kid_finish_job("c_bed", child=ama))
        self.go(server.resolve_teen_approval(
            "job:c_bed", server.TeenApprovalIn(approve=True, stars=3), user=dict(ROLAND)))
        self.assertEqual(self.stars(), 23)
        self.assertEqual(self.approvals(), [])
        chore = self.go(self.db["chores"].find_one({"chore_id": "c_bed"}))
        self.assertEqual(chore["current_assignee"], "m_leo")
        job = self.home(ama)["jobs"][0]
        self.assertEqual((job["title"], job["done"], job["stars_awarded"]), ("Make bed", True, 3))

    def test_approving_twice_cannot_pay_twice(self):
        self.go(server.kid_finish_job("c_bed", child=self.child()))
        self.go(server.resolve_teen_approval(
            "job:c_bed", server.TeenApprovalIn(approve=True, stars=3), user=dict(ROLAND)))
        with self.assertRaises(server.HTTPException):
            self.go(server.resolve_teen_approval(
                "job:c_bed", server.TeenApprovalIn(approve=True, stars=3), user=dict(ROLAND)))
        self.assertEqual(self.stars(), 23)

    def test_declining_pays_nothing(self):
        ama = self.child()
        self.go(server.kid_finish_job("c_bed", child=ama))
        self.go(server.resolve_teen_approval(
            "job:c_bed", server.TeenApprovalIn(approve=False), user=dict(ROLAND)))
        self.assertEqual(self.stars(), 20)
        self.assertEqual(self.approvals(), [])
        self.assertFalse(self.home(ama)["jobs"][0]["waiting"])

    def test_a_parents_own_tick_settles_the_waiting_one(self):
        self.go(server.kid_finish_job("c_bed", child=self.child()))
        self.go(server.complete_chore("c_bed", user=dict(ROLAND), database=self.db))
        self.assertEqual(self.approvals(), [])
        with self.assertRaises(server.HTTPException):
            self.go(server.resolve_teen_approval(
                "job:c_bed", server.TeenApprovalIn(approve=True, stars=5), user=dict(ROLAND)))
        self.assertEqual(self.stars(), 22)  # the job's own 2 stars, once

    def test_a_child_cannot_tick_a_job_that_is_not_theirs(self):
        with self.assertRaises(server.HTTPException) as e:
            self.go(server.kid_finish_job("c_bins", child=self.child()))
        self.assertEqual(e.exception.status_code, 403)
        self.assertEqual(self.approvals(), [])

    def test_another_households_job_is_not_found(self):
        self.go(self.db["chores"].insert_one({
            "chore_id": "c_other", "family_id": "fam2", "title": "Theirs",
            "current_assignee": "m_ama", "assigned_members": ["m_ama"], "star_reward": 9}))
        with self.assertRaises(server.HTTPException) as e:
            self.go(server.kid_finish_job("c_other", child=self.child()))
        self.assertEqual(e.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
