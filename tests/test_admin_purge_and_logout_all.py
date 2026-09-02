"""Two accounts nobody could sign in to, and two tokens nobody could revoke.

A seeder bug created accounts on production whose passwords were placeholder
strings that were never real. /auth/delete-account is self-service by design —
it is the store-required path and it proves identity before destroying data —
so those accounts could not be removed by anyone, including the operator who
made them.

The session half is the same shape. /auth/logout deletes exactly one row: the
token in the Authorization header. That is right for "sign out on this device"
and useless for "a token of mine has been exposed". A password account had an
escape hatch anyway, because a password reset clears every session; a Google or
Apple account has no password to reset and therefore had none at all.

These tests drive the routes the way a caller drives them, not the collections
underneath. Two of this session's earlier privacy tests passed against broken
code precisely because they wrote to the database instead of going through the
route, so the route is the only thing worth asserting on.

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
# The real strays, and the live App Review account they sit one word away from.
STRAY = {"user_id": "stray1", "family_id": "famStray", "email": "review@ahenora.com"}
LIVE = {"user_id": "live1", "family_id": "famLive", "email": "apple-review@ahenora.com"}
# A household with a co-parent, so "delete the whole family" can be wrong.
LEAVER = {"user_id": "leave1", "family_id": "famShared", "email": "leaver@example.com"}
STAYER = {"user_id": "stay1", "family_id": "famShared", "email": "stayer@example.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class PurgeAccount(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admins = server.ADMIN_EMAILS
        server.ADMIN_EMAILS = {ADMIN["email"]}
        server._ADMIN_FAMILY_CACHE.clear()

        async def seed():
            for u in (ADMIN, STRAY, LIVE, LEAVER, STAYER):
                await self.db["users"].insert_one({**u})
            for fid in ("famA", "famStray", "famLive", "famShared"):
                await self.db["families"].insert_one(
                    {"family_id": fid, "plan": "free", "created_at": server.utcnow()})
            # Data that must go with a purged household, and stay with a kept one.
            await self.db["cards"].insert_one(
                {"card_id": "c1", "family_id": "famStray", "title": "stray card"})
            await self.db["cards"].insert_one(
                {"card_id": "c2", "family_id": "famShared", "title": "shared card"})
            await self.db["family_members"].insert_one(
                {"member_id": "m1", "family_id": "famShared", "user_id": "leave1"})
            await self.db["family_members"].insert_one(
                {"member_id": "m2", "family_id": "famShared", "user_id": "stay1"})
            await self.db["user_sessions"].insert_one(
                {"user_id": "stray1", "token_hash": "h1"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins
        server._ADMIN_FAMILY_CACHE.clear()

    def purge(self, caller, email, confirm=None):
        payload = server.PurgeAccountIn(
            email=email, confirm_email=email if confirm is None else confirm)
        return asyncio.run(server.admin_purge_account(payload, user=dict(caller)))

    def users(self, email):
        return asyncio.run(self.db["users"].find_one({"email": email}, {"_id": 0}))

    def rows(self, collection, query):
        async def go():
            return [d async for d in self.db[collection].find(query, {"_id": 0})]
        return asyncio.run(go())

    def test_it_removes_a_stray_account_and_its_empty_household(self):
        out = self.purge(ADMIN, STRAY["email"])
        self.assertTrue(out["deleted_household"])
        self.assertIsNone(self.users(STRAY["email"]))
        self.assertEqual(self.rows("cards", {"family_id": "famStray"}), [])
        self.assertEqual(self.rows("families", {"family_id": "famStray"}), [])
        self.assertEqual(self.rows("user_sessions", {"user_id": "stray1"}), [])

    def test_a_household_with_someone_left_in_it_survives(self):
        out = self.purge(ADMIN, LEAVER["email"])
        self.assertFalse(out["deleted_household"])
        self.assertIsNone(self.users(LEAVER["email"]))
        self.assertIsNotNone(self.users(STAYER["email"]))
        # The shared data belongs to the person still there.
        self.assertEqual(len(self.rows("cards", {"family_id": "famShared"})), 1)
        left = self.rows("family_members", {"family_id": "famShared"})
        self.assertEqual([m["user_id"] for m in left], ["stay1"])

    def test_a_mistyped_confirmation_deletes_nothing(self):
        # The realistic accident: meaning review@, typing apple-review@ in one
        # of the two fields. Either way round, nothing happens.
        with self.assertRaises(server.HTTPException) as caught:
            self.purge(ADMIN, STRAY["email"], confirm=LIVE["email"])
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIsNotNone(self.users(STRAY["email"]))
        self.assertIsNotNone(self.users(LIVE["email"]))

    def test_a_non_admin_cannot_purge_anyone(self):
        with self.assertRaises(server.HTTPException) as caught:
            self.purge(STRAY, LIVE["email"])
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIsNotNone(self.users(LIVE["email"]))

    def test_it_refuses_to_purge_an_admin(self):
        # Nothing reachable from an admin session should be able to delete the
        # operator running it, or the only way back in goes with it.
        with self.assertRaises(server.HTTPException) as caught:
            self.purge(ADMIN, ADMIN["email"])
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIsNotNone(self.users(ADMIN["email"]))

    def test_an_unknown_address_is_a_404_not_a_silent_success(self):
        with self.assertRaises(server.HTTPException) as caught:
            self.purge(ADMIN, "nobody@example.com")
        self.assertEqual(caught.exception.status_code, 404)

    def test_the_address_is_matched_case_insensitively(self):
        self.purge(ADMIN, "Review@Ahenora.COM")
        self.assertIsNone(self.users(STRAY["email"]))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class LogoutEverywhere(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

        async def seed():
            for h in ("browserA", "browserB", "phone"):
                await self.db["user_sessions"].insert_one(
                    {"user_id": "me", "token_hash": h})
            await self.db["user_sessions"].insert_one(
                {"user_id": "someone_else", "token_hash": "theirs"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db

    def sessions(self, user_id):
        async def go():
            return [d async for d in
                    self.db["user_sessions"].find({"user_id": user_id}, {"_id": 0})]
        return asyncio.run(go())

    def test_it_ends_every_session_including_the_caller_own(self):
        out = asyncio.run(server.logout_everywhere(user={"user_id": "me"}))
        self.assertEqual(out["sessions_ended"], 3)
        self.assertEqual(self.sessions("me"), [])

    def test_it_does_not_touch_anyone_else(self):
        asyncio.run(server.logout_everywhere(user={"user_id": "me"}))
        self.assertEqual(len(self.sessions("someone_else")), 1)

    def test_plain_logout_still_ends_only_the_token_that_asked(self):
        # The narrow route keeps its narrow meaning; this is the contrast that
        # makes the new one necessary rather than redundant.
        asyncio.run(server.logout(
            user={"user_id": "me"},
            authorization="Bearer " + "browserA"))
        left = sorted(s["token_hash"] for s in self.sessions("me"))
        self.assertEqual(left, ["browserA", "browserB", "phone"])


if __name__ == "__main__":
    unittest.main()
