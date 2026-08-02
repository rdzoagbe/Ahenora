"""Which of the five acceptance doors real devices actually get through.

The routes exist because a blocked iPhone refused specific request SHAPES,
and none can be deleted on a hunch — app builds already on people's phones
still call them. Counting the ones that succeed is what turns "probably
nobody uses this" into something a later session can act on safely.

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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class InviteRouteCounting(unittest.TestCase):
    """Which door each acceptance came through.

    Five routes exist because a blocked iPhone refused specific request
    shapes. None can be deleted on a hunch — old app builds still call them —
    so the counts are what a later session needs to retire one honestly.
    """

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db
        # ADMIN_EMAILS is module-level and shared: leaving a test address in
        # it would quietly grant admin to whatever runs next in this process.
        server.ADMIN_EMAILS.discard("admin@sim.test")

    def _invited(self, email="k@x.com"):
        """Seed a pending invite directly.

        Not created through the API on purpose: this is a test about which
        door an acceptance came through, and routing it via plan limits and
        billing fixtures would make it a test about those instead.
        """
        for fid, name in (("fam1", "Roland's"), ("fam2", "Keigh's")):
            asyncio.run(self.db["families"].insert_one(
                {"family_id": fid, "name": name, "plan": "free",
                 "billing_cycle": "monthly", "created_at": server.utcnow()}))
        token = "tok-" + server.new_id("inv")
        asyncio.run(self.db["family_invites"].insert_one({
            "invite_id": server.new_id("inv"), "family_id": "fam1",
            "email": email, "token": token, "status": "pending",
            "created_by_user_id": "u_r", "created_by_name": "Roland",
            "expires_at": server.utcnow() + timedelta(days=7),
            "created_at": server.utcnow()}))
        return token

    def _joiner(self, email="k@x.com"):
        user = {"user_id": "u_k", "family_id": "fam2", "name": "Keigh", "email": email}
        asyncio.run(self.db["users"].insert_one(dict(user)))
        return user

    def _counts(self):
        # The readout is admin-only and the admin set comes from the
        # environment, which a test has no business depending on.
        server.ADMIN_EMAILS.add("admin@sim.test")
        rows = asyncio.run(server.invite_route_stats(
            user={"user_id": "u_a", "family_id": "fam1", "email": "admin@sim.test"}))
        return {r["route"]: r["count"] for r in rows["routes"]}

    def test_the_discovery_route_is_recorded_by_name(self):
        token = self._invited()
        asyncio.run(server.family_updates(x_confirm=token, user=self._joiner()))
        self.assertEqual(self._counts().get("discovery"), 1)

    def test_the_membership_post_is_recorded_by_name(self):
        token = self._invited()
        asyncio.run(server.family_membership_post(
            server.InviteAcceptIn(token=token), user=self._joiner()))
        self.assertEqual(self._counts().get("membership-post"), 1)

    def test_counting_never_breaks_the_join_it_describes(self):
        token = self._invited()
        real = self.db["invite_route_stats"]

        class Exploding:
            async def update_one(self, *a, **k):
                raise RuntimeError("counter down")

        self.db._collections["invite_route_stats"] = Exploding()
        try:
            out = asyncio.run(server.family_membership_post(
                server.InviteAcceptIn(token=token), user=self._joiner()))
            self.assertTrue(out.get("ok"))
        finally:
            self.db._collections["invite_route_stats"] = real
