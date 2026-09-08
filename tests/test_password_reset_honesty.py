"""A reset code nobody can send must not be reported as sent.

`request-password-reset` answers {"ok": true} whichever way it goes, on
purpose: anything else turns it into an oracle for which addresses are
registered. The cost of that silence was that an unconfigured mailer looked
identical to a working one — the person is told to check an inbox nothing
will ever reach, and the only symptom is somebody who quietly stops being
able to sign in.

Whether the SERVER can send mail at all is not account-specific, so saying it
reveals nothing while making the difference visible.

Run with:  python3 -m pytest tests/test_password_reset_honesty.py -q
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase


class ResetIn:
    def __init__(self, email):
        self.email = email


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheAnswer(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._cfg = (server.RESEND_API_KEY, server.INVITE_FROM_EMAIL)
        self.sent = []

        async def capture(to_email, name, code):
            self.sent.append(to_email)
            return {"sent": True}

        self._mail, server.send_password_reset_email = server.send_password_reset_email, capture
        asyncio.run(self.db["users"].insert_one({
            "user_id": "u1", "email": "known@x.test", "name": "Roland",
            "password_hash": server.hash_password("password123"), "family_id": "fam"}))

    def tearDown(self):
        server.get_db = self._get_db
        server.send_password_reset_email = self._mail
        server.RESEND_API_KEY, server.INVITE_FROM_EMAIL = self._cfg
        server._auth_reset_all() if hasattr(server, "_auth_reset_all") else None

    def _ask(self, email):
        return asyncio.run(server.request_password_reset(ResetIn(email)))

    def test_it_says_when_the_server_cannot_send_mail_at_all(self):
        server.RESEND_API_KEY = ""
        server.INVITE_FROM_EMAIL = ""
        res = self._ask("known@x.test")
        self.assertTrue(res["ok"])
        self.assertFalse(res["email_configured"])

    def test_it_says_nothing_is_wrong_when_mail_works(self):
        server.RESEND_API_KEY = "re_test"
        server.INVITE_FROM_EMAIL = "Ahenora <hello@x.test>"
        res = self._ask("known@x.test")
        self.assertTrue(res["email_configured"])
        self.assertEqual(self.sent, ["known@x.test"])

    def test_the_answer_is_identical_for_an_address_that_does_not_exist(self):
        # The whole point: a stranger must not be able to tell.
        server.RESEND_API_KEY = "re_test"
        server.INVITE_FROM_EMAIL = "Ahenora <hello@x.test>"
        known = self._ask("known@x.test")
        unknown = self._ask("nobody@x.test")
        self.assertEqual(known, unknown)
        self.assertEqual(self.sent, ["known@x.test"], "no mail for an unknown address")


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheTrail(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def test_a_failed_send_is_recorded_without_the_address(self):
        asyncio.run(server.record_email_failure(
            "password_reset", {"sent": False, "error": "Resend HTTP 403"}))
        rows = asyncio.run(self.db["email_delivery_errors"].find({}, {"_id": 0}).to_list(10))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["kind"], "password_reset")
        self.assertIn("403", rows[0]["error"])
        # What an admin needs is that sending is failing, not who asked.
        self.assertNotIn("email", rows[0])
        self.assertNotIn("to", rows[0])

    def test_a_successful_send_leaves_nothing_behind(self):
        asyncio.run(server.record_email_failure("password_reset", {"sent": True}))
        rows = asyncio.run(self.db["email_delivery_errors"].find({}, {"_id": 0}).to_list(10))
        self.assertEqual(rows, [])

    def test_it_never_raises_on_a_broken_database(self):
        async def explode(doc):
            raise RuntimeError("mongo down")
        self.db["email_delivery_errors"].insert_one = explode
        asyncio.run(server.record_email_failure("password_reset", {"sent": False}))


if __name__ == "__main__":
    unittest.main()
