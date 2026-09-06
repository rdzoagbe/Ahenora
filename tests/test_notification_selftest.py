"""The button that answers "are my notifications actually working?".

The endpoint existed for months with nothing in the app able to reach it, so
the only way to answer that question was to read the source. Now Settings has
a button — which makes what the endpoint REPORTS load-bearing, because a
person will act on it.

The bug this locks out: it built Expo push messages and answered with that
count alone. On the web app there is no Expo token by design, so the one
person the button is most useful to was told "no device is registered" while
their browser subscription was working perfectly. A diagnostic that reports
the absence of the rail it forgot to look at is worse than no diagnostic —
it sends you to fix the wrong thing.

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
class TheSelfTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.expo = []
        self.web = []

        async def to_expo(messages, database=None):
            self.expo.extend(messages)
            return {"sent": len(messages)}

        async def to_web(database, user_id, title, body, data):
            self.web.append({"user_id": user_id, "title": title})

        self._expo, server.send_expo_push_messages = server.send_expo_push_messages, to_expo
        self._web, server.send_web_push_to_user = server.send_web_push_to_user, to_web

        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u1", "family_id": "fam1", "email": "r@x.test"}))
        self.user = {"user_id": "u1", "family_id": "fam1", "email": "r@x.test"}

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web

    def run_test_push(self):
        return asyncio.run(server.test_notification(user=self.user))

    def add_phone(self):
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"user_id": "u1", "family_id": "fam1", "active": True,
             "token": "ExponentPushToken[abc]", "platform": "android"}))

    def add_browser(self):
        asyncio.run(self.db["web_push_subscriptions"].insert_one(
            {"user_id": "u1", "active": True, "endpoint": "https://push.example/x"}))

    def test_a_phone_is_reported_and_pushed(self):
        self.add_phone()
        res = self.run_test_push()
        self.assertEqual(res["tokens"], 1)
        self.assertEqual(res["devices"], 1)
        self.assertEqual(len(self.expo), 1)

    def test_a_browser_counts_as_a_device(self):
        """The whole bug: no Expo token, a working subscription, and the old
        reply said zero."""
        self.add_browser()
        res = self.run_test_push()
        self.assertEqual(res["tokens"], 0)
        self.assertEqual(res["browsers"], 1)
        self.assertEqual(res["devices"], 1)
        self.assertEqual(len(self.web), 1)

    def test_both_rails_are_used_when_both_exist(self):
        self.add_phone()
        self.add_browser()
        res = self.run_test_push()
        self.assertEqual(res["devices"], 2)
        self.assertEqual(len(self.expo), 1)
        self.assertEqual(len(self.web), 1)

    def test_nothing_registered_says_so_honestly(self):
        res = self.run_test_push()
        self.assertEqual(res["devices"], 0)
        self.assertEqual(self.expo, [])
        self.assertEqual(self.web, [])

    def test_a_dormant_browser_is_not_counted(self):
        asyncio.run(self.db["web_push_subscriptions"].insert_one(
            {"user_id": "u1", "active": False, "endpoint": "https://push.example/old"}))
        self.assertEqual(self.run_test_push()["devices"], 0)

    def test_another_persons_devices_are_never_counted(self):
        asyncio.run(self.db["web_push_subscriptions"].insert_one(
            {"user_id": "u2", "active": True, "endpoint": "https://push.example/other"}))
        self.add_phone()
        res = self.run_test_push()
        self.assertEqual(res["browsers"], 0)
        self.assertEqual(res["devices"], 1)

    def test_it_still_sends_when_reminders_are_off_but_says_they_are(self):
        """Deliberate: this is the "does the plumbing work" question, so it must
        answer it. But a person whose toggle is off needs telling why the real
        ones stay quiet — otherwise a successful test deepens the confusion."""
        self.add_phone()
        asyncio.run(self.db["notification_settings"].insert_one(
            {"user_id": "u1", "card_reminders": False}))
        res = self.run_test_push()
        self.assertEqual(len(self.expo), 1)
        self.assertFalse(res["reminders_enabled"])

    def test_untouched_settings_read_as_on(self):
        self.add_phone()
        self.assertTrue(self.run_test_push()["reminders_enabled"])


if __name__ == "__main__":
    unittest.main()
