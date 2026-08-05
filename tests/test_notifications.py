"""One event, one notification per person.

A device's Expo push token changes across reinstalls and some updates, and the
old value was left in the table as active — nothing retired it. So a co-parent
who had reinstalled a few times had several live-looking tokens, and every
family push fanned out to all of them: one event, a handful of notifications.
These pin the fix — send to the newest token per person only — so it can't
quietly come back.

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
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class LatestTokenPerUser(unittest.TestCase):
    def test_keeps_one_newest_token_per_user(self):
        now = server.utcnow()
        docs = [
            {"user_id": "u1", "token": "old", "updated_at": now - timedelta(days=9)},
            {"user_id": "u1", "token": "new", "updated_at": now},
            {"user_id": "u2", "token": "solo", "updated_at": now - timedelta(days=1)},
        ]
        kept = server._latest_token_per_user(docs)
        by_user = {d["user_id"]: d["token"] for d in kept}
        self.assertEqual(by_user, {"u1": "new", "u2": "solo"})

    def test_a_doc_without_a_user_is_dropped(self):
        self.assertEqual(server._latest_token_per_user([{"token": "orphan"}]), [])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class OnePushPerPerson(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._real_send = server.send_expo_push_messages
        self.sent = []

        async def fake_send(messages, database=None):
            self.sent.extend(messages)
            return {"sent": len(messages)}
        server.send_expo_push_messages = fake_send

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._real_send

    def _tokens(self, *docs):
        for d in docs:
            asyncio.run(self.db["notification_tokens"].insert_one(d))

    def test_a_pile_of_stale_tokens_is_one_push(self):
        now = server.utcnow()
        self._tokens(
            {"user_id": "u_wife", "token": "ExponentPushToken[a]", "active": True,
             "updated_at": now - timedelta(days=30)},
            {"user_id": "u_wife", "token": "ExponentPushToken[b]", "active": True,
             "updated_at": now - timedelta(days=2)},
            {"user_id": "u_wife", "token": "ExponentPushToken[c]", "active": True,
             "updated_at": now},
        )
        asyncio.run(server.send_push_to_user(self.db, "u_wife", "Hi", "Body", {"type": "t"}))
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0]["to"], "ExponentPushToken[c]")  # the newest

    def test_new_card_and_assignment_do_not_double_notify_the_assignee(self):
        # A shared card assigned to the co-parent must reach them once — via the
        # hand-off push — not also via the new-card alert.
        asyncio.run(self.db["family_members"].insert_one(
            {"member_id": "m_t", "family_id": "fam1", "name": "Tom",
             "role": "Parent", "user_id": "u_tom"}))
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u_tom", "family_id": "fam1", "name": "Tom", "language": "en"}))
        asyncio.run(self.db["notification_settings"].insert_one(
            {"user_id": "u_tom", "new_card_alerts": True}))
        self._tokens({"user_id": "u_tom", "token": "ExponentPushToken[tom]",
                      "family_id": "fam1", "active": True,
                      "updated_at": server.utcnow()})

        amara = {"user_id": "u_amara", "family_id": "fam1", "name": "Amara"}
        card = server.CardIn(type="TASK", title="Bins out", assignee="Tom", shared=True)
        asyncio.run(server.create_card(card, user=dict(amara)))

        # Exactly one push to Tom, and it is the hand-off, not the new-card alert.
        tom_pushes = [m for m in self.sent if m["to"] == "ExponentPushToken[tom]"]
        self.assertEqual(len(tom_pushes), 1)
        self.assertEqual(tom_pushes[0]["data"]["type"], "task_assigned")


if __name__ == "__main__":
    unittest.main()
