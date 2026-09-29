"""Free is a plan for adults; children are on Family. Prices step evenly.

Roland, 2026-09-29: a family with two children got on Free what another family
paid Family for — unfair to the one paying, and no reason for the other to.
And the step from Duo (1.99) to Family (6.99) was too steep. So:

  * Free: two adults, three scans a month, no children.
  * Family 4.99 / 39.99 and Household 9.99 / 99.99 (were 6.99 / 49.99 and
    14.99 / 149.99).
  * Every NEW household still gets the whole app for 14 days.
  * A household already on Free with children keeps them until
    LEGACY_FREE_UNTIL, and is told the date; after it, the children are
    hidden and KEPT — never deleted — and come back with Family.
  * Card subscribers on an old price are still recognised at renewal
    (STRIPE_OLD_PRICES), so nobody is silently downgraded on the day they pay.
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
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase


def run(coro):
    return asyncio.run(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ThePlans(unittest.TestCase):
    def test_free_has_no_children_and_three_scans(self):
        free = server.PLAN_CATALOG["village"]["limits"]
        self.assertEqual(free["max_children"], 0)
        self.assertEqual(free["ai_scans_per_month"], 3)

    def test_the_new_prices(self):
        c = server.PLAN_CATALOG
        self.assertEqual((c["duo"]["price_monthly"], c["duo"]["price_yearly"]), (1.99, 19.99))
        self.assertEqual((c["executive"]["price_monthly"], c["executive"]["price_yearly"]), (4.99, 39.99))
        self.assertEqual((c["household"]["price_monthly"], c["household"]["price_yearly"]), (9.99, 99.99))

    def test_the_steps_are_even(self):
        prices = [server.PLAN_CATALOG[p]["price_monthly"] for p in ("duo", "executive", "household")]
        self.assertTrue(all(b / a <= 2.6 for a, b in zip(prices, prices[1:])), prices)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhoKeepsWhatForNow(unittest.TestCase):
    OLD = datetime(2026, 6, 1, tzinfo=timezone.utc)
    NEW = datetime(2026, 10, 2, tzinfo=timezone.utc)

    def test_a_household_from_before_is_legacy(self):
        self.assertTrue(server.is_legacy_free({"created_at": self.OLD}))
        self.assertTrue(server.is_legacy_free({}), "no date at all means old")

    def test_a_new_household_is_not(self):
        self.assertFalse(server.is_legacy_free({"created_at": self.NEW}))

    def test_legacy_keeps_the_old_free_until_the_date(self):
        before = server.LEGACY_FREE_UNTIL - timedelta(days=1)
        after = server.LEGACY_FREE_UNTIL + timedelta(minutes=1)
        self.assertEqual(server.free_limits_for({"created_at": self.OLD}, before)["max_children"], 2)
        self.assertEqual(server.free_limits_for({"created_at": self.OLD}, before)["ai_scans_per_month"], 10)
        self.assertEqual(server.free_limits_for({"created_at": self.OLD}, after)["max_children"], 0)
        self.assertEqual(server.free_limits_for({"created_at": self.NEW}, before)["max_children"], 0)

    def test_the_notice_period_is_at_least_sixty_days(self):
        self.assertGreaterEqual((server.LEGACY_FREE_UNTIL - server.NEW_FREE_FROM).days, 60)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatTheAppIsTold(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._rc = os.environ.get("RC_WEBHOOK_SECRET")
        os.environ["RC_WEBHOOK_SECRET"] = "test-live"   # billing live: real limits
        self._until = server.LEGACY_FREE_UNTIL

    def tearDown(self):
        server.get_db = self._get_db
        server.LEGACY_FREE_UNTIL = self._until
        if self._rc is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._rc

    def household(self, created, children=0, plan="village"):
        async def go():
            await self.db["families"].insert_one({"family_id": "fam1", "plan": plan,
                                                  "billing_cycle": "monthly", "created_at": created})
            await self.db["family_members"].insert_one({"family_id": "fam1", "role": "Parent", "user_id": "u1"})
            for i in range(children):
                await self.db["family_members"].insert_one({"family_id": "fam1", "role": "Child", "name": f"c{i}"})
            return await server.build_subscription("fam1")
        return run(go())

    def test_an_old_free_family_with_children_is_told_the_date(self):
        server.LEGACY_FREE_UNTIL = server.utcnow() + timedelta(days=30)
        sub = self.household(datetime(2026, 5, 1, tzinfo=timezone.utc), children=2)
        self.assertTrue(sub["free_children_until"])
        self.assertFalse(sub["children_locked"])
        self.assertFalse(sub["kids_sections_hidden"], "nothing changes before the date")
        self.assertEqual(sub["limits"]["max_children"], 2)

    def test_after_the_date_the_children_are_kept_and_hidden(self):
        server.LEGACY_FREE_UNTIL = server.utcnow() - timedelta(minutes=1)
        sub = self.household(datetime(2026, 5, 1, tzinfo=timezone.utc), children=2)
        self.assertTrue(sub["children_locked"])
        self.assertTrue(sub["kids_sections_hidden"])
        self.assertIsNone(sub["free_children_until"])
        kids = run(self.db["family_members"].count_documents({"role": "Child"}))
        self.assertEqual(kids, 2, "nothing is deleted")

    def test_family_brings_them_back(self):
        server.LEGACY_FREE_UNTIL = server.utcnow() - timedelta(minutes=1)
        sub = self.household(datetime(2026, 5, 1, tzinfo=timezone.utc), children=2, plan="executive")
        self.assertFalse(sub["children_locked"])
        self.assertFalse(sub["kids_sections_hidden"])

    def test_an_old_free_couple_is_not_told_anything(self):
        server.LEGACY_FREE_UNTIL = server.utcnow() + timedelta(days=30)
        sub = self.household(datetime(2026, 5, 1, tzinfo=timezone.utc))
        self.assertIsNone(sub["free_children_until"])
        self.assertFalse(sub["children_locked"])

    def test_a_new_household_on_its_trial_has_everything(self):
        async def go():
            await server._seed_new_family(self.db, {"user_id": "u1"}, "fam1", "a@example.com", "Ana")
            return await server.build_subscription("fam1")
        sub = run(go())
        self.assertEqual(sub["limits"]["max_children"], 10)
        self.assertFalse(sub["children_locked"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class OldCardPricesAreStillRecognised(unittest.TestCase):
    def setUp(self):
        self._env = {k: os.environ.get(k) for k in ("STRIPE_OLD_PRICES", "STRIPE_PRICE_HOUSEHOLD_MONTHLY")}
        os.environ["STRIPE_PRICE_HOUSEHOLD_MONTHLY"] = "price_new_house_m"
        os.environ["STRIPE_OLD_PRICES"] = "price_old_house_m=household:monthly, price_old_fam_y=family:yearly, junk"

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_a_renewal_on_the_old_household_price_stays_household(self):
        self.assertEqual(server._stripe_plan_for_price("price_old_house_m"), "household")
        self.assertEqual(server._stripe_cycle_for_price("price_old_house_m"), "monthly")

    def test_the_old_family_yearly_price(self):
        self.assertEqual(server._stripe_plan_for_price("price_old_fam_y"), "executive")
        self.assertEqual(server._stripe_cycle_for_price("price_old_fam_y"), "yearly")

    def test_the_new_price_still_works(self):
        self.assertEqual(server._stripe_plan_for_price("price_new_house_m"), "household")

    def test_an_unknown_price_is_still_unknown(self):
        self.assertIsNone(server._stripe_plan_for_price("price_nobody"))


if __name__ == "__main__":
    unittest.main()
