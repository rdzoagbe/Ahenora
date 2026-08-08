"""Forgotten-password reset by emailed one-time code.

The whole point is to let someone who cannot sign in prove they own the inbox
and set a new password — without ever turning the endpoint into an oracle for
which emails are registered, and without letting a guessed code walk in.

Pinned here: the request is silent about account existence, the code must be
right and unexpired and only tried a few times, and a successful reset both
changes the password and drops every session opened under the old one.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

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
    from fastapi import HTTPException


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ForgotPasswordReset(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self._send = server.send_password_reset_email
        self.sent = []

        async def _capture(to_email, name, code):
            self.sent.append({"to": to_email, "name": name, "code": code})
            return {"sent": True}
        server.send_password_reset_email = _capture
        # A shared limiter across tests would leak lockouts between cases.
        server._auth_fail.clear()

    def tearDown(self):
        server.get_db = self._get_db
        server.send_password_reset_email = self._send
        server._auth_fail.clear()

    def _db(self, *, password="hunter2", google=False, email="u1@x.com"):
        db = FakeDatabase()

        async def seed():
            await db["users"].insert_one({
                "user_id": "u1", "family_id": "fam1", "email": email, "name": "Sam",
                "password_hash": None if google else server.hash_password(password)})
            await db["user_sessions"].insert_one({"user_id": "u1", "token_hash": "old"})
        asyncio.run(seed())
        server.get_db = lambda: db
        return db

    def _count(self, db, coll, **q):
        return asyncio.run(db[coll].count_documents(q))

    def _request(self, email):
        return asyncio.run(server.request_password_reset(
            server.RequestPasswordResetIn(email=email)))

    def _reset(self, **kw):
        return asyncio.run(server.reset_password(server.ResetPasswordIn(**kw)))

    # ---- request: mints a code, and only for a real password account --------

    def test_request_emails_a_code_and_stores_its_hash(self):
        db = self._db()
        out = self._request("u1@x.com")
        self.assertEqual(out, {"ok": True})
        self.assertEqual(len(self.sent), 1)
        code = self.sent[0]["code"]
        self.assertEqual(len(code), 6)
        row = asyncio.run(db["password_resets"].find_one({"user_id": "u1"}))
        self.assertIsNotNone(row)
        self.assertEqual(row["code_hash"], server.sha256(code))
        # The raw code is never stored.
        self.assertNotIn("code", row)

    def test_request_for_unknown_email_is_silent(self):
        db = self._db()
        out = self._request("nobody@x.com")
        self.assertEqual(out, {"ok": True})
        self.assertEqual(self.sent, [])
        self.assertEqual(self._count(db, "password_resets"), 0)

    def test_request_for_a_google_account_is_silent(self):
        db = self._db(google=True)
        out = self._request("u1@x.com")
        self.assertEqual(out, {"ok": True})
        self.assertEqual(self.sent, [])
        self.assertEqual(self._count(db, "password_resets"), 0)

    # ---- reset: right code sets password and drops old sessions -------------

    def test_correct_code_resets_password_and_signs_in_fresh(self):
        db = self._db()
        self._request("u1@x.com")
        code = self.sent[0]["code"]
        out = self._reset(email="u1@x.com", code=code, new_password="brandnew1")
        self.assertIn("session_token", out)
        self.assertEqual(out["user"]["email"], "u1@x.com")

        user = asyncio.run(db["users"].find_one({"user_id": "u1"}))
        self.assertTrue(server.verify_password("brandnew1", user["password_hash"]))
        # The code is spent and every pre-reset session is gone; exactly one
        # fresh session (the one just issued) remains.
        self.assertEqual(self._count(db, "password_resets"), 0)
        self.assertEqual(self._count(db, "user_sessions", user_id="u1"), 1)
        self.assertEqual(self._count(db, "user_sessions", token_hash="old"), 0)

    def test_wrong_code_is_rejected_and_counts_against_you(self):
        db = self._db()
        self._request("u1@x.com")
        with self.assertRaises(HTTPException) as e:
            self._reset(email="u1@x.com", code="000000", new_password="brandnew1")
        self.assertEqual(e.exception.status_code, 400)
        row = asyncio.run(db["password_resets"].find_one({"user_id": "u1"}))
        self.assertEqual(row["attempts"], 1)
        # Password unchanged.
        user = asyncio.run(db["users"].find_one({"user_id": "u1"}))
        self.assertTrue(server.verify_password("hunter2", user["password_hash"]))

    def test_expired_code_is_rejected(self):
        db = self._db()
        self._request("u1@x.com")
        code = self.sent[0]["code"]

        async def age_it():
            await db["password_resets"].update_one(
                {"user_id": "u1"},
                {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(minutes=1)}})
        asyncio.run(age_it())
        with self.assertRaises(HTTPException) as e:
            self._reset(email="u1@x.com", code=code, new_password="brandnew1")
        self.assertEqual(e.exception.status_code, 400)

    def test_a_short_new_password_is_rejected(self):
        self._db()
        self._request("u1@x.com")
        code = self.sent[0]["code"]
        with self.assertRaises(HTTPException) as e:
            self._reset(email="u1@x.com", code=code, new_password="short")
        self.assertEqual(e.exception.status_code, 400)

    def test_too_many_wrong_attempts_burns_the_code(self):
        db = self._db()
        self._request("u1@x.com")
        code = self.sent[0]["code"]
        # Exhaust the per-code attempt budget with wrong guesses.
        for _ in range(server.PASSWORD_RESET_MAX_ATTEMPTS):
            with self.assertRaises(HTTPException):
                self._reset(email="u1@x.com", code="000000", new_password="brandnew1")
        # Now even the *correct* code is refused: the code is spent, and only a
        # fresh request can start over. Password stays put.
        with self.assertRaises(HTTPException) as e:
            self._reset(email="u1@x.com", code=code, new_password="brandnew1")
        self.assertEqual(e.exception.status_code, 400)
        user = asyncio.run(db["users"].find_one({"user_id": "u1"}))
        self.assertTrue(server.verify_password("hunter2", user["password_hash"]))


if __name__ == "__main__":
    unittest.main()
