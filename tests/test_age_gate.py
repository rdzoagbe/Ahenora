"""A child recorded as under 13 cannot be handed an account of their own.

The 13 floor already existed on the invite, but it only checked the number typed
into that one form. A household could record a child as eight and then, a screen
later, claim fifteen — and the app would believe the second answer. These tests
pin the rule to what the household actually recorded.
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase

PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}


@unittest.skipUnless(HAVE_DEPS, "fastapi not installed")
class UnderThirteenCannotGetAnAccount(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_p", "family_id": "fam1", "user_id": "u_p",
            "name": "Roland", "role": "Parent"}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_kid", "family_id": "fam1", "name": "Abena",
            "role": "child", "age": 8}))

    def tearDown(self):
        server.get_db = self._get_db

    def _invite(self, **kw):
        payload = server.InviteIn(email="a@x.com", is_teen=True, **kw)
        return asyncio.run(server.family_invite(payload, user=dict(PARENT)))

    def test_claiming_a_teen_age_for_an_eight_year_old_is_refused(self):
        with self.assertRaises(server.HTTPException) as ctx:
            self._invite(age=15, member_id="m_kid")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("13", ctx.exception.detail)

    def test_an_age_that_disagrees_with_the_record_is_refused(self):
        asyncio.run(self.db["family_members"].update_one(
            {"member_id": "m_kid"}, {"$set": {"age": 14}}))
        with self.assertRaises(server.HTTPException) as ctx:
            self._invite(age=16, member_id="m_kid")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_an_age_below_thirteen_cannot_be_recorded_on_an_account_holder(self):
        """The contradiction runs both ways."""
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_teen", "family_id": "fam1", "user_id": "u_t",
            "name": "Ama", "role": "teen"}))
        payload = type("P", (), {"name": None, "avatar": None, "age": 9})()
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.update_family_member("m_teen", payload, user=dict(PARENT)))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_a_recorded_teen_age_still_works(self):
        """The gate refuses a contradiction, not the ordinary case."""
        asyncio.run(self.db["family_members"].update_one(
            {"member_id": "m_kid"}, {"$set": {"age": 15}}))
        res = self._invite(age=15, member_id="m_kid")
        self.assertTrue(res.get("invite") or res.get("ok") or res)


if __name__ == "__main__":
    unittest.main()
