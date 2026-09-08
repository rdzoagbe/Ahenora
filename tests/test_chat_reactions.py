"""Reacting to a message.

The cheapest thing in a messenger and the one people use most: acknowledging
something without adding a message to a conversation that already has enough
of them. In a household chat it replaces most of the "ok"s.

Three decisions worth defending, each with a test:

  ONE PER PERSON. Tapping again takes it back, a different emoji replaces the
  old one. Six taps from the same person under one message is clutter, and in
  a household of five "who felt what" is more useful than a tally.

  A FIXED PALETTE. A free-form emoji field is text chosen by a client, stored,
  and then rendered to everyone in the household — a place to put things that
  are not emoji at all. The server refuses anything outside the list.

  THE SAME DOOR AS EVERYTHING ELSE. A reaction addresses a message by id, so
  the lookup carries the family and the thread; otherwise an id is enough to
  touch a conversation you are not in.

Run with:  python3 -m pytest tests/test_chat_reactions.py -q
"""
import asyncio
import os
import re
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
    from fastapi import HTTPException


def Msg(text, reply_to=None):
    return server.ChatMessageIn(text=text, reply_to=reply_to)


def React(emoji):
    return server.ChatReactionIn(emoji=emoji)


@unittest.skipUnless(HAVE, "backend deps not installed")
class Reacting(unittest.TestCase):
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
                ("u_c", "Gran", "m_c", "parent"),
                ("u_t", "Ama", "m_t", "teen")):
            run(self.db["users"].insert_one(
                {"user_id": uid, "family_id": "fam", "name": name, "language": "en"}))
            run(self.db["family_members"].insert_one(
                {"member_id": member, "family_id": "fam", "name": name,
                 "role": role, "user_id": uid}))
        self.a = {"user_id": "u_a", "family_id": "fam", "name": "Roland"}
        self.b = {"user_id": "u_b", "family_id": "fam", "name": "Keigh"}
        self.c = {"user_id": "u_c", "family_id": "fam", "name": "Gran"}
        self.heart, self.thumb = server.CHAT_REACTIONS[0], server.CHAT_REACTIONS[1]

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web

    def _say(self, who, text):
        return asyncio.run(server.family_chat_send("adults", Msg(text), user=who))["message"]

    def _react(self, who, mid, emoji):
        return asyncio.run(
            server.family_chat_react("adults", mid, React(emoji), user=who))["message"]

    def _read(self, who, since=None):
        return asyncio.run(server.family_chat_get("adults", since=since, user=who))["messages"]

    # --- what it does ----------------------------------------------------

    def test_a_reaction_shows_up_with_a_count_and_whether_it_is_yours(self):
        msg = self._say(self.a, "Dentist booked")
        out = self._react(self.b, msg["message_id"], self.thumb)
        self.assertEqual(out["reactions"], [{"emoji": self.thumb, "count": 1, "mine": True}])
        # And to the other person it is not theirs.
        theirs = self._read(self.a)[-1]
        self.assertEqual(theirs["reactions"], [{"emoji": self.thumb, "count": 1, "mine": False}])

    def test_a_message_nobody_reacted_to_carries_no_reactions_field(self):
        plain = self._say(self.a, "just talking")
        self.assertNotIn("reactions", plain)

    def test_two_people_with_the_same_emoji_count_as_two(self):
        msg = self._say(self.a, "Friday it is")
        self._react(self.b, msg["message_id"], self.thumb)
        out = self._react(self.c, msg["message_id"], self.thumb)
        self.assertEqual(out["reactions"], [{"emoji": self.thumb, "count": 2, "mine": True}])

    def test_the_row_is_ordered_by_the_palette_not_by_who_tapped_first(self):
        # Otherwise the row under a message reshuffles itself as people react,
        # which is exactly the sort of movement that makes a screen feel broken.
        msg = self._say(self.a, "news")
        self._react(self.b, msg["message_id"], self.thumb)     # second in palette
        out = self._react(self.c, msg["message_id"], self.heart)  # first in palette
        self.assertEqual([r["emoji"] for r in out["reactions"]], [self.heart, self.thumb])

    # --- one per person --------------------------------------------------

    def test_the_same_emoji_again_takes_it_back(self):
        msg = self._say(self.a, "hello")
        self._react(self.b, msg["message_id"], self.thumb)
        out = self._react(self.b, msg["message_id"], self.thumb)
        self.assertNotIn("reactions", out)

    def test_a_different_emoji_replaces_it_rather_than_adding_one(self):
        msg = self._say(self.a, "hello")
        self._react(self.b, msg["message_id"], self.thumb)
        out = self._react(self.b, msg["message_id"], self.heart)
        self.assertEqual(out["reactions"], [{"emoji": self.heart, "count": 1, "mine": True}])

    def test_taking_yours_back_leaves_everybody_elses(self):
        msg = self._say(self.a, "hello")
        self._react(self.b, msg["message_id"], self.thumb)
        self._react(self.c, msg["message_id"], self.thumb)
        out = self._react(self.b, msg["message_id"], self.thumb)
        self.assertEqual(out["reactions"], [{"emoji": self.thumb, "count": 1, "mine": False}])

    # --- the palette, and the door ---------------------------------------

    def test_anything_outside_the_palette_is_refused(self):
        msg = self._say(self.a, "hello")
        for bad in ("<script>alert(1)</script>", "not an emoji at all", "", "\U0001f4a9"):
            with self.assertRaises(HTTPException) as caught:
                self._react(self.b, msg["message_id"], bad)
            self.assertEqual(caught.exception.status_code, 400)
        self.assertNotIn("reactions", self._read(self.a)[-1])

    def test_you_cannot_react_to_a_message_in_a_thread_you_are_not_in(self):
        private = self._say(self.a, "about her school report")
        teen = {"user_id": "u_t", "family_id": "fam", "name": "Ama"}
        with self.assertRaises(HTTPException) as caught:
            self._react(teen, private["message_id"], self.thumb)
        # 404 on the thread itself: whether the adults' room exists is not
        # something a teen learns by poking at it.
        self.assertEqual(caught.exception.status_code, 404)

    def test_you_cannot_react_to_another_households_message(self):
        asyncio.run(self.db["messages"].insert_one(
            {"message_id": "msg_elsewhere", "family_id": "other_fam", "thread": "adults",
             "sender_user_id": "u_x", "sender_name": "Stranger", "text": "private",
             "read_by": [], "created_at": server.utcnow()}))
        with self.assertRaises(HTTPException) as caught:
            self._react(self.b, "msg_elsewhere", self.thumb)
        self.assertEqual(caught.exception.status_code, 404)

    def test_reacting_to_something_that_is_gone_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self._react(self.b, "msg_nope", self.thumb)
        self.assertEqual(caught.exception.status_code, 404)

    # --- it has to arrive ------------------------------------------------

    def test_a_reaction_reaches_a_screen_that_is_already_open(self):
        # The point of stamping reacted_at: a reaction nobody sees until they
        # reopen the conversation is not a reaction.
        msg = self._say(self.a, "hello")
        cursor = self._read(self.a)[-1]["changed_at"]
        self.assertEqual(self._read(self.a, since=cursor), [])
        self._react(self.b, msg["message_id"], self.thumb)
        fresh = self._read(self.a, since=cursor)
        self.assertEqual(len(fresh), 1)
        self.assertEqual(fresh[0]["reactions"][0]["emoji"], self.thumb)

    def test_the_cursor_can_move_past_a_reaction(self):
        msg = self._say(self.a, "hello")
        self._react(self.b, msg["message_id"], self.thumb)
        cursor = self._read(self.a)[-1]["changed_at"]
        self.assertEqual(self._read(self.a, since=cursor), [],
                         "or every poll would ship the message again forever")


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheTwoPalettesAgree(unittest.TestCase):
    """The client offers a row of buttons; the server refuses anything not on
    its own list. If they drift, a button in the app returns 400 and nothing
    says why."""

    def test_the_app_offers_exactly_what_the_server_accepts(self):
        path = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "api.ts")
        with open(path, encoding="utf-8") as fh:
            source = fh.read()
        found = re.search(r"export const CHAT_REACTIONS = \[([^\]]*)\]", source)
        self.assertIsNotNone(found, "the app has no reaction palette to compare")
        offered = tuple(re.findall(r"'([^']+)'", found.group(1)))
        self.assertEqual(offered, tuple(server.CHAT_REACTIONS))


if __name__ == "__main__":
    unittest.main()
