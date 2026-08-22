"""A passwordless Google row under the same inbox must never lock the real
email/password account out of sign-in. Regression for the duplicate-account
bug: Google sign-in used to look up by google_sub only, minting a second,
passwordless row for an email that already had a password account — and email
login then answered "no password account for this email"."""
import asyncio
import os
import sys
import unittest

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
class PasswordAccountNotShadowed(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db

    def tearDown(self):
        server.get_db = self._get_db
        server._auth_clear("login:wife@x.com")

    def _db(self):
        pw = server.hash_password("password123")
        return FakeDB(
            users=FakeColl([
                # The passwordless Google duplicate is listed FIRST on purpose:
                # a naive find_one would return it and reject the login.
                {"user_id": "u_google", "email": "wife@x.com", "name": "Ama",
                 "google_sub": "g123", "family_id": "fam_g"},
                {"user_id": "u_pw", "email": "wife@x.com", "name": "Ama",
                 "password_hash": pw, "family_id": "fam_pw"},
            ]),
            family_invites=FakeColl([]),
        )

    def test_login_finds_the_password_account_despite_a_google_duplicate(self):
        server.get_db = lambda db=self._db(): db
        payload = server.EmailLoginIn(email="wife@x.com", password="password123", invite_token=None)
        res = asyncio.run(server.login_email(payload))
        self.assertEqual(res["user"]["user_id"], "u_pw")
        self.assertEqual(res["user"]["family_id"], "fam_pw")

    def test_wrong_password_is_still_rejected(self):
        server.get_db = lambda db=self._db(): db
        payload = server.EmailLoginIn(email="wife@x.com", password="wrong", invite_token=None)
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.login_email(payload))
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
