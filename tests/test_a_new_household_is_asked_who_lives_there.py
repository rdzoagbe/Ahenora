"""A new household is asked who lives in it, and may try the plan that fits.

The question shapes the app and never limits it. These pin:

  * only a household created with the question can answer it, once — an
    existing family, or somebody who joined by invitation, is never asked;
  * a couple or somebody on their own has the children's sections put away,
    nothing deleted, and Settings brings them back;
  * the recommendation: Duo for one or two people, Family for children in one
    or two homes, Household beyond what Family holds;
  * the trial: every NEW household gets the whole app for fourteen days, no
    card, nothing charged at the end; what to keep afterwards follows the
    setup. An existing free household is untouched.
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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheRecommendation(unittest.TestCase):
    def test_one_or_two_people_is_duo(self):
        self.assertEqual(server.recommended_plan("solo", 0), "duo")
        self.assertEqual(server.recommended_plan("couple", 3), "duo", "children ignored when none live there")

    def test_children_is_family(self):
        self.assertEqual(server.recommended_plan("family", 2), "executive")
        self.assertEqual(server.recommended_plan("two_homes", 5), "executive")

    def test_more_than_family_holds_is_household(self):
        self.assertEqual(server.recommended_plan("family", 6), "household")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheTrial(unittest.TestCase):
    def test_in_force(self):
        t = server.active_trial({"plan": "village", "trial_plan": "duo",
                                 "trial_ends_at": server.utcnow() + timedelta(days=13, hours=2)})
        self.assertEqual(t["plan"], "duo")
        self.assertEqual(t["days_left"], 14)

    def test_over(self):
        self.assertIsNone(server.active_trial({"plan": "village", "trial_plan": "duo",
                                               "trial_ends_at": server.utcnow() - timedelta(seconds=1)}))

    def test_a_paying_household_is_never_on_trial(self):
        self.assertIsNone(server.active_trial({"plan": "executive", "trial_plan": "duo",
                                               "trial_ends_at": server.utcnow() + timedelta(days=5)}))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheQuestion(unittest.TestCase):
    user = {"user_id": "u1", "family_id": "fam1", "email": "a@example.com"}

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        # Billing live, so the limits are the plan's and not the testing
        # window's top tier.
        self._rc = os.environ.get("RC_WEBHOOK_SECRET")
        os.environ["RC_WEBHOOK_SECRET"] = "test-live"

    def tearDown(self):
        server.get_db = self._get_db
        if self._rc is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._rc

    def new_household(self):
        asyncio.run(server._seed_new_family(self.db, self.user, "fam1", "a@example.com", "Ana"))

    def answer(self, living, children=0, start_trial=False):
        return asyncio.run(server.household_setup(
            server.HouseholdSetupIn(living=living, children=children, start_trial=start_trial),
            user=self.user))

    def family(self):
        return asyncio.run(self.db["families"].find_one({"family_id": "fam1"}))

    def test_a_new_household_is_asked(self):
        self.new_household()
        sub = asyncio.run(server.build_subscription("fam1"))
        self.assertTrue(sub["household_setup_due"])

    def test_an_existing_household_is_not(self):
        asyncio.run(self.db["families"].insert_one({"family_id": "fam1", "plan": "village",
                                                    "billing_cycle": "monthly"}))
        self.assertFalse(asyncio.run(server.build_subscription("fam1"))["household_setup_due"])
        with self.assertRaises(HTTPException) as caught:
            self.answer("couple")
        self.assertEqual(caught.exception.status_code, 409)

    def test_it_is_answered_once(self):
        self.new_household()
        self.answer("couple")
        with self.assertRaises(HTTPException):
            self.answer("family", 2, start_trial=True)
        self.assertEqual(self.family()["household_living"], "couple")

    def test_a_couple_has_the_childrens_side_put_away(self):
        self.new_household()
        sub = self.answer("couple")
        self.assertTrue(sub["kids_sections_hidden"])
        self.assertEqual(sub["recommended_plan"], "duo")
        self.assertEqual(sub["plan"], "village", "answering buys nothing")

    def test_a_family_keeps_it(self):
        self.new_household()
        self.assertFalse(self.answer("family", 2)["kids_sections_hidden"])

    def test_a_new_household_starts_with_the_whole_app(self):
        self.new_household()
        sub = asyncio.run(server.build_subscription("fam1"))
        self.assertEqual(sub["plan"], "village", "nothing has been bought")
        self.assertEqual(sub["trial"]["plan"], "household", "the whole app")
        self.assertEqual(sub["trial"]["days_left"], 14)
        self.assertTrue(sub["limits"]["meal_planner"])
        self.assertTrue(sub["limits"]["helper_accounts"])
        self.assertTrue(sub["trial_used"])
        self.assertNotIn("stripe_customer_id", self.family(), "no card is taken")

    def test_what_to_keep_follows_the_setup(self):
        self.new_household()
        self.assertEqual(self.answer("family", 2)["trial"]["recommended_plan"], "executive")

    def test_a_couple_is_pointed_at_duo_and_sees_no_childrens_side(self):
        self.new_household()
        sub = self.answer("couple")
        self.assertEqual(sub["trial"]["recommended_plan"], "duo")
        self.assertTrue(sub["kids_sections_hidden"])

    def test_skipping_the_question_still_recommends_from_who_is_there(self):
        self.new_household()
        self.assertEqual(asyncio.run(server.build_subscription("fam1"))["trial"]["recommended_plan"], "duo")
        asyncio.run(self.db["family_members"].insert_one({"family_id": "fam1", "role": "Child"}))
        self.assertEqual(asyncio.run(server.build_subscription("fam1"))["trial"]["recommended_plan"], "executive")

    def test_when_it_ends_the_household_is_on_free_with_everything(self):
        self.new_household()
        self.answer("family", 2, start_trial=True)
        asyncio.run(self.db["families"].update_one(
            {"family_id": "fam1"}, {"$set": {"trial_ends_at": server.utcnow() - timedelta(minutes=1)}}))
        sub = asyncio.run(server.build_subscription("fam1"))
        self.assertIsNone(sub["trial"])
        self.assertEqual(sub["plan"], "village")
        self.assertFalse(sub["limits"]["meal_planner"])

    def test_an_existing_free_household_gets_no_trial(self):
        """Existing households keep Free exactly as it is."""
        asyncio.run(self.db["families"].insert_one({"family_id": "fam1", "plan": "village",
                                                    "billing_cycle": "monthly"}))
        sub = asyncio.run(server.build_subscription("fam1"))
        self.assertIsNone(sub["trial"])
        self.assertFalse(sub["limits"]["meal_planner"])

    def test_the_route_is_for_full_members(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "backend", "server.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("require_full_member", src[src.index('@app.post("/api/household/setup")'):][:200])

    def test_an_unknown_answer_is_refused(self):
        self.new_household()
        with self.assertRaises(HTTPException) as caught:
            self.answer("flatmates")
        self.assertEqual(caught.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
