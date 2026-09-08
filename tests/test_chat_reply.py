"""Answering a particular message.

"Yes" three messages later is ambiguous in a household that is coordinating
five things at once; pointing at the one you mean is most of what makes a
messenger feel like a messenger.

The interesting part is not the feature, it is the hole it opens. A reply
carries a message id chosen by the client and renders that message's text back
inside the answer. Look it up by id alone and any account in the family can
read a line out of a conversation it is not in — the access model bypassed by
a field rather than by the door. So the parent is fetched with the family AND
the thread in the query, and that is what most of this file is about.

Run with:  python3 -m pytest tests/test_chat_reply.py -q
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
    from fastapi import HTTPException


def Msg(text, reply_to=None):
    """The real request model, so these tests cannot drift from the shape the
    endpoint is actually handed."""
    return server.ChatMessageIn(text=text, reply_to=reply_to)


@unittest.skipUnless(HAVE, "backend deps not installed")
class Replying(unittest.TestCase):
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
        # Two parents and a teen: the teen is in the household but NOT in the
        # adults' room, which is what makes the leak test meaningful.
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
        self.teen = {"user_id": "u_t", "family_id": "fam", "name": "Ama"}

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web

    def _say(self, who, text, thread="adults", reply_to=None):
        return asyncio.run(
            server.family_chat_send(thread, Msg(text, reply_to), user=who))["message"]

    def _read(self, who, thread="adults"):
        return asyncio.run(server.family_chat_get(thread, user=who))["messages"]

    # --- what it does ----------------------------------------------------

    def test_a_reply_carries_who_and_what_it_answers(self):
        first = self._say(self.a, "Dentist Thursday or Friday?")
        answer = self._say(self.b, "Friday", reply_to=first["message_id"])
        self.assertEqual(answer["reply_to"], first["message_id"])
        self.assertEqual(answer["reply_to_name"], "Roland")
        self.assertEqual(answer["reply_to_text"], "Dentist Thursday or Friday?")

    def test_the_quote_survives_the_original_scrolling_out_of_reach(self):
        # A snapshot, not a live join: the quoted message can be older than the
        # page a client fetches, and a reply that renders blank is worse than
        # no reply feature at all.
        first = self._say(self.a, "the original")
        answer = self._say(self.b, "answering it", reply_to=first["message_id"])
        asyncio.run(self.db["messages"].delete_one({"message_id": first["message_id"]}))
        again = self._read(self.a)[-1]
        self.assertEqual(again["reply_to_text"], "the original")

    def test_a_plain_message_carries_no_quote_at_all(self):
        plain = self._say(self.a, "just talking")
        self.assertNotIn("reply_to", plain)
        self.assertNotIn("reply_to_text", plain)

    def test_a_long_quote_is_cut_rather_than_copied_whole(self):
        long_one = self._say(self.a, "x" * 900)
        answer = self._say(self.b, "ok", reply_to=long_one["message_id"])
        self.assertEqual(len(answer["reply_to_text"]), server.REPLY_QUOTE_LEN)

    # --- the hole it would have opened -----------------------------------

    def test_you_cannot_quote_a_message_from_a_thread_you_are_not_in(self):
        """The whole point of validating against the thread.

        Ama is in the household and has her own conversation with her parents.
        The adults' room is not hers. If a reply looked its parent up by id
        alone, sending "ok" into her own thread quoting an adults-room id would
        render that private line straight back to her.
        """
        private = self._say(self.a, "We should talk about her school report")
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.teen_chat_send(
                Msg("ok", reply_to=private["message_id"]),
                teen={"user": {"user_id": "u_t", "name": "Ama"}, "family_id": "fam"}))
        self.assertEqual(caught.exception.status_code, 404)
        # And nothing was written: a rejected reply must not land as a plain
        # message either.
        rows = asyncio.run(self.db["messages"].find({"thread": "u_t"}, {"_id": 0}).to_list(10))
        self.assertEqual(rows, [])

    def test_you_cannot_quote_a_message_from_another_household(self):
        asyncio.run(self.db["messages"].insert_one(
            {"message_id": "msg_elsewhere", "family_id": "other_fam", "thread": "adults",
             "sender_user_id": "u_x", "sender_name": "Stranger",
             "text": "someone else's private life", "read_by": [],
             "created_at": server.utcnow()}))
        with self.assertRaises(HTTPException) as caught:
            self._say(self.b, "ok", reply_to="msg_elsewhere")
        self.assertEqual(caught.exception.status_code, 404)

    def test_a_reply_to_something_that_does_not_exist_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self._say(self.a, "ok", reply_to="msg_nope")
        self.assertEqual(caught.exception.status_code, 404)

    def test_an_empty_reply_is_still_an_empty_message(self):
        first = self._say(self.a, "something")
        with self.assertRaises(HTTPException) as caught:
            self._say(self.b, "   ", reply_to=first["message_id"])
        self.assertEqual(caught.exception.status_code, 400)


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheScreen(unittest.TestCase):
    def setUp(self):
        path = os.path.join(os.path.dirname(__file__), "..",
                            "frontend", "src", "components", "ChatThread.tsx")
        with open(path, encoding="utf-8") as fh:
            self.source = fh.read()

    def test_replying_is_a_long_press_not_a_tap(self):
        # A tap would fire every time a thumb catches a bubble while scrolling.
        self.assertIn("onLongPress={() => setReplyTo(item)}", self.source)
        self.assertNotIn("onPress={() => setReplyTo(item)}", self.source)

    def test_you_can_change_your_mind(self):
        self.assertIn("chat-reply-cancel", self.source)
        self.assertIn("setReplyTo(null)", self.source)

    def test_sending_clears_what_you_were_answering(self):
        # Otherwise every later message silently quotes the same old one.
        self.assertIn("send(body, replyTo?.message_id)", self.source)

    def test_the_quoted_line_cannot_push_the_cancel_button_off_screen(self):
        # The flexbox trap that shipped an off-screen button on the teen
        # screen two days ago: a flex child will not shrink below its content.
        self.assertIn("replyBarText: { flex: 1, minWidth: 0 }", self.source)


if __name__ == "__main__":
    unittest.main()
