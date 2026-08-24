"""New notification loops: a teen's finished chore reaches the parents, and the
approved star reaches the teen back. These are "someone is waiting on someone"
events that used to fire nothing — a teen ticked a chore and it sat in an
approval list no one knew to open, and the star, once granted, was never
announced to the teen who earned it.

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

PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TeenApprovalLoop(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        server._auth_fail.clear()
        self._real_send = server.send_expo_push_messages
        self.sent = []

        async def fake_send(messages, database=None):
            self.sent.extend(messages)
            return {"sent": len(messages)}
        server.send_expo_push_messages = fake_send

        asyncio.run(self.db["users"].insert_one({**PARENT, "language": "en"}))
        asyncio.run(self.db["users"].insert_one({
            "user_id": "u_t", "family_id": "fam1", "name": "Ama",
            "email": "ama@x.com", "language": "fr", "is_teen": True}))
        for mid, uid, nm, role in [("m_p", "u_p", "Roland", "Parent"), ("m_t", "u_t", "Ama", "teen")]:
            asyncio.run(self.db["family_members"].insert_one({
                "member_id": mid, "family_id": "fam1", "user_id": uid,
                "name": nm, "role": role, "stars": 0}))
        # Both adults have a device registered; the teen too.
        for uid, tok in [("u_p", "ExponentPushToken[parent]"), ("u_t", "ExponentPushToken[teen]")]:
            asyncio.run(self.db["notification_tokens"].insert_one(
                {"user_id": uid, "family_id": "fam1", "token": tok, "active": True, "updated_at": server.utcnow()}))
        self.teen_token = "teentok"
        asyncio.run(self.db["user_sessions"].insert_one({
            "token_hash": server.sha256(self.teen_token), "user_id": "u_t",
            "expires_at": server.utcnow() + timedelta(days=1)}))

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._real_send

    def _teen_card(self):
        return asyncio.run(server.create_card(
            server.CardIn(type="TASK", title="Dishes", assignee="Ama", shared=True),
            user=dict(PARENT)))

    def _tokens_of(self):
        return {m["to"] for m in self.sent}

    def test_finishing_a_teen_task_alerts_the_parent_not_the_teen(self):
        card = self._teen_card()
        self.sent.clear()  # ignore the create/assignment push
        teen = asyncio.run(server.require_teen(authorization=f"Bearer {self.teen_token}"))
        asyncio.run(server.teen_finish_task(card_id=card["card_id"], teen=teen))
        # The parent's device is told; the teen (the author) is not.
        self.assertIn("ExponentPushToken[parent]", self._tokens_of())
        self.assertNotIn("ExponentPushToken[teen]", self._tokens_of())
        self.assertTrue(any(m["data"].get("type") == "teen_approval" for m in self.sent))

    def test_approving_the_star_alerts_the_teen_in_their_language(self):
        card = self._teen_card()
        teen = asyncio.run(server.require_teen(authorization=f"Bearer {self.teen_token}"))
        asyncio.run(server.teen_finish_task(card_id=card["card_id"], teen=teen))
        self.sent.clear()  # ignore the parent's approval-request push
        asyncio.run(server.resolve_teen_approval(
            card["card_id"], server.TeenApprovalIn(approve=True, stars=3), user=dict(PARENT)))
        # The teen hears their star landed, localized to their language (fr).
        self.assertIn("ExponentPushToken[teen]", self._tokens_of())
        teen_msg = next(m for m in self.sent if m["to"] == "ExponentPushToken[teen]")
        self.assertEqual(teen_msg["data"].get("type"), "teen_star")
        self.assertEqual(teen_msg["title"], server.PUSH_I18N["fr"]["teen_star_title"])
        # And the teen's stars actually moved.
        row = asyncio.run(self.db["family_members"].find_one({"member_id": "m_t"}))
        self.assertEqual(row["stars"], 3)

    def test_declining_the_star_tells_nobody_and_awards_nothing(self):
        card = self._teen_card()
        teen = asyncio.run(server.require_teen(authorization=f"Bearer {self.teen_token}"))
        asyncio.run(server.teen_finish_task(card_id=card["card_id"], teen=teen))
        self.sent.clear()
        asyncio.run(server.resolve_teen_approval(
            card["card_id"], server.TeenApprovalIn(approve=False), user=dict(PARENT)))
        self.assertEqual(self.sent, [])
        row = asyncio.run(self.db["family_members"].find_one({"member_id": "m_t"}))
        self.assertEqual(row["stars"], 0)


if __name__ == "__main__":
    unittest.main()
