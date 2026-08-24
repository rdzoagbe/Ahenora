"""Alternating custody (garde alternée) config.

A French custody judgment is written as semaines paires / impaires, so the whole
schedule is one parity: which ISO weeks the children are in this home. These
tests cover the config's defaults, the parent-only write, its validation and
normalisation, and that it round-trips onto the subscription payload the Feed
and Calendar read.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    from fastapi import HTTPException
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class CustodyConfig(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db

    def tearDown(self):
        server.get_db = self._get_db

    def _household(self):
        """fam1 with one parent (u1/p1)."""
        db = FakeDatabase()

        async def seed():
            await db["users"].insert_one({"user_id": "u1", "family_id": "fam1",
                "email": "u1@x.com", "name": "u1"})
            await db["family_members"].insert_one({"member_id": "p1", "family_id": "fam1",
                "user_id": "u1", "name": "u1", "role": "Parent",
                "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc)})
            await db["families"].insert_one({"family_id": "fam1", "plan": "village",
                "billing_cycle": "monthly"})
        asyncio.run(seed())
        server.get_db = lambda: db
        return db

    def _user(self):
        return {"user_id": "u1", "family_id": "fam1", "email": "u1@x.com"}

    def test_default_is_off_and_absent_reads_as_even(self):
        """A family that never set it up gets custody off, and public_custody
        never returns a null parity that would crash the client."""
        self._household()
        sub = asyncio.run(server.build_subscription("fam1"))
        self.assertIn("custody", sub)
        self.assertEqual(sub["custody"], {"enabled": False, "our_weeks": "even", "away_label": ""})

    def test_set_and_round_trip(self):
        db = self._household()
        payload = server.CustodyConfigIn(enabled=True, our_weeks="odd", away_label="leur papa")
        out = asyncio.run(server.set_custody(payload, self._user()))
        # The handler returns the fresh subscription, and it persisted.
        self.assertEqual(out["custody"], {"enabled": True, "our_weeks": "odd", "away_label": "leur papa"})
        fam = asyncio.run(db["families"].find_one({"family_id": "fam1"}))
        self.assertTrue(fam["custody_enabled"])
        self.assertEqual(fam["custody_our_weeks"], "odd")
        self.assertEqual(fam["custody_away_label"], "leur papa")

    def test_invalid_parity_is_refused(self):
        self._household()
        payload = server.CustodyConfigIn(enabled=True, our_weeks="paire")
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.set_custody(payload, self._user()))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_away_label_is_trimmed(self):
        db = self._household()
        payload = server.CustodyConfigIn(enabled=True, our_weeks="even", away_label="   Papa   ")
        asyncio.run(server.set_custody(payload, self._user()))
        fam = asyncio.run(db["families"].find_one({"family_id": "fam1"}))
        self.assertEqual(fam["custody_away_label"], "Papa")

    def test_turning_off_keeps_parity_but_hides_it(self):
        """Turning custody off should not lose the parity a parent set — flip it
        back on and the schedule is still there."""
        db = self._household()
        asyncio.run(server.set_custody(
            server.CustodyConfigIn(enabled=True, our_weeks="odd", away_label="Papa"), self._user()))
        out = asyncio.run(server.set_custody(
            server.CustodyConfigIn(enabled=False, our_weeks="odd", away_label="Papa"), self._user()))
        self.assertFalse(out["custody"]["enabled"])
        self.assertEqual(out["custody"]["our_weeks"], "odd")


if __name__ == "__main__":
    unittest.main()
