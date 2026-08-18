"""The way out of kid mode when the parent PIN is forgotten.

Exiting kid mode needs a grown-up PIN, and there was no recovery — a parent
who forgot it was locked inside the child's app. This adds a password-verified
escape. A child must not be able to use it, so it takes a PARENT'S account
credentials (which the child does not have), and it clears the forgotten PIN
so a fresh one gets set.

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
    from fastapi import HTTPException


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class KidForgotPin(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        # A parent with an account + PIN, and a child in the same family.
        asyncio.run(self.db["users"].insert_one({
            "user_id": "u_mum", "family_id": "fam1", "name": "Mum",
            "email": "mum@x.com", "password_hash": server.hash_password("s3cret-pass")}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_mum", "family_id": "fam1", "name": "Mum",
            "role": "Parent", "user_id": "u_mum", "pin_hash": server.sha256("4321")}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_kid", "family_id": "fam1", "name": "Kofi",
            "role": "Child", "pin_hash": server.sha256("1111")}))
        self.child = {"family_id": "fam1", "member": {"member_id": "m_kid"}}
        server._auth_clear("kidexitpw:fam1")

    def tearDown(self):
        server.get_db = self._get_db

    def _try(self, email, password):
        return asyncio.run(server.exit_kid_forgot_pin(
            server.KidForgotPinIn(email=email, password=password), child=dict(self.child),
            authorization="Bearer test-kid-token"))

    def _mum_pin(self):
        m = asyncio.run(self.db["family_members"].find_one({"member_id": "m_mum"}, {"_id": 0}))
        return m.get("pin_hash")

    def test_correct_parent_password_unlocks_and_clears_the_pin(self):
        out = self._try("mum@x.com", "s3cret-pass")
        self.assertTrue(out["ok"])
        self.assertIsNone(self._mum_pin())  # forgotten PIN cleared for a reset

    def test_wrong_password_is_refused_and_pin_kept(self):
        with self.assertRaises(HTTPException) as ctx:
            self._try("mum@x.com", "not-it")
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertIsNotNone(self._mum_pin())

    def test_the_childs_own_pin_does_not_work_as_a_password(self):
        # A child knows their own PIN; it must not be a way out.
        with self.assertRaises(HTTPException):
            self._try("mum@x.com", "1111")

    def test_an_outsider_account_cannot_unlock_this_family(self):
        asyncio.run(self.db["users"].insert_one({
            "user_id": "u_x", "family_id": "fam2", "name": "Nia",
            "email": "nia@x.com", "password_hash": server.hash_password("outsider")}))
        with self.assertRaises(HTTPException):
            self._try("nia@x.com", "outsider")

    def test_repeated_failures_lock_out(self):
        for _ in range(12):
            try:
                self._try("mum@x.com", "wrong")
            except HTTPException:
                pass
        with self.assertRaises(HTTPException) as ctx:
            self._try("mum@x.com", "s3cret-pass")
        self.assertEqual(ctx.exception.status_code, 429)


if __name__ == "__main__":
    unittest.main()
