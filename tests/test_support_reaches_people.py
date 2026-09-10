"""Both ends of a support request.

Roland: "when someone sends a request via the app I do get a notification
saying I received a support request but I do not know where it is, and the
person who sent the request doesn't get any message saying the support team
will reach out to them."

Two separate holes, at the two ends of the same message.

  THE NOTIFICATION WENT NOWHERE. `support_ticket` was not in the routing table
  at all, so it fell to the default — the Feed, which is the screen the app
  already opens on. Tapping "someone wrote to support" was indistinguishable
  from opening the app, and the inbox itself sits far down a long page of
  charts on the admin screen.

  THE SENDER GOT NOTHING TO KEEP. The only acknowledgement was a toast on the
  sheet they were already looking at. It vanished when they closed it. Somebody
  who writes to support and hears nothing assumes the message went nowhere —
  which is exactly what used to happen here for months, and the reason not to
  leave any doubt about it now.

Run with:  python3 -m pytest tests/test_support_reaches_people.py -q
"""
import asyncio
import inspect
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


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheSenderIsAnswered(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.sent = []

        async def capture(payload):
            self.sent.append(payload)
            return {"sent": True}
        self._resend, server._resend_send = server._resend_send, capture
        self._key, server.RESEND_API_KEY = server.RESEND_API_KEY, "test-key"
        self._from, server.INVITE_FROM_EMAIL = server.INVITE_FROM_EMAIL, "hello@ahenora.com"
        self._inbox, server.SUPPORT_INBOX_EMAIL = server.SUPPORT_INBOX_EMAIL, "support@ahenora.com"

        async def no_push(*a, **k):
            return {"admins": 0, "devices": 0, "web": 0}
        self._push, server.notify_admins_of_support_ticket = (
            server.notify_admins_of_support_ticket, no_push)

    def tearDown(self):
        server._resend_send = self._resend
        server.RESEND_API_KEY = self._key
        server.INVITE_FROM_EMAIL = self._from
        server.SUPPORT_INBOX_EMAIL = self._inbox
        server.notify_admins_of_support_ticket = self._push

    def _submit(self, email="parent@example.com", name="Keigh"):
        user = {"user_id": "u_1", "family_id": "fam", "email": email, "name": name}
        return asyncio.run(server.submit_support_contact(
            server.SupportContactIn(subject="Can't add a child",
                                    message="The add button does nothing."),
            user=user, database=self.db))

    def test_the_person_who_wrote_in_gets_an_email(self):
        self._submit()
        to = [p["to"][0] for p in self.sent]
        self.assertIn("parent@example.com", to,
                      "the sender was told nothing they could keep")

    def test_it_says_somebody_will_come_back_to_them(self):
        self._submit()
        ack = next(p for p in self.sent if p["to"][0] == "parent@example.com")
        self.assertIn("get back to you", ack["text"])

    def test_it_carries_their_own_words_back(self):
        # The difference between "we got something from you" and a receipt.
        self._submit()
        ack = next(p for p in self.sent if p["to"][0] == "parent@example.com")
        self.assertIn("The add button does nothing.", ack["text"])
        self.assertIn("Can't add a child", ack["text"])

    def test_a_reply_from_them_lands_where_somebody_is_looking(self):
        self._submit()
        ack = next(p for p in self.sent if p["to"][0] == "parent@example.com")
        self.assertEqual(ack.get("reply_to"), "support@ahenora.com")

    def test_the_support_inbox_is_still_emailed_too(self):
        # The receipt must not have replaced the message.
        self._submit()
        self.assertIn("support@ahenora.com", [p["to"][0] for p in self.sent])

    def test_a_user_with_no_email_on_file_still_files_a_ticket(self):
        out = self._submit(email="")
        self.assertTrue(out["ok"])
        self.assertNotIn("", [p["to"][0] for p in self.sent])

    def test_a_failing_receipt_never_costs_the_ticket(self):
        async def boom(payload):
            raise RuntimeError("mail is down")
        server._resend_send = boom
        out = self._submit()
        self.assertTrue(out["ok"], "the form must not fail because mail did")
        stored = asyncio.run(self.db["support_tickets"].find({}, {"_id": 0}).to_list(5))
        self.assertEqual(len(stored), 1)

    def test_what_the_sender_was_told_is_written_on_the_ticket(self):
        # So "did they ever hear from us?" is a lookup, not a mystery — the
        # same reason the other two deliveries are recorded.
        self._submit()
        stored = asyncio.run(self.db["support_tickets"].find({}, {"_id": 0}).to_list(5))[0]
        self.assertIn("ack", stored.get("notified") or {})


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheNotificationLeadsSomewhere(unittest.TestCase):
    def setUp(self):
        path = os.path.join(os.path.dirname(__file__), "..",
                            "frontend", "src", "notificationRouting.ts")
        with open(path, encoding="utf-8") as fh:
            self.routing = fh.read()

    def test_the_push_and_the_route_agree_on_the_type(self):
        # The push sends `support_ticket`. A route for any other spelling is a
        # route for nothing.
        self.assertIn('"type": "support_ticket"',
                      inspect.getsource(server.notify_admins_of_support_ticket))
        self.assertIn("case 'support_ticket':", self.routing)

    def test_it_opens_the_admin_screen_not_the_feed(self):
        after = self.routing.split("case 'support_ticket':")[1][:220]
        self.assertIn("/metrics", after)
        self.assertNotIn("(tabs)/feed", after)

    def test_it_asks_for_the_inbox_rather_than_the_top_of_the_page(self):
        # The inbox is below a screenful of charts; landing at the top of that
        # screen is the same complaint one page over.
        after = self.routing.split("case 'support_ticket':")[1][:220]
        self.assertIn("support", after)
        metrics = os.path.join(os.path.dirname(__file__), "..",
                               "frontend", "app", "metrics.tsx")
        with open(metrics, encoding="utf-8") as fh:
            body = fh.read()
        self.assertIn("metrics-support", body)
        self.assertIn("scrollTo({ y: supportY.current", body)


if __name__ == "__main__":
    unittest.main()
