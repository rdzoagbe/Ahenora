"""A licence-test purchase is not income, and its BILLING_ISSUE is not a problem.

`is_test_billing_event` was written for one thing: a store's "is this endpoint
alive?" ping. A second thing arrived later and looked exactly like money — a
Play LICENCE TEST account. Its purchases are ordinary RENEWAL, CANCELLATION and
BILLING_ISSUE events carrying a real product id, and the test subscription
renews DAILY. So the billing alert fired every morning about a payment problem
that was never a payment.

An alert that cries wolf daily is one that stops being read, and then the real
one arrives and is not seen. That is the damage, and it is done to the only
person who reads these.

The store does say which it is: RevenueCat stamps every event SANDBOX or
PRODUCTION. We simply never read it.

Two rules matter more than the classification:

  * absent means REAL. A missing field must never be the thing that silences
    an alert about somebody's genuine failed payment, so this fails towards
    saying something.
  * a sandbox purchase still GRANTS its plan. A licence-test account has to
    get premium or it cannot test premium. This decides what counts as money,
    not what counts as paid.

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


def row(**kw):
    base = {"source": "revenuecat", "event_type": "RENEWAL", "matched": True}
    base.update(kw)
    return base


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatCountsAsMoney(unittest.TestCase):
    def test_a_sandbox_renewal_is_not_money(self):
        self.assertTrue(server.is_test_billing_event(row(environment="SANDBOX")))

    def test_a_sandbox_billing_issue_is_not_a_billing_issue(self):
        # The one that fired daily.
        self.assertTrue(server.is_test_billing_event(
            row(event_type="BILLING_ISSUE", environment="SANDBOX")))

    def test_a_production_renewal_is_money(self):
        self.assertFalse(server.is_test_billing_event(row(environment="PRODUCTION")))

    def test_an_event_with_no_environment_is_treated_as_money(self):
        # The rule that matters most. Every row written before this change has
        # no environment, and a missing field must never be what silences an
        # alert about a real failed payment.
        self.assertFalse(server.is_test_billing_event(row()))
        self.assertFalse(server.is_test_billing_event(row(environment="")))
        self.assertFalse(server.is_test_billing_event(row(environment=None)))

    def test_the_dashboard_ping_is_still_caught(self):
        # The original meaning, not replaced by the new one.
        self.assertTrue(server.is_test_billing_event(
            {"source": "revenuecat", "event_type": "TEST"}))

    def test_the_store_may_shout_or_whisper(self):
        for value in ("sandbox", "Sandbox", " SANDBOX "):
            self.assertTrue(server.is_test_billing_event(row(environment=value)), value)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheAlert(unittest.TestCase):
    def test_a_sandbox_billing_issue_raises_nothing(self):
        self.assertIsNone(server.billing_alert_kind(
            row(event_type="BILLING_ISSUE", environment="SANDBOX")))

    def test_a_real_billing_issue_still_raises(self):
        self.assertEqual(
            server.billing_alert_kind(row(event_type="BILLING_ISSUE", environment="PRODUCTION")),
            "BILLING_ISSUE")

    def test_a_real_billing_issue_with_no_environment_still_raises(self):
        self.assertEqual(
            server.billing_alert_kind(row(event_type="BILLING_ISSUE")), "BILLING_ISSUE")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheRecord(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()

    def stored(self, **kw):
        asyncio.run(server.record_billing_event(
            self.db, source="revenuecat", event_type="RENEWAL", matched=True,
            family_id="fam1", **kw))
        return asyncio.run(self.db["billing_events"].find_one({"family_id": "fam1"}))

    def test_the_environment_is_written_down(self):
        # Classified on READ, from a field stored on write. A classification
        # computed at write time could never be corrected for rows already in
        # the database.
        self.assertEqual(self.stored(environment="SANDBOX")["environment"], "SANDBOX")

    def test_it_is_normalised_so_the_read_does_not_have_to_guess(self):
        self.assertEqual(self.stored(environment=" sandbox ")["environment"], "SANDBOX")

    def test_an_event_that_said_nothing_stores_an_empty_string(self):
        self.assertEqual(self.stored()["environment"], "")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheWebhookReadsIt(unittest.TestCase):
    def test_the_handler_passes_the_environment_through(self):
        # The classifier can be perfect and change nothing if the one place
        # that sees the store's payload never forwards the field.
        here = os.path.join(os.path.dirname(__file__), "..", "backend", "server.py")
        with open(here, encoding="utf-8") as fh:
            src = fh.read()
        start = src.index("async def revenuecat_webhook")
        end = src.index("async def _fetch_rc_subscriber")
        body = src[start:end]
        # Both record_billing_event calls in the handler: matched and unmatched.
        self.assertEqual(body.count('environment=event.get("environment")'), 2)


if __name__ == "__main__":
    unittest.main()
