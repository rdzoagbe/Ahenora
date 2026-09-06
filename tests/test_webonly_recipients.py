"""A browser-only member is a real member: they must hear everything.

The bug this locks out: new-card alerts, co-parent alerts (hand-off notes,
announcements, redeemed rewards) and the unclaimed-card due reminder all
derived their RECIPIENTS from Expo token rows. A co-parent who only ever used
the web app had no token row, so they were never even a candidate — the send
path could reach browsers, but nobody listed them. They found out days later,
which is the exact failure the app exists to prevent.

Recipients now come from the household's accounts, and each send goes through
send_push_to_user, which fans out to phone AND browser.

Star milestones were fixed the same way, later and separately — they had been
missed when the others were done, which is why the last test here stops
checking senders one at a time and asserts the RULE: no delivery path may read
Expo token rows to decide who hears something.

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

    def test_a_star_milestone_reaches_the_web_only_parent(self):
        """Missed when the others were fixed. A child hitting 50 stars is the
        single most celebratory thing the app does, and the parent who uses the
        web app — or an iPhone running it from Safari — heard nothing."""
        asyncio.run(server.send_star_milestone_alert("fam1", "Ama", 49, 50))
        self.assertIn("u_k", self._recipients())
        self.assertIn("u_r", self._recipients())

    def test_a_star_milestone_only_fires_on_crossing(self):
        asyncio.run(server.send_star_milestone_alert("fam1", "Ama", 50, 51))
        self.assertEqual(self.sent, [])

    def test_a_star_milestone_can_be_turned_off(self):
        """It went out through raw token rows, so it never consulted anybody's
        settings — the one alert in the app that could not be silenced."""
        server.send_push_to_user = self._real   # exercise the real gate
        delivered = []

        async def to_expo(messages, database=None):
            delivered.extend(messages)
            return {"sent": len(messages)}
        real_expo, server.send_expo_push_messages = server.send_expo_push_messages, to_expo
        try:
            asyncio.run(self.db["notification_settings"].insert_one(
                {"user_id": "u_r", "new_card_alerts": False}))
            asyncio.run(server.send_star_milestone_alert("fam1", "Ama", 49, 50))
            self.assertEqual(delivered, [])
        finally:
            server.send_expo_push_messages = real_expo


@unittest.skipUnless(HAVE, "backend deps not installed")
class NoSenderPicksRecipientsFromPhones(unittest.TestCase):
    """The rule, not one more instance of it.

    Three senders were fixed for this, then a fourth was found months later
    doing exactly the same thing. Checking each one by name only ever catches
    the ones somebody thought of. A delivery function that iterates
    notification_tokens is choosing PHONES as its audience, and every
    browser-only member is invisible to it by construction.

    send_push_to_user and the test endpoint read that collection legitimately —
    the first is the fan-out itself, the second reports the count back to the
    person asking. Everything else is a bug.
    """

    ALLOWED = {"send_push_to_user", "test_notification", "_push_zones",
               "health_push", "send_expo_push_messages"}

    def test_no_other_function_selects_recipients_from_token_rows(self):
        import inspect
        import re
        source = inspect.getsource(server)
        offenders = []
        # Walk each top-level def and look for a recipient-selecting read.
        for match in re.finditer(r"^(?:async )?def (\w+)\(", source, re.M):
            name = match.group(1)
            start = match.start()
            nxt = source.find("\ndef ", start + 1)
            nxt_async = source.find("\nasync def ", start + 1)
            ends = [e for e in (nxt, nxt_async) if e != -1]
            body = source[start:min(ends)] if ends else source[start:]
            if name in self.ALLOWED:
                continue
            if 'notification_tokens"].find(' not in body:
                continue
            # A read that only counts or reports is fine; one that then builds
            # push messages or calls a send is not.
            if "send_expo_push_messages" in body or "_latest_token_per_user" in body:
                offenders.append(name)
        self.assertEqual(
            offenders, [],
            "these pick push recipients from phone tokens, so browser-only "
            f"members never hear them: {offenders}")


if __name__ == "__main__":
    unittest.main()
