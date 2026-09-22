"""Which store sold it — recorded, normalised, and countable.

Downloads on a platform and no revenue from it has two explanations that need
opposite fixes: nobody has tried to buy, or everybody who tried has failed.
Forty-seven recorded billing events could not tell them apart, because the
`store` field RevenueCat sends on every event was read and thrown away. The
admin screen could say how much money arrived and never from where.

Two things are pinned. The store is captured on every path that records a
purchase — the webhook, the self-heal sweep, the replay, and Stripe — because
the household whose purchase went missing is exactly the one worth knowing the
platform of, and it is the sweep and the replay that repair those. And the
spelling is normalised: the REST API answers "app_store" and the webhook
answers "APP_STORE", so without a single spelling one iPhone purchase counts as
two different stores depending on which path happened to record it.
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


def run(coro):
    return asyncio.run(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheStoreIsWrittenDown(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._push = server.send_push_to_user

        async def quiet(database, user_id, title, body, data, **kw):
            return {"devices": 0, "web": 0}
        server.send_push_to_user = quiet

    def tearDown(self):
        server.get_db = self._get_db
        server.send_push_to_user = self._push

    def record(self, **kw):
        kw.setdefault("source", "revenuecat")
        kw.setdefault("matched", True)
        kw.setdefault("event_type", "INITIAL_PURCHASE")
        run(server.record_billing_event(self.db, **kw))
        return run(self.db["billing_events"].find_one({}))

    def test_the_store_is_kept(self):
        self.assertEqual(self.record(store="APP_STORE")["store"], "APP_STORE")

    def test_the_rest_api_spelling_becomes_the_webhook_spelling(self):
        """Otherwise the same iPhone purchase counts as two stores depending on
        which code path recorded it."""
        self.assertEqual(self.record(store="app_store")["store"], "APP_STORE")

    def test_a_mac_purchase_counts_as_the_app_store(self):
        self.assertEqual(self.record(store="mac_app_store")["store"], "APP_STORE")

    def test_a_store_we_have_not_met_is_kept_as_it_arrived(self):
        """Hiding it would lose information; a store we do not recognise is
        still a store."""
        self.assertEqual(self.record(store="new_store")["store"], "NEW_STORE")

    def test_no_store_is_blank_not_guessed(self):
        self.assertEqual(self.record()["store"], "")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheStoreIsReadFromASubscriber(unittest.TestCase):
    """The sweep and the replay reach RevenueCat's REST API rather than being
    handed an event, so they read the store out of the subscriptions block."""

    def test_it_reads_the_store_for_that_product(self):
        subscriber = {"subscriptions": {
            "ahenora_executive_monthly": {"store": "app_store"},
            "something_else": {"store": "play_store"},
        }}
        self.assertEqual(
            server.rc_store_for_product(subscriber, "ahenora_executive_monthly"),
            "APP_STORE")

    def test_an_unknown_product_has_no_store(self):
        self.assertIsNone(server.rc_store_for_product({"subscriptions": {}}, "nope"))

    def test_a_subscriber_with_nothing_in_it_does_not_explode(self):
        self.assertIsNone(server.rc_store_for_product({}, None))
        self.assertIsNone(server.rc_store_for_product(None, "x"))

    def test_a_subscription_that_names_no_store_has_none(self):
        subscriber = {"subscriptions": {"p": {"expires_date": "2026-10-01"}}}
        self.assertIsNone(server.rc_store_for_product(subscriber, "p"))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ThePurchasesAreCountedByStore(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admin = server.is_admin_user
        server.is_admin_user = lambda u: True
        self.admin = {"user_id": "u_a", "family_id": "fam0"}

    def tearDown(self):
        server.get_db = self._get_db
        server.is_admin_user = self._admin

    def add(self, **kw):
        row = {"event_id": server.new_id("bev"), "source": "revenuecat",
               "matched": True, "family_id": "fam1", "environment": "PRODUCTION",
               "received_at": server.utcnow()}
        row.update(kw)
        run(self.db["billing_events"].insert_one(row))

    def read(self):
        return run(server.admin_billing_events(user=dict(self.admin), limit=40))["purchases_by_store"]

    def test_real_purchases_are_counted_where_they_happened(self):
        self.add(event_type="INITIAL_PURCHASE", store="PLAY_STORE")
        self.add(event_type="RENEWAL", store="PLAY_STORE")
        self.add(event_type="INITIAL_PURCHASE", store="APP_STORE")
        self.assertEqual(self.read(), {"PLAY_STORE": 2, "APP_STORE": 1})

    def test_a_platform_that_sold_nothing_has_no_line(self):
        """Its absence is the finding. A zero would read as a measurement; no
        line reads as what it is."""
        self.add(event_type="INITIAL_PURCHASE", store="PLAY_STORE")
        self.assertNotIn("APP_STORE", self.read())

    def test_a_test_purchase_is_not_a_sale(self):
        """Counting a licence-test renewal would say iPhones are buying when no
        iPhone has."""
        self.add(event_type="RENEWAL", store="APP_STORE", environment="SANDBOX")
        self.assertNotIn("APP_STORE", self.read())

    def test_things_that_are_not_purchases_are_not_counted(self):
        self.add(event_type="CANCELLATION", store="PLAY_STORE")
        self.add(event_type="EXPIRATION", store="PLAY_STORE")
        self.add(event_type="BILLING_ISSUE", store="PLAY_STORE")
        self.assertEqual(self.read(), {})

    def test_a_repaired_purchase_counts(self):
        """The sweep and the replay recover money a webhook lost. That is still
        a sale, and on a platform whose revenue is in question it is exactly
        the sale worth seeing."""
        self.add(event_type="RECONCILED", source="sweep", store="APP_STORE")
        self.add(event_type="RECOVERED", source="replay", store="APP_STORE")
        self.assertEqual(self.read(), {"APP_STORE": 2})

    def test_a_row_from_before_this_existed_is_unknown_not_assigned(self):
        self.add(event_type="INITIAL_PURCHASE")
        self.assertEqual(self.read(), {"unknown": 1})


if __name__ == "__main__":
    unittest.main()
