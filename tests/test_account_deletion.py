"""Deleting your own account — for real, and at once.

The store requires self-service deletion and it is simply how it should work.
Two shapes, and the danger in each is opposite: the solo delete must leave
NOTHING (orphaned personal data is the whole thing this prevents), and the
co-parent delete must leave the household ENTIRELY intact for the person still
in it. Both are pinned here.
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
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase
    from fastapi import HTTPException


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class DeletingYourAccount(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self._email = server.send_account_deleted_email

        async def _no_email(*a, **k):
            return {"sent": False}
        server.send_account_deleted_email = _no_email

    def tearDown(self):
        server.get_db = self._get_db
        server.send_account_deleted_email = self._email

    def _solo(self, password=None):
        """One account (u1), some household data, a child profile."""
        db = FakeDatabase()
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        async def seed():
            await db["users"].insert_one({"user_id": "u1", "family_id": "fam1",
                "email": "solo@x.com", "name": "Solo",
                "password_hash": server.hash_password(password) if password else None})
            await db["family_members"].insert_one({"member_id": "p1", "family_id": "fam1",
                "user_id": "u1", "name": "Solo", "role": "Parent", "created_at": base})
            await db["family_members"].insert_one({"member_id": "kid1", "family_id": "fam1",
                "name": "Ama", "role": "Child"})
            await db["families"].insert_one({"family_id": "fam1", "plan": "village"})
            await db["cards"].insert_one({"card_id": "c1", "family_id": "fam1", "title": "Bins"})
            await db["vault"].insert_one({"doc_id": "d1", "family_id": "fam1", "title": "Passport"})
            await db["user_sessions"].insert_one({"user_id": "u1", "token_hash": "t"})
        asyncio.run(seed())
        server.get_db = lambda: db
        return db

    def _coparented(self):
        db = FakeDatabase()
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        async def seed():
            for uid, mid, off in (("u1", "p1", 0), ("u9", "p2", 30)):
                await db["users"].insert_one({"user_id": uid, "family_id": "fam1",
                    "email": f"{uid}@x.com", "name": uid, "password_hash": None})
                await db["family_members"].insert_one({"member_id": mid, "family_id": "fam1",
                    "user_id": uid, "name": uid, "role": "Parent",
                    "created_at": base + timedelta(days=off)})
            await db["families"].insert_one({"family_id": "fam1", "plan": "village"})
            await db["cards"].insert_one({"card_id": "c1", "family_id": "fam1", "title": "Bins"})
        asyncio.run(seed())
        server.get_db = lambda: db
        return db

    def _count(self, db, coll, **q):
        return asyncio.run(db[coll].count_documents(q))

    # ---- solo: everything goes -------------------------------------------

    def test_a_solo_account_takes_the_whole_household_with_it(self):
        db = self._solo()
        out = asyncio.run(server.delete_account(
            server.DeleteAccountIn(confirm=True), user={"user_id": "u1", "family_id": "fam1"}))
        self.assertTrue(out["deleted_household"])
        for coll in ("users", "family_members", "families", "cards", "vault", "user_sessions"):
            self.assertEqual(self._count(db, coll), 0, f"{coll} not purged")

    def test_a_password_account_must_prove_itself(self):
        self._solo(password="hunter2")
        with self.assertRaises(HTTPException) as e:
            asyncio.run(server.delete_account(
                server.DeleteAccountIn(password="wrong"), user={"user_id": "u1", "family_id": "fam1"}))
        self.assertEqual(e.exception.status_code, 403)

    def test_the_right_password_lets_it_through(self):
        db = self._solo(password="hunter2")
        asyncio.run(server.delete_account(
            server.DeleteAccountIn(password="hunter2"), user={"user_id": "u1", "family_id": "fam1"}))
        self.assertEqual(self._count(db, "users"), 0)

    def test_an_oauth_account_needs_an_explicit_confirm(self):
        self._solo()  # password_hash None
        with self.assertRaises(HTTPException) as e:
            asyncio.run(server.delete_account(
                server.DeleteAccountIn(), user={"user_id": "u1", "family_id": "fam1"}))
        self.assertEqual(e.exception.status_code, 400)

    # ---- co-parented: only you leave -------------------------------------

    def test_a_co_parent_leaving_keeps_the_household_whole(self):
        db = self._coparented()
        out = asyncio.run(server.delete_account(
            server.DeleteAccountIn(confirm=True), user={"user_id": "u9", "family_id": "fam1"}))
        self.assertFalse(out["deleted_household"])
        # u9 gone; u1, the family, and the shared card all remain.
        self.assertEqual(self._count(db, "users", user_id="u9"), 0)
        self.assertEqual(self._count(db, "users", user_id="u1"), 1)
        self.assertEqual(self._count(db, "families", family_id="fam1"), 1)
        self.assertEqual(self._count(db, "cards", family_id="fam1"), 1)
        self.assertEqual(self._count(db, "family_members", user_id="u9"), 0)
        self.assertEqual(self._count(db, "family_members", user_id="u1"), 1)


if __name__ == "__main__":
    unittest.main()
