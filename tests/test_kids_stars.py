"""Tests for the star economy: the ledger and concurrent updates.

An audit found that redeeming a reward moved a child's balance without writing
anything to the star ledger, and that both star endpoints used a
read-modify-write pattern that let two concurrent requests double-spend or
lose an update. These drive the real FastAPI handlers against an in-memory
Mongo stand-in that implements the filter semantics the fixes rely on.

Skipped where backend dependencies are not installed (Backend CI runs
stdlib-only); runs wherever `pip install -r backend/requirements.txt` has been.
"""

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    os.environ.setdefault("GOOGLE_API_KEY", "test-key-not-real")
    import server
    from fastapi import HTTPException


class FakeCollection:
    """Enough Mongo to exercise guarded updates: $gte filters and $inc."""

    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def _matches(self, row, query):
        for key, cond in query.items():
            value = row.get(key)
            if isinstance(cond, dict):
                if "$gte" in cond and not (value is not None and value >= cond["$gte"]):
                    return False
            elif value != cond:
                return False
        return True

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if self._matches(row, query):
                return dict(row)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return type("R", (), {"inserted_id": doc.get("_id")})()

    async def update_one(self, query, update):
        # Yield control first, so concurrent callers genuinely interleave the
        # way they would against a real database.
        await asyncio.sleep(0)
        for row in self.rows:
            if self._matches(row, query):
                for field, amount in (update.get("$inc") or {}).items():
                    row[field] = row.get(field, 0) + amount
                for field, value in (update.get("$set") or {}).items():
                    row[field] = value
                return type("R", (), {"matched_count": 1, "modified_count": 1})()
        return type("R", (), {"matched_count": 0, "modified_count": 0})()

    async def delete_one(self, query):
        for index, row in enumerate(self.rows):
            if self._matches(row, query):
                del self.rows[index]
                return type("R", (), {"deleted_count": 1})()
        return type("R", (), {"deleted_count": 0})()

    async def delete_many(self, query):
        keep = [r for r in self.rows if not self._matches(r, query)]
        removed = len(self.rows) - len(keep)
        self.rows[:] = keep
        return type("R", (), {"deleted_count": removed})()

    def find(self, query=None, projection=None):
        rows = [r for r in self.rows if self._matches(r, query or {})]

        class _Cursor:
            def sort(self, *a, **k):
                return self

            def limit(self, *a, **k):
                return self

            async def to_list(self, n=None):
                return [dict(r) for r in rows]

            def __aiter__(self):
                async def gen():
                    for r in rows:
                        yield dict(r)
                return gen()

        return _Cursor()


class FakeDB:
    def __init__(self, **collections):
        self.collections = {name: FakeCollection(rows) for name, rows in collections.items()}

    def __getitem__(self, name):
        return self.collections.setdefault(name, FakeCollection())


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class StarEconomy(unittest.TestCase):
    USER = {"family_id": "fam1", "user_id": "u1", "name": "Parent", "role": "parent"}

    def setUp(self):
        self._get_db = server.get_db
        self._alert = server.send_star_milestone_alert

        async def _no_alert(*a, **k):
            return None

        server.send_star_milestone_alert = _no_alert

    def tearDown(self):
        server.get_db = self._get_db
        server.send_star_milestone_alert = self._alert

    def _install(self, stars=100, cost=60):
        db = FakeDB(
            family_members=[{"member_id": "kid1", "family_id": "fam1", "name": "Kid",
                             "role": "child", "stars": stars}],
            rewards=[{"reward_id": "r1", "family_id": "fam1", "title": "Movie night",
                      "cost_stars": cost}],
            star_transactions=[],
        )
        server.get_db = lambda: db
        return db

    def _redeem(self, db):
        payload = type("P", (), {"member_id": "kid1"})()
        return server.redeem_reward("r1", payload, user=self.USER)

    # ---- the ledger bug -------------------------------------------------

    def test_redeeming_writes_a_ledger_entry(self):
        # The bug: the balance dropped but star_transactions stayed empty, so
        # the spend never showed in Recent Activity.
        db = self._install(stars=100, cost=60)
        asyncio.run(self._redeem(db))

        self.assertEqual(db["family_members"].rows[0]["stars"], 40)
        ledger = db["star_transactions"].rows
        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger[0]["delta"], -60)
        self.assertEqual(ledger[0]["member_id"], "kid1")
        self.assertIn("Movie night", ledger[0]["reason"])

    def test_ledger_reconciles_with_the_balance(self):
        # Awards minus spends must equal the balance — the property that broke
        # when redemptions were invisible to the ledger.
        db = self._install(stars=100, cost=60)
        asyncio.run(self._redeem(db))
        total = sum(t["delta"] for t in db["star_transactions"].rows)
        self.assertEqual(100 + total, db["family_members"].rows[0]["stars"])

    # ---- the concurrency bugs -------------------------------------------

    def test_two_redeems_cannot_both_spend_the_same_stars(self):
        # The bug: both passed the balance check, both decremented, balance -60.
        db = self._install(stars=60, cost=60)

        async def race():
            return await asyncio.gather(
                self._redeem(db), self._redeem(db), return_exceptions=True
            )

        results = asyncio.run(race())
        ok = [r for r in results if not isinstance(r, Exception)]
        failed = [r for r in results if isinstance(r, HTTPException)]

        self.assertEqual(len(ok), 1, "exactly one redeem should succeed")
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0].status_code, 400)
        self.assertEqual(db["family_members"].rows[0]["stars"], 0)
        self.assertGreaterEqual(db["family_members"].rows[0]["stars"], 0)
        self.assertEqual(len(db["star_transactions"].rows), 1)

    def test_concurrent_removals_do_not_lose_an_update(self):
        # The bug: from 10, two concurrent -8s both read 10 and both wrote 2,
        # so one removal vanished. Now one wins and the other is rejected.
        db = self._install(stars=10, cost=60)
        payload = type("P", (), {"delta": -8, "reason": "Tidy up"})()

        async def race():
            return await asyncio.gather(
                server.adjust_member_stars("kid1", payload, user=self.USER),
                server.adjust_member_stars("kid1", payload, user=self.USER),
                return_exceptions=True,
            )

        results = asyncio.run(race())
        ok = [r for r in results if not isinstance(r, Exception)]
        self.assertEqual(len(ok), 1)
        self.assertEqual(db["family_members"].rows[0]["stars"], 2)
        self.assertGreaterEqual(db["family_members"].rows[0]["stars"], 0)

    def test_concurrent_awards_both_count(self):
        # Awards have no floor to guard, but the lost-update bug applied to
        # them too: two +5s must leave +10, not +5.
        db = self._install(stars=0, cost=60)
        payload = type("P", (), {"delta": 5, "reason": "Helped out"})()

        async def race():
            return await asyncio.gather(
                server.adjust_member_stars("kid1", payload, user=self.USER),
                server.adjust_member_stars("kid1", payload, user=self.USER),
            )

        asyncio.run(race())
        self.assertEqual(db["family_members"].rows[0]["stars"], 10)
        self.assertEqual(len(db["star_transactions"].rows), 2)

    def test_cannot_redeem_more_than_the_balance(self):
        db = self._install(stars=10, cost=60)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(self._redeem(db))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(db["family_members"].rows[0]["stars"], 10)
        self.assertEqual(db["star_transactions"].rows, [])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ChoresAndRoutinesAwardStars(unittest.TestCase):
    """Finishing a chore or a routine used to earn nothing but a toast, leaving
    them outside the star economy they were meant to feed."""

    USER = {"family_id": "fam1", "user_id": "u1", "name": "Parent", "role": "parent"}

    def setUp(self):
        self._get_db = server.get_db

    def tearDown(self):
        server.get_db = self._get_db

    def _db(self, members=None, chores=None, routines=None):
        db = FakeDB(
            family_members=members if members is not None else [
                {"member_id": "kid1", "family_id": "fam1", "name": "Ama", "role": "child", "stars": 0},
                {"member_id": "kid2", "family_id": "fam1", "name": "Kofi", "role": "child", "stars": 0},
            ],
            chores=chores or [],
            routines=routines or [],
            star_transactions=[],
            chore_logs=[],
            routine_logs=[],
        )
        server.get_db = lambda: db
        return db

    def _stars(self, db, member_id):
        return next(m["stars"] for m in db["family_members"].rows if m["member_id"] == member_id)

    # ---- chores ---------------------------------------------------------

    def test_completing_a_chore_pays_the_child_who_did_it_then_rotates(self):
        db = self._db(chores=[{
            "chore_id": "c1", "family_id": "fam1", "title": "Bins out", "frequency": "weekly",
            "assigned_members": ["kid1", "kid2"], "current_assignee": "kid1",
            "rotate": True, "star_reward": 5, "created_at": server.utcnow(),
        }])
        result = asyncio.run(server.complete_chore("c1", user=self.USER, database=db))

        # Paid the doer, not the next child up.
        self.assertEqual(result["stars_awarded"], 5)
        self.assertEqual(self._stars(db, "kid1"), 5)
        self.assertEqual(self._stars(db, "kid2"), 0)
        # Then handed the chore on.
        self.assertEqual(db["chores"].rows[0]["current_assignee"], "kid2")

    def test_a_completed_chore_appears_in_the_ledger(self):
        db = self._db(chores=[{
            "chore_id": "c1", "family_id": "fam1", "title": "Bins out", "frequency": "weekly",
            "assigned_members": ["kid1"], "current_assignee": "kid1",
            "rotate": True, "star_reward": 5, "created_at": server.utcnow(),
        }])
        asyncio.run(server.complete_chore("c1", user=self.USER, database=db))
        ledger = db["star_transactions"].rows
        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger[0]["delta"], 5)
        self.assertEqual(ledger[0]["member_id"], "kid1")
        self.assertIn("Bins out", ledger[0]["reason"])

    def test_a_chore_sitting_with_a_parent_pays_nobody(self):
        # The wheel can include parents; paying a parent in stars would be odd.
        db = self._db(
            members=[{"member_id": "p1", "family_id": "fam1", "name": "Parent",
                      "role": "parent", "stars": 0}],
            chores=[{
                "chore_id": "c1", "family_id": "fam1", "title": "Bins out", "frequency": "weekly",
                "assigned_members": ["p1"], "current_assignee": "p1",
                "rotate": True, "star_reward": 5, "created_at": server.utcnow(),
            }])
        result = asyncio.run(server.complete_chore("c1", user=self.USER, database=db))
        self.assertEqual(result["stars_awarded"], 0)
        self.assertEqual(self._stars(db, "p1"), 0)
        self.assertEqual(db["star_transactions"].rows, [])

    def test_a_zero_star_chore_still_completes_and_rotates(self):
        db = self._db(chores=[{
            "chore_id": "c1", "family_id": "fam1", "title": "Tiny job", "frequency": "daily",
            "assigned_members": ["kid1", "kid2"], "current_assignee": "kid1",
            "rotate": True, "star_reward": 0, "created_at": server.utcnow(),
        }])
        result = asyncio.run(server.complete_chore("c1", user=self.USER, database=db))
        self.assertEqual(result["stars_awarded"], 0)
        self.assertEqual(db["chores"].rows[0]["current_assignee"], "kid2")
        self.assertEqual(db["star_transactions"].rows, [])

    def test_a_solo_chore_pays_but_does_not_rotate(self):
        db = self._db(chores=[{
            "chore_id": "c1", "family_id": "fam1", "title": "Feed cat", "frequency": "daily",
            "assigned_members": ["kid1"], "current_assignee": "kid1",
            "rotate": True, "star_reward": 3, "created_at": server.utcnow(),
        }])
        asyncio.run(server.complete_chore("c1", user=self.USER, database=db))
        self.assertEqual(self._stars(db, "kid1"), 3)
        self.assertEqual(db["chores"].rows[0]["current_assignee"], "kid1")

    # ---- routines -------------------------------------------------------

    def test_completing_a_routine_pays_its_child(self):
        db = self._db(routines=[{
            "routine_id": "r1", "family_id": "fam1", "name": "Bedtime",
            "steps": [{"label": "Teeth"}], "member_id": "kid1",
            "star_reward": 2, "created_at": server.utcnow(),
        }])
        result = asyncio.run(server.log_routine_completion("r1", user=self.USER, database=db))
        self.assertEqual(result["stars_awarded"], 2)
        self.assertEqual(self._stars(db, "kid1"), 2)
        self.assertEqual(len(db["routine_logs"].rows), 1)
        self.assertEqual(db["star_transactions"].rows[0]["reason"], "Bedtime")

    def test_a_routine_with_no_child_still_logs(self):
        db = self._db(routines=[{
            "routine_id": "r1", "family_id": "fam1", "name": "Tidy up",
            "steps": [], "member_id": None, "star_reward": 2,
            "created_at": server.utcnow(),
        }])
        result = asyncio.run(server.log_routine_completion("r1", user=self.USER, database=db))
        self.assertEqual(result["stars_awarded"], 0)
        self.assertEqual(len(db["routine_logs"].rows), 1)
        self.assertEqual(db["star_transactions"].rows, [])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ManagingAChild(unittest.TestCase):
    """A typo at setup used to be permanent short of deleting the child — which
    would have taken their stars with it — and a forgotten PIN locked them out
    of redeeming with no way back."""

    USER = {"family_id": "fam1", "user_id": "u1", "name": "Parent", "role": "parent"}
    OTHER = {"family_id": "fam2", "user_id": "u2", "name": "Stranger", "role": "parent"}

    def setUp(self):
        self._get_db = server.get_db

    def tearDown(self):
        server.get_db = self._get_db

    def _install(self, **over):
        row = {"member_id": "kid1", "family_id": "fam1", "name": "Ama",
               "role": "child", "stars": 40, "pin_hash": None}
        row.update(over)
        db = FakeDB(family_members=[row], star_transactions=[], redemptions=[])
        server.get_db = lambda: db
        return db

    def _patch(self, db, user=None, **fields):
        payload = type("P", (), {"name": None, "avatar": None, **fields})()
        return asyncio.run(server.update_family_member("kid1", payload, user=user or self.USER))

    def test_renaming_keeps_the_stars(self):
        # The reason this endpoint exists: the alternative was delete-and-recreate.
        db = self._install()
        result = self._patch(db, name="Amara")
        self.assertEqual(result["name"], "Amara")
        self.assertEqual(result["stars"], 40)
        self.assertEqual(db["family_members"].rows[0]["name"], "Amara")

    def test_a_blank_name_is_rejected(self):
        db = self._install()
        with self.assertRaises(HTTPException) as ctx:
            self._patch(db, name="   ")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(db["family_members"].rows[0]["name"], "Ama")

    def test_a_name_is_trimmed(self):
        db = self._install()
        self.assertEqual(self._patch(db, name="  Kofi  ")["name"], "Kofi")

    def test_an_absurd_name_is_rejected(self):
        db = self._install()
        with self.assertRaises(HTTPException):
            self._patch(db, name="x" * 200)

    def test_an_empty_patch_changes_nothing(self):
        db = self._install()
        self.assertEqual(self._patch(db)["name"], "Ama")
        self.assertEqual(db["family_members"].rows[0]["stars"], 40)

    def test_stars_cannot_be_set_through_this_endpoint(self):
        # Stars move through the audited endpoint that writes a ledger entry.
        # A silent $set here would break the balance the history explains.
        db = self._install()
        self._patch(db, name="Ama", stars=99999)
        self.assertEqual(db["family_members"].rows[0]["stars"], 40)
        self.assertEqual(db["star_transactions"].rows, [])

    def test_another_family_cannot_rename_a_child(self):
        db = self._install()
        with self.assertRaises(HTTPException) as ctx:
            self._patch(db, user=self.OTHER, name="Hacked")
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(db["family_members"].rows[0]["name"], "Ama")

    def test_a_forgotten_pin_can_be_cleared(self):
        db = self._install(pin_hash=server.sha256("1234"))
        result = asyncio.run(server.remove_member_pin("kid1", user=self.USER))
        self.assertFalse(result["has_pin"])
        self.assertIsNone(db["family_members"].rows[0]["pin_hash"])

    def test_clearing_a_pin_does_not_touch_the_stars(self):
        db = self._install(pin_hash=server.sha256("1234"))
        asyncio.run(server.remove_member_pin("kid1", user=self.USER))
        self.assertEqual(db["family_members"].rows[0]["stars"], 40)

    def test_another_family_cannot_clear_a_pin(self):
        db = self._install(pin_hash=server.sha256("1234"))
        with self.assertRaises(HTTPException):
            asyncio.run(server.remove_member_pin("kid1", user=self.OTHER))
        self.assertIsNotNone(db["family_members"].rows[0]["pin_hash"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class RedemptionFulfilment(unittest.TestCase):
    """Spending stars was the whole transaction; nobody tracked whether the
    reward was ever handed over. These cover the record, the settle, and the
    refund — including two parents tapping at the same moment."""

    USER = {"family_id": "fam1", "user_id": "u1", "name": "Parent", "role": "parent"}
    OTHER = {"family_id": "fam2", "user_id": "u2", "name": "Stranger", "role": "parent"}

    def setUp(self):
        self._get_db = server.get_db

    def tearDown(self):
        server.get_db = self._get_db

    def _install(self, stars=100, cost=60):
        db = FakeDB(
            family_members=[{"member_id": "kid1", "family_id": "fam1", "name": "Ama",
                             "role": "child", "stars": stars}],
            rewards=[{"reward_id": "r1", "family_id": "fam1", "title": "Cinema trip",
                      "cost_stars": cost, "icon": "🎬"}],
            star_transactions=[],
            redemptions=[],
        )
        server.get_db = lambda: db
        return db

    def _redeem(self, db):
        payload = type("P", (), {"member_id": "kid1"})()
        return asyncio.run(server.redeem_reward("r1", payload, user=self.USER))

    def _only(self, db):
        return db["redemptions"].rows[0]

    # ---- the record -----------------------------------------------------

    def test_redeeming_records_something_still_owed(self):
        db = self._install()
        result = self._redeem(db)

        self.assertEqual(len(db["redemptions"].rows), 1)
        row = self._only(db)
        self.assertEqual(row["status"], "pending")
        self.assertEqual(row["member_id"], "kid1")
        self.assertEqual(row["cost_stars"], 60)
        self.assertIsNone(row["fulfilled_at"])
        # The caller gets it back so the UI can show it without a refetch.
        self.assertEqual(result["redemption"]["redemption_id"], row["redemption_id"])

    def test_the_promise_survives_the_reward_being_renamed_or_deleted(self):
        # The title is copied, not looked up: what a child paid for should not
        # change or vanish underneath them.
        db = self._install()
        self._redeem(db)
        db["rewards"].rows.clear()

        rows = asyncio.run(server.list_redemptions(user=self.USER))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["reward_title"], "Cinema trip")
        self.assertEqual(rows[0]["reward_icon"], "🎬")
        self.assertEqual(rows[0]["cost_stars"], 60)

    def test_listing_never_leaks_another_family(self):
        db = self._install()
        self._redeem(db)
        db["redemptions"].rows.append({
            "redemption_id": "red_other", "family_id": "fam2", "member_id": "kidX",
            "reward_title": "Not yours", "cost_stars": 10, "status": "pending",
            "created_at": server.utcnow(),
        })

        mine = asyncio.run(server.list_redemptions(user=self.USER))
        self.assertEqual([r["reward_title"] for r in mine], ["Cinema trip"])

        theirs = asyncio.run(server.list_redemptions(user=self.OTHER))
        self.assertEqual([r["reward_title"] for r in theirs], ["Not yours"])

    def test_an_unknown_status_filter_is_rejected(self):
        # Quietly ignoring it would return every status while looking filtered.
        db = self._install()
        self._redeem(db)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.list_redemptions(status="pendign", user=self.USER))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_listing_can_be_narrowed_to_what_is_outstanding(self):
        db = self._install()
        self._redeem(db)
        asyncio.run(server.fulfil_redemption(self._only(db)["redemption_id"], user=self.USER))

        self.assertEqual(asyncio.run(server.list_redemptions(status="pending", user=self.USER)), [])
        settled = asyncio.run(server.list_redemptions(status="fulfilled", user=self.USER))
        self.assertEqual(len(settled), 1)

    # ---- handing it over -------------------------------------------------

    def test_marking_it_given_settles_it_and_stamps_the_time(self):
        db = self._install()
        self._redeem(db)
        result = asyncio.run(server.fulfil_redemption(self._only(db)["redemption_id"], user=self.USER))

        self.assertEqual(result["status"], "fulfilled")
        self.assertIsNotNone(result["fulfilled_at"])
        # Settling is not a star movement — the stars were spent at redeem time.
        self.assertEqual(len(db["star_transactions"].rows), 1)
        self.assertEqual(db["family_members"].rows[0]["stars"], 40)

    def test_it_cannot_be_given_twice(self):
        db = self._install()
        self._redeem(db)
        rid = self._only(db)["redemption_id"]
        asyncio.run(server.fulfil_redemption(rid, user=self.USER))

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.fulfil_redemption(rid, user=self.USER))
        self.assertEqual(ctx.exception.status_code, 404)

    def test_another_family_cannot_settle_it(self):
        db = self._install()
        self._redeem(db)
        rid = self._only(db)["redemption_id"]

        with self.assertRaises(HTTPException):
            asyncio.run(server.fulfil_redemption(rid, user=self.OTHER))
        with self.assertRaises(HTTPException):
            asyncio.run(server.cancel_redemption(rid, user=self.OTHER))
        self.assertEqual(self._only(db)["status"], "pending")

    # ---- giving the stars back -------------------------------------------

    def test_cancelling_returns_the_stars_and_says_so_in_the_ledger(self):
        db = self._install(stars=100, cost=60)
        self._redeem(db)
        self.assertEqual(db["family_members"].rows[0]["stars"], 40)

        result = asyncio.run(server.cancel_redemption(self._only(db)["redemption_id"], user=self.USER))

        self.assertEqual(result["redemption"]["status"], "cancelled")
        self.assertEqual(db["family_members"].rows[0]["stars"], 100)
        refund = db["star_transactions"].rows[-1]
        self.assertEqual(refund["delta"], 60)
        self.assertIn("Cinema trip", refund["reason"])
        # The ledger still reconciles: -60 then +60 against an unchanged balance.
        self.assertEqual(100 + sum(t["delta"] for t in db["star_transactions"].rows), 100)

    def test_something_already_given_cannot_be_refunded(self):
        # Otherwise a child keeps the cinema trip and gets the stars back too.
        db = self._install()
        self._redeem(db)
        rid = self._only(db)["redemption_id"]
        asyncio.run(server.fulfil_redemption(rid, user=self.USER))

        with self.assertRaises(HTTPException):
            asyncio.run(server.cancel_redemption(rid, user=self.USER))
        self.assertEqual(db["family_members"].rows[0]["stars"], 40)
        self.assertEqual(len(db["star_transactions"].rows), 1)

    def test_two_parents_cancelling_at_once_refund_once(self):
        # Claiming the redemption before touching the balance is what makes
        # this safe; refunding first would credit 120 stars for one reward.
        db = self._install(stars=100, cost=60)
        self._redeem(db)
        rid = self._only(db)["redemption_id"]

        async def race():
            return await asyncio.gather(
                server.cancel_redemption(rid, user=self.USER),
                server.cancel_redemption(rid, user=self.USER),
                return_exceptions=True,
            )

        results = asyncio.run(race())
        ok = [r for r in results if not isinstance(r, Exception)]
        self.assertEqual(len(ok), 1, "exactly one cancel should succeed")
        self.assertEqual(db["family_members"].rows[0]["stars"], 100)
        self.assertEqual(len([t for t in db["star_transactions"].rows if t["delta"] > 0]), 1)

    def test_two_parents_marking_it_given_at_once_settle_once(self):
        db = self._install()
        self._redeem(db)
        rid = self._only(db)["redemption_id"]

        async def race():
            return await asyncio.gather(
                server.fulfil_redemption(rid, user=self.USER),
                server.fulfil_redemption(rid, user=self.USER),
                return_exceptions=True,
            )

        results = asyncio.run(race())
        self.assertEqual(len([r for r in results if not isinstance(r, Exception)]), 1)

    def test_a_refund_with_nobody_to_credit_writes_no_ledger_entry(self):
        # If the child is removed between claiming the redemption and crediting
        # it, an unconditional insert would leave a +60 in the history that no
        # balance ever received, and the ledger would stop reconciling.
        db = self._install()
        self._redeem(db)
        rid = self._only(db)["redemption_id"]
        db["family_members"].rows.clear()

        result = asyncio.run(server.cancel_redemption(rid, user=self.USER))

        self.assertIsNone(result["member"])
        self.assertIsNone(result["transaction"])
        self.assertEqual([t["delta"] for t in db["star_transactions"].rows], [-60])

    # ---- tidying up -------------------------------------------------------

    def test_removing_a_child_clears_what_they_were_owed(self):
        # Otherwise the parent is left with an outstanding reward and no name
        # to attach it to.
        db = self._install()
        self._redeem(db)
        asyncio.run(server.delete_family_member("kid1", user=self.USER))
        self.assertEqual(db["redemptions"].rows, [])


if __name__ == "__main__":
    unittest.main()
