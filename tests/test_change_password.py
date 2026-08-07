"""Changing the password on a password account.

The Account screen had a Change-password row that rendered but did nothing —
no handler, no endpoint. This pins the endpoint behind it: the current password
must be proven, the new one must clear the same floor as registration, and a
Google account (no password) is told plainly rather than left guessing.
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
    from fastapi import HTTPException


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ChangingYourPassword(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self.db = FakeDatabase()
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def _user(self, password="hunter2"):
        asyncio.run(self.db["users"].insert_one({
            "user_id": "u1", "family_id": "fam1", "email": "r@x.com", "name": "Roland",
            "password_hash": server.hash_password(password) if password else None}))
        return {"user_id": "u1", "family_id": "fam1",
                "password_hash": server.hash_password(password) if password else None}

    def _call(self, user, current, new):
        return asyncio.run(server.change_password(
            server.ChangePasswordIn(current_password=current, new_password=new), user=user))

    def test_the_right_current_password_sets_a_new_one(self):
        user = self._user("hunter2")
        out = self._call(user, "hunter2", "newpass99")
        self.assertTrue(out["ok"])
        stored = asyncio.run(self.db["users"].find_one({"user_id": "u1"}))
        self.assertTrue(server.verify_password("newpass99", stored["password_hash"]))
        self.assertFalse(server.verify_password("hunter2", stored["password_hash"]))

    def test_a_wrong_current_password_is_refused(self):
        user = self._user("hunter2")
        with self.assertRaises(HTTPException) as e:
            self._call(user, "wrong", "newpass99")
        self.assertEqual(e.exception.status_code, 403)

    def test_a_too_short_new_password_is_refused(self):
        user = self._user("hunter2")
        with self.assertRaises(HTTPException) as e:
            self._call(user, "hunter2", "short")
        self.assertEqual(e.exception.status_code, 400)

    def test_the_new_password_must_differ(self):
        user = self._user("hunter2")
        with self.assertRaises(HTTPException) as e:
            self._call(user, "hunter2", "hunter2")
        self.assertEqual(e.exception.status_code, 400)

    def test_a_google_account_has_no_password_to_change(self):
        user = self._user(password=None)
        with self.assertRaises(HTTPException) as e:
            self._call(user, "anything", "newpass99")
        self.assertEqual(e.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
