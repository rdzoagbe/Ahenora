"""The kids' funnel on the Usage page counts the wedge honestly.

Ahenora is sold on chores the kids want to finish. Since October 2026 the
store listings, the setup step and the trial thank-you all lead with the
children, and this read-out is what says whether that pitch works: of the
households created in the window, how many named a child, gave a first star,
saw a chore finished, were still there in week two, and pay.

Each step is a subset of the one before. A grown-up's star is not a child's,
a household too young for a week two is neither a success nor a failure, and
nothing from outside the window or another household counts.

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
    from fastapi import HTTPException
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase

ADMIN_EMAIL = "boss@ahenora.com"
ADMIN = {"user_id": "u_admin", "family_id": "famA", "email": ADMIN_EMAIL}


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheKidsFunnel(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db, self._admins = server.get_db, server.ADMIN_EMAILS
        server.get_db = lambda: self.db
        server.ADMIN_EMAILS = {ADMIN_EMAIL}
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins

    def family(self, fid, age_days, plan="village"):
        created = self.now - timedelta(days=age_days)
        run(self.db["families"].insert_one({"family_id": fid, "plan": plan, "created_at": created}))
        return created

    def member(self, fid, mid, role):
        run(self.db["family_members"].insert_one(
            {"family_id": fid, "member_id": mid, "name": mid, "role": role}))

    def star(self, fid, mid, delta=1):
        run(self.db["star_transactions"].insert_one(
            {"family_id": fid, "member_id": mid, "delta": delta, "created_at": self.now}))

    def chore(self, fid, mid):
        run(self.db["chore_logs"].insert_one(
            {"family_id": fid, "member_id": mid, "completed_at": self.now}))

    def adult(self, fid, uid, last_active):
        run(self.db["users"].insert_one(
            {"user_id": uid, "family_id": fid, "email": f"{uid}@x.test",
             "created_at": self.now, "last_active_at": last_active}))

    def funnel(self, days=30):
        return run(server.metrics_kids_funnel(days=days, user=dict(ADMIN), database=self.db))

    def test_only_an_admin_may_read_it(self):
        with self.assertRaises(HTTPException) as caught:
            run(server.metrics_kids_funnel(
                days=30, user={"user_id": "u", "family_id": "f", "email": "parent@x.test"},
                database=self.db))
        self.assertEqual(caught.exception.status_code, 403)

    def test_an_empty_month_is_all_zeros(self):
        self.assertEqual(self.funnel(), {
            "window_days": 30, "new_households": 0, "with_children": 0, "first_star": 0,
            "chore_done": 0, "week_two_eligible": 0, "week_two_active": 0, "paying": 0})

    def test_each_step_is_a_subset_of_the_one_before(self):
        # Six households this month, each stopping one step further along.
        self.family("f_couple", 10)                      # no children
        self.family("f_named", 10); self.member("f_named", "k1", "child")
        self.family("f_star", 10); self.member("f_star", "k2", "Child"); self.star("f_star", "k2")
        made = self.family("f_chore", 3)                 # too young for a week two
        self.member("f_chore", "k3", "teen"); self.star("f_chore", "k3", 3); self.chore("f_chore", "k3")
        made = self.family("f_gone", 12)                 # old enough, nobody came back
        self.member("f_gone", "k4", "child"); self.star("f_gone", "k4"); self.chore("f_gone", "k4")
        self.adult("f_gone", "u4", made + timedelta(days=2))
        made = self.family("f_back", 12)                 # came back in week two, still Free
        self.member("f_back", "k5", "child"); self.star("f_back", "k5"); self.chore("f_back", "k5")
        self.adult("f_back", "u5", made + timedelta(days=9))
        made = self.family("f_paid", 20, plan="executive")
        self.member("f_paid", "k6", "child"); self.star("f_paid", "k6"); self.chore("f_paid", "k6")
        self.adult("f_paid", "u6", self.now)

        self.assertEqual(self.funnel(), {
            "window_days": 30, "new_households": 7, "with_children": 6, "first_star": 5,
            "chore_done": 4, "week_two_eligible": 3, "week_two_active": 2, "paying": 1})

    def test_a_grown_ups_star_is_not_a_childs(self):
        self.family("f1", 5)
        self.member("f1", "kid", "child")
        self.member("f1", "dad", "Parent")
        self.star("f1", "dad", 5)
        self.chore("f1", "dad")
        self.assertEqual(self.funnel()["first_star"], 0)
        self.assertEqual(self.funnel()["chore_done"], 0)

    def test_a_spent_star_is_not_a_first_star(self):
        self.family("f1", 5)
        self.member("f1", "kid", "child")
        self.star("f1", "kid", -2)
        self.assertEqual(self.funnel()["first_star"], 0)

    def test_an_old_household_and_another_households_rows_do_not_count(self):
        self.family("f_old", 45)                         # before the window
        self.member("f_old", "k", "child"); self.star("f_old", "k")
        self.family("f_new", 5)
        self.member("f_new", "k", "child")
        self.star("f_other", "k")                        # a stranger's row with the same member id
        self.chore("f_other", "k")
        got = self.funnel()
        self.assertEqual((got["new_households"], got["with_children"], got["first_star"]), (1, 1, 0))
        self.assertEqual(self.funnel(days=60)["first_star"], 1, "widening the window brings the old one in")

    def test_a_paying_household_still_has_to_have_come_back(self):
        # Plan is a current fact; the funnel reads it only for households that
        # walked the whole path, so a family that bought on day one and never
        # finished a chore is not credited to the wedge.
        self.family("f_bought", 10, plan="duo")
        self.member("f_bought", "k", "child")
        self.adult("f_bought", "u", self.now)
        self.assertEqual(self.funnel()["paying"], 0)


if __name__ == "__main__":
    unittest.main()
