"""Did that land? — the other half of "read".

The chat has always recorded `read_by`, and has always used it for exactly one
thing: the viewer's own unread badge. So the app could tell you there were two
messages you had not opened, and could never tell you whether the message YOU
sent had been opened by anybody. In a co-parenting app that is the question
that actually gets asked — "did you see what I sent about Friday?" — and the
answer was sitting unused in the database.

Two properties matter more than the tick itself:

  It must be countable from what is already stored. A second record of who has
  seen what could disagree with the badge; this one cannot, because it IS the
  badge's data.

  It must arrive without reopening the screen. A message being read does not
  make it newer, so a cursor pinned to send time would never carry the change
  — the same shape of bug as the one that made the whole thread static.

Run with:  python3 -m pytest tests/test_chat_seen.py -q
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


class Msg:
    def __init__(self, text):
        self.text = text


@unittest.skipUnless(HAVE, "backend deps not installed")
class Base(unittest.TestCase):
    people = (("u_a", "Roland", "m_a", "parent"), ("u_b", "Keigh", "m_b", "co-parent"))

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
        for uid, name, member, role in self.people:
            run(self.db["users"].insert_one(
                {"user_id": uid, "family_id": "fam", "name": name, "language": "en"}))
            run(self.db["family_members"].insert_one(
                {"member_id": member, "family_id": "fam", "name": name,
                 "role": role, "user_id": uid}))
        self.a = {"user_id": "u_a", "family_id": "fam", "name": "Roland"}
        self.b = {"user_id": "u_b", "family_id": "fam", "name": "Keigh"}
        self.c = {"user_id": "u_c", "family_id": "fam", "name": "Third"}

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web

    def _say(self, who, text):
        return asyncio.run(server.family_chat_send("adults", Msg(text), user=who))["message"]

    def _read(self, who, since=None):
        return asyncio.run(server.family_chat_get("adults", since=since, user=who))["messages"]


class TheTick(Base):
    def test_a_message_nobody_has_opened_is_not_seen(self):
        sent = self._say(self.a, "Can you get the kids Friday?")
        self.assertFalse(sent["seen"])
        self.assertEqual(sent["seen_by"], 0)
        self.assertEqual(sent["audience"], 1)

    def test_it_turns_seen_once_the_other_person_opens_the_thread(self):
        self._say(self.a, "Can you get the kids Friday?")
        self._read(self.b)
        mine = self._read(self.a)[-1]
        self.assertTrue(mine["seen"])
        self.assertEqual(mine["seen_by"], 1)

    def test_reading_your_own_message_does_not_make_it_seen(self):
        # Otherwise every message is "seen" the instant you send it, which is
        # a lie told confidently — worse than saying nothing.
        self._say(self.a, "hello")
        self.assertFalse(self._read(self.a)[-1]["seen"])

    def test_a_receipt_counts_only_the_people_actually_in_the_thread(self):
        # A helper or a teen is in the household but not in the adults' room,
        # and must not hold the tick back forever.
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u_t", "family_id": "fam", "name": "Ama", "language": "en"}))
        asyncio.run(self.db["family_members"].insert_one(
            {"member_id": "m_t", "family_id": "fam", "name": "Ama",
             "role": "teen", "user_id": "u_t"}))
        self._say(self.a, "grown-ups only")
        self._read(self.b)
        self.assertTrue(self._read(self.a)[-1]["seen"])

    def test_three_people_report_partial_before_everyone(self):
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u_c", "family_id": "fam", "name": "Third", "language": "en"}))
        asyncio.run(self.db["family_members"].insert_one(
            {"member_id": "m_c", "family_id": "fam", "name": "Third",
             "role": "parent", "user_id": "u_c"}))
        self._say(self.a, "all three of us")
        self._read(self.b)
        mine = self._read(self.a)[-1]
        self.assertEqual((mine["seen_by"], mine["audience"]), (1, 2))
        self.assertFalse(mine["seen"], "one of two is not everyone")
        self._read(self.c)
        self.assertTrue(self._read(self.a)[-1]["seen"])

    def test_read_still_means_the_viewer_and_seen_means_the_others(self):
        """The two are different facts about the same message and adding one
        must not have quietly redefined the other."""
        self._say(self.a, "hello")

        # To Keigh, before she has opened it: `read` is false because it is
        # hers to answer. `seen` is NOT viewer-relative — it is a fact about
        # the message, so it reads the same to both of them.
        row = asyncio.run(self.db["messages"].find({}, {"_id": 0}).to_list(10))[-1]
        pending = server.public_chat_message(row, "u_b", {"u_a", "u_b"})
        self.assertFalse(pending["read"], "she has not opened it")
        self.assertFalse(pending["seen"], "and so it has not been seen")

        # To Roland: read (he wrote it) but not yet seen by her.
        mine = self._read(self.a)[-1]
        self.assertTrue(mine["read"])
        self.assertFalse(mine["seen"])


class ItArrivesWithoutReopening(Base):
    """The tick has to travel on the same cursor the messages do."""

    def test_a_message_becoming_seen_comes_back_to_a_polling_sender(self):
        self._say(self.a, "Friday?")
        cursor = self._read(self.a)[-1]["changed_at"]
        self.assertEqual(self._read(self.a, since=cursor), [], "nothing has happened yet")
        self._read(self.b)                              # Keigh opens the thread
        fresh = self._read(self.a, since=cursor)
        self.assertEqual(len(fresh), 1, "the sender must be told, without reopening")
        self.assertTrue(fresh[0]["seen"])

    def test_the_cursor_can_move_past_a_read(self):
        # The failure this guards: read_at is newer than created_at, so a
        # cursor pinned to send time would return the same row on EVERY poll
        # for the rest of the conversation.
        self._say(self.a, "Friday?")
        self._read(self.b)
        cursor = self._read(self.a)[-1]["changed_at"]
        self.assertEqual(self._read(self.a, since=cursor), [],
                         "a seen message must stop coming back once acknowledged")

    def test_a_readers_own_cursor_is_not_left_behind_by_their_own_read(self):
        """The ordering bug, pinned.

        Marking the thread read AFTER serialising the rows stamps a change the
        returned rows do not carry: the cursor the reader stores is older than
        the change its own read just made, so every poll from then on is handed
        the entire page again — a live chat that re-downloads its history every
        four seconds, quietly, forever.
        """
        self._say(self.a, "Friday?")
        cursor = self._read(self.b)[-1]["changed_at"]
        self.assertEqual(self._read(self.b, since=cursor), [],
                         "a reader must not be re-sent the page its own read stamped")

    def test_changed_at_is_never_older_than_created_at(self):
        sent = self._say(self.a, "hello")
        self.assertGreaterEqual(sent["changed_at"], sent["created_at"])

    def test_a_second_read_by_the_same_person_writes_nothing_new(self):
        self._say(self.a, "hello")
        self._read(self.b)
        after_first = asyncio.run(self.db["messages"].find({}, {"_id": 0}).to_list(10))[-1]
        self._read(self.b)
        after_second = asyncio.run(self.db["messages"].find({}, {"_id": 0}).to_list(10))[-1]
        self.assertEqual(after_first.get("read_at"), after_second.get("read_at"),
                         "re-reading an already-read thread must not restamp it, "
                         "or the sender's screen would be handed the same row forever")


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheScreenShowsIt(unittest.TestCase):
    def setUp(self):
        path = os.path.join(os.path.dirname(__file__), "..",
                            "frontend", "src", "components", "ChatThread.tsx")
        with open(path, encoding="utf-8") as fh:
            self.source = fh.read()

    def test_only_the_newest_sent_message_carries_a_receipt(self):
        self.assertIn("lastMineId", self.source)

    def test_the_cursor_follows_changed_at(self):
        self.assertIn("m.changed_at", self.source)

    def test_it_says_nothing_rather_than_guessing(self):
        # A thread whose roster the server did not price must not be labelled
        # "Sent" — that would claim nobody has read a message we know nothing
        # about.
        self.assertIn("typeof m.audience !== 'number'", self.source)


if __name__ == "__main__":
    unittest.main()
