"""Using the app keeps you signed in.

Expiry used to count from sign-in rather than from last use, so a family that
opened the app every morning was still signed out on schedule. For a Google
account that is one tap; for an email account it is a retyped password, which
is what made coming back feel broken."""
import asyncio
import os
import sys
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.dirname(__file__))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from test_invites import FakeColl, FakeDB


@unittest.skipUnless(HAVE_DEPS, "fastapi not installed")
class SessionRenewal(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db

    def tearDown(self):
        server.get_db = self._get_db

    def _db(self, days_left):
        return FakeDB(
            user_sessions=FakeColl([
                {"session_id": "s1", "user_id": "u1", "token_hash": server.sha256("tok"),
                 "expires_at": server.utcnow() + timedelta(days=days_left)},
            ]),
            users=FakeColl([
                {"user_id": "u1", "email": "p@x.com", "name": "Parent", "family_id": "fam"},
            ]),
        )

    def _call(self, db):
        server.get_db = lambda: db
        return asyncio.run(server.require_user(authorization="Bearer tok"))

    def test_a_session_in_use_is_pushed_back_out(self):
        db = self._db(days_left=2)
        before = db["user_sessions"].rows[0]["expires_at"]
        user = self._call(db)
        self.assertEqual(user["user_id"], "u1")
        after = db["user_sessions"].rows[0]["expires_at"]
        self.assertGreater(after, before)
        # Renewed to a full term, not merely nudged.
        self.assertGreater(after, server.utcnow() + timedelta(days=server.SESSION_DAYS - 1))

    def test_a_fresh_session_is_not_rewritten_on_every_request(self):
        # Still nearly a full term left: renewing here would mean a database
        # write on every single request.
        db = self._db(days_left=server.SESSION_DAYS)
        before = db["user_sessions"].rows[0]["expires_at"]
        self._call(db)
        self.assertEqual(db["user_sessions"].rows[0]["expires_at"], before)

    # Expiry itself is not asserted here: the in-memory double ignores operator
    # queries like {"$gt": now}, so it hands back rows real Mongo would filter
    # out. The lookup still carries that filter — renewal only ever extends a
    # session the query already accepted, and never revives a lapsed one.

    def test_renewal_never_resurrects_a_session_it_was_not_given(self):
        db = self._db(days_left=2)
        server.get_db = lambda: db
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.require_user(authorization="Bearer wrong-token"))
        self.assertEqual(ctx.exception.status_code, 401)
        # The real session's expiry is untouched by the rejected request.
        self.assertLess(db["user_sessions"].rows[0]["expires_at"],
                        server.utcnow() + timedelta(days=3))

    def test_sessions_last_long_enough_for_a_household(self):
        # A week signed everyone out weekly; this is the guard against slipping
        # back to that without meaning to.
        self.assertGreaterEqual(server.SESSION_DAYS, 30)


if __name__ == "__main__":
    unittest.main()
