"""A conversation left open shows what arrives in it.

Until 2026-09-08 the chat screen loaded once and never again: a reply landed
on the server, the push went out, and the open conversation showed nothing
until you navigated away and back. The only way to read it was to tap the
notification — which is what Roland reported.

Two things had to be true before a screen could poll:

  A read had to be BOUNDED. `_chat_thread_messages` returned every message
  ever sent in the thread, sorted in Python. A household chatting daily for a
  year would have downloaded thousands of rows to look at the last three, and
  polling would have done it every few seconds.

  A read had to be able to return NOTHING. Without a cursor, every poll ships
  the whole history again and the client diffs it.

The cursor is `changed_at`, not `created_at`: since 2026-09-08 a message also
changes when someone READS it (that is how a "Seen" tick reaches the sender
without reopening the screen), and a cursor pinned to send time could never
move past such a change — every poll would re-ship the same row forever.

Run with:  python3 -m pytest tests/test_chat_live.py -q
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


def Msg(text, **kw):
    """The real request model, not a stand-in.

    A hand-written stub with just a `.text` broke silently the day the endpoint
    started reading a second field off the payload: eleven tests failed at once
    on a change that was correct. Building the actual model means these tests
    cannot drift from the shape the endpoint is given.
    """
    return server.ChatMessageIn(text=text, **kw)


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheThreadRead(unittest.TestCase):
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
        for uid, name, member in (("u_a", "Roland", "m_a"), ("u_b", "Keigh", "m_b")):
            run(self.db["users"].insert_one(
                {"user_id": uid, "family_id": "fam", "name": name, "language": "en"}))
            run(self.db["family_members"].insert_one(
                {"member_id": member, "family_id": "fam", "name": name,
                 "role": "parent", "user_id": uid}))
        self.a = {"user_id": "u_a", "family_id": "fam", "name": "Roland"}
        self.b = {"user_id": "u_b", "family_id": "fam", "name": "Keigh"}

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web

    def _say(self, who, text):
        return asyncio.run(server.family_chat_send("adults", Msg(text), user=who))

    def _read(self, who, since=None):
        return asyncio.run(server.family_chat_get("adults", since=since, user=who))["messages"]

    # --- the cursor ------------------------------------------------------

    def test_a_poll_of_a_quiet_thread_returns_nothing(self):
        self._say(self.a, "Can you get the kids?")
        msgs = self._read(self.b)
        self.assertEqual(len(msgs), 1)
        cursor = msgs[-1]["changed_at"]
        self.assertEqual(self._read(self.b, since=cursor), [],
                         "a poll with nothing new must be an empty answer, not the history")

    def test_a_poll_returns_only_what_arrived_after_the_cursor(self):
        self._say(self.a, "first")
        cursor = self._read(self.b)[-1]["changed_at"]
        self._say(self.a, "second")
        self._say(self.a, "third")
        fresh = self._read(self.b, since=cursor)
        self.assertEqual([m["text"] for m in fresh], ["second", "third"])

    def test_the_first_read_still_returns_the_history(self):
        for text in ("one", "two", "three"):
            self._say(self.a, text)
        self.assertEqual([m["text"] for m in self._read(self.b)], ["one", "two", "three"])

    # --- the bound -------------------------------------------------------

    def test_a_read_is_bounded(self):
        now = server.utcnow()
        rows = [{"message_id": f"m{i}", "family_id": "fam", "thread": "adults",
                 "sender_user_id": "u_a", "sender_name": "Roland", "sender_kind": "parent",
                 "text": f"msg {i}", "read_by": [],
                 "created_at": now - timedelta(minutes=server.CHAT_PAGE + 50 - i)}
                for i in range(server.CHAT_PAGE + 50)]
        asyncio.run(self.db["messages"].insert_many(rows))
        msgs = self._read(self.b)
        self.assertEqual(len(msgs), server.CHAT_PAGE)
        # The NEWEST page, not the oldest — the point of a chat is the end of it.
        self.assertEqual(msgs[-1]["text"], f"msg {server.CHAT_PAGE + 49}")

    # --- reading marks read, polling for nothing does not write ----------

    def test_reading_marks_the_thread_read(self):
        self._say(self.a, "hello")
        # Unread to Keigh until she opens it; read once she has.
        stored = asyncio.run(self.db["messages"].find({}, {"_id": 0}).to_list(10))
        self.assertNotIn("u_b", stored[0].get("read_by") or [])
        self._read(self.b)
        stored = asyncio.run(self.db["messages"].find({}, {"_id": 0}).to_list(10))
        self.assertIn("u_b", stored[0].get("read_by") or [])

    def test_an_empty_poll_writes_nothing(self):
        self._say(self.a, "hello")
        cursor = self._read(self.b)[-1]["changed_at"]
        calls = []
        real = server._mark_read

        async def counted(*a, **k):
            calls.append(1)
            return await real(*a, **k)
        server._mark_read = counted
        try:
            self.assertEqual(self._read(self.b, since=cursor), [])
        finally:
            server._mark_read = real
        self.assertEqual(calls, [], "a poll returning nothing must not write to the database")


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheScreenPolls(unittest.TestCase):
    """A backend that can stream and a screen that never asks is the bug."""

    def setUp(self):
        path = os.path.join(os.path.dirname(__file__), "..",
                            "frontend", "src", "components", "ChatThread.tsx")
        with open(path, encoding="utf-8") as fh:
            self.source = fh.read()

    def test_it_asks_again_while_it_is_open(self):
        self.assertIn("setInterval", self.source)
        self.assertIn("refresh(true)", self.source)

    def test_it_stops_while_the_app_is_in_the_background(self):
        # A timer fetching a screen nobody is looking at is just battery.
        self.assertIn("AppState.addEventListener", self.source)
        self.assertIn("clearInterval", self.source)

    def test_it_merges_rather_than_appends(self):
        # The sent message is added locally AND comes back from the next poll;
        # appending blindly would show it twice.
        self.assertIn("new Map(prev.map", self.source)

    def test_it_does_not_yank_a_reader_to_the_bottom(self):
        self.assertIn("atBottom", self.source)


if __name__ == "__main__":
    unittest.main()
