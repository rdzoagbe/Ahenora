"""Family chat: parents talk to each other ('adults' thread) and to each teen
(one thread per teen). The security claim: a teen only ever reaches THEIR OWN
thread — never the adults thread, never another teen's — so "teens see nothing
of the family" holds even with chat on. The messages collection stands alone;
no family data is joined.

Run with:  python3 -m unittest discover -s tests -v
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
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase

PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
COPARENT = {"user_id": "u_p2", "family_id": "fam1", "name": "Awo", "email": "a@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class FamilyChat(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        # Parent, co-parent, and two teens (each with a login).
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_p", "family_id": "fam1", "user_id": "u_p", "name": "Roland", "role": "Parent"}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_p2", "family_id": "fam1", "user_id": "u_p2", "name": "Awo", "role": "co-parent"}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_t", "family_id": "fam1", "user_id": "u_t", "name": "Ama", "role": "teen"}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_t2", "family_id": "fam1", "user_id": "u_t2", "name": "Kofi", "role": "teen"}))

    def tearDown(self):
        server.get_db = self._get_db

    def _teen(self, uid, name):
        return {"user": {"user_id": uid, "family_id": "fam1", "name": name, "is_teen": True},
                "member": None, "family_id": "fam1"}

    def _send_parent(self, thread, text, who=PARENT):
        return asyncio.run(server.family_chat_send(
            thread=thread, payload=server.ChatMessageIn(text=text), user=dict(who)))

    def _teen_msgs(self, uid, name):
        return asyncio.run(server.teen_chat_get(teen=self._teen(uid, name)))["messages"]

    # --- the co-parent conversation is one room, not two ----------------
    def test_coparent_is_the_adults_room_not_a_separate_dm(self):
        threads = asyncio.run(server.family_chat_threads(user=dict(PARENT)))["threads"]
        adults = [t for t in threads if t.get("is_adults")]
        self.assertEqual(len(adults), 1)
        # The adults room carries the co-parent, so every door opens this one key.
        self.assertEqual(adults[0]["title"], "Awo")
        self.assertEqual(adults[0]["member_id"], "m_p2")
        # No separate dm: thread for the co-parent — that split the messages.
        dm_rows = [t for t in threads if str(t["thread"]).startswith(server.DM_PREFIX)]
        self.assertEqual([t for t in dm_rows if t.get("member_id") == "m_p2"], [])

    def test_migration_folds_coparent_dm_into_adults(self):
        # A message sent under the old dm: co-parent key, before the unify.
        key = server.dm_thread("u_p", "u_p2")
        asyncio.run(server._chat_insert(self.db, "fam1", key, "u_p", "parent", "Roland", "sent from her profile"))
        asyncio.run(self.db["families"].insert_one({"family_id": "fam1", "plan": "village"}))
        asyncio.run(server._merge_coparent_dms(self.db))
        # It now lives in the adults room, where both parents read it.
        adults_msgs = asyncio.run(server._chat_thread_messages(self.db, "fam1", server.ADULTS_THREAD, "u_p2"))
        self.assertIn("sent from her profile", [m["text"] for m in adults_msgs])
        # And nothing is left under the old key.
        old = asyncio.run(server._chat_thread_messages(self.db, "fam1", key, "u_p"))
        self.assertEqual(old, [])

    # --- the security claim ---------------------------------------------
    def test_teen_sees_only_their_own_thread(self):
        """Adults chatter and another teen's thread are both invisible to Ama."""
        self._send_parent(server.ADULTS_THREAD, "grown-up talk about the mortgage")
        self._send_parent("u_t2", "Kofi, tidy your room")   # the OTHER teen
        self._send_parent("u_t", "Ama, homework tonight?")   # Ama's thread
        texts = {m["text"] for m in self._teen_msgs("u_t", "Ama")}
        self.assertIn("Ama, homework tonight?", texts)
        self.assertNotIn("grown-up talk about the mortgage", texts)
        self.assertNotIn("Kofi, tidy your room", texts)

    def test_parent_chat_routes_refuse_a_teen(self):
        """Every parent chat route depends on require_full_member -> require_user,
        and require_user 403s a teen token. So a teen can never reach the adults
        thread or another teen's thread through the parent routes."""
        asyncio.run(self.db["users"].insert_one({
            "user_id": "u_t", "family_id": "fam1", "name": "Ama", "is_teen": True}))
        tok = "teentok"
        asyncio.run(self.db["user_sessions"].insert_one({
            "token_hash": server.sha256(tok), "user_id": "u_t",
            "expires_at": server.utcnow() + timedelta(days=1)}))
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.require_user(authorization=f"Bearer {tok}"))
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, "teen_mode")

    def test_a_helper_can_use_the_household_room_but_not_the_grown_ups_one(self):
        """Helpers were shut out of chat entirely, which made coordinating a
        school run impossible. They are in the household now — and still not in
        the room where the parents talk about money."""
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_h", "family_id": "fam1", "user_id": "u_h",
            "name": "Grandma", "role": "helper"}))
        helper = {"user_id": "u_h", "family_id": "fam1", "name": "Grandma", "is_helper": True}
        asyncio.run(server.family_chat_send(
            thread=server.HOUSEHOLD_THREAD, payload=server.ChatMessageIn(text="I can do the 5pm run"),
            user=dict(helper)))
        seen = asyncio.run(server.family_chat_get(
            thread=server.HOUSEHOLD_THREAD, user=dict(PARENT)))["messages"]
        self.assertIn("I can do the 5pm run", {m["text"] for m in seen})

        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.family_chat_get(thread=server.ADULTS_THREAD, user=dict(helper)))
        self.assertEqual(ctx.exception.status_code, 404)

    # --- the new model: threads are defined by who is in them -------------
    def test_two_parents_get_a_private_one_to_one(self):
        dm = server.dm_thread("u_p", "u_p2")
        self._send_parent(dm, "did you pay the nursery invoice?")
        seen = asyncio.run(server.family_chat_get(thread=dm, user=dict(COPARENT)))["messages"]
        self.assertIn("did you pay the nursery invoice?", {m["text"] for m in seen})
        # And it is not the adults room, nor visible to a teen.
        with self.assertRaises(server.HTTPException):
            asyncio.run(server.family_chat_get(
                thread=dm, user={"user_id": "u_t", "family_id": "fam1", "is_teen": True}))

    def test_a_teen_cannot_open_another_teens_conversation(self):
        self._send_parent("u_t2", "Kofi, bins tonight")
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.family_chat_get(
                thread="u_t2", user={"user_id": "u_t", "family_id": "fam1", "is_teen": True}))
        self.assertEqual(ctx.exception.status_code, 404)

    def test_two_teens_are_not_given_a_private_channel(self):
        """Every private thread has a parent in it. A sibling-to-sibling channel
        no parent can see is not something a family app should open by accident."""
        dm = server.dm_thread("u_t", "u_t2")
        self.assertIsNone(asyncio.run(
            server._thread_participants(self.db, "fam1", dm)))
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.family_chat_get(
                thread=dm, user={"user_id": "u_t", "family_id": "fam1", "is_teen": True}))
        self.assertEqual(ctx.exception.status_code, 404)

    def test_a_note_to_a_young_child_is_read_in_kid_mode(self):
        """A child with no login has no inbox, so this is the only honest way to
        say something to them."""
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_kid", "family_id": "fam1", "name": "Abena", "role": "child"}))
        thread = server.KID_PREFIX + "m_kid"
        self._send_parent(thread, "Great job on your room today")
        child = {"member": {"member_id": "m_kid", "name": "Abena"}, "family_id": "fam1"}
        msgs = asyncio.run(server.kid_notes(child=child))["messages"]
        self.assertIn("Great job on your room today", {m["text"] for m in msgs})
        # A teen cannot read another child's notes.
        with self.assertRaises(server.HTTPException):
            asyncio.run(server.family_chat_get(
                thread=thread, user={"user_id": "u_t", "family_id": "fam1", "is_teen": True}))

    def test_a_young_child_has_no_way_to_send_anything(self):
        """Under-13s read notes and nothing more. A teen has their own account
        and a real conversation; a child on a shared family phone does not get a
        way to post, not even a fixed one."""
        self.assertFalse(hasattr(server, "kid_notes_ack"))

    def test_a_note_thread_is_refused_for_a_child_who_has_an_account(self):
        """A teen has a real conversation; the note thread is only for a child
        who cannot be messaged any other way."""
        self.assertIsNone(asyncio.run(
            server._thread_participants(self.db, "fam1", server.KID_PREFIX + "m_t")))

    def test_teen_can_reply_and_parent_sees_it_in_that_thread_only(self):
        asyncio.run(server.teen_chat_send(
            payload=server.ChatMessageIn(text="ok done!"), teen=self._teen("u_t", "Ama")))
        in_thread = asyncio.run(server.family_chat_get(thread="u_t", user=dict(PARENT)))["messages"]
        self.assertIn("ok done!", {m["text"] for m in in_thread})
        adults = asyncio.run(server.family_chat_get(thread=server.ADULTS_THREAD, user=dict(PARENT)))["messages"]
        self.assertNotIn("ok done!", {m["text"] for m in adults})

    def test_parent_cannot_reach_a_teen_outside_their_family(self):
        outsider = {"user_id": "u_out", "family_id": "famZ", "name": "Stranger"}
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.family_chat_get(thread="u_t", user=outsider))
        self.assertEqual(ctx.exception.status_code, 404)

    def test_coparents_share_the_adults_thread(self):
        self._send_parent(server.ADULTS_THREAD, "school run tomorrow?", who=PARENT)
        seen = asyncio.run(server.family_chat_get(thread=server.ADULTS_THREAD, user=dict(COPARENT)))["messages"]
        self.assertIn("school run tomorrow?", {m["text"] for m in seen})

    # --- threads + unread -----------------------------------------------
    def test_thread_list_and_unread(self):
        asyncio.run(server.teen_chat_send(
            payload=server.ChatMessageIn(text="hi mum"), teen=self._teen("u_t", "Ama")))
        res = asyncio.run(server.family_chat_threads(user=dict(PARENT)))
        by = {t["thread"]: t for t in res["threads"]}
        self.assertIn(server.ADULTS_THREAD, by)
        self.assertIn("u_t", by)
        self.assertIn("u_t2", by)
        self.assertEqual(by["u_t"]["unread"], 1)   # Ama's message, unread by the parent
        self.assertEqual(by["u_t2"]["unread"], 0)

    def test_reading_clears_unread(self):
        asyncio.run(server.teen_chat_send(
            payload=server.ChatMessageIn(text="hi mum"), teen=self._teen("u_t", "Ama")))
        asyncio.run(server.family_chat_get(thread="u_t", user=dict(PARENT)))  # opening marks read
        res = asyncio.run(server.family_chat_threads(user=dict(PARENT)))
        by = {t["thread"]: t for t in res["threads"]}
        self.assertEqual(by["u_t"]["unread"], 0)

    def test_empty_message_rejected(self):
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.teen_chat_send(
                payload=server.ChatMessageIn(text="   "), teen=self._teen("u_t", "Ama")))
        self.assertEqual(ctx.exception.status_code, 400)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class MessageTextIsNotAPrompt(unittest.TestCase):
    """Chat was being cleaned with the sanitiser written for AI prompts, which
    deletes phrases that could address a model and flattens every newline. In a
    family conversation that silently edits what people said."""

    def test_it_keeps_what_a_person_actually_wrote(self):
        from ai_safety import sanitize_message_text
        said = "You are now officially a teenager! Act as a grown-up, please 🎉"
        self.assertEqual(sanitize_message_text(said), said)

    def test_it_keeps_paragraphs(self):
        from ai_safety import sanitize_message_text
        self.assertEqual(sanitize_message_text("Dinner at 6.\n\nBring the dog."),
                         "Dinner at 6.\n\nBring the dog.")

    def test_it_still_strips_what_can_lie_about_itself(self):
        from ai_safety import sanitize_message_text
        # Zero-width and bidi-override characters make displayed text differ
        # from stored text; control characters have no place in a message.
        self.assertEqual(sanitize_message_text("he​llo‮"), "hello")
        self.assertEqual(sanitize_message_text("a\x00b"), "a b")

    def test_it_tidies_runaway_whitespace_and_caps_length(self):
        from ai_safety import sanitize_message_text
        self.assertEqual(sanitize_message_text("  a   b  \n\n\n\n c  "), "a b\n\nc")
        self.assertEqual(len(sanitize_message_text("x" * 5000)), 2000)
