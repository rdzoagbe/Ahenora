"""Money leaving, and the only person who can do anything about it.

The admin screen tints these rows, which helps exactly as much as opening the
admin screen does. A card that fails on a Tuesday is a household that loses
access on a Friday, and the window to fix it is the days in between — so it has
to arrive on the phone, not wait on a screen.

Three things are worth waking somebody for, and they are the same three the
screen already singles out: a failed card (recoverable, and only while somebody
knows), a cancellation (they have not gone yet), and a purchase that reached no
household at all (nobody is even asking for that money back).

What these tests mostly guard is the two ways this feature could do HARM:

  * **Breaking the webhook.** A push that fails must never fail the webhook. A
    500 back to RevenueCat is a retry, and a retried purchase event is a plan
    granted twice — the thing meant to protect the money would be the thing
    corrupting it.
  * **Crying wolf.** The test-event classification exists because a dashboard
    ping kept the admin screen's loudest alarm on for weeks. If it starts
    firing pushes, it has moved the problem rather than fixed it.

Run with:  python3 -m unittest discover -s tests -v
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


def run(coro):
    return asyncio.run(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class BillingAlerts(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.sent = []
        self._push = server.send_push_to_user
        self._admins = server.ADMIN_EMAILS

        async def fake_push(database, user_id, title, body, data, **kw):
            self.sent.append({"user_id": user_id, "title": title,
                              "body": body, "data": data})
            return {"devices": 1, "web": 0}

        server.send_push_to_user = fake_push
        server.ADMIN_EMAILS = {"founder@sim.test"}
        run(self.db["users"].insert_one({
            "user_id": "u_admin", "email": "founder@sim.test",
            "family_id": "fam_admin", "name": "Roland"}))

    def tearDown(self):
        server.send_push_to_user = self._push
        server.ADMIN_EMAILS = self._admins

    def record(self, **kw):
        kw.setdefault("source", "revenuecat")
        kw.setdefault("matched", True)
        kw.setdefault("family_id", "fam1")
        return run(server.record_billing_event(self.db, **kw))

    # --- what is worth a push ---------------------------------------------

    def test_a_failed_card_reaches_the_founder(self):
        self.record(event_type="BILLING_ISSUE")
        self.assertEqual(len(self.sent), 1)
        self.assertIn("payment failed", self.sent[0]["title"].lower())
        self.assertEqual(self.sent[0]["user_id"], "u_admin")
        self.assertEqual(self.sent[0]["data"]["kind"], "BILLING_ISSUE")

    def test_a_cancellation_reaches_the_founder(self):
        self.record(event_type="CANCELLATION")
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0]["data"]["kind"], "CANCELLATION")

    def test_money_that_reached_nobody_is_the_loudest(self):
        self.record(event_type="INITIAL_PURCHASE", matched=False,
                    family_id=None, app_user_id="rc_abc123")
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0]["data"]["kind"], "unmatched")
        # The id is what a person needs to go and find the buyer.
        self.assertIn("rc_abc123", self.sent[0]["body"])

    # --- and what is NOT --------------------------------------------------

    def test_a_renewal_is_not_news(self):
        self.record(event_type="RENEWAL", plan="executive")
        self.assertEqual(self.sent, [])

    def test_an_expiration_is_not_pushed(self):
        # Deliberately absent, as it is from the screen's tint: by then the
        # plan has already dropped and there is nothing left to do. A push you
        # cannot act on teaches you to ignore the next one.
        self.record(event_type="EXPIRATION", plan="village")
        self.assertEqual(self.sent, [])

    def test_a_dashboard_test_ping_never_pushes(self):
        # The exact false alarm that kept the admin screen's loudest banner on
        # for weeks. If it starts sending pushes it has moved, not been fixed.
        self.record(event_type="TEST", matched=False, family_id=None,
                    app_user_id="rc_test_user")
        self.assertEqual(self.sent, [])

    def test_the_sweep_recovering_money_is_not_an_alarm(self):
        # RECONCILED means the safety net WORKED. Good news is not an alert.
        self.record(source="sweep", event_type="RECONCILED", plan="executive")
        self.assertEqual(self.sent, [])

    # --- it must not storm ------------------------------------------------

    def test_a_retrying_card_does_not_push_twice(self):
        self.record(event_type="BILLING_ISSUE")
        self.record(event_type="BILLING_ISSUE")
        self.record(event_type="BILLING_ISSUE")
        self.assertEqual(len(self.sent), 1)

    def test_a_different_household_is_still_heard(self):
        # Quieting a repeat must not quiet everybody.
        self.record(event_type="BILLING_ISSUE", family_id="fam1")
        self.record(event_type="BILLING_ISSUE", family_id="fam2")
        self.assertEqual(len(self.sent), 2)

    def test_a_different_problem_for_the_same_household_is_still_heard(self):
        self.record(event_type="BILLING_ISSUE", family_id="fam1")
        self.record(event_type="CANCELLATION", family_id="fam1")
        self.assertEqual(len(self.sent), 2)

    def test_the_quiet_window_eventually_opens_again(self):
        self.record(event_type="BILLING_ISSUE")
        self.assertEqual(len(self.sent), 1)
        # Age the first event past the window.
        old = server.utcnow() - timedelta(hours=server.BILLING_ALERT_QUIET_HOURS + 1)
        run(self.db["billing_events"].update_many({}, {"$set": {"received_at": old}}))
        self.record(event_type="BILLING_ISSUE")
        self.assertEqual(len(self.sent), 2)

    # --- and it must never break the money path ---------------------------

    def test_a_failing_push_does_not_break_the_webhook(self):
        """The one that matters most.

        A 500 back to RevenueCat is a retry, and a retried purchase event is a
        plan granted twice. record_billing_event must swallow this.
        """
        async def boom(*a, **kw):
            raise RuntimeError("APNs is down")

        server.send_push_to_user = boom
        self.record(event_type="BILLING_ISSUE")  # must not raise
        # and the row is still written, so the admin screen still shows it
        rows = run(self.db["billing_events"].find({}, {"_id": 0}).to_list(10))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["event_type"], "BILLING_ISSUE")

    def test_the_row_is_written_before_anyone_is_told(self):
        # An alert pointing at a row that does not exist is worse than silence.
        seen = {}

        async def check(database, user_id, title, body, data, **kw):
            rows = await database["billing_events"].find({}, {"_id": 0}).to_list(10)
            seen["rows"] = len(rows)
            seen["event_id_exists"] = any(
                r.get("event_id") == data.get("event_id") for r in rows)
            return {"devices": 1}

        server.send_push_to_user = check
        self.record(event_type="BILLING_ISSUE")
        self.assertEqual(seen.get("rows"), 1)
        self.assertTrue(seen.get("event_id_exists"))

    def test_no_admins_configured_is_silence_not_a_crash(self):
        server.ADMIN_EMAILS = set()
        self.record(event_type="BILLING_ISSUE")
        self.assertEqual(self.sent, [])

    # --- the classifier, directly -----------------------------------------

    def test_the_classifier_agrees_with_the_screen(self):
        # The screen tints BILLING_ISSUE and CANCELLATION and nothing else;
        # the push must not drift from it.
        self.assertEqual(server.BILLING_ALERT_EVENTS,
                         {"BILLING_ISSUE", "CANCELLATION"})
        for event_type, want in (
            ("BILLING_ISSUE", "BILLING_ISSUE"),
            ("CANCELLATION", "CANCELLATION"),
            ("billing_issue", "BILLING_ISSUE"),   # case off the wire
            ("RENEWAL", None),
            ("EXPIRATION", None),
        ):
            with self.subTest(event_type=event_type):
                self.assertEqual(
                    server.billing_alert_kind(
                        {"matched": True, "event_type": event_type}),
                    want)


if __name__ == "__main__":
    unittest.main()
