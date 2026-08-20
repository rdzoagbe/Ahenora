"""Teen mode: a 13-17 account with its own login but a restricted world.

The security claim guarded here mirrors kid mode's: a teen's token must be
worthless on every parent route — refused by require_user itself — so it can
never reach the family calendar, vault, other members or settings. A teen only
ever sees the /api/teen/* allowlist, scoped server-side to their own tasks and
family-wide events. A parent-private task belonging to someone else must never
appear.

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
class TeenMode(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        server._auth_fail.clear()
        # Parent + a teen account (own login, is_teen flag set).
        asyncio.run(self.db["users"].insert_one({**PARENT, "language": "en"}))
        asyncio.run(self.db["users"].insert_one({
            "user_id": "u_t", "family_id": "fam1", "name": "Ama",
            "email": "ama@x.com", "language": "en", "is_teen": True}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_p", "family_id": "fam1", "user_id": "u_p",
            "name": "Roland", "role": "Parent", "stars": 0}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_t", "family_id": "fam1", "user_id": "u_t",
            "name": "Ama", "role": "teen", "stars": 0}))
        # A live session token for the teen (a normal login — no kid `kind`).
        self.teen_token = "teentok"
        asyncio.run(self.db["user_sessions"].insert_one({
            "token_hash": server.sha256(self.teen_token), "user_id": "u_t",
            "expires_at": server.utcnow() + timedelta(days=1)}))

    def tearDown(self):
        server.get_db = self._get_db

    def _card(self, **kw):
        defaults = dict(type="TASK", title="x", assignee=None, shared=False)
        defaults.update(kw)
        return asyncio.run(server.create_card(server.CardIn(**defaults), user=dict(PARENT)))

    # --- the security claim ---------------------------------------------
    def test_teen_token_refused_by_require_user(self):
        """The whole guarantee: a teen token is worthless on any parent route."""
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.require_user(authorization=f"Bearer {self.teen_token}"))
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail, "teen_mode")

    def test_require_teen_accepts_only_teen(self):
        teen = asyncio.run(server.require_teen(authorization=f"Bearer {self.teen_token}"))
        self.assertEqual(teen["user"]["user_id"], "u_t")
        # A parent's own session must NOT satisfy require_teen.
        ptok = "parenttok"
        asyncio.run(self.db["user_sessions"].insert_one({
            "token_hash": server.sha256(ptok), "user_id": "u_p",
            "expires_at": server.utcnow() + timedelta(days=1)}))
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.require_teen(authorization=f"Bearer {ptok}"))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_teen_home_scoping(self):
        """Own task + shared event show; a parent-private task never does."""
        self._card(type="TASK", title="Tidy your room", assignee="Ama", shared=False)
        self._card(type="EVENT", title="Family movie night", shared=True)
        self._card(type="TASK", title="Pay the mortgage", assignee="Roland", shared=False)
        self._card(type="EVENT", title="Secret parent dinner", shared=False)

        teen = asyncio.run(server.require_teen(authorization=f"Bearer {self.teen_token}"))
        home = asyncio.run(server.teen_home(teen=teen))
        task_titles = {t["title"] for t in home["tasks"]}
        agenda_titles = {a["title"] for a in home["agenda"]}

        self.assertIn("Tidy your room", task_titles)
        self.assertIn("Family movie night", agenda_titles)
        # The two parent-private items must be invisible to the teen.
        self.assertNotIn("Pay the mortgage", task_titles)
        self.assertNotIn("Secret parent dinner", agenda_titles)

    def test_teen_can_finish_own_task_not_others(self):
        mine = self._card(type="TASK", title="Homework", assignee="Ama", shared=False)
        theirs = self._card(type="TASK", title="Pay the mortgage", assignee="Roland", shared=False)
        teen = asyncio.run(server.require_teen(authorization=f"Bearer {self.teen_token}"))

        res = asyncio.run(server.teen_finish_task(card_id=mine["card_id"], teen=teen))
        self.assertTrue(res["ok"])
        done = asyncio.run(self.db["cards"].find_one({"card_id": mine["card_id"]}))
        self.assertEqual(done["status"], "DONE")

        # A parent-private task the teen can't see returns 404, never completes.
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.teen_finish_task(card_id=theirs["card_id"], teen=teen))
        self.assertEqual(ctx.exception.status_code, 404)

    def test_invite_marks_teen_role_and_flag(self):
        """A teen invite yields role 'teen', and accepting flags the user."""
        invite = {"is_teen": True, "relationship": None}
        self.assertEqual(server.invite_member_role(invite), "teen")
