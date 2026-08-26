"""The Gift Pot — pool for a birthday. A Family feature; reminders stay free.

Covers the money-adjacent and privacy-sensitive paths: the Family gate, one
pledge per person (chipping in again updates, never stacks), the surprise being
hidden from the person it's for, cross-family isolation, and account-deletion
cleanup. All run under fake_mongo, so filters that Mongo operators can't be
trusted for in the test double are done in Python in the endpoints.

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
    import server
    from fake_mongo import FakeDatabase
    HAVE = True
except ImportError:
    HAVE = False


def run(coro):
    # A fresh loop per call — a shared get_event_loop() gets closed by other
    # test modules in the full suite and then errors here.
    return asyncio.new_event_loop().run_until_complete(coro)


@unittest.skipUnless(HAVE, "backend deps not installed")
class GiftPot(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        # Billing "live" so the plan gate is actually enforced — otherwise the
        # testing-window override grants every family household limits and the
        # 402 never fires. (Same reason e2e_backend sets this.)
        self._had_rc = os.environ.get("RC_WEBHOOK_SECRET")
        os.environ["RC_WEBHOOK_SECRET"] = "gift-pot-test"
        # Two parents + one child, on the FREE plan by default.
        run(self._seed())

    def tearDown(self):
        server.get_db = self._get_db
        if self._had_rc is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._had_rc

    async def _seed(self, plan="village"):
        await self.db["families"].insert_one({
            "family_id": "fam1", "plan": plan, "billing_cycle": "monthly",
            "grandfathered": False, "updated_at": server.utcnow()})
        for uid, name, role in (("u_r", "Roland", "Parent"), ("u_k", "Keigh", "Parent")):
            await self.db["users"].insert_one(
                {"user_id": uid, "family_id": "fam1", "name": name})
            await self.db["family_members"].insert_one(
                {"member_id": f"m_{uid}", "family_id": "fam1", "user_id": uid,
                 "name": name, "role": role})
        # A young child — no account.
        await self.db["family_members"].insert_one(
            {"member_id": "m_ama", "family_id": "fam1", "name": "Ama", "role": "Child"})

    def _user(self, uid="u_r"):
        return {"user_id": uid, "family_id": "fam1", "name": {"u_r": "Roland", "u_k": "Keigh"}[uid]}

    async def _set_plan(self, plan):
        await self.db["families"].update_one({"family_id": "fam1"}, {"$set": {"plan": plan}})

    # --- the Family gate --------------------------------------------------
    def test_creating_a_pot_is_refused_on_the_free_plan(self):
        with self.assertRaises(server.HTTPException) as e:
            run(server.create_gift_pot(server.GiftPotIn(title="Ama", per_head=10), self._user()))
        self.assertEqual(e.exception.status_code, 402)
        self.assertEqual(e.exception.detail["feature"], "gift_pot")

    def test_family_plan_can_create_a_pot(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(
            server.GiftPotIn(title="Ama", per_head=10, target_total=50), self._user()))
        self.assertEqual(pot["title"], "Ama")
        self.assertEqual(pot["status"], "open")
        self.assertEqual(pot["total_pledged"], 0)

    # --- pledges ----------------------------------------------------------
    def test_chipping_in_twice_updates_your_pledge_never_stacks(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama", per_head=10), self._user()))
        pid = pot["pot_id"]
        run(server.chip_in_gift_pot(pid, server.GiftChipIn(amount=10), self._user("u_r")))
        got = run(server.chip_in_gift_pot(pid, server.GiftChipIn(amount=15), self._user("u_r")))
        self.assertEqual(got["contributor_count"], 1)       # not two rows
        self.assertEqual(got["total_pledged"], 15)          # replaced, not added
        self.assertEqual(got["your_amount"], 15)

    def test_two_people_chipping_in_sum_toward_the_target(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(
            server.GiftPotIn(title="Ama", per_head=10, target_total=50), self._user()))
        pid = pot["pot_id"]
        run(server.chip_in_gift_pot(pid, server.GiftChipIn(amount=10), self._user("u_r")))
        got = run(server.chip_in_gift_pot(pid, server.GiftChipIn(amount=20), self._user("u_k")))
        self.assertEqual(got["contributor_count"], 2)
        self.assertEqual(got["total_pledged"], 30)

    def test_chipping_in_zero_withdraws_your_pledge(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama", per_head=10), self._user()))
        pid = pot["pot_id"]
        run(server.chip_in_gift_pot(pid, server.GiftChipIn(amount=10), self._user("u_r")))
        got = run(server.chip_in_gift_pot(pid, server.GiftChipIn(amount=0), self._user("u_r")))
        self.assertEqual(got["contributor_count"], 0)
        self.assertIsNone(got["your_amount"])

    # --- the surprise -----------------------------------------------------
    def test_a_pot_for_a_parent_is_hidden_from_that_parent(self):
        run(self._set_plan("executive"))
        # Roland opens a pot for Keigh's birthday.
        pot = run(server.create_gift_pot(
            server.GiftPotIn(title="Keigh", for_member_id="m_u_k", per_head=10), self._user("u_r")))
        # Keigh must not see it in her list...
        keigh_list = run(server.list_gift_pots(self._user("u_k")))
        self.assertEqual(keigh_list, [])
        # ...nor by direct fetch (404, not 403 — a 403 would reveal it exists).
        with self.assertRaises(server.HTTPException) as e:
            run(server.get_gift_pot(pot["pot_id"], self._user("u_k")))
        self.assertEqual(e.exception.status_code, 404)
        # Roland (and any non-celebrant) still sees it.
        self.assertEqual(len(run(server.list_gift_pots(self._user("u_r")))), 1)

    def test_a_child_birthday_pot_is_visible_to_both_parents(self):
        run(self._set_plan("executive"))
        run(server.create_gift_pot(
            server.GiftPotIn(title="Ama", for_member_id="m_ama", per_head=10), self._user("u_r")))
        self.assertEqual(len(run(server.list_gift_pots(self._user("u_r")))), 1)
        self.assertEqual(len(run(server.list_gift_pots(self._user("u_k")))), 1)

    # --- one pot per card -------------------------------------------------
    def test_one_pot_per_birthday_card(self):
        run(self._set_plan("executive"))
        run(self.db["cards"].insert_one({
            "card_id": "card_bday", "family_id": "fam1", "type": "BIRTHDAY",
            "title": "Ama's birthday", "status": "OPEN", "created_at": server.utcnow()}))
        p1 = run(server.create_gift_pot(server.GiftPotIn(card_id="card_bday"), self._user("u_r")))
        p2 = run(server.create_gift_pot(server.GiftPotIn(card_id="card_bday"), self._user("u_k")))
        self.assertEqual(p1["pot_id"], p2["pot_id"])        # same pot, not a rival
        self.assertEqual(p1["title"], "Ama's birthday")     # title taken from the card

    # --- isolation --------------------------------------------------------
    def test_another_family_cannot_read_or_chip_into_your_pot(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama"), self._user("u_r")))
        outsider = {"user_id": "u_x", "family_id": "fam2", "name": "Outsider"}
        with self.assertRaises(server.HTTPException) as e:
            run(server.get_gift_pot(pot["pot_id"], outsider))
        self.assertEqual(e.exception.status_code, 404)
        with self.assertRaises(server.HTTPException):
            run(server.chip_in_gift_pot(pot["pot_id"], server.GiftChipIn(amount=5), outsider))

    # --- close ------------------------------------------------------------
    def test_closing_is_idempotent(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama"), self._user()))
        pid = pot["pot_id"]
        self.assertEqual(run(server.close_gift_pot(pid, self._user()))["status"], "closed")
        self.assertEqual(run(server.close_gift_pot(pid, self._user()))["status"], "closed")
        # a closed pot refuses new pledges
        with self.assertRaises(server.HTTPException) as e:
            run(server.chip_in_gift_pot(pid, server.GiftChipIn(amount=5), self._user()))
        self.assertEqual(e.exception.status_code, 409)

    # --- account deletion cleans it up -----------------------------------
    def test_gift_pots_is_purged_on_account_deletion(self):
        self.assertIn("gift_pots", server._FAMILY_SCOPED_COLLECTIONS)


@unittest.skipUnless(HAVE, "backend deps not installed")
class YearlyRecurrence(unittest.TestCase):
    def test_a_birthday_advances_by_a_year(self):
        from datetime import datetime, timezone
        d = datetime(2026, 8, 26, 9, 0, tzinfo=timezone.utc)
        nxt = server.advance_due_date(d, "yearly")
        self.assertEqual((nxt.year, nxt.month, nxt.day), (2027, 8, 26))

    def test_feb_29_lands_on_feb_28_in_a_common_year(self):
        from datetime import datetime, timezone
        d = datetime(2028, 2, 29, 9, 0, tzinfo=timezone.utc)   # 2028 is a leap year
        nxt = server.advance_due_date(d, "yearly")
        self.assertEqual((nxt.year, nxt.month, nxt.day), (2029, 2, 28))


if __name__ == "__main__":
    unittest.main()
