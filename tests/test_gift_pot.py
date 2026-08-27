"""The Gift Pot — pool for a birthday. A Family feature; reminders stay free.

Covers the money-adjacent and privacy-sensitive paths: the Family gate, one
pledge per person (chipping in again updates, never stacks), the surprise being
hidden from the person it's for, cross-family isolation, and account-deletion
cleanup. All run under fake_mongo, so filters that Mongo operators can't be
trusted for in the test double are done in Python in the endpoints.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import json
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

    # --- editing the pot --------------------------------------------------
    def test_editing_updates_only_the_sent_fields(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(
            server.GiftPotIn(title="Ama", per_head=10, target_total=50, note="a bike"), self._user()))
        pid = pot["pot_id"]
        # Change only the per-head; title/target/note must survive untouched.
        got = run(server.edit_gift_pot(pid, server.GiftPotEditIn(per_head=15), self._user()))
        self.assertEqual(got["per_head"], 15)
        self.assertEqual(got["title"], "Ama")
        self.assertEqual(got["target_total"], 50)
        self.assertEqual(got["note"], "a bike")

    def test_editing_can_change_title_target_and_note(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama", per_head=10), self._user()))
        got = run(server.edit_gift_pot(
            pot["pot_id"],
            server.GiftPotEditIn(title="Ama's big day", target_total=80, note="ideas welcome"),
            self._user()))
        self.assertEqual(got["title"], "Ama's big day")
        self.assertEqual(got["target_total"], 80)
        self.assertEqual(got["note"], "ideas welcome")

    def test_editing_can_clear_the_target(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(
            server.GiftPotIn(title="Ama", per_head=10, target_total=50), self._user()))
        got = run(server.edit_gift_pot(
            pot["pot_id"], server.GiftPotEditIn(clear_target=True), self._user()))
        self.assertIsNone(got["target_total"])

    def test_editing_never_touches_pledges(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama", per_head=10), self._user()))
        pid = pot["pot_id"]
        run(server.chip_in_gift_pot(pid, server.GiftChipIn(amount=12), self._user("u_r")))
        got = run(server.edit_gift_pot(pid, server.GiftPotEditIn(per_head=20), self._user()))
        self.assertEqual(got["total_pledged"], 12)
        self.assertEqual(got["contributor_count"], 1)

    def test_editing_is_refused_on_the_free_plan(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama"), self._user()))
        run(self._set_plan("village"))
        with self.assertRaises(server.HTTPException) as e:
            run(server.edit_gift_pot(pot["pot_id"], server.GiftPotEditIn(title="x"), self._user()))
        self.assertEqual(e.exception.status_code, 402)

    def test_a_celebrant_cannot_edit_their_own_surprise(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(
            server.GiftPotIn(title="Keigh", for_member_id="m_u_k", per_head=10), self._user("u_r")))
        with self.assertRaises(server.HTTPException) as e:
            run(server.edit_gift_pot(pot["pot_id"], server.GiftPotEditIn(title="x"), self._user("u_k")))
        self.assertEqual(e.exception.status_code, 404)

    def test_another_family_cannot_edit_your_pot(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama"), self._user("u_r")))
        outsider = {"user_id": "u_x", "family_id": "fam2", "name": "Outsider"}
        # Blocked either way — the plan gate fires first for a family with no
        # subscription, and _load_own_pot would 404 even if it didn't.
        with self.assertRaises(server.HTTPException) as e:
            run(server.edit_gift_pot(pot["pot_id"], server.GiftPotEditIn(title="x"), outsider))
        self.assertIn(e.exception.status_code, (402, 404))

    # --- feed notifications ----------------------------------------------
    def test_a_first_pledge_logs_a_feed_line(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama", per_head=10), self._user()))
        run(server.chip_in_gift_pot(pot["pot_id"], server.GiftChipIn(amount=15), self._user("u_r")))
        act = run(self.db["activity"].find_one({"kind": "pot_pledge"}, {"_id": 0}))
        self.assertIsNotNone(act)
        self.assertEqual(act["actor_name"], "Roland")
        self.assertEqual(act["amount"], 15)
        self.assertEqual(act["hidden_by"], [])          # not a surprise → visible to all

    def test_updating_a_pledge_does_not_re_announce(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama", per_head=10), self._user()))
        pid = pot["pot_id"]
        run(server.chip_in_gift_pot(pid, server.GiftChipIn(amount=10), self._user("u_r")))
        run(server.chip_in_gift_pot(pid, server.GiftChipIn(amount=20), self._user("u_r")))
        n = 0
        async def count():
            nonlocal n
            async for _ in self.db["activity"].find({"kind": "pot_pledge"}, {"_id": 0}):
                n += 1
        run(count())
        self.assertEqual(n, 1)                          # one line, not two

    def test_a_surprise_pledge_is_hidden_from_the_celebrant(self):
        run(self._set_plan("executive"))
        # Roland opens a pot for Keigh; Roland pledges.
        pot = run(server.create_gift_pot(
            server.GiftPotIn(title="Keigh", for_member_id="m_u_k", per_head=10), self._user("u_r")))
        run(server.chip_in_gift_pot(pot["pot_id"], server.GiftChipIn(amount=15), self._user("u_r")))
        act = run(self.db["activity"].find_one({"kind": "pot_pledge"}, {"_id": 0}))
        self.assertIn("u_k", act["hidden_by"])          # the celebrant never sees it

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

    # --- the surprise, resolved from the CARD (the real client path) ------
    def test_a_pot_created_from_a_card_naming_a_parent_hides_from_that_parent(self):
        # This is the path the app actually uses: the client sends only card_id
        # (never for_member_id), so the celebrant must be resolved server-side
        # from the birthday card's title. Keigh's birthday → hidden from Keigh.
        run(self._set_plan("executive"))
        run(self.db["cards"].insert_one({
            "card_id": "card_keigh", "family_id": "fam1", "type": "BIRTHDAY",
            "title": "Keigh's birthday 🎂", "status": "OPEN", "created_at": server.utcnow()}))
        run(server.create_gift_pot(server.GiftPotIn(card_id="card_keigh"), self._user("u_r")))
        self.assertEqual(run(server.list_gift_pots(self._user("u_k"))), [])   # celebrant blind
        self.assertEqual(len(run(server.list_gift_pots(self._user("u_r")))), 1)  # giver sees it

    def test_a_child_birthday_card_pot_is_visible_to_both_parents(self):
        run(self._set_plan("executive"))
        run(self.db["cards"].insert_one({
            "card_id": "card_ama", "family_id": "fam1", "type": "BIRTHDAY",
            "title": "Ama's birthday", "status": "OPEN", "created_at": server.utcnow()}))
        run(server.create_gift_pot(server.GiftPotIn(card_id="card_ama"), self._user("u_r")))
        self.assertEqual(len(run(server.list_gift_pots(self._user("u_r")))), 1)
        self.assertEqual(len(run(server.list_gift_pots(self._user("u_k")))), 1)

    def test_the_dedup_path_also_hides_from_the_celebrant(self):
        # A second create for the same card returns the existing pot — but must
        # 404 for the celebrant, not hand them their own surprise.
        run(self._set_plan("executive"))
        run(self.db["cards"].insert_one({
            "card_id": "card_keigh2", "family_id": "fam1", "type": "BIRTHDAY",
            "title": "Keigh's birthday", "status": "OPEN", "created_at": server.utcnow()}))
        run(server.create_gift_pot(server.GiftPotIn(card_id="card_keigh2"), self._user("u_r")))
        with self.assertRaises(server.HTTPException) as e:
            run(server.create_gift_pot(server.GiftPotIn(card_id="card_keigh2"), self._user("u_k")))
        self.assertEqual(e.exception.status_code, 404)

    # --- the delete gate --------------------------------------------------
    def test_deleting_a_pot_is_refused_on_the_free_plan(self):
        run(self._set_plan("executive"))
        pot = run(server.create_gift_pot(server.GiftPotIn(title="Ama"), self._user()))
        run(self._set_plan("village"))     # family lapsed to free
        with self.assertRaises(server.HTTPException) as e:
            run(server.delete_gift_pot(pot["pot_id"], self._user()))
        self.assertEqual(e.exception.status_code, 402)

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


@unittest.skipUnless(HAVE, "backend deps not installed")
class GiftPotSharing(unittest.TestCase):
    """Phase B — the outer circle: a share link that lets extended family and
    friends (no household account) contribute to ONE pot and see nothing else.
    These are the security-critical tests: the public view is an allow-list, so
    prove it leaks nothing about the household, and that the token scopes access
    to exactly one pot."""

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._had_rc = os.environ.get("RC_WEBHOOK_SECRET")
        os.environ["RC_WEBHOOK_SECRET"] = "gift-pot-test"
        run(self._seed())

    def tearDown(self):
        server.get_db = self._get_db
        if self._had_rc is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._had_rc

    async def _seed(self):
        await self.db["families"].insert_one({
            "family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
            "grandfathered": False, "updated_at": server.utcnow()})
        await self.db["users"].insert_one(
            {"user_id": "u_r", "family_id": "fam1", "name": "Roland Mensah"})
        await self.db["family_members"].insert_one(
            {"member_id": "m_r", "family_id": "fam1", "user_id": "u_r",
             "name": "Roland Mensah", "role": "Parent"})

    def _org(self):
        return {"user_id": "u_r", "family_id": "fam1", "name": "Roland Mensah"}

    def _make_shared_pot(self):
        pot = run(server.create_gift_pot(
            server.GiftPotIn(title="Ama", per_head=10, target_total=50,
                             note="Let's get her the scooter"), self._org()))
        shared = run(server.share_gift_pot(pot["pot_id"], self._org()))
        return shared

    # --- sharing lifecycle ------------------------------------------------
    def test_share_mints_a_token_and_is_stable(self):
        pot = self._make_shared_pot()
        self.assertTrue(pot["share_token"])
        self.assertTrue(pot["shared"])
        again = run(server.share_gift_pot(pot["pot_id"], self._org()))
        self.assertEqual(again["share_token"], pot["share_token"])   # reused, not rotated

    def test_unshare_kills_the_public_link(self):
        pot = self._make_shared_pot()
        token = pot["share_token"]
        self.assertTrue(run(server.view_shared_pot(token)))          # works while shared
        run(server.unshare_gift_pot(pot["pot_id"], self._org()))
        with self.assertRaises(server.HTTPException) as e:
            run(server.view_shared_pot(token))
        self.assertEqual(e.exception.status_code, 404)

    # --- the public view leaks NOTHING about the household ---------------
    def test_public_view_is_a_minimal_allowlist(self):
        pot = self._make_shared_pot()
        # an outsider joins with an amount
        run(server.join_shared_pot(pot["share_token"],
            server.PotJoinIn(name="Auntie Efua", amount=25, method="transfer")))
        view = run(server.view_shared_pot(pot["share_token"]))
        allowed = {"title", "occasion", "per_head", "target_total", "total_pledged",
                   "contributor_count", "status", "note", "organiser_name", "contributors"}
        self.assertEqual(set(view.keys()), allowed)     # exactly these, nothing more
        # none of the household internals ever appear
        blob = json.dumps(view)
        for leak in ("fam1", "u_r", "m_r", "family_id", "card_id", "for_member_id",
                     "pot_id", "share_token", "user_id"):
            self.assertNotIn(leak, blob, f"public view leaked {leak}")
        # first names only — no surname
        self.assertEqual(view["organiser_name"], "Roland")
        # who's in is shown, but NOT how much each gave
        self.assertEqual(view["contributors"], [{"name": "Auntie", "paid": False}])
        self.assertEqual(view["total_pledged"], 25)     # the total is fine to show

    def test_a_token_unlocks_only_its_own_pot(self):
        p1 = self._make_shared_pot()
        p2 = run(server.create_gift_pot(server.GiftPotIn(title="Kofi", per_head=5), self._org()))
        p2 = run(server.share_gift_pot(p2["pot_id"], self._org()))
        self.assertEqual(run(server.view_shared_pot(p1["share_token"]))["title"], "Ama")
        self.assertEqual(run(server.view_shared_pot(p2["share_token"]))["title"], "Kofi")

    def test_an_empty_or_unknown_token_never_leaks_an_unshared_pot(self):
        run(server.create_gift_pot(server.GiftPotIn(title="Unshared"), self._org()))
        for bad in ("", "   ", "nope-not-a-token"):
            with self.assertRaises(server.HTTPException) as e:
                run(server.view_shared_pot(bad))
            self.assertEqual(e.exception.status_code, 404)

    # --- external contribution --------------------------------------------
    def test_an_outsider_can_join_with_just_a_name(self):
        pot = self._make_shared_pot()
        run(server.join_shared_pot(pot["share_token"],
            server.PotJoinIn(name="Cousin Yaw", amount=15, method="cash")))
        # organiser sees the full row, with source 'link' and no user_id
        org = run(server.get_gift_pot(pot["pot_id"], self._org()))
        link_rows = [c for c in org["contributions"] if c["source"] == "link"]
        self.assertEqual(len(link_rows), 1)
        self.assertEqual(link_rows[0]["name"], "Cousin Yaw")
        self.assertEqual(link_rows[0]["amount"], 15)
        self.assertEqual(link_rows[0]["method"], "cash")
        self.assertIsNone(link_rows[0]["user_id"])
        self.assertFalse(link_rows[0]["paid"])

    def test_joining_is_ungated_works_regardless_of_plan(self):
        # Even if the household were free, an already-shared pot must accept
        # outsiders — the outsider has no plan; the gate was on the organiser.
        pot = self._make_shared_pot()
        run(self.db["families"].update_one({"family_id": "fam1"}, {"$set": {"plan": "village"}}))
        self.assertTrue(run(server.join_shared_pot(pot["share_token"],
            server.PotJoinIn(name="Neighbour", amount=10))))

    def test_a_closed_pot_refuses_new_outsiders(self):
        pot = self._make_shared_pot()
        run(server.close_gift_pot(pot["pot_id"], self._org()))
        with self.assertRaises(server.HTTPException) as e:
            run(server.join_shared_pot(pot["share_token"], server.PotJoinIn(name="Late", amount=5)))
        self.assertEqual(e.exception.status_code, 409)

    # --- the organiser runs the money side --------------------------------
    def test_organiser_marks_a_pledge_paid_and_the_public_view_reflects_it(self):
        pot = self._make_shared_pot()
        run(server.join_shared_pot(pot["share_token"],
            server.PotJoinIn(name="Auntie Efua", amount=25)))
        org = run(server.get_gift_pot(pot["pot_id"], self._org()))
        cid = org["contributions"][0]["contrib_id"]
        run(server.set_contribution_paid(pot["pot_id"], cid, server.GiftPaidIn(paid=True), self._org()))
        org = run(server.get_gift_pot(pot["pot_id"], self._org()))
        self.assertTrue(org["contributions"][0]["paid"])
        self.assertEqual(org["paid_total"], 25)
        # the public view shows 'in & paid' but still no amount
        view = run(server.view_shared_pot(pot["share_token"]))
        self.assertEqual(view["contributors"][0], {"name": "Auntie", "paid": True})

    def test_organiser_can_remove_a_bogus_pledge(self):
        pot = self._make_shared_pot()
        run(server.join_shared_pot(pot["share_token"], server.PotJoinIn(name="Spam", amount=999)))
        org = run(server.get_gift_pot(pot["pot_id"], self._org()))
        cid = org["contributions"][0]["contrib_id"]
        run(server.remove_contribution(pot["pot_id"], cid, self._org()))
        self.assertEqual(run(server.get_gift_pot(pot["pot_id"], self._org()))["contributor_count"], 0)

    def test_outsider_cannot_reach_household_endpoints(self):
        # There is simply no unauthenticated path to get_gift_pot / list — they
        # require a member. This documents that the ONLY public surface is the
        # token view/join.
        pot = self._make_shared_pot()
        with self.assertRaises(Exception):
            run(server.get_gift_pot(pot["pot_id"], {"user_id": "x", "family_id": "other"}))
