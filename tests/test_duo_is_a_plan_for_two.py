"""Duo: a plan for two, and moving between plans without paying twice.

Duo (€1.99 / €19.99) is the everyday paid kit for a couple — the kitchen,
unlimited scans, the Sunday brief, the gift pot — without the children's side
of the app. These pin:

  * what Duo includes and what it leaves to Family;
  * that every store's Duo product is granted Duo, not Family;
  * who may choose it (two people with a login, children without one do not
    count) and that the children's sections are hidden on it, never deleted;
  * that a plan switch never creates a second subscription: a card switch
    changes the one subscription (up now, down at renewal), and a store switch
    grants an upgrade at once but waits for the renewal to apply a downgrade.
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
    from fastapi import HTTPException

ROOT = os.path.join(os.path.dirname(__file__), "..")


def server_source() -> str:
    with open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8") as fh:
        return fh.read()


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatDuoIs(unittest.TestCase):
    def test_price(self):
        duo = server.PLAN_CATALOG["duo"]
        self.assertEqual(duo["price_monthly"], 1.99)
        self.assertEqual(duo["price_yearly"], 19.99)

    def test_the_everyday_kit_is_in(self):
        limits = server.PLAN_CATALOG["duo"]["limits"]
        for feature in ("meal_planner", "weekly_brief", "weekly_report", "gift_pot", "secret_santa"):
            self.assertTrue(limits[feature], feature)
        self.assertEqual(limits["ai_scans_per_month"], server.AI_SCANS_UNLIMITED)
        self.assertEqual(limits["vault_bytes"], 500 * 1024 * 1024)

    def test_the_childrens_side_is_family(self):
        limits = server.PLAN_CATALOG["duo"]["limits"]
        self.assertEqual(limits["max_children"], 0)
        self.assertEqual(limits["max_members"], 2)
        for feature in ("allowance", "carpool", "helper_accounts"):
            self.assertFalse(limits[feature], feature)

    def test_every_gated_flag_is_defined(self):
        """require_feature fails closed: a flag missing from Duo would lock a
        feature a Duo household pays for."""
        self.assertEqual(set(server.PLAN_CATALOG["duo"]["limits"]),
                         set(server.PLAN_CATALOG["executive"]["limits"]))

    def test_it_counts_as_paying(self):
        self.assertIn("duo", server.PAID_PLANS)

    def test_the_order_of_plans(self):
        order = sorted(["household", "village", "executive", "duo"], key=server.plan_rank)
        self.assertEqual(order, ["village", "duo", "executive", "household"])

    def test_the_wall_names_duo_where_duo_opens_it(self):
        self.assertIn("Duo", server.PREMIUM_FEATURE_MESSAGES["meal_planner"])
        self.assertNotIn("Duo", server.PREMIUM_FEATURE_MESSAGES["allowance"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class EveryStoreGrantsDuo(unittest.TestCase):
    def test_google(self):
        self.assertEqual(server.rc_plan_from_product("duo:monthly"), ("duo", "monthly"))
        self.assertEqual(server.rc_plan_from_product("duo:yearly"), ("duo", "yearly"))
        self.assertEqual(server.rc_plan_from_product("duo")[0], "duo")

    def test_apple(self):
        self.assertEqual(server.rc_plan_from_product("ahenora_duo_monthly"), ("duo", "monthly"))
        self.assertEqual(server.rc_plan_from_product("ahenora_duo_yearly"), ("duo", "yearly"))

    def test_the_others_are_unchanged(self):
        self.assertEqual(server.rc_plan_from_product("premium_monthly")[0], "executive")
        self.assertEqual(server.rc_plan_from_product("ahenora_executive_yearly")[0], "executive")
        self.assertEqual(server.rc_plan_from_product("household:yearly")[0], "household")
        self.assertEqual(server.rc_plan_from_product("ahenora_household_monthly")[0], "household")

    def test_card(self):
        self.assertEqual(server.STRIPE_TIER_TO_PLAN["duo"], "duo")
        old = {k: os.environ.get(k) for k in ("STRIPE_PRICE_DUO_MONTHLY", "STRIPE_PRICE_DUO_YEARLY")}
        os.environ["STRIPE_PRICE_DUO_MONTHLY"] = "price_duo_m"
        os.environ["STRIPE_PRICE_DUO_YEARLY"] = "price_duo_y"
        try:
            self.assertEqual(server._stripe_plan_for_price("price_duo_m"), "duo")
            self.assertEqual(server._stripe_cycle_for_price("price_duo_y"), "yearly")
            self.assertEqual(server._stripe_price_id("duo", "monthly"), "price_duo_m")
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AStoreSwitch(unittest.TestCase):
    """RevenueCat's PRODUCT_CHANGE: product_id is the plan being LEFT."""

    def change(self, old, new, old_plan, old_cycle="monthly"):
        end = server.utcnow() + timedelta(days=20)
        return server.rc_product_change(
            {"product_id": old, "new_product_id": new}, old_plan, old_cycle, end), end

    def test_up_is_granted_now(self):
        out, _ = self.change("duo:monthly", "premium_monthly:monthly", "duo")
        self.assertEqual(out["plan"], "executive")
        self.assertIsNone(out["pending_plan"])

    def test_down_waits_for_the_renewal(self):
        out, end = self.change("ahenora_executive_monthly", "ahenora_duo_monthly", "executive")
        self.assertEqual(out["plan"], "executive", "keeps what was paid for")
        self.assertEqual(out["pending_plan"], "duo")
        self.assertEqual(out["pending_plan_at"], end)

    def test_another_cycle_of_the_same_plan_waits(self):
        out, _ = self.change("ahenora_duo_monthly", "ahenora_duo_yearly", "duo")
        self.assertEqual(out["plan"], "duo")
        self.assertEqual(out["pending_plan"], "duo")
        self.assertEqual(out["pending_plan_cycle"], "yearly")

    def test_without_the_new_product_nothing_moves(self):
        out = server.rc_product_change({"product_id": "duo:monthly"}, "duo", "monthly", None)
        self.assertEqual(out, {"plan": "duo", "billing_cycle": "monthly"})

    def test_the_webhook_routes_product_change_here(self):
        src = server_source()
        body = src[src.index("async def revenuecat_webhook"):]
        body = body[:body.index("async def _fetch_rc_subscriber")]
        self.assertIn('if event_type == "PRODUCT_CHANGE":', body)
        self.assertLess(body.index('if event_type == "PRODUCT_CHANGE":'),
                        body.index("elif event_type in RC_PREMIUM_EVENTS:"))


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, str(body)

    def json(self):
        return self._body


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ACardSwitch(unittest.TestCase):
    """One subscription, changed — never a second one next to it."""

    def setUp(self):
        self._request = server.requests.request
        self.calls = []
        self.schedule = None
        self.sub = {
            "id": "sub_1", "current_period_end": 1_800_000_000,
            "items": {"data": [{"id": "si_1", "price": {"id": "price_family_m"}}]},
        }

    def tearDown(self):
        server.requests.request = self._request

    def stripe(self, fail_on=None):
        def fake(method, url, data=None, auth=None, timeout=None):
            path = url.split("/v1", 1)[1]
            self.calls.append((method, path, dict(data or [])))
            if fail_on and fail_on in path:
                return _Resp(402, {"error": {"message": "card declined"}})
            if method == "GET":
                sub = dict(self.sub)
                if self.schedule:
                    sub["schedule"] = self.schedule
                return _Resp(200, sub)
            if path == "/subscription_schedules":
                return _Resp(200, {"id": "sched_1", "phases": [
                    {"start_date": 1_797_400_000, "end_date": 1_800_000_000}]})
            return _Resp(200, {"id": "ok"})
        server.requests.request = fake

    def test_up_changes_the_one_subscription_now(self):
        self.stripe()
        os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_fake")
        out = server.stripe_switch_plan("sub_1", "price_household_m", upgrade=True)
        self.assertEqual(out["effective"], "now")
        method, path, form = self.calls[-1]
        self.assertEqual((method, path), ("POST", "/subscriptions/sub_1"))
        self.assertEqual(form["items[0][id]"], "si_1", "the existing item is changed, not a new one added")
        self.assertEqual(form["items[0][price]"], "price_household_m")
        self.assertEqual(form["proration_behavior"], "always_invoice")
        self.assertEqual(form["payment_behavior"], "pending_if_incomplete",
                         "a declined card must not get the better plan")
        self.assertFalse(any(p.startswith("/checkout") for _, p, _ in self.calls))

    def test_down_waits_for_the_renewal_date(self):
        self.stripe()
        os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_fake")
        out = server.stripe_switch_plan("sub_1", "price_duo_m", upgrade=False)
        self.assertEqual(out, {"effective": "renewal", "at": 1_800_000_000})
        created = [c for c in self.calls if c[1] == "/subscription_schedules"][0]
        self.assertEqual(created[2]["from_subscription"], "sub_1")
        method, path, form = self.calls[-1]
        self.assertEqual(path, "/subscription_schedules/sched_1")
        self.assertEqual(form["phases[0][items][0][price]"], "price_family_m", "this period stays as paid")
        self.assertEqual(form["phases[0][end_date]"], "1800000000")
        self.assertEqual(form["phases[1][items][0][price]"], "price_duo_m")
        self.assertEqual(form["end_behavior"], "release")
        self.assertEqual(form["proration_behavior"], "none")

    def test_an_earlier_pending_change_is_released_first(self):
        self.schedule = "sched_old"
        self.stripe()
        os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_fake")
        server.stripe_switch_plan("sub_1", "price_household_m", upgrade=True)
        self.assertIn(("POST", "/subscription_schedules/sched_old/release", {}), self.calls)

    def test_the_period_end_is_read_from_the_item_on_newer_api_versions(self):
        self.assertEqual(server._stripe_period_end(
            {"items": {"data": [{"current_period_end": 123}]}}), 123)

    def test_a_refusal_is_a_readable_error(self):
        self.stripe(fail_on="/subscriptions/sub_1")
        os.environ.setdefault("STRIPE_SECRET_KEY", "sk_test_fake")
        with self.assertRaises(HTTPException) as caught:
            server.stripe_switch_plan("sub_1", "price_household_m", upgrade=True)
        self.assertEqual(caught.exception.detail, "card_change_failed")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheRoutes(unittest.TestCase):
    ENV = ("STRIPE_SECRET_KEY", "STRIPE_PRICE_DUO_MONTHLY", "STRIPE_PRICE_DUO_YEARLY",
           "STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_YEARLY")

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db, self._switch = server.get_db, server.stripe_switch_plan
        self._env = {k: os.environ.get(k) for k in self.ENV}
        server.get_db = lambda: self.db
        os.environ.update({"STRIPE_SECRET_KEY": "sk_test_fake",
                           "STRIPE_PRICE_DUO_MONTHLY": "price_duo_m",
                           "STRIPE_PRICE_DUO_YEARLY": "price_duo_y",
                           "STRIPE_PRICE_MONTHLY": "price_family_m",
                           "STRIPE_PRICE_YEARLY": "price_family_y"})
        self.switched = []

        def fake_switch(sub_id, price, upgrade):
            self.switched.append((sub_id, price, upgrade))
            return {"effective": "now" if upgrade else "renewal",
                    "at": None if upgrade else 1_800_000_000}
        server.stripe_switch_plan = fake_switch

    def tearDown(self):
        server.get_db, server.stripe_switch_plan = self._get_db, self._switch
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def seed(self, plan="executive", card=True, people=2, children=0):
        async def go():
            fam = {"family_id": "fam1", "plan": plan, "billing_cycle": "monthly"}
            if card:
                fam.update({"stripe_customer_id": "cus_1", "stripe_subscription_id": "sub_1",
                            "stripe_subscription_status": "active"})
            await self.db["families"].insert_one(fam)
            for i in range(people):
                await self.db["family_members"].insert_one(
                    {"family_id": "fam1", "member_id": f"p{i}", "role": "Parent", "user_id": f"u{i}"})
            for i in range(children):
                await self.db["family_members"].insert_one(
                    {"family_id": "fam1", "member_id": f"c{i}", "role": "Child"})
        asyncio.run(go())

    user = {"user_id": "u0", "family_id": "fam1", "email": "a@example.com"}

    def change(self, tier, cycle="monthly"):
        return asyncio.run(server.stripe_change_plan({"tier": tier, "cycle": cycle}, user=self.user))

    def test_family_down_to_duo_is_scheduled_and_recorded(self):
        self.seed()
        out = self.change("duo")
        self.assertEqual(self.switched, [("sub_1", "price_duo_m", False)])
        self.assertEqual(out["effective"], "renewal")
        fam = asyncio.run(self.db["families"].find_one({"family_id": "fam1"}))
        self.assertEqual(fam["pending_plan"], "duo")
        self.assertEqual(fam["plan"], "executive", "the plan itself only moves when Stripe says so")

    def test_duo_up_to_family_is_now(self):
        self.seed(plan="duo")
        out = self.change("family")
        self.assertEqual(self.switched, [("sub_1", "price_family_m", True)])
        self.assertEqual(out["effective"], "now")

    def test_monthly_to_yearly_of_the_same_plan_is_now(self):
        self.seed(plan="duo")
        self.change("duo", "yearly")
        self.assertEqual(self.switched, [("sub_1", "price_duo_y", True)])

    def test_choosing_what_you_already_have_does_nothing(self):
        self.seed(plan="duo")
        self.assertEqual(self.change("duo")["effective"], "none")
        self.assertEqual(self.switched, [])

    def test_four_people_cannot_choose_duo(self):
        self.seed(people=3)
        with self.assertRaises(HTTPException) as caught:
            self.change("duo")
        self.assertEqual(caught.exception.detail, "duo_not_eligible")
        self.assertEqual(self.switched, [])

    def test_children_without_a_login_do_not_count(self):
        self.seed(people=2, children=2)
        self.change("duo")
        self.assertEqual(len(self.switched), 1)

    def test_an_invite_already_sent_counts(self):
        self.seed(people=2)
        asyncio.run(self.db["family_invites"].insert_one(
            {"family_id": "fam1", "status": "pending",
             "expires_at": server.utcnow() + timedelta(days=3)}))
        with self.assertRaises(HTTPException):
            self.change("duo")

    def test_no_card_subscription_no_change(self):
        self.seed(card=False)
        with self.assertRaises(HTTPException) as caught:
            self.change("duo")
        self.assertEqual(caught.exception.status_code, 404)

    def test_checkout_refuses_a_second_subscription(self):
        """The bug this closes: a card subscriber choosing another plan went
        through Checkout again and ended up paying for both."""
        self.seed()
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.stripe_checkout({"tier": "duo", "cycle": "monthly"}, user=self.user))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(caught.exception.detail, "card_subscription_exists")

    def test_checkout_refuses_duo_for_four(self):
        self.seed(card=False, people=4)
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.stripe_checkout({"tier": "duo", "cycle": "monthly"}, user=self.user))
        self.assertEqual(caught.exception.detail, "duo_not_eligible")

    def test_both_routes_are_for_full_members(self):
        src = server_source()
        for route in ('@app.post("/api/billing/stripe/change")', '@app.put("/api/family/kids-sections")'):
            self.assertIn("require_full_member", src[src.index(route):][:300], route)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatTheAppIsTold(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def sub(self, plan, people=2, children=0, hidden=None):
        async def go():
            fam = {"family_id": "fam1", "plan": plan, "billing_cycle": "monthly"}
            if hidden is not None:
                fam["kids_sections_hidden"] = hidden
            await self.db["families"].insert_one(fam)
            for i in range(people):
                await self.db["family_members"].insert_one(
                    {"family_id": "fam1", "role": "Parent", "user_id": f"u{i}"})
            for i in range(children):
                await self.db["family_members"].insert_one({"family_id": "fam1", "role": "Child"})
            return await server.build_subscription("fam1")
        return asyncio.run(go())

    def test_a_couple_may_choose_duo(self):
        s = self.sub("executive", people=2, children=1)
        self.assertTrue(s["duo_eligible"])
        self.assertEqual(s["duo_people_count"], 2)

    def test_three_adults_may_not(self):
        s = self.sub("executive", people=3)
        self.assertFalse(s["duo_eligible"])

    def test_duo_hides_the_childrens_sections(self):
        self.assertTrue(self.sub("duo", children=1)["kids_sections_hidden"])

    def test_family_shows_them_unless_the_household_chose(self):
        self.assertFalse(self.sub("executive")["kids_sections_hidden"])

    def test_a_couple_on_any_plan_can_hide_them(self):
        s = self.sub("village", hidden=True)
        self.assertTrue(s["kids_sections_hidden"])
        self.assertTrue(s["kids_sections_choice"])

    def test_the_setting_route_stores_the_choice(self):
        self.sub("village")
        out = asyncio.run(server.set_kids_sections(
            server.KidsSectionsIn(hidden=True), user={"user_id": "u0", "family_id": "fam1"}))
        self.assertTrue(out["kids_sections_hidden"])
        fam = asyncio.run(self.db["families"].find_one({"family_id": "fam1"}))
        self.assertTrue(fam["kids_sections_hidden"])

    def test_nothing_is_deleted_on_duo(self):
        self.sub("duo", children=2)
        kids = asyncio.run(self.db["family_members"].count_documents({"role": "Child"}))
        self.assertEqual(kids, 2)

    def test_a_pending_change_is_shown(self):
        async def go():
            await self.db["families"].insert_one({
                "family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
                "pending_plan": "duo", "pending_plan_at": server.utcnow() + timedelta(days=9)})
            return await server.build_subscription("fam1")
        s = asyncio.run(go())
        self.assertEqual(s["pending_plan"], "duo")
        self.assertTrue(s["pending_plan_at"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheCardWebhook(unittest.TestCase):
    def test_a_renewal_on_the_duo_price_lands_duo_monthly_or_yearly(self):
        old = os.environ.get("STRIPE_PRICE_DUO_YEARLY")
        os.environ["STRIPE_PRICE_DUO_YEARLY"] = "price_duo_y"
        try:
            _, _, changes = server.stripe_event_changes({
                "type": "customer.subscription.updated",
                "data": {"object": {"status": "active", "customer": "cus_1",
                                    "items": {"data": [{"price": {"id": "price_duo_y"}}]}}}})
        finally:
            if old is None:
                os.environ.pop("STRIPE_PRICE_DUO_YEARLY", None)
            else:
                os.environ["STRIPE_PRICE_DUO_YEARLY"] = old
        self.assertEqual(changes["plan"], "duo")
        self.assertEqual(changes["billing_cycle"], "yearly")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhereTheSubscriptionLives(unittest.TestCase):
    """A switch must happen in the store that bills — never start a second."""

    def test_card(self):
        self.assertEqual(server.billed_through(
            {"plan": "duo", "stripe_customer_id": "cus", "stripe_subscription_status": "active"}), "card")

    def test_the_store_the_webhook_named(self):
        self.assertEqual(server.billed_through(
            {"plan": "executive", "rc_store": "PLAY_STORE", "rc_product_id": "ahenora_x"}), "play_store")
        self.assertEqual(server.billed_through({"plan": "executive", "rc_store": "APP_STORE"}), "app_store")

    def test_before_the_store_was_recorded_the_product_says(self):
        self.assertEqual(server.billed_through(
            {"plan": "executive", "rc_product_id": "ahenora_executive_monthly"}), "app_store")
        self.assertEqual(server.billed_through(
            {"plan": "executive", "rc_product_id": "premium_monthly"}), "play_store")

    def test_a_promotional_grant_is_no_store(self):
        self.assertIsNone(server.billed_through(
            {"plan": "executive", "rc_store": "PROMOTIONAL", "rc_product_id": "ahenora_executive_monthly"}))

    def test_free_and_founding_are_nowhere(self):
        self.assertIsNone(server.billed_through({"plan": "village", "rc_product_id": "premium_monthly"}))
        self.assertIsNone(server.billed_through({"plan": "household", "grandfathered": True}))


if __name__ == "__main__":
    unittest.main()
