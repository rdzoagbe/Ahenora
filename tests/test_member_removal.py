"""Removing a co-parent must be a clean break — in both directions.

Moving the removed account to a fresh, empty household is only half the job.
Two live threads used to survive the removal:

  * an open session still served a cached view of the OLD household until it
    happened to refresh, and
  * their notification tokens still carried the OLD family_id, so they kept
    receiving the household's pushes after they were gone.

Both are severed here: the removed member's sessions and tokens are dropped,
while the remover's own sessions and tokens are left untouched.

Run with:  python3 -m unittest discover -s tests -v
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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class RemovingACoParent(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db

    def tearDown(self):
        server.get_db = self._get_db

    def _household(self):
        """fam1 with a founder (u1/p1) and a co-parent (u9/p2). Each account
        holds an open session and a device token pointed at fam1."""
        db = FakeDatabase()
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)

        async def seed():
            for uid, mid, off in (("u1", "p1", 0), ("u9", "p2", 30)):
                await db["users"].insert_one({"user_id": uid, "family_id": "fam1",
                    "email": f"{uid}@x.com", "name": uid, "password_hash": None})
                await db["family_members"].insert_one({"member_id": mid, "family_id": "fam1",
                    "user_id": uid, "name": uid, "role": "Parent",
                    "created_at": base + timedelta(days=off)})
                await db["user_sessions"].insert_one({"user_id": uid, "token_hash": f"s-{uid}"})
                await db["notification_tokens"].insert_one({"user_id": uid, "family_id": "fam1",
                    "token": f"ExponentPushToken[{uid}]", "active": True})
            await db["families"].insert_one({"family_id": "fam1", "plan": "village"})
        asyncio.run(seed())
        server.get_db = lambda: db
        return db

    def _count(self, db, coll, **q):
        return asyncio.run(db[coll].count_documents(q))

    def test_removed_co_parent_loses_sessions_and_tokens(self):
        db = self._household()
        asyncio.run(server.delete_family_member(
            "p2", user={"user_id": "u1", "family_id": "fam1"}))

        # The removed member's live threads back into fam1 are gone.
        self.assertEqual(self._count(db, "user_sessions", user_id="u9"), 0)
        self.assertEqual(self._count(db, "notification_tokens", user_id="u9"), 0)
        # Their member row in fam1 is gone; their account moved to a new family.
        self.assertEqual(self._count(db, "family_members", member_id="p2"), 0)
        moved = asyncio.run(db["users"].find_one({"user_id": "u9"}))
        self.assertIsNotNone(moved)
        self.assertNotEqual(moved["family_id"], "fam1")

    def test_the_remover_keeps_their_own_session_and_token(self):
        db = self._household()
        asyncio.run(server.delete_family_member(
            "p2", user={"user_id": "u1", "family_id": "fam1"}))

        # Removing someone else must never sign the remover out or mute them.
        self.assertEqual(self._count(db, "user_sessions", user_id="u1"), 1)
        self.assertEqual(self._count(db, "notification_tokens", user_id="u1"), 1)
        self.assertEqual(self._count(db, "family_members", user_id="u1", family_id="fam1"), 1)

    def test_removing_a_child_profile_touches_no_sessions(self):
        """A child profile has no account, so there is nothing to revoke — and
        the founder's own session must survive removing one."""
        db = self._household()

        async def add_child():
            await db["family_members"].insert_one({"member_id": "kid1", "family_id": "fam1",
                "name": "Ama", "role": "Child"})
        asyncio.run(add_child())

        asyncio.run(server.delete_family_member(
            "kid1", user={"user_id": "u1", "family_id": "fam1"}))
        self.assertEqual(self._count(db, "family_members", member_id="kid1"), 0)
        self.assertEqual(self._count(db, "user_sessions", user_id="u1"), 1)
        self.assertEqual(self._count(db, "user_sessions", user_id="u9"), 1)


if __name__ == "__main__":
    unittest.main()
