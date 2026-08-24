"""An assigned task carries who set it, and defaults to shared.

Assigning defaults to shared (so a task handed to the co-parent is visible to
both without a thought), while an explicit private is still respected — that is
how a surprise stays a surprise. And the creator's name now rides along so an
assigned card can say who set it.

Run with:  python3 -m unittest discover -s tests -v
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

A = {"user_id": "u1", "family_id": "fam1", "name": "Roland"}
B = {"user_id": "u2", "family_id": "fam1", "name": "Kim"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AssignedIsShared(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._real_send = server.send_expo_push_messages

        async def fake_send(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = fake_send

        async def seed():
            for u, mid in ((A, "m1"), (B, "m2")):
                await self.db["users"].insert_one({**u})
                await self.db["family_members"].insert_one({
                    "member_id": mid, "family_id": "fam1", "user_id": u["user_id"],
                    "name": u["name"], "role": "Parent"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._real_send

    def _create(self, user, **kw):
        payload = server.CardIn(type="TASK", title=kw.pop("title", "School run"), **kw)
        return asyncio.run(server.create_card(payload, user=dict(user)))

    def test_assigning_defaults_to_shared(self):
        # CardIn.shared defaults True, so a plain assign is visible to both.
        card = self._create(A, assignee="Kim")
        self.assertTrue(card["shared"])
        self.assertEqual(card["created_by_name"], "Roland")

    def test_explicit_private_is_respected_even_when_assigned(self):
        # The surprise-party case: deliberately private stays private.
        card = self._create(A, title="Surprise party", assignee="Kim", shared=False)
        self.assertFalse(card["shared"])

    def test_created_by_name_is_returned(self):
        card = self._create(B, assignee="Roland")
        self.assertEqual(card["created_by_name"], "Kim")

    def test_recurring_occurrence_keeps_the_creator_name(self):
        card = self._create(A, assignee="Kim", recurrence="weekly",
                            due_date="2026-08-25T08:00:00Z")
        asyncio.run(server.update_card(
            card["card_id"], server.CardPatchIn(status="DONE"), user=dict(A)))
        spawned = asyncio.run(self.db["cards"].find_one(
            {"family_id": "fam1", "status": "OPEN", "title": "School run"}))
        self.assertEqual(spawned["created_by_name"], "Roland")
        self.assertTrue(spawned["shared"])              # inherits parent's sharing


if __name__ == "__main__":
    unittest.main()
