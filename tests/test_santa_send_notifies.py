"""'Send everyone their match' has to send something.

The button said it sent; the endpoint minted links and flipped a status, and
nobody was told. Household members now get a push that their match is ready
to reveal in the app. The match itself never travels.
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE, "backend deps not installed")
class SantaSend(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.expo = []

        async def to_expo(messages, database=None):
            self.expo.extend(messages)
            return {"sent": len(messages)}

        async def to_web(database, user_id, title, body, data):
            return 0

        async def feature_ok(user, feature):
            return None
        self._expo, server.send_expo_push_messages = server.send_expo_push_messages, to_expo
        self._web, server.send_web_push_to_user = server.send_web_push_to_user, to_web
        self._feat, server.require_feature = server.require_feature, feature_ok
        run = asyncio.run
        run(self.db["users"].insert_one({"user_id": "u_a", "family_id": "fam", "email": "a@x", "language": "fr"}))
        run(self.db["users"].insert_one({"user_id": "u_b", "family_id": "fam", "email": "b@x", "language": "en"}))
        run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_b", "token": "ExponentPushToken[b]", "active": True,
             "platform": "ios", "updated_at": server.utcnow()}))
        run(self.db["santa_draws"].insert_one({
            "draw_id": "d1", "family_id": "fam", "title": "Noël 2026", "status": "shuffled",
            "created_by_user_id": "u_a",
            "participants": [
                {"pid": "p1", "name": "A", "source": "member", "user_id": "u_a"},
                {"pid": "p2", "name": "B", "source": "member", "user_id": "u_b"},
                {"pid": "p3", "name": "Grandma", "source": "link", "contact": "g@x"},
            ],
            "assignments": {"p1": "p2", "p2": "p3", "p3": "p1"},
            "exclusions": [], "rev": 1, "created_at": server.utcnow(), "updated_at": server.utcnow(),
        }))
        self.user = {"user_id": "u_a", "family_id": "fam", "email": "a@x"}

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web
        server.require_feature = self._feat

    def test_members_are_pushed_and_the_count_is_returned(self):
        out = asyncio.run(server.send_santa_draw("d1", user=self.user))
        self.assertEqual(out["status"], "sent")
        self.assertEqual(out["members_notified"], 1)
        self.assertEqual(len(self.expo), 1)
        self.assertEqual(self.expo[0]["to"], "ExponentPushToken[b]")
        self.assertEqual(self.expo[0]["data"], {"type": "santa_draw", "draw_id": "d1"})
        self.assertIn("Noël 2026", self.expo[0]["body"])
        # The match itself never travels.
        self.assertNotIn("Grandma", self.expo[0]["body"] + self.expo[0]["title"])

    def test_the_sender_is_not_pushed_and_outsiders_get_a_link(self):
        out = asyncio.run(server.send_santa_draw("d1", user=self.user))
        self.assertTrue(all(m["to"] != "ExponentPushToken[a]" for m in self.expo))
        outsider = next(p for p in out["participants"] if p["name"] == "Grandma")
        self.assertTrue(outsider.get("token"))


if __name__ == "__main__":
    unittest.main()
