"""A browser-only member is a real member: they must hear everything.

The bug this locks out: new-card alerts, co-parent alerts (hand-off notes,
announcements, redeemed rewards) and the unclaimed-card due reminder all
derived their RECIPIENTS from Expo token rows. A co-parent who only ever used
the web app had no token row, so they were never even a candidate — the send
path could reach browsers, but nobody listed them. They found out days later,
which is the exact failure the app exists to prevent.

Recipients now come from the household's accounts, and each send goes through
send_push_to_user, which fans out to phone AND browser.

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
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE, "backend deps not installed")
class WebOnlyMemberHearsEverything(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.sent = []
        self._real = server.send_push_to_user

        async def capture(database, user_id, title, body, data, channel="household-alerts", pref_key=None):
            self.sent.append({"user_id": user_id, "title": title, "data": data})
        server.send_push_to_user = capture

        async def seed():
            # Roland has the Android app; Keigh uses only the web app — no Expo
            # token row anywhere, exactly like the real-world case.
            for uid, name in (("u_r", "Roland"), ("u_k", "Keigh")):
                await self.db["users"].insert_one(
                    {"user_id": uid, "family_id": "fam1", "name": name, "language": "en"})
                await self.db["family_members"].insert_one({
                    "member_id": f"m_{uid}", "family_id": "fam1", "user_id": uid,
                    "name": name, "role": "Parent"})
            await self.db["notification_tokens"].insert_one({
                "family_id": "fam1", "user_id": "u_r", "active": True,
                "token": "ExponentPushToken[roland]", "platform": "android"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_push_to_user = self._real

    def _recipients(self):
        return {s["user_id"] for s in self.sent}

    def test_new_card_alert_reaches_the_web_only_parent(self):
        asyncio.run(server.send_new_card_alert(
            "fam1", {"card_id": "c1", "title": "Sign the slip"}, created_by_user_id="u_r"))
        self.assertIn("u_k", self._recipients())      # the web-only parent
        self.assertNotIn("u_r", self._recipients())   # never the author

    def test_coparent_alert_reaches_the_web_only_parent(self):
        asyncio.run(server.send_coparent_alert(
            "fam1", "Roland left a note", "Bins go out tonight", "handoff_note",
            created_by_user_id="u_r"))
        self.assertIn("u_k", self._recipients())
        self.assertNotIn("u_r", self._recipients())

    def test_an_unclaimed_due_reminder_lists_the_web_only_parent(self):
        card = {"family_id": "fam1", "shared": True, "assignee": "",
                "created_by_user_id": "u_r"}
        who = asyncio.run(server._reminder_recipients(self.db, card))
        self.assertIn("u_k", who)
        self.assertIn("u_r", who)

    def test_a_private_card_reminder_is_still_the_creators_alone(self):
        card = {"family_id": "fam1", "shared": False, "created_by_user_id": "u_r"}
        self.assertEqual(asyncio.run(server._reminder_recipients(self.db, card)), ["u_r"])


if __name__ == "__main__":
    unittest.main()
