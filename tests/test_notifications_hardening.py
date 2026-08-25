"""Notification hardening: reach every real device, obey every opt-out.

Guards the fixes from the notification audit: a person's phone AND tablet both
get pushed (not just the last-opened one), a muted alert actually stays silent,
chat can be turned off, and logging out deactivates that device's token.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone, timedelta

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
class TokenDedup(unittest.TestCase):
    def _doc(self, uid, platform, token, mins_ago):
        return {"user_id": uid, "platform": platform, "token": token,
                "updated_at": datetime.now(timezone.utc) - timedelta(minutes=mins_ago)}

    def test_a_phone_and_a_tablet_both_survive(self):
        docs = [self._doc("u1", "android", "tok_phone", 1),
                self._doc("u1", "ios", "tok_tablet", 5)]
        kept = {d["token"] for d in server._latest_token_per_user(docs)}
        self.assertEqual(kept, {"tok_phone", "tok_tablet"})

    def test_two_tokens_on_the_same_device_collapse_to_the_newest(self):
        docs = [self._doc("u1", "android", "tok_old", 30),
                self._doc("u1", "android", "tok_new", 1)]
        kept = [d["token"] for d in server._latest_token_per_user(docs)]
        self.assertEqual(kept, ["tok_new"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class OptOutGating(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._real = server.send_expo_push_messages
        self.sent = []

        async def fake_send(messages, database=None):
            self.sent.extend(messages)
            return {"sent": len(messages)}
        server.send_expo_push_messages = fake_send

        async def seed():
            await self.db["notification_tokens"].insert_one({
                "user_id": "u1", "platform": "android", "token": "ExponentPushToken[x]",
                "active": True, "updated_at": server.utcnow()})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._real

    def _prefs(self, **flags):
        asyncio.run(self.db["notification_settings"].insert_one({
            "user_id": "u1", "created_at": server.utcnow() - timedelta(days=1),
            "updated_at": server.utcnow(), **flags}))

    def _push(self, pref_key=None, channel="household-alerts"):
        asyncio.run(server.send_push_to_user(
            self.db, "u1", "Hi", "there", {"type": "x"},
            channel=channel, pref_key=pref_key))

    def test_no_pref_key_always_sends(self):
        self._push()
        self.assertEqual(len(self.sent), 1)

    def test_a_muted_alert_stays_silent(self):
        self._prefs(new_card_alerts=False)
        self._push(pref_key="new_card_alerts")
        self.assertEqual(self.sent, [])

    def test_an_enabled_alert_still_sends(self):
        self._prefs(new_card_alerts=True)
        self._push(pref_key="new_card_alerts")
        self.assertEqual(len(self.sent), 1)

    def test_chat_can_be_turned_off(self):
        self._prefs(chat_messages=False)
        self._push(pref_key="chat_messages")
        self.assertEqual(self.sent, [])

    def test_the_channel_is_passed_through(self):
        self._push(channel="card-reminders")
        self.assertEqual(self.sent[0]["channelId"], "card-reminders")
        self.assertEqual(self.sent[0]["priority"], "high")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Unregister(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        asyncio.run(self.db["notification_tokens"].insert_one({
            "token": "tok1", "user_id": "u1", "active": True}))

    def tearDown(self):
        server.get_db = self._get_db

    def test_logout_deactivates_this_devices_token(self):
        asyncio.run(server.unregister_notification_token(
            server.NotificationTokenIn(token="tok1"),
            user={"user_id": "u1", "family_id": "f1"}))
        doc = asyncio.run(self.db["notification_tokens"].find_one({"token": "tok1"}))
        self.assertFalse(doc["active"])

    def test_you_cannot_deactivate_someone_elses_token(self):
        asyncio.run(server.unregister_notification_token(
            server.NotificationTokenIn(token="tok1"),
            user={"user_id": "u2", "family_id": "f1"}))
        doc = asyncio.run(self.db["notification_tokens"].find_one({"token": "tok1"}))
        self.assertTrue(doc["active"])   # untouched — not the caller's token


if __name__ == "__main__":
    unittest.main()
