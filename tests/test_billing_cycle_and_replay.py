"""The billing cycle, and the purchases that reached nobody.

Two defects found in live data on 2026-09-07, both from the admin screen
rather than from a test.

THE CYCLE. rc_plan_from_product decided monthly-vs-yearly by searching the
product id for the substring "year". Ahenora's annual plan is a `yearly` base
plan under a Google Play subscription named `premium_monthly`, and RevenueCat
reports an entitlement's `product_identifier` as the subscription id ALONE —
so the string this function received for a customer who had paid for a year
was literally "premium_monthly". Every annual subscriber was stored as
monthly. €49.99 of annual subscription, filed as a €6.99 month.

The name is only ever as true as whoever typed it. The term is a fact, so the
cycle now comes from the term.

THE LOST PURCHASE. A webhook naming an app_user_id with no matching user is
answered 200, correctly — RevenueCat must stop retrying — and that was the end
of it. The admin screen showed one such row: real money, delivered nowhere.
The common cause is a race rather than a mystery, so it is retried.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

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


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheCycleComesFromTheTerm(unittest.TestCase):
    def test_the_exact_live_case_a_year_under_a_product_called_monthly(self):
        """The bug, named. 365 days sold under `premium_monthly`."""
        plan, cycle = server.rc_plan_from_product("premium_monthly", 365.0)
        self.assertEqual(cycle, "yearly")
        self.assertEqual(plan, "executive")

    def test_a_real_month_under_the_same_product_is_still_monthly(self):
        _, cycle = server.rc_plan_from_product("premium_monthly", 30.0)
        self.assertEqual(cycle, "monthly")

    def test_a_long_running_monthly_is_not_promoted_to_yearly(self):
        """One period, not the lifetime of the subscription. A monthly renewed
        for seven months is seven months old and still monthly."""
        _, cycle = server.rc_plan_from_product("ahenora_executive_monthly", 31.0)
        self.assertEqual(cycle, "monthly")

    def test_a_quarterly_plan_sits_on_the_monthly_side(self):
        _, cycle = server.rc_plan_from_product("some_quarterly", 92.0)
        self.assertEqual(cycle, "monthly")

    def test_the_name_is_still_the_fallback_when_no_term_is_known(self):
        """A lifetime entitlement, or a store that answered without dates."""
        _, cycle = server.rc_plan_from_product("ahenora_executive_yearly", None)
        self.assertEqual(cycle, "yearly")
        _, cycle = server.rc_plan_from_product("ahenora_executive_monthly", None)
        self.assertEqual(cycle, "monthly")

    def test_the_term_outranks_a_misleading_name(self):
        """If the two disagree, believe the money."""
        _, cycle = server.rc_plan_from_product("premium_monthly", 366.0)
        self.assertEqual(cycle, "yearly")

    def test_the_period_is_read_from_subscriptions_not_the_entitlement(self):
        """An entitlement's purchase_date is the ORIGINAL purchase, so a monthly
        running seven months would measure 240 days and be called yearly. The
        subscriptions block carries the latest renewal instead."""
        now = datetime(2026, 9, 7, tzinfo=timezone.utc)
        subscriber = {
            "subscriptions": {
                "premium_monthly": {
                    "purchase_date": iso(now - timedelta(days=3)),
                    "expires_date": iso(now + timedelta(days=27)),
                },
            },
        }
        days = server.rc_term_days_for_product(subscriber, "premium_monthly")
        self.assertAlmostEqual(days, 30.0, places=1)
        self.assertEqual(server.rc_cycle_from_term(days), "monthly")

    def test_a_yearly_reads_as_a_year(self):
        now = datetime(2026, 9, 7, tzinfo=timezone.utc)
        subscriber = {"subscriptions": {"premium_monthly": {
            "purchase_date": iso(now - timedelta(days=9)),
            "expires_date": iso(now + timedelta(days=356)),
        }}}
        days = server.rc_term_days_for_product(subscriber, "premium_monthly")
        self.assertEqual(server.rc_cycle_from_term(days), "yearly")

    def test_nonsense_dates_fall_back_rather_than_raise(self):
        for row in ({}, {"purchase_date": "not a date", "expires_date": "also not"},
                    {"purchase_date": iso(datetime(2026, 9, 7, tzinfo=timezone.utc))}):
            subscriber = {"subscriptions": {"p": row}}
            self.assertIsNone(server.rc_term_days_for_product(subscriber, "p"))
        self.assertIsNone(server.rc_cycle_from_term(None))

    def test_a_webhooks_own_milliseconds(self):
        day = 86400000
        self.assertEqual(server.rc_cycle_from_term(
            server.rc_term_days_from_ms(0, 365 * day)), "yearly")
        self.assertEqual(server.rc_cycle_from_term(
            server.rc_term_days_from_ms(0, 30 * day)), "monthly")
        self.assertIsNone(server.rc_term_days_from_ms(None, 30 * day))
        self.assertIsNone(server.rc_term_days_from_ms(10 * day, day))  # expiry before purchase


@unittest.skipUnless(HAVE, "backend deps not installed")
class AWebhookForAYearGrantsAYear(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._secret = os.environ.get("RC_WEBHOOK_SECRET")
        os.environ["RC_WEBHOOK_SECRET"] = "s3cret"
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u1", "family_id": "fam1", "email": "k@x.test"}))
        asyncio.run(self.db["families"].insert_one(
            {"family_id": "fam1", "plan": "village"}))

    def tearDown(self):
        server.get_db = self._get_db
        if self._secret is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._secret

    def fire(self, **event):
        base = {"type": "INITIAL_PURCHASE", "app_user_id": "u1",
                "product_id": "premium_monthly"}
        base.update(event)
        return asyncio.run(server.revenuecat_webhook(
            {"event": base}, authorization="Bearer s3cret"))

    def family(self):
        return asyncio.run(self.db["families"].find_one({"family_id": "fam1"}, {"_id": 0}))

    def test_the_live_purchase_is_recorded_as_yearly(self):
        day = 86400000
        self.fire(purchased_at_ms=0, expiration_at_ms=365 * day)
        fam = self.family()
        self.assertEqual(fam["plan"], "executive")
        self.assertEqual(fam["billing_cycle"], "yearly")

    def test_a_monthly_under_the_same_product_stays_monthly(self):
        day = 86400000
        self.fire(purchased_at_ms=0, expiration_at_ms=30 * day)
        self.assertEqual(self.family()["billing_cycle"], "monthly")

    def test_an_event_without_dates_falls_back_to_the_name(self):
        self.fire(product_id="ahenora_executive_yearly")
        self.assertEqual(self.family()["billing_cycle"], "yearly")


@unittest.skipUnless(HAVE, "backend deps not installed")
class APurchaseThatReachedNobody(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._fetch = server._fetch_rc_subscriber
        self.now = datetime(2026, 9, 7, tzinfo=timezone.utc)
        self.entitled = True

        async def fake_fetch(user_id, secret):
            if not self.entitled:
                return {"subscriber": {}}
            return {"subscriber": {
                "entitlements": {"premium": {
                    "product_identifier": "premium_monthly",
                    "expires_date": iso(self.now + timedelta(days=356))}},
                "subscriptions": {"premium_monthly": {
                    "purchase_date": iso(self.now - timedelta(days=9)),
                    "expires_date": iso(self.now + timedelta(days=356))}},
            }}
        server._fetch_rc_subscriber = fake_fetch

        asyncio.run(self.db["billing_events"].insert_one({
            "event_id": "bev_1", "source": "revenuecat",
            "event_type": "INITIAL_PURCHASE", "matched": False,
            "family_id": None, "app_user_id": "u_late",
            "product_id": "premium_monthly",
            "detail": "no account carries this app_user_id",
            "received_at": self.now,
        }))

    def tearDown(self):
        server.get_db = self._get_db
        server._fetch_rc_subscriber = self._fetch

    def replay(self):
        return asyncio.run(server.replay_unmatched_billing(self.db, secret="k"))

    def family(self):
        return asyncio.run(self.db["families"].find_one({"family_id": "famX"}, {"_id": 0}))

    def arrive(self):
        """The account the webhook named, existing at last."""
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u_late", "family_id": "famX"}))
        asyncio.run(self.db["families"].insert_one(
            {"family_id": "famX", "plan": "village"}))

    def test_it_stays_lost_while_the_account_does_not_exist(self):
        res = self.replay()
        self.assertEqual(res["resolved"], 0)

    def test_it_is_recovered_once_the_account_appears(self):
        """The race this exists for: the webhook beat the account row."""
        self.arrive()
        res = self.replay()
        self.assertEqual(res["resolved"], 1)
        fam = self.family()
        self.assertEqual(fam["plan"], "executive")
        # And with the right cycle, because recovery reads the term too.
        self.assertEqual(fam["billing_cycle"], "yearly")

    def test_a_lapsed_subscription_is_not_granted_off_a_stale_event(self):
        """The stored event says they paid; RevenueCat says they no longer hold
        it. Believe RevenueCat — granting here would be worse than the miss."""
        self.arrive()
        self.entitled = False
        self.assertEqual(self.replay()["resolved"], 0)
        self.assertEqual(self.family()["plan"], "village")

    def test_a_recovered_row_is_not_replayed_forever(self):
        self.arrive()
        self.assertEqual(self.replay()["resolved"], 1)
        self.assertEqual(self.replay()["resolved"], 0)

    def test_recovery_leaves_a_trail(self):
        self.arrive()
        self.replay()
        rows = asyncio.run(self.db["billing_events"].find({}, {"_id": 0}).to_list(50))
        self.assertTrue(any(r.get("event_type") == "RECOVERED" for r in rows))
        original = next(r for r in rows if r.get("event_id") == "bev_1")
        self.assertIsNotNone(original.get("resolved_at"))
        self.assertEqual(original.get("family_id"), "famX")


if __name__ == "__main__":
    unittest.main()
