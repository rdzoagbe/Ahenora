"""Is there a payment behind this plan? Asked once, not twice.

Found in live data: the admin screen said three paying households; RevenueCat
said two paid subscribers. Neither number looked wrong on its own.

Two places answered the same question with different rules:

  * the launch cleanup asked `{"rc_last_event": {"$exists": False}}`
  * the admin screen asked `fam.get("rc_last_event")` — truthiness

Nothing separates those two rules except a value neither author had in mind.
A webhook whose payload carries no `type` stores `rc_last_event: ""`, because
the handler reads `event.get("type", "")`. That value EXISTS, so the cleanup
skips the household forever; it is FALSY, so the screen prints no rail. The
household is then counted as a paying subscriber, shown as though its rail
were merely unknown, and is structurally immune to the code written to catch
exactly it.

billing_marker is now the only answer, so the two cannot drift again.

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
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE, "backend deps not installed")
class WhatCountsAsAPayment(unittest.TestCase):
    def test_a_google_play_subscriber(self):
        self.assertEqual(
            server.billing_marker({"rc_last_event": "INITIAL_PURCHASE"}), "google_play")

    def test_a_card_subscriber(self):
        self.assertEqual(
            server.billing_marker({"stripe_last_event": "checkout.session.completed"}),
            "stripe")

    def test_nothing_at_all(self):
        self.assertIsNone(server.billing_marker({}))
        self.assertIsNone(server.billing_marker(None))

    def test_a_blank_marker_is_no_marker(self):
        """The exact value that split the two rules. A webhook with no `type`
        stores "" — present, and meaningless."""
        self.assertIsNone(server.billing_marker({"rc_last_event": ""}))
        self.assertIsNone(server.billing_marker({"rc_last_event": "   "}))
        self.assertIsNone(server.billing_marker({"rc_last_event": None}))
        self.assertIsNone(server.billing_marker({"stripe_last_event": ""}))

    def test_a_card_payment_outranks_a_blank_play_marker(self):
        self.assertEqual(server.billing_marker(
            {"rc_last_event": "", "stripe_last_event": "invoice.paid"}), "stripe")


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheLaunchCleanup(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._db = server.db
        server.db = self.db
        self._secret = os.environ.get("RC_WEBHOOK_SECRET")
        os.environ["RC_WEBHOOK_SECRET"] = "live"

    def tearDown(self):
        server.db = self._db
        if self._secret is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._secret

    def seed(self, fid, **fields):
        asyncio.run(self.db["families"].insert_one({"family_id": fid, **fields}))

    def plan_of(self, fid):
        return asyncio.run(
            self.db["families"].find_one({"family_id": fid}, {"_id": 0}))["plan"]

    def run_cleanup(self):
        asyncio.run(server.reset_testing_window_plans())

    def test_a_testing_window_plan_is_reset(self):
        self.seed("f_test", plan="executive")
        self.run_cleanup()
        self.assertEqual(self.plan_of("f_test"), "village")

    def test_a_blank_marker_no_longer_shields_a_free_plan(self):
        """The live case. It survived every restart because "" exists."""
        self.seed("f_blank", plan="executive", rc_last_event="")
        self.run_cleanup()
        self.assertEqual(self.plan_of("f_blank"), "village")

    def test_a_real_play_subscriber_is_untouched(self):
        self.seed("f_play", plan="executive", rc_last_event="RENEWAL")
        self.run_cleanup()
        self.assertEqual(self.plan_of("f_play"), "executive")

    def test_a_real_card_subscriber_is_untouched(self):
        self.seed("f_card", plan="household", stripe_last_event="invoice.paid")
        self.run_cleanup()
        self.assertEqual(self.plan_of("f_card"), "household")

    def test_a_free_household_is_left_alone(self):
        self.seed("f_free", plan="village")
        self.run_cleanup()
        self.assertEqual(self.plan_of("f_free"), "village")

    def test_it_does_nothing_before_billing_is_live(self):
        """Wiping plans while the testing window is open would take the app
        away from the people testing it."""
        os.environ.pop("RC_WEBHOOK_SECRET", None)
        self.seed("f_test", plan="executive")
        self.run_cleanup()
        self.assertEqual(self.plan_of("f_test"), "executive")


if __name__ == "__main__":
    unittest.main()
