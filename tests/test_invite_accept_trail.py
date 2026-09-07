"""Was the inviter actually told when their invite landed?

Field report, 2026-09-07: "I sent her the invite and she got a notification of
the invite on the app but I did not get the notification when she joined."
The accept path did call the inviter's push — fire-and-forget, result
discarded — so whether it reached a phone, found no phone registered, or
failed at the sender was unknowable after the fact. These tests pin the trail
that makes it knowable, and the admin read-out that surfaces it.

Run with:  python3 -m pytest tests/test_invite_accept_trail.py -q
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
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheTrail(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.expo = []
        self.web_result = 0

        async def to_expo(messages, database=None):
            self.expo.extend(messages)
            return {"sent": len(messages)}

        async def to_web(database, user_id, title, body, data):
            return self.web_result

        self._expo, server.send_expo_push_messages = server.send_expo_push_messages, to_expo
        self._web, server.send_web_push_to_user = server.send_web_push_to_user, to_web
        self._add = server.add_user_to_family_if_needed

        async def fake_add(database, user, family_id, role=None):
            return None
        server.add_user_to_family_if_needed = fake_add

        run = asyncio.run
        run(self.db["users"].insert_one(
            {"user_id": "u_roland", "email": "r@x.test", "name": "Roland",
             "family_id": "fam_main", "language": "fr"}))
        run(self.db["users"].insert_one(
            {"user_id": "u_keigh", "email": "k@x.test", "name": "Keigh",
             "family_id": "fam_solo", "language": "en"}))
        self.invite = server._new_invite_doc(
            {"user_id": "u_roland", "family_id": "fam_main", "name": "Roland", "email": "r@x.test"},
            email="k@x.test", relationship="Co-parent")
        run(self.db["family_invites"].insert_one(dict(self.invite)))

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web
        server.add_user_to_family_if_needed = self._add

    def _register_phone(self):
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_roland", "token": "ExponentPushToken[roland]", "active": True,
             "platform": "android", "updated_at": server.utcnow()}))

    def _accept(self):
        keigh = asyncio.run(self.db["users"].find_one({"user_id": "u_keigh"}, {"_id": 0}))
        return asyncio.run(server._accept_invite_for_user(
            self.db, keigh, dict(self.invite), "fam_main"))

    def _stored(self):
        return asyncio.run(self.db["family_invites"].find_one(
            {"invite_id": self.invite["invite_id"]}, {"_id": 0}))

    def test_send_push_to_user_says_what_it_reached(self):
        self._register_phone()
        self.web_result = 2
        reached = asyncio.run(server.send_push_to_user(
            self.db, "u_roland", "T", "B", {"type": "t"}))
        self.assertEqual(reached["devices"], 1)
        self.assertEqual(reached["web"], 2)
        self.assertEqual(len(self.expo), 1)

    def test_send_push_to_user_still_never_raises(self):
        async def explode(messages, database=None):
            raise RuntimeError("exp.host down")
        server.send_expo_push_messages = explode
        self._register_phone()
        reached = asyncio.run(server.send_push_to_user(
            self.db, "u_roland", "T", "B", {"type": "t"}))
        self.assertIn("exp.host down", reached["error"])

    def test_accepting_records_that_the_inviter_was_told(self):
        self._register_phone()
        self._accept()
        stored = self._stored()
        self.assertEqual(stored["status"], "accepted")
        trail = stored["accepted_notify"]
        self.assertEqual(trail["inviter_id"], "u_roland")
        self.assertEqual(trail["devices"], 1)
        self.assertNotIn("skipped", trail)
        # And the push itself went to the INVITER, in the inviter's language.
        self.assertEqual(self.expo[0]["to"], "ExponentPushToken[roland]")
        self.assertEqual(self.expo[0]["data"]["type"], "invite_accepted")
        self.assertIn("Keigh", self.expo[0]["title"])

    def test_accepting_records_when_nobody_could_be_told(self):
        # No phone, no browser: the join still works, and the trail says WHY
        # the inviter heard nothing rather than leaving it a mystery.
        self._accept()
        trail = self._stored()["accepted_notify"]
        self.assertEqual(trail["devices"], 0)
        self.assertEqual(trail["web"], 0)
        self.assertIn("no registered device", trail["skipped"])
        self.assertEqual(self.expo, [])

    def test_accepting_records_a_sender_failure(self):
        async def explode(messages, database=None):
            raise RuntimeError("exp.host down")
        server.send_expo_push_messages = explode
        self._register_phone()
        user, joined = self._accept()
        self.assertTrue(joined)
        trail = self._stored()["accepted_notify"]
        self.assertIn("exp.host down", trail["skipped"])

    def test_the_join_survives_a_trail_that_cannot_be_written(self):
        # notify_invite_accepted writes the trail; if that write blows up the
        # person must still be in the household.
        self._register_phone()
        real_update = self.db["family_invites"].update_one
        calls = {"n": 0}

        async def flaky(query, update, upsert=False):
            if "accepted_notify" in (update.get("$set") or {}):
                raise RuntimeError("write failed")
            return await real_update(query, update, upsert)
        self.db["family_invites"].update_one = flaky
        user, joined = self._accept()
        self.assertTrue(joined)
        self.assertEqual(user["family_id"], "fam_main")
        self.assertEqual(self._stored()["status"], "accepted")


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheReadOut(unittest.TestCase):
    """The admin Invites panel shows, per accepted invite, whether the
    inviter was told — so the next "I never got the notification" is a
    lookup and not an investigation."""

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        server.ADMIN_EMAILS.add("boss@ahenora.test")
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db

    def _inv(self, email, trail=None, status="accepted"):
        doc = {"invite_id": f"inv_{email}", "email": email, "family_id": "famA",
               "status": status, "created_at": self.now - timedelta(days=1),
               "expires_at": self.now + timedelta(days=7)}
        if trail is not None:
            doc["accepted_notify"] = trail
        asyncio.run(self.db["family_invites"].insert_one(doc))

    def _read(self):
        return asyncio.run(server.metrics_invites(
            days=30, user={"user_id": "u_admin", "email": "boss@ahenora.test"},
            database=self.db))

    def test_reached_unreachable_and_unrecorded_are_told_apart(self):
        self._inv("a@x.test", {"devices": 1, "web": 0})
        self._inv("b@x.test", {"devices": 0, "web": 1})
        self._inv("c@x.test", {"devices": 0, "web": 0, "skipped": "nobody"})
        self._inv("d@x.test")                       # accepted before the trail existed
        self._inv("e@x.test", status="pending")     # not accepted: not counted at all
        told = self._read()["inviter_told"]
        self.assertEqual(told, {"reached": 2, "unreachable": 1, "not_recorded": 1})


if __name__ == "__main__":
    unittest.main()
