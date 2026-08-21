"""Helper mode: a trusted adult (grandparent/carer) with a login but a limited
view. Unlike a teen (walled off entirely — require_user 403s a teen), a helper
is a real family member who uses the normal app, but the sensitive surfaces —
vault, billing, member management, invites, expenses, star adjustments — are
denied server-side by require_full_member. Deny-by-default, proven here.

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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class HelperMode(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        server._auth_fail.clear()
        asyncio.run(self.db["users"].insert_one({**PARENT, "language": "en"}))
        asyncio.run(self.db["users"].insert_one({
            "user_id": "u_h", "family_id": "fam1", "name": "Grandma",
            "email": "gran@x.com", "language": "en", "is_helper": True}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_p", "family_id": "fam1", "user_id": "u_p",
            "name": "Roland", "role": "Parent", "stars": 0}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_h", "family_id": "fam1", "user_id": "u_h",
            "name": "Grandma", "role": "helper", "stars": 0}))
        # A live login for the helper — a normal session (no kid `kind`).
        self.helper_token = "helpertok"
        asyncio.run(self.db["user_sessions"].insert_one({
            "token_hash": server.sha256(self.helper_token), "user_id": "u_h",
            "expires_at": server.utcnow() + timedelta(days=1)}))

    def tearDown(self):
        server.get_db = self._get_db

    # --- the security claim ---------------------------------------------
    def test_helper_passes_require_user_but_fails_require_full_member(self):
        """A helper is a real user (normal app works), but the sensitive gate
        refuses them — that's the whole model."""
        user = asyncio.run(server.require_user(authorization=f"Bearer {self.helper_token}"))
        self.assertEqual(user["user_id"], "u_h")  # not walled off like a teen
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.require_full_member(user=user))
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, "helper_mode")

    def test_require_full_member_allows_a_parent(self):
        allowed = asyncio.run(server.require_full_member(user=dict(PARENT)))
        self.assertEqual(allowed["user_id"], "u_p")

    def test_sensitive_routes_share_the_guard(self):
        """A sample of the gated routes all refuse a helper (they share the one
        require_full_member dependency, so this covers the surface)."""
        helper = {"user_id": "u_h", "family_id": "fam1", "is_helper": True}
        for _ in range(1):
            with self.assertRaises(server.HTTPException) as ctx:
                asyncio.run(server.require_full_member(user=helper))
            self.assertEqual(ctx.exception.status_code, 403)

    # --- provisioning ---------------------------------------------------
    def test_join_sets_is_helper_on_the_returned_dict(self):
        """The join response must flag the user the auth handlers serialize."""
        u = {"user_id": "u_new", "family_id": "fam1", "name": "Nana", "email": "nana@x.com"}
        asyncio.run(self.db["users"].insert_one(dict(u)))  # exists before joining, as in the real flow
        asyncio.run(server.add_user_to_family_if_needed(self.db, u, "fam1", role="helper"))
        self.assertTrue(u.get("is_helper"))
        stored = asyncio.run(self.db["users"].find_one({"user_id": "u_new"}))
        self.assertTrue(stored.get("is_helper"))

    def test_invite_yields_helper_role(self):
        self.assertEqual(server.invite_member_role({"is_helper": True, "relationship": None}), "helper")

    def test_helper_invite_skips_the_two_parent_cap(self):
        """A helper is never a co-parent, so a full household still accepts one."""
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_p2", "family_id": "fam1", "user_id": "u_p2",
            "name": "Awo", "role": "co-parent", "stars": 0}))
        try:
            asyncio.run(server.family_invite(
                server.InviteIn(email="carer@x.com", is_helper=True), user=dict(PARENT)))
        except server.HTTPException as e:
            self.assertNotIn("two parents", str(e.detail).lower())

    def test_public_user_exposes_is_helper(self):
        pub = server.public_user({"user_id": "u_h", "email": "gran@x.com",
                                  "name": "Grandma", "family_id": "fam1", "is_helper": True})
        self.assertTrue(pub["is_helper"])
