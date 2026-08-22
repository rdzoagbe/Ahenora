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

    def test_helper_is_refused_by_the_parent_chat_gate(self):
        """A helper is not in parent chat: require_full_member (which the parent
        chat routes use) refuses them."""
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.require_full_member(user={"user_id": "u_h", "family_id": "fam1", "is_helper": True}))
        self.assertEqual(ctx.exception.status_code, 403)

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
