"""The in-app "Contact support" form actually reaches somebody.

Field report, 2026-09-07: "some users sent a contact support email and I did
not receive it." The endpoint stored a ticket and stopped. The app said
"Your message has been received. We'll get back to you soon." — a promise
nothing in the system could keep, because nothing told the person who would
have to keep it.

Run with:  python3 -m pytest tests/test_support_contact.py -q
"""
import asyncio
import os
import sys
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    from fastapi import HTTPException
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase


class SupportBody:
    def __init__(self, subject, message):
        self.subject, self.message = subject, message


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheForm(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.mails = []
        self.expo = []
        self._resend, server._resend_send = server._resend_send, self._send_mail
        self._expo, server.send_expo_push_messages = server.send_expo_push_messages, self._send_expo
        self._web, server.send_web_push_to_user = server.send_web_push_to_user, self._send_web
        self._cfg = (server.RESEND_API_KEY, server.INVITE_FROM_EMAIL, server.SUPPORT_INBOX_EMAIL)
        server.RESEND_API_KEY = "re_test"
        server.INVITE_FROM_EMAIL = "Ahenora <hello@ahenora.test>"
        server.SUPPORT_INBOX_EMAIL = "support@ahenora.test"
        server.ADMIN_EMAILS.add("boss@ahenora.test")
        run = asyncio.run
        run(self.db["users"].insert_one(
            {"user_id": "u_boss", "email": "boss@ahenora.test", "name": "Roland", "family_id": "fam_boss"}))
        run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_boss", "token": "ExponentPushToken[boss]", "active": True,
             "platform": "ios", "updated_at": server.utcnow()}))
        self.user = {"user_id": "u_k", "family_id": "fam_k", "email": "k@x.test", "name": "Keigh"}

    def tearDown(self):
        server.get_db = self._get_db
        server._resend_send = self._resend
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web
        server.RESEND_API_KEY, server.INVITE_FROM_EMAIL, server.SUPPORT_INBOX_EMAIL = self._cfg
        server.ADMIN_EMAILS.discard("boss@ahenora.test")

    async def _send_mail(self, payload):
        self.mails.append(payload)
        return {"sent": True, "provider": "resend"}

    async def _send_expo(self, messages, database=None):
        self.expo.extend(messages)
        return {"sent": len(messages)}

    async def _send_web(self, database, user_id, title, body, data):
        return 0

    def _submit(self, subject="App crashes", message="Calendar shows an error on my iPhone"):
        return asyncio.run(server.submit_support_contact(
            SupportBody(subject, message), user=self.user, database=self.db))

    def _ticket(self, ticket_id):
        return asyncio.run(self.db["support_tickets"].find_one({"ticket_id": ticket_id}, {"_id": 0}))

    def test_the_message_is_emailed_to_the_support_inbox_with_reply_to_the_user(self):
        res = self._submit()
        self.assertTrue(res["ok"])
        self.assertEqual(len(self.mails), 1)
        mail = self.mails[0]
        self.assertEqual(mail["to"], ["support@ahenora.test"])
        self.assertEqual(mail["reply_to"], "k@x.test")
        self.assertIn("App crashes", mail["subject"])
        self.assertIn("Calendar shows an error", mail["text"])
        self.assertIn("Keigh", mail["text"])

    def test_every_admin_gets_a_push(self):
        self._submit()
        self.assertEqual(len(self.expo), 1)
        self.assertEqual(self.expo[0]["to"], "ExponentPushToken[boss]")
        self.assertEqual(self.expo[0]["data"]["type"], "support_ticket")
        self.assertIn("Keigh", self.expo[0]["title"])

    def test_delivery_is_written_on_the_ticket(self):
        res = self._submit()
        t = self._ticket(res["ticket_id"])
        self.assertTrue(t["notified"]["email"]["sent"])
        self.assertEqual(t["notified"]["push"]["devices"], 1)

    def test_the_form_still_succeeds_when_mail_is_down(self):
        async def down(payload):
            raise RuntimeError("resend 503")
        server._resend_send = down
        res = self._submit()
        self.assertTrue(res["ok"])
        t = self._ticket(res["ticket_id"])
        self.assertEqual(t["status"], "open")
        self.assertFalse(t["notified"]["email"]["sent"])
        self.assertIn("resend 503", t["notified"]["email"]["error"])
        # The push still went, so the founder still heard.
        self.assertEqual(len(self.expo), 1)

    def test_unconfigured_mail_is_recorded_not_hidden(self):
        server.RESEND_API_KEY = ""
        res = self._submit()
        t = self._ticket(res["ticket_id"])
        self.assertEqual(t["notified"]["email"], {"sent": False, "error": "email not configured"})

    def test_empty_subject_or_message_is_refused(self):
        with self.assertRaises(HTTPException) as ctx:
            self._submit(subject="  ", message="hi")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(self.mails, [])


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheInbox(unittest.TestCase):
    """The admin panel lists every ticket — including the ones stored during
    the months the form delivered nowhere — and lets one be closed."""

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        server.ADMIN_EMAILS.add("boss@ahenora.test")
        self.admin = {"user_id": "u_boss", "email": "boss@ahenora.test", "family_id": "fam_boss"}
        now = server.utcnow()
        run = asyncio.run
        run(self.db["support_tickets"].insert_one(
            {"ticket_id": "tkt_old", "family_id": "f1", "user_id": "u1", "user_email": "a@x.test",
             "user_name": "A", "subject": "Old and never delivered", "message": "help",
             "status": "open", "created_at": now - timedelta(days=40)}))
        run(self.db["support_tickets"].insert_one(
            {"ticket_id": "tkt_new", "family_id": "f2", "user_id": "u2", "user_email": "b@x.test",
             "user_name": "B", "subject": "New", "message": "hi", "status": "open",
             "created_at": now - timedelta(hours=1),
             "notified": {"email": {"sent": True}, "push": {"devices": 1, "web": 0}}}))
        run(self.db["support_tickets"].insert_one(
            {"ticket_id": "tkt_done", "family_id": "f3", "user_id": "u3", "user_email": "c@x.test",
             "user_name": "C", "subject": "Done", "message": "ok", "status": "closed",
             "created_at": now - timedelta(days=2), "closed_at": now - timedelta(days=1)}))

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS.discard("boss@ahenora.test")

    def test_only_an_admin_may_read_it(self):
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.admin_support_tickets(user={"user_id": "u9", "email": "x@x.test"}))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_open_first_newest_first_and_the_undelivered_ones_are_counted(self):
        res = asyncio.run(server.admin_support_tickets(user=self.admin))
        self.assertEqual([t["ticket_id"] for t in res["tickets"]], ["tkt_new", "tkt_old", "tkt_done"])
        self.assertEqual(res["open"], 2)
        self.assertEqual(res["total"], 3)
        # tkt_old and tkt_done predate delivery tracking: nobody was ever told.
        self.assertEqual(res["never_delivered"], 2)
        old = res["tickets"][1]
        self.assertIsNone(old["emailed"])
        self.assertEqual(old["pushed_devices"], 0)
        new = res["tickets"][0]
        self.assertTrue(new["emailed"])
        self.assertEqual(new["pushed_devices"], 1)

    def test_closing_a_ticket(self):
        res = asyncio.run(server.admin_close_support_ticket("tkt_old", user=self.admin))
        self.assertEqual(res["status"], "closed")
        after = asyncio.run(server.admin_support_tickets(user=self.admin))
        self.assertEqual(after["open"], 1)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.admin_close_support_ticket("tkt_missing", user=self.admin))
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
