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


if __name__ == "__main__":
    unittest.main()
