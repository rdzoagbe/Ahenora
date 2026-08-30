"""Granting the App Review account its entitlement — without granting it power.

Apple needs a demo account that can reach every gated feature, or the reviewer
cannot evaluate what the subscription buys. The obvious shortcut is to add the
reviewer's address to ADMIN_EMAILS, because family_has_admin() hands an admin
household the top plan.

That shortcut also hands whoever holds those credentials every /api/admin
route — the subscriber list, billing events, the dedupe tools. Those
credentials get typed into a form at Apple and sit in a review queue.

`grandfathered` already means "top tier, no purchase" and nothing else, so
these tests hold the line: the flag lifts the plan, and it never confers admin.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

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

ADMIN = {"user_id": "admin1", "family_id": "famA", "email": "boss@ahenora.com"}
REVIEWER = {"user_id": "rev1", "family_id": "famR", "email": "appreview@ahenora.com"}
STRANGER = {"user_id": "s1", "family_id": "famS", "email": "someone@example.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Grandfathering(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admins = server.ADMIN_EMAILS
        server.ADMIN_EMAILS = {ADMIN["email"]}
        server._ADMIN_FAMILY_CACHE.clear()

        async def seed():
            for u in (ADMIN, REVIEWER, STRANGER):
                await self.db["users"].insert_one({**u})
                await self.db["families"].insert_one(
                    {"family_id": u["family_id"], "plan": "free",
                     "billing_cycle": "monthly", "created_at": server.utcnow()})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins
        server._ADMIN_FAMILY_CACHE.clear()

    def grant(self, caller, email, on=True):
        payload = server.GrandfatherIn(email=email, grandfathered=on)
        return asyncio.run(server.admin_set_grandfathered(payload, user=dict(caller)))

    def family(self, fid):
        return asyncio.run(self.db["families"].find_one({"family_id": fid}, {"_id": 0}))

    def test_an_admin_can_grant_it(self):
        self.grant(ADMIN, REVIEWER["email"])
        self.assertTrue(self.family("famR")["grandfathered"])

    def test_it_is_reversible(self):
        self.grant(ADMIN, REVIEWER["email"])
        self.grant(ADMIN, REVIEWER["email"], on=False)
        self.assertFalse(self.family("famR")["grandfathered"])

    def test_a_non_admin_cannot_grant_it_to_anyone(self):
        with self.assertRaises(server.HTTPException) as caught:
            self.grant(STRANGER, STRANGER["email"])
        self.assertEqual(caught.exception.status_code, 403)

    def test_a_non_admin_cannot_grant_it_to_themselves(self):
        with self.assertRaises(server.HTTPException) as caught:
            self.grant(REVIEWER, REVIEWER["email"])
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIsNone(self.family("famR").get("grandfathered"))

    def test_an_unknown_address_is_a_404_not_a_silent_success(self):
        """A typo must not report success and leave the reviewer on Free."""
        with self.assertRaises(server.HTTPException) as caught:
            self.grant(ADMIN, "typo@ahenora.com")
        self.assertEqual(caught.exception.status_code, 404)

    def test_the_flag_does_not_make_the_household_an_admin_one(self):
        """The whole reason for using this flag instead of ADMIN_EMAILS."""
        self.grant(ADMIN, REVIEWER["email"])
        server._ADMIN_FAMILY_CACHE.clear()
        self.assertFalse(
            asyncio.run(server.family_has_admin(self.db, "famR")))

    def test_but_it_does_lift_the_plan_to_the_top_tier(self):
        """Otherwise the reviewer meets a paywall and cannot evaluate the app."""
        self.grant(ADMIN, REVIEWER["email"])
        sub = asyncio.run(server.build_subscription("famR"))
        top = server.PLAN_CATALOG["household"]["limits"]
        self.assertEqual(sub["limits"], top)
        self.assertTrue(sub["grandfathered"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
