"""Correcting what you sent, for a short while, and never invisibly.

Roland chose this shape over delete-for-yourself and over leaving messages
immutable, and the choice matters because of what this app is: two people
coordinating a household, where a message is often the record of what was
agreed. So the interesting part is not the edit. It is the three fences
around it.

  ONLY THE PERSON WHO WROTE IT. Anything else is putting words in somebody's
  mouth inside the app they use to agree things.

  ONLY FOR A SHORT WINDOW. The other person may already have read it.
  "Thursday" must not be able to become "Friday" a week later, sitting next
  to their memory of reading it.

  THE MARKER NEVER COMES OFF. An edit that leaves no trace is a rewrite of
  the record. `edited` is set once and nothing clears it — not a later edit,
  not a reaction, not a read.

Run with:  python3 -m pytest tests/test_chat_edit.py -q
"""
import asyncio
import os
import re
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
    from fastapi import HTTPException


def Msg(text, reply_to=None):
    return server.ChatMessageIn(text=text, reply_to=reply_to)


def Edit(text):
    return server.ChatEditIn(text=text)


@unittest.skipUnless(HAVE, "backend deps not installed")
class Editing(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

        async def quiet(*a, **k):
            return {"sent": 0}
        self._expo, server.send_expo_push_messages = server.send_expo_push_messages, quiet
        self._web = server.send_web_push_to_user

        async def no_web(database, user_id, title, body, data):
            return 0
        server.send_web_push_to_user = no_web

        run = asyncio.run
        for uid, name, member, role in (
                ("u_a", "Roland", "m_a", "parent"),
                ("u_b", "Keigh", "m_b", "co-parent"),
                ("u_t", "Ama", "m_t", "teen")):
            run(self.db["users"].insert_one(
                {"user_id": uid, "family_id": "fam", "name": name, "language": "en"}))
            run(self.db["family_members"].insert_one(
                {"member_id": member, "family_id": "fam", "name": name,
                 "role": role, "user_id": uid}))
        self.a = {"user_id": "u_a", "family_id": "fam", "name": "Roland"}
        self.b = {"user_id": "u_b", "family_id": "fam", "name": "Keigh"}

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web

    def _say(self, who, text):
        return asyncio.run(server.family_chat_send("adults", Msg(text), user=who))["message"]

    def _edit(self, who, mid, text):
        return asyncio.run(
            server.family_chat_edit("adults", mid, Edit(text), user=who))["message"]

    def _read(self, who, since=None):
        return asyncio.run(server.family_chat_get("adults", since=since, user=who))["messages"]

    def _age(self, mid, minutes):
        """Push a message into the past, since the window is measured from
        when it was sent."""
        asyncio.run(self.db["messages"].update_one(
            {"message_id": mid},
            {"$set": {"created_at": server.utcnow() - timedelta(minutes=minutes)}}))

    # --- what it does ----------------------------------------------------

    def test_you_can_fix_what_you_just_sent(self):
        msg = self._say(self.a, "Dentist on Thurdsay")
        out = self._edit(self.a, msg["message_id"], "Dentist on Thursday")
        self.assertEqual(out["text"], "Dentist on Thursday")
        self.assertTrue(out["edited"])

    def test_the_other_person_sees_the_correction_and_the_marker(self):
        msg = self._say(self.a, "Dentist on Thurdsay")
        self._edit(self.a, msg["message_id"], "Dentist on Thursday")
        theirs = self._read(self.b)[-1]
        self.assertEqual(theirs["text"], "Dentist on Thursday")
        self.assertTrue(theirs["edited"])

    def test_an_untouched_message_carries_no_marker(self):
        self.assertNotIn("edited", self._say(self.a, "plain"))

    def test_opening_the_box_and_changing_nothing_does_not_brand_it(self):
        # Re-sending identical text must not make a message look rewritten.
        msg = self._say(self.a, "unchanged")
        out = self._edit(self.a, msg["message_id"], "unchanged")
        self.assertNotIn("edited", out)
        self.assertNotIn("edited", self._read(self.b)[-1])

    # --- only the person who wrote it ------------------------------------

    def test_you_cannot_edit_somebody_elses_message(self):
        msg = self._say(self.a, "I'll collect them at four")
        with self.assertRaises(HTTPException) as caught:
            self._edit(self.b, msg["message_id"], "I'll collect them at six")
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(self._read(self.a)[-1]["text"], "I'll collect them at four")

    def test_you_cannot_edit_into_a_thread_you_are_not_in(self):
        private = self._say(self.a, "about her school report")
        teen = {"user_id": "u_t", "family_id": "fam", "name": "Ama"}
        with self.assertRaises(HTTPException) as caught:
            self._edit(teen, private["message_id"], "something else")
        self.assertEqual(caught.exception.status_code, 404)

    def test_you_cannot_edit_another_households_message(self):
        asyncio.run(self.db["messages"].insert_one(
            {"message_id": "msg_elsewhere", "family_id": "other_fam", "thread": "adults",
             "sender_user_id": "u_a", "sender_name": "Roland", "text": "theirs",
             "read_by": [], "created_at": server.utcnow()}))
        with self.assertRaises(HTTPException) as caught:
            self._edit(self.a, "msg_elsewhere", "mine now")
        self.assertEqual(caught.exception.status_code, 404)

    # --- only for a short while ------------------------------------------

    def test_an_old_message_can_no_longer_be_changed(self):
        msg = self._say(self.a, "Thursday")
        self._age(msg["message_id"], server.CHAT_EDIT_WINDOW_MINUTES + 1)
        with self.assertRaises(HTTPException) as caught:
            self._edit(self.a, msg["message_id"], "Friday")
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(self._read(self.b)[-1]["text"], "Thursday")

    def test_a_message_just_inside_the_window_can_still_be_fixed(self):
        msg = self._say(self.a, "Thurdsay")
        self._age(msg["message_id"], server.CHAT_EDIT_WINDOW_MINUTES - 1)
        self.assertEqual(self._edit(self.a, msg["message_id"], "Thursday")["text"], "Thursday")

    # --- the marker is permanent ------------------------------------------

    def test_a_second_edit_does_not_clear_the_marker(self):
        msg = self._say(self.a, "one")
        self._edit(self.a, msg["message_id"], "two")
        out = self._edit(self.a, msg["message_id"], "three")
        self.assertTrue(out["edited"])

    def test_reading_and_reacting_leave_the_marker_alone(self):
        msg = self._say(self.a, "one")
        self._edit(self.a, msg["message_id"], "two")
        self._read(self.b)
        asyncio.run(server.family_chat_react(
            "adults", msg["message_id"],
            server.ChatReactionIn(emoji=server.CHAT_REACTIONS[1]), user=self.b))
        self.assertTrue(self._read(self.a)[-1]["edited"])

    # --- an edit is not a delete ------------------------------------------

    def test_emptying_a_message_is_refused_rather_than_deleting_it(self):
        # Deleting is a different decision with different consequences and
        # must not arrive by accident through the edit box.
        msg = self._say(self.a, "something")
        for blank in ("", "   ", "\n\n"):
            with self.assertRaises(HTTPException) as caught:
                self._edit(self.a, msg["message_id"], blank)
            self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(self._read(self.b)[-1]["text"], "something")

    # --- it has to arrive -------------------------------------------------

    def test_an_edit_reaches_a_screen_that_is_already_open(self):
        msg = self._say(self.a, "Thurdsay")
        cursor = self._read(self.b)[-1]["changed_at"]
        self.assertEqual(self._read(self.b, since=cursor), [])
        self._edit(self.a, msg["message_id"], "Thursday")
        fresh = self._read(self.b, since=cursor)
        self.assertEqual(len(fresh), 1)
        self.assertEqual(fresh[0]["text"], "Thursday")

    def test_the_cursor_can_move_past_an_edit(self):
        msg = self._say(self.a, "one")
        self._edit(self.a, msg["message_id"], "two")
        cursor = self._read(self.b)[-1]["changed_at"]
        self.assertEqual(self._read(self.b, since=cursor), [],
                         "or every poll would ship the message again forever")


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheTeenGetsTheSameConversation(unittest.TestCase):
    """A teen's thread runs through the same helpers, so it cannot quietly
    become a lesser chat than the one the grown-ups have."""

    def test_the_teen_endpoints_share_the_grown_ups_rules(self):
        import inspect
        for fn in (server.teen_chat_edit, server.teen_chat_react):
            source = inspect.getsource(fn)
            self.assertIn("_chat_", source)
        # And the teen can only ever address their own thread, whatever id
        # they send: the thread key is their user id, not a parameter.
        self.assertIn('tuid, message_id, tuid', inspect.getsource(server.teen_chat_edit))


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheTwoWindowsAgree(unittest.TestCase):
    """The app decides whether to OFFER an Edit button; the server decides
    whether to allow it. If they drift, the button is there and returns 403."""

    def test_the_app_offers_the_window_the_server_enforces(self):
        path = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "api.ts")
        with open(path, encoding="utf-8") as fh:
            source = fh.read()
        found = re.search(r"CHAT_EDIT_WINDOW_MINUTES = (\d+)", source)
        self.assertIsNotNone(found, "the app has no edit window to compare")
        self.assertEqual(int(found.group(1)), server.CHAT_EDIT_WINDOW_MINUTES)


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheScreen(unittest.TestCase):
    def setUp(self):
        path = os.path.join(os.path.dirname(__file__), "..",
                            "frontend", "src", "components", "ChatThread.tsx")
        with open(path, encoding="utf-8") as fh:
            self.source = fh.read()

    def test_the_marker_is_shown(self):
        self.assertIn("chat-edited", self.source)

    def test_editing_and_replying_cannot_both_be_on(self):
        # You are either writing something new or fixing something old;
        # sending while both were set would have to pick one silently.
        self.assertIn("setEditing(acting);\n                  setReplyTo(null);", self.source)
        self.assertIn("setReplyTo(acting); setEditing(null);", self.source)

    def test_a_half_typed_message_survives_changing_your_mind(self):
        self.assertIn("draftBeforeEdit", self.source)

    def test_the_button_is_not_offered_once_the_window_has_passed(self):
        self.assertIn("chatCanEdit(acting)", self.source)


if __name__ == "__main__":
    unittest.main()
