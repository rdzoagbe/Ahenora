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
import re
import sys
import unittest
from datetime import datetime, timedelta, timezone

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
                if "$ne" in cond and value == cond["$ne"]:
                    return False
                if "$regex" in cond:
                    flags = re.I if "i" in (cond.get("$options") or "") else 0
                    if not isinstance(value, str) or not re.search(cond["$regex"], value, flags):
                        return False
                # Claiming a period the first time filters on the field being
                # absent, so without this the fake matches every racer and the
                # double-pay guard looks broken when it is not.
                if "$exists" in cond and (key in row) != cond["$exists"]:
                    return False
            # Mongo matches a scalar against an array field by membership, which
            # is how a chore's assigned_members is queried.
            elif isinstance(value, list):
                if cond not in value:
                    return False
            elif value != cond:
                return False
        return True

    async def count_documents(self, query=None):
        return sum(1 for r in self.rows if self._matches(r, query or {}))

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

    async def update_many(self, query, update):
        await asyncio.sleep(0)
        touched = 0
        for row in self.rows:
            if self._matches(row, query):
                for field, amount in (update.get("$inc") or {}).items():
                    row[field] = row.get(field, 0) + amount
                for field, value in (update.get("$set") or {}).items():
                    row[field] = value
                touched += 1
        return type("R", (), {"matched_count": touched, "modified_count": touched})()

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
        payload = type("P", (), {"delta": -8, "reason": "Tidy up", "awarded_for": None})()

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
        payload = type("P", (), {"delta": 5, "reason": "Helped out", "awarded_for": None})()

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

    # ---- assigned task cards --------------------------------------------

    def test_marking_a_task_card_done_pays_the_child_and_ticks_the_week(self):
        # Completing an assigned task card is a primary earning path. It used to
        # bank +5 with a raw $inc that skipped the weekly meter and the ledger,
        # so weekend treats (gated on week_earned) stayed locked and the ledger
        # diverged from the balance. It now routes through the shared helper.
        db = self._db()
        db["cards"].rows.append({
            "card_id": "card1", "family_id": "fam1", "type": "TASK",
            "title": "Tidy room", "assignee": "Ama", "status": "OPEN",
            "source": "MANUAL", "shared": True, "created_by_user_id": "u1",
            "created_at": server.utcnow(),
        })
        _alert = server.send_star_milestone_alert

        async def _no_alert(*a, **k):
            return None

        server.send_star_milestone_alert = _no_alert
        try:
            asyncio.run(server.update_card(
                "card1", server.CardPatchIn(status="DONE"), user=self.USER))
        finally:
            server.send_star_milestone_alert = _alert

        self.assertEqual(self._stars(db, "kid1"), 5)
        member = next(m for m in db["family_members"].rows if m["member_id"] == "kid1")
        self.assertEqual(member["week_earned"], 5)
        ledger = db["star_transactions"].rows
        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger[0]["delta"], 5)
        self.assertEqual(ledger[0]["member_id"], "kid1")

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

    def test_the_patch_model_accepts_nothing_but_name_and_avatar(self):
        # Stars move through the audited endpoint that writes a ledger entry,
        # so the model itself must refuse them — testing only the handler body
        # would stay green the day somebody adds a stars field to the model.
        self.assertEqual(set(server.MemberPatchIn.model_fields), {"name", "avatar"})

    def test_stars_survive_an_attempt_to_set_them(self):
        db = self._install()
        self._patch(db, name="Ama", stars=99999)
        self.assertEqual(db["family_members"].rows[0]["stars"], 40)
        self.assertEqual(db["star_transactions"].rows, [])

    def test_an_oversized_avatar_is_rejected(self):
        db = self._install()
        with self.assertRaises(HTTPException):
            self._patch(db, avatar="x" * 5000)

    # ---- renaming must not break who gets paid ---------------------------

    def test_renaming_follows_through_to_cards_that_name_the_child(self):
        # Cards address a child by name and decide who earned a star by looking
        # that name up. Renaming without this left every existing card pointing
        # at a name nobody answers to: the lookup misses, the card is still
        # flagged paid, and the child gets nothing — silently, forever.
        db = self._install()
        db["cards"].rows.extend([
            {"card_id": "c1", "family_id": "fam1", "assignee": "Ama", "type": "TASK"},
            {"card_id": "c2", "family_id": "fam1", "assignee": "Kofi", "type": "TASK"},
            {"card_id": "c3", "family_id": "fam2", "assignee": "Ama", "type": "TASK"},
        ])
        self._patch(db, name="Amara")

        by_id = {c["card_id"]: c["assignee"] for c in db["cards"].rows}
        self.assertEqual(by_id["c1"], "Amara")
        self.assertEqual(by_id["c2"], "Kofi", "another child's card must not move")
        self.assertEqual(by_id["c3"], "Ama", "another family's card must not move")

    def test_renaming_updates_the_denormalised_copies(self):
        db = self._install()
        db["handoff_notes"].rows.append(
            {"note_id": "n1", "family_id": "fam1", "member_id": "kid1", "member_name": "Ama"})
        db["expenses"].rows.append(
            {"expense_id": "e1", "family_id": "fam1", "child_member_id": "kid1", "child_name": "Ama"})
        self._patch(db, name="Amara")
        self.assertEqual(db["handoff_notes"].rows[0]["member_name"], "Amara")
        self.assertEqual(db["expenses"].rows[0]["child_name"], "Amara")

    def test_a_name_already_taken_is_refused(self):
        # Two children answering to the same name makes "who earned this star"
        # unanswerable, because the card lookup is by name.
        db = self._install()
        db["family_members"].rows.append(
            {"member_id": "kid2", "family_id": "fam1", "name": "Kofi", "role": "child", "stars": 0})
        with self.assertRaises(HTTPException) as ctx:
            self._patch(db, name="kofi")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(db["family_members"].rows[0]["name"], "Ama")

    def test_the_same_name_in_another_family_is_fine(self):
        db = self._install()
        db["family_members"].rows.append(
            {"member_id": "kidX", "family_id": "fam2", "name": "Kofi", "role": "child", "stars": 0})
        self.assertEqual(self._patch(db, name="Kofi")["name"], "Kofi")

    def test_correcting_your_own_capitalisation_is_allowed(self):
        # "ama" -> "Ama" must not read as a clash with yourself.
        db = self._install()
        self.assertEqual(self._patch(db, name="AMA")["name"], "AMA")

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

    # ---- deleting a child ------------------------------------------------

    def _with_shared_things(self):
        db = self._install()
        db["family_members"].rows.append(
            {"member_id": "kid2", "family_id": "fam1", "name": "Kofi", "role": "child", "stars": 5})
        db["chores"].rows.append({
            "chore_id": "c1", "family_id": "fam1", "title": "Bins out",
            "assigned_members": ["kid1", "kid2"], "current_assignee": "kid1", "star_reward": 5,
        })
        db["routines"].rows.append(
            {"routine_id": "rt1", "family_id": "fam1", "name": "Bedtime", "member_id": "kid1"})
        db["allowances"].rows.append(
            {"allowance_id": "a1", "family_id": "fam1", "member_id": "kid1", "amount": 5})
        db["allowance_txns"].rows.append(
            {"txn_id": "t1", "family_id": "fam1", "member_id": "kid1", "amount": 5})
        db["star_transactions"].rows.append(
            {"transaction_id": "s1", "family_id": "fam1", "member_id": "kid1", "delta": 10})
        return db

    def test_another_family_cannot_delete_a_child(self):
        db = self._install()
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.delete_family_member("kid1", user=self.OTHER))
        self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(len(db["family_members"].rows), 1)

    def _coparented(self):
        """Founder u1 (earliest) + co-parent u9, both account-holders."""
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db = FakeDB(
            family_members=[
                {"member_id": "p1", "family_id": "fam1", "user_id": "u1",
                 "name": "Roland", "role": "Parent", "created_at": base},
                {"member_id": "p2", "family_id": "fam1", "user_id": "u9",
                 "name": "Keigh", "role": "Parent", "created_at": base + timedelta(days=30)},
            ],
            users=[
                {"user_id": "u1", "family_id": "fam1", "email": "r@x.com", "name": "Roland"},
                {"user_id": "u9", "family_id": "fam1", "email": "k@x.com", "name": "Keigh"},
            ],
            families=[{"family_id": "fam1", "plan": "village"}],
            star_transactions=[], redemptions=[], family_invites=[],
        )
        server.get_db = lambda: db
        return db

    def test_the_founder_can_remove_a_co_parent(self):
        db = self._coparented()
        asyncio.run(server.delete_family_member("p2", user=self.USER))   # u1 removes u9
        ids = [m["member_id"] for m in db["family_members"].rows if m["family_id"] == "fam1"]
        self.assertNotIn("p2", ids)
        # The co-parent keeps their account — moved to a fresh, empty household.
        u9 = next(u for u in db["users"].rows if u["user_id"] == "u9")
        self.assertNotEqual(u9["family_id"], "fam1")

    def test_a_founder_whose_row_predates_user_id_linkage_can_still_remove(self):
        # The production 403: the household owner's own member row was created
        # before member rows carried user_id, so a bare user_id lookup found
        # nothing and read the founder as "not a parent". Resolution now falls
        # back to email, so they are recognised and the removal goes through.
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db = FakeDB(
            family_members=[
                {"member_id": "p1", "family_id": "fam1",  # no user_id on the founder row
                 "email": "R@X.com", "name": "Roland", "role": "Parent", "created_at": base},
                {"member_id": "p2", "family_id": "fam1", "user_id": "u9",
                 "email": "k@x.com", "name": "Keigh", "role": "Co-parent",
                 "created_at": base + timedelta(days=30)},
            ],
            users=[
                {"user_id": "u1", "family_id": "fam1", "email": "r@x.com", "name": "Roland"},
                {"user_id": "u9", "family_id": "fam1", "email": "k@x.com", "name": "Keigh"},
            ],
            families=[{"family_id": "fam1", "plan": "village"}],
            star_transactions=[], redemptions=[], family_invites=[],
        )
        server.get_db = lambda: db
        founder = {"family_id": "fam1", "user_id": "u1", "email": "r@x.com", "name": "Roland"}
        asyncio.run(server.delete_family_member("p2", user=founder))
        ids = [m["member_id"] for m in db["family_members"].rows if m["family_id"] == "fam1"]
        self.assertNotIn("p2", ids)

    def test_a_founder_with_no_member_row_at_all_can_still_remove(self):
        # The stronger production shape: the owner has no parent-level member
        # row — the household's parent rows are the two co-parents, and the
        # owner is known only from `users`. An authenticated account that
        # matches no member row is the founder, so removal must go through.
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db = FakeDB(
            family_members=[
                {"member_id": "p2", "family_id": "fam1", "user_id": "u9",
                 "email": "k@x.com", "name": "Keigh", "role": "Co-parent",
                 "created_at": base + timedelta(days=10)},
                {"member_id": "p3", "family_id": "fam1", "user_id": "u3",
                 "email": "t@x.com", "name": "The Tester", "role": "Co-parent",
                 "created_at": base + timedelta(days=40)},
            ],
            users=[
                {"user_id": "u1", "family_id": "fam1", "email": "r@x.com", "name": "Roland"},
                {"user_id": "u9", "family_id": "fam1", "email": "k@x.com", "name": "Keigh"},
                {"user_id": "u3", "family_id": "fam1", "email": "t@x.com", "name": "The Tester"},
            ],
            families=[{"family_id": "fam1", "plan": "village"}],
            star_transactions=[], redemptions=[], family_invites=[],
        )
        server.get_db = lambda: db
        owner = {"family_id": "fam1", "user_id": "u1", "email": "r@x.com", "name": "Roland"}
        asyncio.run(server.delete_family_member("p3", user=owner))  # remove The Tester
        ids = [m["member_id"] for m in db["family_members"].rows if m["family_id"] == "fam1"]
        self.assertNotIn("p3", ids)
        self.assertIn("p2", ids)

    def test_a_family_member_with_an_account_still_cannot_remove(self):
        # The guard the permissive fallback must not weaken: a grandparent
        # invited as a family member HAS an account and a user_id-linked row,
        # so they are matched, found non-parent, and refused.
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db = FakeDB(
            family_members=[
                {"member_id": "p1", "family_id": "fam1", "user_id": "u1",
                 "email": "r@x.com", "name": "Roland", "role": "Parent", "created_at": base},
                {"member_id": "g1", "family_id": "fam1", "user_id": "u7",
                 "email": "gran@x.com", "name": "Gran", "role": "Grandparent",
                 "created_at": base + timedelta(days=5)},
            ],
            users=[
                {"user_id": "u1", "family_id": "fam1", "email": "r@x.com", "name": "Roland"},
                {"user_id": "u7", "family_id": "fam1", "email": "gran@x.com", "name": "Gran"},
            ],
            families=[{"family_id": "fam1", "plan": "village"}],
            star_transactions=[], redemptions=[], family_invites=[],
        )
        server.get_db = lambda: db
        gran = {"family_id": "fam1", "user_id": "u7", "email": "gran@x.com", "name": "Gran"}
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.delete_family_member("p1", user=gran))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_a_founder_with_no_created_at_is_still_protected(self):
        # Founder detection sorts a row with no created_at as OLDEST, not "now",
        # so a legacy founder row without a timestamp keeps its protection — a
        # co-parent who joined later cannot be mistaken for the founder and use
        # that to evict the owner.
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db = FakeDB(
            family_members=[
                {"member_id": "p1", "family_id": "fam1", "user_id": "u1",  # no created_at
                 "email": "r@x.com", "name": "Roland", "role": "Parent"},
                {"member_id": "p2", "family_id": "fam1", "user_id": "u9",
                 "email": "k@x.com", "name": "Keigh", "role": "Co-parent", "created_at": base},
            ],
            users=[
                {"user_id": "u1", "family_id": "fam1", "email": "r@x.com", "name": "Roland"},
                {"user_id": "u9", "family_id": "fam1", "email": "k@x.com", "name": "Keigh"},
            ],
            families=[{"family_id": "fam1", "plan": "village"}],
            star_transactions=[], redemptions=[], family_invites=[],
        )
        server.get_db = lambda: db
        co = {"family_id": "fam1", "user_id": "u9", "email": "k@x.com", "name": "Keigh"}
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.delete_family_member("p1", user=co))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_a_rowless_owner_can_remove_a_co_parent(self):
        # The owner whose member row was never written (no user_id, no email
        # match) is still the founder — every invited member gets a row, so
        # "no row" is the owner. They can remove a co-parent.
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        db = FakeDB(
            family_members=[
                {"member_id": "p2", "family_id": "fam1", "user_id": "u9",
                 "email": "k@x.com", "name": "Keigh", "role": "Co-parent", "created_at": base},
            ],
            users=[
                {"user_id": "u1", "family_id": "fam1", "email": "owner@x.com", "name": "Roland"},
                {"user_id": "u9", "family_id": "fam1", "email": "k@x.com", "name": "Keigh"},
            ],
            families=[{"family_id": "fam1", "plan": "village"}],
            star_transactions=[], redemptions=[], family_invites=[],
        )
        server.get_db = lambda: db
        owner = {"family_id": "fam1", "user_id": "u1", "email": "owner@x.com", "name": "Roland"}
        asyncio.run(server.delete_family_member("p2", user=owner))
        ids = [m["member_id"] for m in db["family_members"].rows if m["family_id"] == "fam1"]
        self.assertNotIn("p2", ids)

    def test_a_co_parent_cannot_remove_the_founder(self):
        self._coparented()
        co = {"family_id": "fam1", "user_id": "u9", "name": "Keigh", "role": "parent"}
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.delete_family_member("p1", user=co))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_you_cannot_remove_yourself_that_way(self):
        self._coparented()
        co = {"family_id": "fam1", "user_id": "u9", "name": "Keigh", "role": "parent"}
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.delete_family_member("p2", user=co))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_a_child_profile_still_deletes_without_ceremony(self):
        # No account, so none of the co-parent guards apply — a child goes.
        db = self._install()
        asyncio.run(server.delete_family_member("kid1", user=self.USER))
        self.assertEqual(len(db["family_members"].rows), 0)

    def test_deleting_takes_only_what_was_theirs(self):
        db = self._with_shared_things()
        asyncio.run(server.delete_family_member("kid1", user=self.USER))

        self.assertEqual([m["member_id"] for m in db["family_members"].rows], ["kid2"])
        for gone in ("star_transactions", "allowances", "allowance_txns", "redemptions"):
            self.assertEqual(db[gone].rows, [], gone)

    def test_a_chore_they_held_passes_to_whoever_is_left(self):
        # A chore left holding a dead member id rendered as a raw "member_a3f9…"
        # on the wheel and paid nobody on completion while reporting success.
        db = self._with_shared_things()
        asyncio.run(server.delete_family_member("kid1", user=self.USER))

        chore = db["chores"].rows[0]
        self.assertEqual(chore["assigned_members"], ["kid2"])
        self.assertEqual(chore["current_assignee"], "kid2")

    def test_a_chore_only_they_did_is_left_unassigned_not_deleted(self):
        # The work still needs doing; it just belongs to nobody for now.
        db = self._install()
        db["chores"].rows.append({
            "chore_id": "c1", "family_id": "fam1", "title": "Feed cat",
            "assigned_members": ["kid1"], "current_assignee": "kid1", "star_reward": 3,
        })
        asyncio.run(server.delete_family_member("kid1", user=self.USER))

        chore = db["chores"].rows[0]
        self.assertEqual(chore["assigned_members"], [])
        self.assertIsNone(chore["current_assignee"])

    def test_their_routine_survives_unassigned(self):
        db = self._with_shared_things()
        asyncio.run(server.delete_family_member("kid1", user=self.USER))
        routine = db["routines"].rows[0]
        self.assertEqual(routine["name"], "Bedtime")
        self.assertIsNone(routine["member_id"])

    def test_the_expense_record_survives_the_person(self):
        # The name is denormalised precisely so history outlives the member.
        db = self._install()
        db["expenses"].rows.append({
            "expense_id": "e1", "family_id": "fam1",
            "child_member_id": "kid1", "child_name": "Ama", "amount": 12,
        })
        asyncio.run(server.delete_family_member("kid1", user=self.USER))
        self.assertEqual(db["expenses"].rows[0]["child_name"], "Ama")


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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class PocketMoney(unittest.TestCase):
    """Setting an allowance used to be a note to nobody: the config was stored
    and never read again, so the balance sat at zero until a parent remembered
    to record every payment by hand."""

    USER = {"family_id": "fam1", "user_id": "u1", "name": "Parent", "role": "parent"}
    OTHER = {"family_id": "fam2", "user_id": "u2", "name": "Stranger", "role": "parent"}

    def setUp(self):
        self._feature = server.require_feature

        async def _allow(*a, **k):
            return {"plan": "premium"}

        server.require_feature = _allow

    def tearDown(self):
        server.require_feature = self._feature

    def _db(self, amount=5.0, frequency="weekly", last_paid=None, age_days=0):
        row = {
            "allowance_id": "alw1", "family_id": "fam1", "member_id": "kid1",
            "amount": amount, "frequency": frequency,
            "created_at": server.utcnow() - timedelta(days=age_days),
        }
        if last_paid is not None:
            row["last_paid_at"] = last_paid
        return FakeDB(allowances=[row], allowance_txns=[])

    def _pay(self, db, user=None):
        return asyncio.run(server.pay_allowance("kid1", user=user or self.USER, database=db))

    # ---- the datetimes Mongo actually returns ---------------------------

    def test_a_row_from_the_real_database_does_not_crash(self):
        """Mongo returns naive datetimes; utcnow() is aware. Comparing the two
        raises TypeError, and this 500ed the very first time a real row — as
        opposed to a test fixture, which stored aware datetimes — was
        serialized. The fixture here is deliberately naive for that reason."""
        from datetime import datetime as _dt
        row = {
            "allowance_id": "alw1", "family_id": "fam1", "member_id": "kid1",
            "amount": 5.0, "frequency": "weekly",
            "created_at": _dt.utcnow(),          # naive, as from Mongo
            "last_paid_at": _dt.utcnow() - timedelta(days=2),
        }
        cfg = server.public_allowance_config(row)   # must not raise
        self.assertFalse(cfg["is_due"])
        self.assertIsNotNone(cfg["next_due_at"])

    def test_paying_a_naive_row_does_not_crash(self):
        from datetime import datetime as _dt
        db = FakeDB(allowance_txns=[], allowances=[{
            "allowance_id": "alw1", "family_id": "fam1", "member_id": "kid1",
            "amount": 5.0, "frequency": "weekly",
            "created_at": _dt.utcnow() - timedelta(days=30),
            "last_paid_at": _dt.utcnow() - timedelta(days=8),  # naive and due
        }])
        result = self._pay(db)
        self.assertEqual(result["transaction"]["amount"], 5.0)

    # ---- when it is due -------------------------------------------------

    def test_a_new_allowance_is_payable_immediately(self):
        # Otherwise setting one up does nothing visible for a week, which is
        # how it came to look broken in the first place.
        db = self._db()
        cfg = server.public_allowance_config(db["allowances"].rows[0])
        self.assertTrue(cfg["is_due"])
        self.assertIsNone(cfg["last_paid_at"])

    def test_it_is_not_due_again_the_same_week(self):
        db = self._db(last_paid=server.utcnow() - timedelta(days=2))
        self.assertFalse(server.public_allowance_config(db["allowances"].rows[0])["is_due"])

    def test_it_is_due_again_after_the_period(self):
        db = self._db(last_paid=server.utcnow() - timedelta(days=8))
        self.assertTrue(server.public_allowance_config(db["allowances"].rows[0])["is_due"])

    def test_monthly_waits_a_month_not_a_week(self):
        db = self._db(frequency="monthly", last_paid=server.utcnow() - timedelta(days=10))
        self.assertFalse(server.public_allowance_config(db["allowances"].rows[0])["is_due"])

    # ---- paying ---------------------------------------------------------

    def test_paying_records_the_money_and_stamps_the_period(self):
        db = self._db(amount=5.0)
        result = self._pay(db)

        self.assertEqual(result["transaction"]["amount"], 5.0)
        self.assertEqual(result["transaction"]["txn_type"], "deposit")
        self.assertEqual(len(db["allowance_txns"].rows), 1)
        self.assertIsNotNone(db["allowances"].rows[0]["last_paid_at"])
        self.assertFalse(result["allowance"]["is_due"])

    def test_the_balance_follows_from_the_payment(self):
        db = self._db(amount=5.0)
        self._pay(db)
        balance = asyncio.run(server.get_allowance_balance("kid1", user=self.USER, database=db))
        self.assertEqual(balance["balance"], 5.0)

    def test_paying_twice_in_one_period_is_refused(self):
        db = self._db()
        self._pay(db)
        with self.assertRaises(HTTPException) as ctx:
            self._pay(db)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(len(db["allowance_txns"].rows), 1)

    def test_two_taps_at_once_pay_once(self):
        # Claiming the period before writing the money is what makes this safe;
        # writing first would credit a child twice for one week.
        db = self._db()

        async def race():
            return await asyncio.gather(
                server.pay_allowance("kid1", user=self.USER, database=db),
                server.pay_allowance("kid1", user=self.USER, database=db),
                return_exceptions=True,
            )

        results = asyncio.run(race())
        ok = [r for r in results if not isinstance(r, Exception)]
        self.assertEqual(len(ok), 1, "exactly one payment should land")
        self.assertEqual(len(db["allowance_txns"].rows), 1)

    def test_a_child_with_no_allowance_set_cannot_be_paid(self):
        db = FakeDB(allowances=[], allowance_txns=[])
        with self.assertRaises(HTTPException) as ctx:
            self._pay(db)
        self.assertEqual(ctx.exception.status_code, 404)

    def test_another_family_cannot_pay_it(self):
        db = self._db()
        with self.assertRaises(HTTPException):
            self._pay(db, user=self.OTHER)
        self.assertEqual(db["allowance_txns"].rows, [])


if __name__ == "__main__":
    unittest.main()
