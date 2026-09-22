"""Every upgrade wall the app puts up leaves a trace, and the trace is readable.

Sixteen places in the backend tell a household "upgrade to do this". Not one of
them recorded anything, so the most important pricing question — of the walls
we built, which do real families actually walk into? — had no answer, and every
change to the paid line was guesswork.

Two halves are pinned here. The recording must never stand between a caller and
its 402: measuring is not allowed to change behaviour, so a missing database, a
missing loop or a failed write costs a data point and nothing else. And the
read-out must say whether the walls were even switched on, because while no
paid rail is configured every family gets the top tier's limits, no gate can
fire, and an empty table then means "off", not "nobody wants to pay". Those are
opposite conclusions from identical data.
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
    from fastapi import HTTPException


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AWallLeavesATrace(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def _walls(self):
        return asyncio.run(self._read())

    async def _read(self):
        return [r async for r in self.db["plan_walls"].find({}, {"_id": 0})]

    async def _hit(self, **kwargs):
        """Raise a wall the way a request handler does, then let the recording
        finish. The write is deliberately scheduled rather than awaited, so a
        test that checks immediately would be racing it."""
        with self.assertRaises(HTTPException) as caught:
            server.plan_limit_error(**kwargs)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        return caught.exception

    # --- the 402 is never at risk -------------------------------------------

    def test_the_caller_still_gets_its_402(self):
        err = asyncio.run(self._hit(
            feature="ai_scans", current_plan="village", message="Out of scans.",
            limit=10, used=10, family_id="fam1"))
        self.assertEqual(err.status_code, 402)
        self.assertEqual(err.detail["feature"], "ai_scans")
        self.assertEqual(err.detail["message"], "Out of scans.")

    def test_a_wall_without_a_family_still_raises(self):
        """Nothing to record is not a reason to let somebody through."""
        with self.assertRaises(HTTPException) as caught:
            server.plan_limit_error(
                feature="meal_planner", current_plan="village", message="Premium.")
        self.assertEqual(caught.exception.status_code, 402)
        self.assertEqual(self._walls(), [], "no family, nothing to record")

    def test_a_broken_database_costs_a_data_point_and_nothing_else(self):
        def explode():
            raise RuntimeError("database is gone")
        server.get_db = explode

        async def attempt():
            with self.assertRaises(HTTPException) as caught:
                server.plan_limit_error(
                    feature="ai_scans", current_plan="village", message="Out.",
                    family_id="fam1")
            # Let the detached write run and fail on its own.
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            return caught.exception
        self.assertEqual(asyncio.run(attempt()).status_code, 402)

    def test_no_running_loop_does_not_break_the_gate(self):
        """Called from synchronous code there is no loop to schedule on. The
        wall must still go up."""
        with self.assertRaises(HTTPException) as caught:
            server.plan_limit_error(
                feature="vault_storage", current_plan="village", message="Full.",
                family_id="fam1")
        self.assertEqual(caught.exception.status_code, 402)

    # --- what gets recorded --------------------------------------------------

    def test_the_wall_records_which_one_and_whose(self):
        asyncio.run(self._hit(
            feature="max_children", current_plan="village", message="Upgrade.",
            limit=2, used=2, family_id="fam1"))
        rows = self._walls()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["feature"], "max_children")
        self.assertEqual(rows[0]["family_id"], "fam1")
        self.assertEqual(rows[0]["plan"], "village")
        self.assertEqual(rows[0]["limit"], 2)
        self.assertEqual(rows[0]["hits"], 1)
        self.assertEqual(rows[0]["date"], server.utcnow().strftime("%Y-%m-%d"))

    def test_hitting_the_same_wall_twice_counts_twice_in_one_row(self):
        """One row per family per feature per day. A row per hit grows without
        bound and answers nothing extra."""
        async def twice():
            await self._hit(feature="ai_scans", current_plan="village",
                            message="Out.", family_id="fam1")
            await self._hit(feature="ai_scans", current_plan="village",
                            message="Out.", family_id="fam1")
        asyncio.run(twice())
        rows = self._walls()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["hits"], 2)

    def test_different_walls_and_different_households_stay_apart(self):
        async def several():
            await self._hit(feature="ai_scans", current_plan="village",
                            message="Out.", family_id="fam1")
            await self._hit(feature="vault_storage", current_plan="village",
                            message="Full.", family_id="fam1")
            await self._hit(feature="ai_scans", current_plan="village",
                            message="Out.", family_id="fam2")
        asyncio.run(several())
        self.assertEqual(len(self._walls()), 3)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheReadOutSaysWhatItMeans(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admin = server.is_admin_user
        server.is_admin_user = lambda u: bool(u.get("admin"))
        self._live = server.billing_is_live
        server.billing_is_live = lambda: True
        self.admin = {"user_id": "u_a", "family_id": "fam0", "admin": True}

        async def seed():
            for fam, plan in (("fam1", "village"), ("fam2", "executive"),
                              ("fam3", "village")):
                await self.db["families"].insert_one({"family_id": fam, "plan": plan})
            today = server.utcnow().strftime("%Y-%m-%d")
            long_ago = (server.utcnow() - server.timedelta(days=200)).strftime("%Y-%m-%d")
            rows = [
                ("fam1", "ai_scans", today, 5),
                ("fam2", "ai_scans", today, 3),
                ("fam3", "max_children", today, 1),
                # Outside a 30-day window: must not be counted there.
                ("fam1", "meal_planner", long_ago, 9),
            ]
            for fam, feature, date, hits in rows:
                await self.db["plan_walls"].insert_one(
                    {"family_id": fam, "feature": feature, "date": date,
                     "hits": hits, "plan": "village"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.is_admin_user = self._admin
        server.billing_is_live = self._live

    def _read(self, days=30):
        return asyncio.run(server.metrics_paywall(
            days=days, user=dict(self.admin), database=self.db))

    def test_it_is_admin_only(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.metrics_paywall(
                days=30, user={"user_id": "u_x", "family_id": "fam1"}, database=self.db))
        self.assertEqual(caught.exception.status_code, 403)

    def test_it_says_whether_the_walls_are_even_switched_on(self):
        """Without this, an empty table reads as 'nobody wants to pay' when it
        actually means 'no gate can fire'."""
        self.assertTrue(self._read()["paywall_live"])
        server.billing_is_live = lambda: False
        self.assertFalse(self._read()["paywall_live"])

    def test_the_most_hit_wall_comes_first(self):
        walls = self._read()["walls"]
        self.assertEqual(walls[0]["feature"], "ai_scans")
        self.assertEqual(walls[0]["hits"], 8)
        self.assertEqual(walls[0]["households"], 2)

    def test_it_says_how_many_who_hit_a_wall_now_pay(self):
        """A wall many households reach and none pay past is a wall in the
        wrong place — which is the whole reason to look."""
        scans = next(w for w in self._read()["walls"] if w["feature"] == "ai_scans")
        self.assertEqual(scans["households_now_paying"], 1, "fam2 is on a paid plan")

    def test_the_window_is_respected(self):
        features = [w["feature"] for w in self._read(days=30)["walls"]]
        self.assertNotIn("meal_planner", features, "200 days ago is not this month")
        self.assertIn("meal_planner", [w["feature"] for w in self._read(days=365)["walls"]])

    def test_the_totals_let_the_walls_be_read_against_the_whole_base(self):
        out = self._read()
        self.assertEqual(out["households_hitting_any_wall"], 3)
        self.assertEqual(out["households_total"], 3)
        self.assertEqual(out["households_paying"], 1)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class EveryWallIsInstrumented(unittest.TestCase):
    def test_no_call_site_forgets_to_say_whose_wall_it_is(self):
        """A wall raised without a family_id is invisible, and an invisible
        wall is the bug this whole change exists to fix. Pinned against the
        source so the next one added cannot quietly skip it."""
        import re
        path = os.path.join(os.path.dirname(__file__), "..", "backend", "server.py")
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        missing = []
        for i, line in enumerate(lines):
            if re.fullmatch(r"\s*plan_limit_error\($", line):
                block = "\n".join(lines[i:i + 10])
                if "family_id=" not in block.split("plan_limit_error(")[1].split(")")[0]:
                    missing.append(i + 1)
        self.assertEqual(missing, [], f"plan_limit_error without family_id at {missing}")

    def test_there_are_still_as_many_walls_as_we_think(self):
        import re
        path = os.path.join(os.path.dirname(__file__), "..", "backend", "server.py")
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        calls = [l for l in lines if re.fullmatch(r"\s*plan_limit_error\($", l)]
        self.assertEqual(len(calls), 15, "the number of upgrade walls changed — "
                                         "check the pricing read-out still covers them")


if __name__ == "__main__":
    unittest.main()
