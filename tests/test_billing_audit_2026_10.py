"""Billing guards added by the October 2026 audit.

  * Checkout refuses while ANY card subscription is live, whatever the plan
    currently reads (a failed renewal must not open a second subscription).
  * A Stripe event about a subscription that is not the household's current
    one moves no plan.
  * A booked change is settled only when its plan AND billing cycle arrive.
  * The Plans page is told whose store account pays, so a co-parent is not
    offered a "change" that is really a second subscription.

Run with:  python3 -m unittest tests.test_billing_audit_2026_10 -v
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


def sub_event(etype, sub_id, status="active"):
    return {"type": etype, "data": {"object": {
        "id": sub_id, "status": status, "customer": "cus_1"}}}


@unittest.skipUnless(HAVE, "backend deps not installed")
class CardSubscriptionExists(unittest.TestCase):
    def test_a_live_subscription_blocks_a_second_checkout(self):
        for status in ("active", "trialing", "past_due", "unpaid", None):
            self.assertTrue(server.card_subscription_exists(
                {"plan": "village", "stripe_subscription_id": "sub_1",
                 "stripe_subscription_status": status}), status)

    def test_an_ended_or_missing_one_does_not(self):
        for status in server.CARD_SUBSCRIPTION_OVER:
            self.assertFalse(server.card_subscription_exists(
                {"stripe_subscription_id": "sub_1", "stripe_subscription_status": status}))
        self.assertFalse(server.card_subscription_exists({"plan": "executive"}))
        self.assertFalse(server.card_subscription_exists(None))


@unittest.skipUnless(HAVE, "backend deps not installed")
class StripeEventsForTheHousehold(unittest.TestCase):
    FAMILY = {"stripe_subscription_id": "sub_live", "plan": "executive",
              "billing_cycle": "monthly"}

    def test_an_old_subscription_ending_does_not_drop_the_household(self):
        changes = {"plan": "village", "stripe_subscription_status": "canceled",
                   "stripe_customer_id": "cus_1"}
        out = server.stripe_changes_for_family(
            sub_event("customer.subscription.deleted", "sub_old", "canceled"),
            self.FAMILY, changes)
        self.assertNotIn("plan", out)
        self.assertNotIn("stripe_subscription_status", out)
        self.assertEqual(out["stripe_customer_id"], "cus_1")

    def test_the_current_subscription_ending_does(self):
        out = server.stripe_changes_for_family(
            sub_event("customer.subscription.deleted", "sub_live", "canceled"),
            dict(self.FAMILY, pending_plan="duo"), {"plan": "village"})
        self.assertEqual(out["plan"], "village")
        self.assertIsNone(out["pending_plan"])

    def test_a_booked_change_waits_for_its_cycle(self):
        family = dict(self.FAMILY, plan="executive", billing_cycle="yearly",
                      pending_plan="executive", pending_plan_cycle="monthly")
        same = server.stripe_changes_for_family(
            sub_event("customer.subscription.updated", "sub_live"), family,
            {"plan": "executive", "billing_cycle": "yearly"})
        self.assertNotIn("pending_plan", same)
        arrived = server.stripe_changes_for_family(
            sub_event("customer.subscription.updated", "sub_live"), family,
            {"plan": "executive", "billing_cycle": "monthly"})
        self.assertIsNone(arrived["pending_plan"])

    def test_a_booked_plan_without_a_cycle_settles_on_the_plan(self):
        family = dict(self.FAMILY, pending_plan="duo")
        out = server.stripe_changes_for_family(
            sub_event("customer.subscription.updated", "sub_live"), family, {"plan": "duo"})
        self.assertIsNone(out["pending_plan"])

    def test_a_first_checkout_is_not_filtered(self):
        out = server.stripe_changes_for_family(
            sub_event("customer.subscription.created", "sub_new"), {"plan": "village"},
            {"plan": "executive"})
        self.assertEqual(out["plan"], "executive")


@unittest.skipUnless(HAVE, "backend deps not installed")
class WhoseStoreAccountPays(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        asyncio.run(self.db["users"].insert_one({"user_id": "u2", "name": "Ama "}))

    def owner(self, family):
        return asyncio.run(server.store_billing_owner(self.db, family))

    def test_a_store_plan_names_its_buyer(self):
        family = {"plan": "executive", "rc_store": "PLAY_STORE",
                  "rc_product_id": "premium_monthly", "rc_last_event": "RENEWAL",
                  "rc_app_user_id": "u2"}
        self.assertEqual(self.owner(family),
                         {"billing_owner_user_id": "u2", "billing_owner_name": "Ama"})

    def test_nobody_is_named_for_card_free_or_unknown(self):
        empty = {"billing_owner_user_id": None, "billing_owner_name": None}
        self.assertEqual(self.owner({"plan": "village"}), empty)
        self.assertEqual(self.owner({"plan": "executive", "rc_store": "PLAY_STORE",
                                     "rc_product_id": "premium_monthly"}), empty)
        self.assertEqual(self.owner({"plan": "executive", "stripe_subscription_id": "sub_1",
                                     "stripe_subscription_status": "active",
                                     "rc_app_user_id": "u2"}), empty)


if __name__ == "__main__":
    unittest.main()
