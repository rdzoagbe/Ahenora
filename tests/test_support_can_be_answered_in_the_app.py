"""A support message is answered from the admin screen.

Roland, 2026-10-27, looking at "Cancel subscription after trial" in the
support inbox: "I need to be able to respond to this too. If possible in the
app." The inbox could list a message and mark it handled; answering meant
leaving the app for a mail client and finding the thread.

These hold the reply:

  * it reaches the person who wrote in, from the app, with reply-to set to
    the support inbox and their own words quoted underneath;
  * it is written on the ticket only once it has gone — a failed send
    changes nothing and says so, so the draft can be tried again;
  * "send and mark handled" closes the ticket in the same step;
  * only an admin can send one.

Run with:  python3 -m pytest tests/test_support_can_be_answered_in_the_app.py -q
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
    from fastapi import HTTPException

ADMIN = {"user_id": "u_admin", "family_id": "fam_admin", "email": "founder@example.com", "name": "Roland"}
PARENT = {"user_id": "u_parent", "family_id": "fam", "email": "parent@example.com", "name": "Alexandra"}


@unittest.skipUnless(HAVE, "backend deps not installed")
class ASupportMessageIsAnsweredInTheApp(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.sent = []
        self.fail_with = None

        async def capture(payload):
            if self.fail_with:
                raise RuntimeError(self.fail_with)
            self.sent.append(payload)
            return {"sent": True, "provider": "resend", "response": {"id": "re_123"}}
        self._resend, server._resend_send = server._resend_send, capture
        self._key, server.RESEND_API_KEY = server.RESEND_API_KEY, "test-key"
        self._from, server.INVITE_FROM_EMAIL = server.INVITE_FROM_EMAIL, "hello@ahenora.com"
        self._inbox, server.SUPPORT_INBOX_EMAIL = server.SUPPORT_INBOX_EMAIL, "support@ahenora.com"
        self._admins, server.ADMIN_EMAILS = server.ADMIN_EMAILS, {"founder@example.com"}

        async def no_push(*a, **k):
            return {"admins": 0, "devices": 0, "web": 0}
        self._push, server.notify_admins_of_support_ticket = server.notify_admins_of_support_ticket, no_push

        out = asyncio.run(server.submit_support_contact(
            server.SupportContactIn(subject="Cancel subscription after trial",
                                    message="Hi! I want to cancel my subscription after the trial."),
            user=PARENT, database=self.db))
        self.ticket_id = out["ticket_id"]
        self.sent.clear()

    def tearDown(self):
        server._resend_send = self._resend
        server.RESEND_API_KEY = self._key
        server.INVITE_FROM_EMAIL = self._from
        server.SUPPORT_INBOX_EMAIL = self._inbox
        server.ADMIN_EMAILS = self._admins
        server.notify_admins_of_support_ticket = self._push

    def reply(self, message="Hi Alexandra, nothing will be charged.", close=False, user=ADMIN, ticket_id=None):
        return asyncio.run(server.admin_reply_support_ticket(
            ticket_id or self.ticket_id, server.SupportReplyIn(message=message, close=close),
            user=user, database=self.db))

    def stored(self):
        return asyncio.run(self.db["support_tickets"].find_one({"ticket_id": self.ticket_id}))

    def test_the_reply_reaches_the_person_who_wrote_in(self):
        self.reply()
        self.assertEqual(len(self.sent), 1)
        mail = self.sent[0]
        self.assertEqual(mail["to"], ["parent@example.com"])
        self.assertEqual(mail["subject"], "Re: Cancel subscription after trial")
        self.assertIn("Hi Alexandra, nothing will be charged.", mail["text"])

    def test_their_answer_comes_back_to_the_support_inbox(self):
        self.reply()
        self.assertEqual(self.sent[0]["reply_to"], "support@ahenora.com")

    def test_it_quotes_what_they_wrote(self):
        self.reply()
        self.assertIn("> Hi! I want to cancel my subscription after the trial.", self.sent[0]["text"])

    def test_the_reply_is_written_on_the_ticket_and_listed(self):
        out = self.reply()
        replies = self.stored().get("replies")
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["message"], "Hi Alexandra, nothing will be charged.")
        self.assertEqual(replies[0]["by_name"], "Roland")
        self.assertEqual(replies[0]["email_id"], "re_123")
        self.assertEqual(out["ticket"]["replies"][0]["message"], "Hi Alexandra, nothing will be charged.")
        self.assertEqual(self.stored()["status"], "open")

    def test_send_and_mark_handled_closes_it(self):
        out = self.reply(close=True)
        self.assertEqual(self.stored()["status"], "closed")
        self.assertEqual(out["ticket"]["status"], "closed")

    def test_a_failed_send_changes_nothing_and_says_so(self):
        self.fail_with = "connection reset"
        with self.assertRaises(HTTPException) as caught:
            self.reply(close=True)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertFalse(self.stored().get("replies"))
        self.assertEqual(self.stored()["status"], "open")

    def test_a_ticket_with_no_address_cannot_be_answered_by_email(self):
        asyncio.run(self.db["support_tickets"].update_one(
            {"ticket_id": self.ticket_id}, {"$set": {"user_email": ""}}))
        with self.assertRaises(HTTPException) as caught:
            self.reply()
        self.assertEqual(caught.exception.status_code, 502)
        self.assertEqual(self.sent, [])

    def test_an_empty_reply_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            self.reply(message="   ")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(self.sent, [])

    def test_only_an_admin_can_reply(self):
        with self.assertRaises(HTTPException) as caught:
            self.reply(user=PARENT)
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(self.sent, [])

    def test_an_unknown_ticket_is_a_404(self):
        with self.assertRaises(HTTPException) as caught:
            self.reply(ticket_id="tkt_nope")
        self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
