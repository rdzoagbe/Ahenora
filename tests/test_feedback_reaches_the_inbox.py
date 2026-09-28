"""Feedback from inside the app reaches the one inbox that is read.

The app had a "Contact support" form and nothing else: no way to say "I love
this" or "this is confusing" without writing a support request, and nothing
that ever asked. Feedback now goes into the same support inbox — emailed,
pushed to the admin's phone, listed on the metrics screen — marked as feedback,
and without the "we'll get back to you" a support request earns. A single
question is asked a week in, once per person, on any device.
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
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class FeedbackLandsInTheInbox(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.sent = {"ticket": 0, "ack": 0, "push": 0}
        self.saved = (server.send_support_ticket_email, server.send_support_ack_email,
                      server.notify_admins_of_support_ticket)

        async def ticket_email(ticket):
            self.sent["ticket"] += 1
            return {"sent": True}

        async def ack_email(ticket):
            self.sent["ack"] += 1
            return {"sent": True}

        async def push(database, ticket):
            self.sent["push"] += 1
            return {"admins": 1, "devices": 1, "web": 0}
        server.send_support_ticket_email = ticket_email
        server.send_support_ack_email = ack_email
        server.notify_admins_of_support_ticket = push
        self.user = {"user_id": "u1", "family_id": "f1", "email": "p@x.com", "name": "Parent",
                     "created_at": server.utcnow() - timedelta(days=9)}
        asyncio.run(self.db["users"].insert_one(dict(self.user)))

    def tearDown(self):
        (server.send_support_ticket_email, server.send_support_ack_email,
         server.notify_admins_of_support_ticket) = self.saved

    def submit(self, kind=None, subject="Hello", message="Something"):
        body = server.SupportContactIn(subject=subject, message=message, kind=kind)
        return asyncio.run(server.submit_support_contact(body, user=dict(self.user), database=self.db))

    def ticket(self):
        return asyncio.run(self.db["support_tickets"].find_one({}))

    def test_feedback_is_marked_and_reaches_the_admin(self):
        self.submit(kind="feedback")
        self.assertEqual(self.ticket()["kind"], "feedback")
        self.assertEqual(self.sent["ticket"], 1, "emailed to the support inbox")
        self.assertEqual(self.sent["push"], 1, "pushed to the admin's phone")

    def test_feedback_does_not_promise_a_reply(self):
        self.submit(kind="feedback")
        self.assertEqual(self.sent["ack"], 0)

    def test_a_support_request_still_gets_its_acknowledgement(self):
        self.submit()
        self.assertEqual(self.ticket()["kind"], "support")
        self.assertEqual(self.sent["ack"], 1)

    def test_an_unknown_kind_is_a_support_request(self):
        """A support request must never be quietly downgraded to feedback."""
        self.submit(kind="whatever")
        self.assertEqual(self.ticket()["kind"], "support")
        self.assertEqual(self.sent["ack"], 1)

    def test_the_week_in_answer_is_not_asked_again(self):
        self.submit(kind="day7")
        user = asyncio.run(self.db["users"].find_one({"user_id": "u1"}))
        self.assertTrue(user["day7_feedback_done"])
        self.assertFalse(server.day7_feedback_due(user))

    def test_not_now_is_not_asked_again_either(self):
        asyncio.run(server.dismiss_day7_feedback(user=dict(self.user), database=self.db))
        user = asyncio.run(self.db["users"].find_one({"user_id": "u1"}))
        self.assertFalse(server.day7_feedback_due(user))

    def test_the_admin_list_says_which_kind(self):
        self.assertEqual(server.public_support_ticket({"ticket_id": "t"})["kind"], "support")
        self.assertEqual(server.public_support_ticket({"ticket_id": "t", "kind": "day7"})["kind"], "day7")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhenTheWeekInQuestionIsAsked(unittest.TestCase):
    def user(self, days, **extra):
        return {"user_id": "u", "created_at": server.utcnow() - timedelta(days=days), **extra}

    def test_not_before_a_week(self):
        self.assertFalse(server.day7_feedback_due(self.user(6)))

    def test_from_a_week(self):
        self.assertTrue(server.day7_feedback_due(self.user(7)))

    def test_never_of_a_teen(self):
        self.assertFalse(server.day7_feedback_due(self.user(30, is_teen=True)))

    def test_never_without_a_start_date(self):
        self.assertFalse(server.day7_feedback_due({"user_id": "u"}))

    def test_the_app_is_told(self):
        pub = server.public_user({"user_id": "u", "email": "e", "name": "n", "family_id": "f",
                                  "created_at": server.utcnow() - timedelta(days=8)})
        self.assertTrue(pub["day7_feedback_due"])
        self.assertTrue(pub["member_since"])


if __name__ == "__main__":
    unittest.main()
