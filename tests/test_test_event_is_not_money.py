"""A store's "is this endpoint alive?" ping is not a lost payment.

RevenueCat's dashboard has a "Send test event" button. It posts a real webhook
carrying event_type TEST, product "test_product" and a synthetic app_user_id
that belongs to nobody — which is the whole point of it.

We filed it as a purchase that reached no household. So the admin screen's
loudest alarm — a red banner reading "That is real money landing nowhere, the
store got a 200 back and will not send it again" — stood from 31 August
onwards because somebody pressed a button to check the endpoint was wired up.
It could never clear: the id is not a person, so the twice-daily replay would
never resolve it, and it burned a RevenueCat lookup a pass forever trying.

Worse than the noise is what the noise hides. A REAL unmatched purchase raises
the same banner and reads the same, sitting next to the false alarm that has
been standing for weeks, and is indistinguishable from it.

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

ADMIN = {"user_id": "u_a", "family_id": "famA", "email": "admin@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatCountsAsALostPayment(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admins = set(server.ADMIN_EMAILS)
        server.ADMIN_EMAILS = self._admins | {"admin@x.com"}
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins

    def add(self, **kw):
        row = {"event_id": kw.pop("event_id", server.new_id("bev")),
               "source": "revenuecat", "matched": False, "family_id": None,
               "received_at": self.now}
        row.update(kw)
        asyncio.run(self.db["billing_events"].insert_one(row))
        return row

    def log(self):
        return asyncio.run(server.admin_billing_events(user=dict(ADMIN), limit=40))

    # --- the classification ---------------------------------------------

    def test_a_revenuecat_test_event_is_recognised(self):
        self.assertTrue(server.is_test_billing_event(
            {"source": "revenuecat", "event_type": "TEST"}))

    def test_it_is_recognised_whatever_the_casing(self):
        # The row already in production was written before this existed, and
        # the classification runs on read, so it has to cope with what is
        # actually stored rather than what we would store today.
        for et in ("TEST", "test", " Test "):
            with self.subTest(event_type=et):
                self.assertTrue(server.is_test_billing_event(
                    {"source": "revenuecat", "event_type": et}))

    def test_a_real_purchase_is_never_mistaken_for_a_test(self):
        # The direction that would cost money: silencing a genuine one.
        for et in ("INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE",
                   "NON_RENEWING_PURCHASE", "UNCANCELLATION", ""):
            with self.subTest(event_type=et):
                self.assertFalse(server.is_test_billing_event(
                    {"source": "revenuecat", "event_type": et}))

    def test_a_test_named_event_from_elsewhere_is_not_waved_through(self):
        # Only RevenueCat sends this shape. A Stripe row that happened to
        # carry the word must not inherit the exemption.
        self.assertFalse(server.is_test_billing_event(
            {"source": "stripe", "event_type": "TEST"}))
        self.assertFalse(server.is_test_billing_event(None))

    # --- what the screen does with it ------------------------------------

    def test_a_test_ping_does_not_raise_the_money_alarm(self):
        self.add(event_type="TEST", product_id="test_product",
                 app_user_id="3e369e42-313b-4cbb-b3af-59ef2a1986fe")
        self.assertEqual(self.log()["unmatched"], 0)

    def test_a_real_lost_payment_still_does(self):
        # The whole point. Silencing the false alarm must not silence the
        # true one, so both live in the same log together here.
        self.add(event_type="TEST", product_id="test_product", app_user_id="tst")
        self.add(event_type="INITIAL_PURCHASE", product_id="ahenora_executive_monthly",
                 app_user_id="u_ghost")
        out = self.log()
        self.assertEqual(out["unmatched"], 1)
        # And it is the one at the top, where a person will see it.
        self.assertEqual(out["events"][0]["event_type"], "INITIAL_PURCHASE")
        self.assertFalse(out["events"][0]["is_test"])

    def test_the_test_ping_is_still_shown_because_it_is_evidence(self):
        # "No event has ever arrived" and "the only event that ever arrived
        # was a test" are different situations: the second means the endpoint
        # is correctly wired and simply has not sold anything yet. Hiding the
        # row would throw that away.
        self.add(event_type="TEST", product_id="test_product", app_user_id="tst")
        out = self.log()
        self.assertTrue(out["ever_received"])
        self.assertIsNotNone(out["last_test_at"])
        self.assertEqual([e["is_test"] for e in out["events"]], [True])

    def test_no_test_ping_means_no_claim_that_one_arrived(self):
        self.add(event_type="RENEWAL", matched=True, family_id="famA", plan="executive")
        self.assertIsNone(self.log()["last_test_at"])

    # --- and the replay stops chasing a person who does not exist ---------

    def test_the_replay_does_not_hunt_for_a_synthetic_id(self):
        """It was retrying twice a day, forever, against a real API."""
        self.add(event_id="bev_test", event_type="TEST", product_id="test_product",
                 app_user_id="3e369e42-313b-4cbb-b3af-59ef2a1986fe")
        calls = []

        async def fake_fetch(user_id, secret):
            calls.append(user_id)
            return {"subscriber": {}}
        real = server._fetch_rc_subscriber
        server._fetch_rc_subscriber = fake_fetch
        try:
            out = asyncio.run(server.replay_unmatched_billing(self.db, secret="k"))
        finally:
            server._fetch_rc_subscriber = real
        self.assertEqual(calls, [])
        self.assertEqual(out["attempted"], 0)
        # And no retry count on it either: a number there invites somebody to
        # investigate a row that has nothing behind it.
        row = asyncio.run(self.db["billing_events"].find_one({"event_id": "bev_test"}))
        self.assertIsNone(row.get("replay_state"))
        self.assertIsNone(row.get("replay_attempts"))


if __name__ == "__main__":
    unittest.main()
