"""Kid mode: a child gets their own view, and nothing else.

A child has no account. They get a profile on a device a parent already signed
into, entered with their own PIN, and a much smaller app. The security claim
being guarded here is the important one: the session a child holds must be
worthless everywhere except the handful of kid endpoints — otherwise handing
over the tablet hands over the vault, the calendar and a co-parent's private
items.

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

ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class KidMode(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        server._auth_fail.clear()
        asyncio.run(self.db["users"].insert_one({**ROLAND, "language": "en"}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_parent", "family_id": "fam1", "user_id": "u_r",
            "name": "Roland", "role": "Parent", "stars": 0,
            "pin_hash": server.sha256("9999")}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_ama", "family_id": "fam1", "name": "Ama",
            "role": "Child", "stars": 20, "pin_hash": server.sha256("1234")}))

    def tearDown(self):
        server.get_db = self._get_db

    # --- helpers --------------------------------------------------------
    def _enter(self, pin="1234", member="m_ama"):
        return asyncio.run(server.start_kid_session(
            server.ChildSessionIn(member_id=member, pin=pin), user=dict(ROLAND)))

    def _child(self, token):
        return asyncio.run(server.require_child(authorization=f"Bearer {token}"))

    def _home(self, token):
        return asyncio.run(server.kid_home(child=self._child(token)))

    def _chore(self, title, assignee="Ama", shared=True):
        return asyncio.run(server.create_card(
            server.CardIn(type="TASK", title=title, assignee=assignee, shared=shared),
            user=dict(ROLAND)))

    def _reward(self, title, cost):
        rid = server.new_id("reward")
        asyncio.run(self.db["rewards"].insert_one({
            "reward_id": rid, "family_id": "fam1", "title": title,
            "cost_stars": cost, "icon": "🍦", "created_at": server.utcnow()}))
        return rid

    # --- getting in -----------------------------------------------------
    def test_the_right_pin_opens_the_childs_view(self):
        out = self._enter()
        self.assertTrue(out["session_token"])
        self.assertEqual(out["member"]["name"], "Ama")

    def test_the_wrong_pin_does_not(self):
        with self.assertRaises(server.HTTPException) as e:
            self._enter(pin="0000")
        self.assertEqual(e.exception.status_code, 401)

    def test_repeated_guessing_locks_the_profile(self):
        for _ in range(server.AUTH_FAIL_MAX + 1):
            try:
                self._enter(pin="0000")
            except server.HTTPException:
                pass
        with self.assertRaises(server.HTTPException) as e:
            self._enter(pin="1234")   # even the RIGHT pin, once locked
        self.assertEqual(e.exception.status_code, 429)

    def test_kid_mode_is_refused_until_a_grown_up_has_a_pin(self):
        asyncio.run(self.db["family_members"].update_one(
            {"member_id": "m_parent"}, {"$set": {"pin_hash": None}}))
        with self.assertRaises(server.HTTPException) as e:
            self._enter()
        self.assertEqual(e.exception.status_code, 400)

    def test_you_cannot_switch_into_a_grown_ups_profile(self):
        with self.assertRaises(server.HTTPException) as e:
            self._enter(pin="9999", member="m_parent")
        self.assertEqual(e.exception.status_code, 404)

    # --- the wall -------------------------------------------------------
    def test_a_child_session_opens_nothing_else_in_the_app(self):
        token = self._enter()["session_token"]
        asyncio.run(self.db["user_sessions"].find_one({}))  # sanity: it exists
        with self.assertRaises(server.HTTPException) as e:
            asyncio.run(server.require_user(authorization=f"Bearer {token}"))
        self.assertEqual(e.exception.status_code, 403)

    def test_a_parent_session_is_not_a_kid_session(self):
        raw = asyncio.run(server._issue_session(self.db, "u_r"))
        with self.assertRaises(server.HTTPException) as e:
            asyncio.run(server.require_child(authorization=f"Bearer {raw}"))
        self.assertEqual(e.exception.status_code, 401)

    def test_leaving_kid_mode_needs_a_grown_ups_pin(self):
        token = self._enter()["session_token"]
        with self.assertRaises(server.HTTPException) as e:
            asyncio.run(server.exit_kid_session(
                server.ParentPinIn(pin="1234"), child=self._child(token),
                authorization="Bearer test-kid-token"))
        self.assertEqual(e.exception.status_code, 401)
        out = asyncio.run(server.exit_kid_session(
            server.ParentPinIn(pin="9999"), child=self._child(token),
            authorization="Bearer test-kid-token"))
        self.assertTrue(out["ok"])

    # --- what a child sees ----------------------------------------------
    def test_the_home_screen_holds_their_stars_chores_and_rewards(self):
        self._chore("Tidy room")
        self._reward("Ice cream", 10)
        home = self._home(self._enter()["session_token"])
        self.assertEqual(home["name"], "Ama")
        self.assertEqual(home["stars"], 20)
        self.assertEqual([c["title"] for c in home["chores"]], ["Tidy room"])
        self.assertEqual([r["title"] for r in home["rewards"]], ["Ice cream"])

    def test_another_persons_chores_are_not_shown(self):
        self._chore("Tidy room")
        self._chore("Do the taxes", assignee="Roland")
        home = self._home(self._enter()["session_token"])
        self.assertEqual([c["title"] for c in home["chores"]], ["Tidy room"])

    def test_a_private_parent_item_never_reaches_a_child(self):
        # A private parent to-do the parent keeps to themselves (assigned to
        # Roland, not to the child) never shows in the child's home. A chore
        # actually assigned to the child is meant for them and does show — that
        # is the point of assigning it — so privacy here means "not the child's".
        self._chore("Therapy booking", assignee="Roland", shared=False)
        home = self._home(self._enter()["session_token"])
        self.assertEqual(home["chores"], [])

    # --- what a child can do --------------------------------------------
    def test_they_can_finish_their_own_chore(self):
        card = self._chore("Tidy room")
        token = self._enter()["session_token"]
        asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))
        fresh = asyncio.run(self.db["cards"].find_one({"card_id": card["card_id"]}))
        self.assertEqual(fresh["status"], "DONE")
        self.assertEqual(fresh["completed_by_name"], "Ama")

    def test_finishing_your_own_chore_pays_nothing_until_a_parent_approves(self):
        # It used to pay 5 stars on the spot. A child holding a phone could
        # therefore award themselves, repeatedly, by ticking chores nobody had
        # checked — and the parent found out only by noticing the number had
        # moved. It now goes where a teen's finished task has always gone.
        card = self._chore("Tidy room")
        token = self._enter()["session_token"]
        out = asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))

        m = asyncio.run(self.db["family_members"].find_one({"member_id": "m_ama"}, {"_id": 0}))
        self.assertEqual(m["stars"], 20)          # untouched
        self.assertEqual(m.get("week_earned", 0), 0)
        self.assertIsNone(asyncio.run(
            self.db["star_transactions"].find_one({"member_id": "m_ama"})))
        self.assertTrue(out["awaiting_approval"])

    def test_the_chore_still_reads_as_done_for_the_child(self):
        # Waiting on a parent must not look like the tick failing.
        card = self._chore("Tidy room")
        token = self._enter()["session_token"]
        asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))
        fresh = asyncio.run(self.db["cards"].find_one({"card_id": card["card_id"]}))
        self.assertEqual(fresh["status"], "DONE")

    def test_it_lands_in_the_parents_approval_list(self):
        card = self._chore("Tidy room")
        token = self._enter()["session_token"]
        asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))
        rows = asyncio.run(server.teen_approvals(user=dict(ROLAND)))["approvals"]
        self.assertEqual([r["card_id"] for r in rows], [card["card_id"]])
        self.assertEqual(rows[0]["who"], "Ama")

    def test_approving_it_pays_the_child_the_parent_chose(self):
        # A kid has no account, so the approval cannot resolve them by user_id
        # the way it resolves a teen — the member id is written onto the card.
        # Without that path an approved chore would pay nobody.
        card = self._chore("Tidy room")
        token = self._enter()["session_token"]
        asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))
        asyncio.run(server.resolve_teen_approval(
            card["card_id"], server.TeenApprovalIn(approve=True, stars=3),
            user=dict(ROLAND)))
        m = asyncio.run(self.db["family_members"].find_one({"member_id": "m_ama"}, {"_id": 0}))
        self.assertEqual(m["stars"], 23)
        self.assertEqual(m["week_earned"], 3)

    def test_declining_it_pays_nothing(self):
        card = self._chore("Tidy room")
        token = self._enter()["session_token"]
        asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))
        asyncio.run(server.resolve_teen_approval(
            card["card_id"], server.TeenApprovalIn(approve=False),
            user=dict(ROLAND)))
        m = asyncio.run(self.db["family_members"].find_one({"member_id": "m_ama"}, {"_id": 0}))
        self.assertEqual(m["stars"], 20)

    def test_a_finished_chore_cannot_be_queued_twice(self):
        card = self._chore("Tidy room")
        token = self._enter()["session_token"]
        asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))
        asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))
        rows = asyncio.run(server.teen_approvals(user=dict(ROLAND)))["approvals"]
        self.assertEqual(len(rows), 1)

    def test_re_ticking_after_approval_cannot_be_paid_again(self):
        # The whole point: no path back to a second payment.
        card = self._chore("Tidy room")
        token = self._enter()["session_token"]
        asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))
        asyncio.run(server.resolve_teen_approval(
            card["card_id"], server.TeenApprovalIn(approve=True, stars=5),
            user=dict(ROLAND)))
        asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))
        rows = asyncio.run(server.teen_approvals(user=dict(ROLAND)))["approvals"]
        self.assertEqual(rows, [])
        m = asyncio.run(self.db["family_members"].find_one({"member_id": "m_ama"}, {"_id": 0}))
        self.assertEqual(m["stars"], 25)

    def test_they_cannot_finish_somebody_elses(self):
        card = self._chore("Do the taxes", assignee="Roland")
        token = self._enter()["session_token"]
        with self.assertRaises(server.HTTPException) as e:
            asyncio.run(server.kid_finish_chore(card["card_id"], child=self._child(token)))
        self.assertEqual(e.exception.status_code, 403)

    def test_spending_stars_leaves_something_owed(self):
        rid = self._reward("Ice cream", 15)
        token = self._enter()["session_token"]
        out = asyncio.run(server.kid_request_reward(rid, child=self._child(token)))
        self.assertEqual(out["stars"], 5)
        self.assertEqual(out["redemption"]["status"], "pending")
        home = self._home(token)
        self.assertEqual([r["reward_title"] for r in home["owed"]], ["Ice cream"])

    def test_they_cannot_spend_stars_they_do_not_have(self):
        rid = self._reward("Bicycle", 500)
        token = self._enter()["session_token"]
        with self.assertRaises(server.HTTPException) as e:
            asyncio.run(server.kid_request_reward(rid, child=self._child(token)))
        self.assertEqual(e.exception.status_code, 400)
        self.assertEqual(self._home(token)["stars"], 20)

    def test_two_taps_cannot_spend_the_same_stars_twice(self):
        rid = self._reward("Ice cream", 15)
        token = self._enter()["session_token"]
        asyncio.run(server.kid_request_reward(rid, child=self._child(token)))
        with self.assertRaises(server.HTTPException):
            asyncio.run(server.kid_request_reward(rid, child=self._child(token)))
        self.assertEqual(self._home(token)["stars"], 5)

    # --- the picker -----------------------------------------------------
    def test_the_picker_lists_the_household_and_says_it_is_ready(self):
        out = asyncio.run(server.list_profiles(user=dict(ROLAND)))
        self.assertTrue(out["kid_mode_ready"])
        self.assertEqual({p["name"] for p in out["profiles"]}, {"Roland", "Ama"})
        ama = [p for p in out["profiles"] if p["name"] == "Ama"][0]
        self.assertTrue(ama["is_child"] and ama["has_pin"])

    def test_the_picker_says_when_no_grown_up_has_a_pin_yet(self):
        asyncio.run(self.db["family_members"].update_one(
            {"member_id": "m_parent"}, {"$set": {"pin_hash": None}}))
        self.assertFalse(asyncio.run(server.list_profiles(user=dict(ROLAND)))["kid_mode_ready"])


if __name__ == "__main__":
    unittest.main()
