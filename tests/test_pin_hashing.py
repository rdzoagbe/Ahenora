"""A stored PIN must not be a bare hash of four digits.

sha256("1234") is one of only 10,000 values and has no salt, so a copy of the
database gave up every child's PIN at once — and two households who both chose
1234 were visibly identical rows. These tests hold the new shape in place and,
just as importantly, hold the migration path open: a PIN set before this change
must still let its family in.

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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class PinHashing(unittest.TestCase):
    def test_a_stored_pin_is_salted_and_stretched(self):
        stored = server.hash_pin("1234")
        self.assertTrue(stored.startswith("pbkdf2_sha256$"))
        self.assertNotIn(server.sha256("1234"), stored)

    def test_the_same_pin_stores_differently_every_time(self):
        # Without a salt, every family that picks 1234 shares one hash, and the
        # database itself tells an attacker which households to try first.
        self.assertNotEqual(server.hash_pin("1234"), server.hash_pin("1234"))

    def test_it_verifies_the_right_pin_and_refuses_the_wrong_one(self):
        stored = server.hash_pin("1234")
        self.assertTrue(server.verify_pin("1234", stored))
        self.assertFalse(server.verify_pin("1235", stored))
        self.assertFalse(server.verify_pin("", stored))
        self.assertFalse(server.verify_pin("1234", ""))

    def test_a_pin_stored_the_old_way_still_works(self):
        # Nobody may be locked out of their own child's profile by this change.
        self.assertTrue(server.verify_pin("1234", server.sha256("1234")))
        self.assertFalse(server.verify_pin("9999", server.sha256("1234")))

    def test_an_old_pin_is_rewritten_the_next_time_it_is_used(self):
        db = FakeDatabase()
        legacy = server.sha256("1234")
        asyncio.run(db["family_members"].insert_one(
            {"member_id": "m1", "family_id": "fam1", "pin_hash": legacy}))
        member = asyncio.run(db["family_members"].find_one({"member_id": "m1"}))

        self.assertTrue(asyncio.run(server._verify_pin_and_upgrade(db, member, "1234")))
        after = asyncio.run(db["family_members"].find_one({"member_id": "m1"}))
        self.assertTrue(after["pin_hash"].startswith("pbkdf2_sha256$"))
        # And the upgraded row still accepts the same PIN.
        self.assertTrue(server.verify_pin("1234", after["pin_hash"]))

    def test_a_wrong_pin_never_rewrites_the_stored_one(self):
        db = FakeDatabase()
        legacy = server.sha256("1234")
        asyncio.run(db["family_members"].insert_one(
            {"member_id": "m1", "family_id": "fam1", "pin_hash": legacy}))
        member = asyncio.run(db["family_members"].find_one({"member_id": "m1"}))

        self.assertFalse(asyncio.run(server._verify_pin_and_upgrade(db, member, "0000")))
        after = asyncio.run(db["family_members"].find_one({"member_id": "m1"}))
        self.assertEqual(after["pin_hash"], legacy)


if __name__ == "__main__":
    unittest.main()
