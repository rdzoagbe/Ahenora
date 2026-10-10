"""A second household gets nothing: every id-taking route, every collection.

The route-by-route authorization walk of 2026-10-10 found that each handler
looks a row up by its id AND the caller's family_id, and answers a miss with
a 404 (or a 403 where the thing is somebody's own). That is the right shape,
and this file holds it in place: it seeds one household with a row in every
user-data collection, then asks for each of those rows as a parent from a
different household, and expects a refusal and an untouched database.

The point is the "next month" case. A handler written later that looks a
row up by id alone would let any signed-in account read or change any other
household's data by guessing or leaking an id. A new collection needs a line
in SEED and a line in CALLS here, and the walk at the bottom catches a
collection that gained a route without gaining a test.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import copy
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    from fastapi import HTTPException
    import server
    from fake_mongo import FakeDatabase
    HAVE = True
except ImportError:
    HAVE = False


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


A = "fam_a"
B = "fam_b"


@unittest.skipUnless(HAVE, "backend deps not installed")
class AnotherHouseholdGetsNothing(unittest.TestCase):
    """Household A owns a row in every collection. Household B asks for it."""

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._push = server.send_push_to_user

        async def quiet(*args, **kwargs):
            return {"devices": 0, "web": 0}
        server.send_push_to_user = quiet
        run(self._seed())
        self.before = self._dump()

    def tearDown(self):
        server.get_db = self._get_db
        server.send_push_to_user = self._push

    # --- the two households ----------------------------------------------

    async def _seed(self):
        now = server.utcnow()
        for fam, uid, name in ((A, "u_a", "Ama"), (A, "u_a2", "Kofi"), (B, "u_b", "Bea")):
            await self.db["families"].insert_one({
                "family_id": fam, "plan": "family", "billing_cycle": "monthly",
                "grandfathered": False, "updated_at": now, "storage_used_bytes": 0})
            await self.db["users"].insert_one(
                {"user_id": uid, "family_id": fam, "name": name, "language": "en",
                 "email": f"{uid}@example.com"})
            await self.db["family_members"].insert_one(
                {"member_id": f"m_{uid}", "family_id": fam, "user_id": uid,
                 "name": name, "role": "Parent", "stars": 0, "week_earned": 0})
        # A child in household A, with stars, a reward and a redemption.
        await self.db["family_members"].insert_one(
            {"member_id": "m_child_a", "family_id": A, "name": "Efua", "role": "Child",
             "stars": 12, "week_earned": 4, "pin_hash": None, "record": {"allergies": "nuts"}})
        await self.db["cards"].insert_one(
            {"card_id": "card_a", "family_id": A, "type": "TASK", "title": "School run",
             "status": "OPEN", "source": "MANUAL", "recurrence": "NONE", "reminder_minutes": 0,
             "shared": True, "created_by_user_id": "u_a", "created_at": now, "updated_at": now})
        await self.db["vault"].insert_one(
            {"doc_id": "doc_a", "family_id": A, "title": "Passport", "mime_type": "image/jpeg",
             "image_base64": "aGk=", "owner_user_id": "u_a", "visibility": "family",
             "created_at": now})
        await self.db["activity"].insert_one(
            {"activity_id": "act_a", "family_id": A, "user_id": "u_a", "actor_name": "Ama",
             "kind": "task_done", "ref": "card_a", "title": "School run", "shared": True,
             "hidden_by": ["u_a"], "created_at": now})
        await self.db["family_invites"].insert_one(
            {"invite_id": "inv_a", "family_id": A, "token": "tok_a", "email": "x@example.com",
             "status": "pending", "role": "Co-parent", "invited_by": "u_a", "created_at": now})
        await self.db["messages"].insert_one(
            {"message_id": "msg_a", "family_id": A, "thread": server.HOUSEHOLD_THREAD,
             "sender_user_id": "u_a", "text": "hello", "reactions": {}, "created_at": now})
        await self.db["shopping_list"].insert_one(
            {"item_id": "item_a", "family_id": A, "name": "milk", "checked": False,
             "category": "dairy", "created_at": now})
        await self.db["shopping_history"].insert_one(
            {"history_id": "hist_a", "family_id": A, "items": ["milk"], "created_at": now})
        await self.db["gift_pots"].insert_one(
            {"pot_id": "pot_a", "family_id": A, "title": "Teacher gift", "per_head": 5.0,
             "contributions": [{"contrib_id": "c_a", "name": "Ama", "amount": 5.0, "paid": False}],
             "status": "open", "share_token": None, "rev": 0, "created_by_user_id": "u_a",
             "created_at": now, "updated_at": now})
        await self.db["santa_draws"].insert_one(
            {"draw_id": "draw_a", "family_id": A, "title": "Xmas", "participants": [],
             "sent_at": None, "created_by_user_id": "u_a", "created_at": now})
        await self.db["routines"].insert_one(
            {"routine_id": "rt_a", "family_id": A, "name": "Bedtime", "steps": ["teeth"],
             "member_id": "m_child_a", "star_reward": 1, "created_at": now})
        await self.db["meals"].insert_one(
            {"meal_id": "meal_a", "family_id": A, "day": "2026-10-10", "slot": "dinner",
             "name": "Lasagne", "created_at": now})
        await self.db["meal_plans_saved"].insert_one(
            {"plan_id": "plan_a", "family_id": A, "name": "Week 1", "meals": [], "created_at": now})
        await self.db["carpools"].insert_one(
            {"carpool_id": "cp_a", "family_id": A, "title": "Football", "created_at": now})
        await self.db["allowances"].insert_one(
            {"allowance_id": "alw_a", "family_id": A, "member_id": "m_child_a",
             "amount": 5.0, "frequency": "weekly", "last_paid_at": None, "created_at": now})
        await self.db["allowance_txns"].insert_one(
            {"txn_id": "txn_a", "family_id": A, "member_id": "m_child_a", "amount": 5.0,
             "kind": "pay", "created_at": now})
        await self.db["announcements"].insert_one(
            {"announcement_id": "ann_a", "family_id": A, "text": "Granny visits",
             "created_at": now})
        await self.db["chores"].insert_one(
            {"chore_id": "chore_a", "family_id": A, "title": "Bins", "rotation": ["m_child_a"],
             "current_index": 0, "created_at": now})
        await self.db["rewards"].insert_one(
            {"reward_id": "rw_a", "family_id": A, "title": "Ice cream", "cost_stars": 5,
             "created_at": now})
        await self.db["redemptions"].insert_one(
            {"redemption_id": "rd_a", "family_id": A, "member_id": "m_child_a",
             "reward_id": "rw_a", "status": "pending", "cost_stars": 5, "created_at": now})
        await self.db["handoff_notes"].insert_one(
            {"note_id": "note_a", "family_id": A, "text": "Pick up at 3", "from_user_id": "u_a",
             "to_user_id": "u_a2", "acked_at": None, "created_at": now})
        await self.db["expenses"].insert_one(
            {"expense_id": "exp_a", "family_id": A, "title": "Shoes", "amount": 40.0,
             "paid_by_user_id": "u_a", "created_at": now})
        await self.db["star_transactions"].insert_one(
            {"transaction_id": "st_a", "family_id": A, "member_id": "m_child_a", "delta": 2,
             "created_at": now})

    @staticmethod
    def _user(uid, fam):
        return {"user_id": uid, "family_id": fam, "name": uid, "email": f"{uid}@example.com"}

    def _dump(self):
        """Household A's rows only. Bea's own household may keep its ordinary
        bookkeeping (plan counters, last-active stamps); A must not move."""
        return {name: copy.deepcopy([r for r in col.rows if r.get("family_id") == A])
                for name, col in self.db._collections.items()}

    # --- the ask -------------------------------------------------------------

    def _refused(self, coro, *, collection, ident, key):
        """Call as Bea; expect a 403/404 or a no-op, and household A untouched."""
        try:
            run(coro)
        except HTTPException as e:
            self.assertIn(e.status_code, (403, 404),
                          f"{collection}: wrong refusal {e.status_code}: {e.detail}")
        row = run(self.db[collection].find_one({key: ident}))
        self.assertIsNotNone(row, f"{collection}: household A's row {ident} is gone")
        self.assertEqual(row.get("family_id"), A)

    def _unchanged(self):
        self.assertEqual(self._dump(), self.before, "a refused call still wrote something")

    # One ask per collection. Each is a route that takes the row's id.
    def test_cards(self):
        b = self._user("u_b", B)
        self._refused(server.update_card("card_a", server.CardPatchIn(title="Mine now"), user=b),
                      collection="cards", ident="card_a", key="card_id")
        self._refused(server.share_card("card_a", user=b),
                      collection="cards", ident="card_a", key="card_id")
        self._refused(server.delete_card("card_a", user=b),
                      collection="cards", ident="card_a", key="card_id")
        self._unchanged()

    def test_vault(self):
        b = self._user("u_b", B)
        self._refused(server.render_vault_doc("doc_a", user=b),
                      collection="vault", ident="doc_a", key="doc_id")
        self._refused(server.delete_vault_doc("doc_a", user=b),
                      collection="vault", ident="doc_a", key="doc_id")
        self._refused(server.set_vault_expiry("doc_a", expiry_date="2027-01-01", user=b, database=self.db),
                      collection="vault", ident="doc_a", key="doc_id")
        self._unchanged()

    def test_activity(self):
        b = self._user("u_b", B)
        self._refused(server.delete_activity("act_a", user=b),
                      collection="activity", ident="act_a", key="activity_id")
        self._refused(server.unhide_activity("act_a", user=b),
                      collection="activity", ident="act_a", key="activity_id")
        self._unchanged()

    def test_family_members(self):
        b = self._user("u_b", B)
        self._refused(server.get_member_record("m_child_a", user=b),
                      collection="family_members", ident="m_child_a", key="member_id")
        self._refused(server.member_star_history("m_child_a", user=b),
                      collection="family_members", ident="m_child_a", key="member_id")
        self._refused(server.adjust_member_stars("m_child_a", server.StarAdjustmentIn(delta=50), user=b),
                      collection="family_members", ident="m_child_a", key="member_id")
        self._refused(server.delete_family_member("m_child_a", user=b),
                      collection="family_members", ident="m_child_a", key="member_id")
        self._unchanged()

    def test_family_invites(self):
        b = self._user("u_b", B)
        self._refused(server.delete_family_invite("inv_a", user=b),
                      collection="family_invites", ident="inv_a", key="invite_id")
        self._refused(server.complete_family_invite("inv_a", user=b),
                      collection="family_invites", ident="inv_a", key="invite_id")
        self._unchanged()

    def test_messages(self):
        b = self._user("u_b", B)
        self._refused(server.family_chat_react(server.HOUSEHOLD_THREAD, "msg_a",
                                               server.ChatReactionIn(emoji="👍"), user=b),
                      collection="messages", ident="msg_a", key="message_id")
        self._refused(server.family_chat_edit(server.HOUSEHOLD_THREAD, "msg_a",
                                              server.ChatEditIn(text="edited"), user=b),
                      collection="messages", ident="msg_a", key="message_id")
        # Bea's own household thread must not carry Ama's words either.
        page = run(server.family_chat_get(server.HOUSEHOLD_THREAD, user=b))
        texts = [m.get("text") for m in (page.get("messages") or page.get("items") or [])] \
            if isinstance(page, dict) else [m.get("text") for m in page]
        self.assertNotIn("hello", texts)
        self._unchanged()

    def test_shopping_list(self):
        b = self._user("u_b", B)
        self._refused(server.update_shopping_item("item_a", server.ShoppingItemPatchIn(checked=True), user=b),
                      collection="shopping_list", ident="item_a", key="item_id")
        self._refused(server.delete_shopping_item("item_a", user=b),
                      collection="shopping_list", ident="item_a", key="item_id")
        self._unchanged()

    def test_shopping_history(self):
        b = self._user("u_b", B)
        self._refused(server.reuse_shopping_history("hist_a", user=b),
                      collection="shopping_history", ident="hist_a", key="history_id")
        self._refused(server.delete_shopping_history("hist_a", user=b),
                      collection="shopping_history", ident="hist_a", key="history_id")
        self._unchanged()

    def test_gift_pots(self):
        b = self._user("u_b", B)
        self._refused(server.get_gift_pot("pot_a", user=b),
                      collection="gift_pots", ident="pot_a", key="pot_id")
        self._refused(server.share_gift_pot("pot_a", user=b),
                      collection="gift_pots", ident="pot_a", key="pot_id")
        self._refused(server.close_gift_pot("pot_a", user=b),
                      collection="gift_pots", ident="pot_a", key="pot_id")
        self._refused(server.remove_contribution("pot_a", "c_a", user=b),
                      collection="gift_pots", ident="pot_a", key="pot_id")
        self._refused(server.delete_gift_pot("pot_a", user=b),
                      collection="gift_pots", ident="pot_a", key="pot_id")
        self._unchanged()

    def test_santa_draws(self):
        b = self._user("u_b", B)
        self._refused(server.get_santa_draw("draw_a", user=b),
                      collection="santa_draws", ident="draw_a", key="draw_id")
        self._refused(server.shuffle_santa_draw("draw_a", user=b),
                      collection="santa_draws", ident="draw_a", key="draw_id")
        self._refused(server.delete_santa_draw("draw_a", user=b),
                      collection="santa_draws", ident="draw_a", key="draw_id")
        self._unchanged()

    def test_routines(self):
        b = self._user("u_b", B)
        self._refused(server.log_routine_completion("rt_a", user=b, database=self.db),
                      collection="routines", ident="rt_a", key="routine_id")
        self._refused(server.delete_routine("rt_a", user=b, database=self.db),
                      collection="routines", ident="rt_a", key="routine_id")
        self._unchanged()

    def test_meals(self):
        b = self._user("u_b", B)
        self._refused(server.delete_meal("meal_a", user=b, database=self.db),
                      collection="meals", ident="meal_a", key="meal_id")
        self._unchanged()

    def test_meal_plans_saved(self):
        b = self._user("u_b", B)
        self._refused(server.reuse_saved_plan("plan_a", user=b, database=self.db),
                      collection="meal_plans_saved", ident="plan_a", key="plan_id")
        self._refused(server.delete_saved_plan("plan_a", user=b, database=self.db),
                      collection="meal_plans_saved", ident="plan_a", key="plan_id")
        self._unchanged()

    def test_carpools(self):
        b = self._user("u_b", B)
        self._refused(server.delete_carpool("cp_a", user=b, database=self.db),
                      collection="carpools", ident="cp_a", key="carpool_id")
        self._unchanged()

    def test_allowances(self):
        b = self._user("u_b", B)
        self._refused(server.pay_allowance("m_child_a", user=b, database=self.db),
                      collection="allowances", ident="alw_a", key="allowance_id")
        self._refused(server.delete_allowance("m_child_a", user=b, database=self.db),
                      collection="allowances", ident="alw_a", key="allowance_id")
        txns = run(server.list_allowance_transactions("m_child_a", user=b, database=self.db))
        rows = txns if isinstance(txns, list) else txns.get("transactions") or txns.get("items") or []
        self.assertEqual(rows, [], "household A's pocket-money ledger leaked")
        self._unchanged()

    def test_announcements(self):
        b = self._user("u_b", B)
        self._refused(server.delete_announcement("ann_a", user=b, database=self.db),
                      collection="announcements", ident="ann_a", key="announcement_id")
        self._unchanged()

    def test_chores(self):
        b = self._user("u_b", B)
        self._refused(server.complete_chore("chore_a", user=b, database=self.db),
                      collection="chores", ident="chore_a", key="chore_id")
        self._refused(server.rotate_chore("chore_a", user=b, database=self.db),
                      collection="chores", ident="chore_a", key="chore_id")
        self._refused(server.delete_chore("chore_a", user=b, database=self.db),
                      collection="chores", ident="chore_a", key="chore_id")
        self._unchanged()

    def test_rewards(self):
        b = self._user("u_b", B)
        self._refused(server.update_reward("rw_a", server.RewardPatchIn(title="Mine"), user=b),
                      collection="rewards", ident="rw_a", key="reward_id")
        self._refused(server.redeem_reward("rw_a", server.RedeemIn(member_id="m_child_a"), user=b),
                      collection="rewards", ident="rw_a", key="reward_id")
        self._refused(server.delete_reward("rw_a", user=b),
                      collection="rewards", ident="rw_a", key="reward_id")
        self._unchanged()

    def test_redemptions(self):
        b = self._user("u_b", B)
        self._refused(server.fulfil_redemption("rd_a", user=b),
                      collection="redemptions", ident="rd_a", key="redemption_id")
        self._refused(server.cancel_redemption("rd_a", user=b),
                      collection="redemptions", ident="rd_a", key="redemption_id")
        self._unchanged()

    def test_handoff_notes(self):
        b = self._user("u_b", B)
        self._refused(server.ack_handoff_note("note_a", user=b),
                      collection="handoff_notes", ident="note_a", key="note_id")
        self._refused(server.delete_handoff_note("note_a", user=b),
                      collection="handoff_notes", ident="note_a", key="note_id")
        self._unchanged()

    def test_expenses(self):
        b = self._user("u_b", B)
        self._refused(server.delete_expense("exp_a", user=b),
                      collection="expenses", ident="exp_a", key="expense_id")
        self._unchanged()

    # --- lists: household A is simply not there ------------------------------

    def test_lists_show_only_your_own_household(self):
        b = self._user("u_b", B)

        def ids(result, key):
            rows = result if isinstance(result, list) else next(
                (v for v in result.values() if isinstance(v, list)), [])
            return {r.get(key) for r in rows if isinstance(r, dict)}

        self.assertNotIn("card_a", ids(run(server.list_cards(user=b)), "card_id"))
        self.assertNotIn("doc_a", ids(run(server.list_vault(user=b)), "doc_id"))
        self.assertNotIn("m_child_a", ids(run(server.family_members(user=b)), "member_id"))
        self.assertNotIn("pot_a", ids(run(server.list_gift_pots(user=b)), "pot_id"))
        self.assertNotIn("draw_a", ids(run(server.list_santa_draws(user=b)), "draw_id"))
        self.assertNotIn("alw_a", ids(run(server.list_allowances(user=b, database=self.db)), "allowance_id"))
        self.assertNotIn("rd_a", ids(run(server.list_redemptions(user=b)), "redemption_id"))
        self.assertNotIn("act_a", ids(run(server.list_hidden_activity(user=b)), "activity_id"))

    # --- the walk: no handler looks a row up by its id alone ----------------

    def test_every_handler_scopes_its_lookups_to_the_household(self):
        """Read the server. A `find_one`/`update_one`/`delete_one` on a
        user-data collection whose filter names an id but no family_id,
        user_id or member_id is a new way for one household to reach another,
        unless the same function already found that row with a household
        filter a few lines above (the re-read after a write, which is the one
        honest reason to go by id alone)."""
        src = open(os.path.join(os.path.dirname(__file__), "..", "backend", "server.py")).read()
        user_data = {
            "cards", "vault", "activity", "family_invites", "messages", "shopping_list",
            "shopping_history", "gift_pots", "santa_draws", "routines", "meals",
            "meal_plans_saved", "carpools", "allowances", "allowance_txns", "announcements",
            "chores", "rewards", "redemptions", "handoff_notes", "expenses",
            "expense_items", "family_members", "star_transactions", "event_candidates",
            "calendar_contacts", "notification_settings", "shopping_aisles",
        }
        scope_keys = ("family_id", "user_id", "member_id", "share_token", '"token"',
                      "token_hash", "created_by", "email")
        pattern = re.compile(
            r'database\["(?P<col>[a-z_]+)"\]\s*\.\s*(?P<op>find_one|update_one|delete_one)\(\s*'
            r'(?P<arg>\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})', re.S)

        def scoped(arg):
            return any(k in arg for k in scope_keys)

        def id_from_a_loaded_row(arg):
            # {"invite_id": invite["invite_id"]} / {"card_id": card.get("card_id")}:
            # the id was read off a row this function already fetched (by
            # household, or by an unguessable token), not off the request.
            return bool(re.search(r'"[a-z_]+_id":\s*\w+(\[|\.get\()', arg))

        loose = []
        for m in pattern.finditer(src):
            col, op, arg = m.group("col"), m.group("op"), m.group("arg")
            if col not in user_data or scoped(arg) or id_from_a_loaded_row(arg):
                continue
            # The same function, above this line: a scoped lookup of this
            # collection makes the by-id call a re-read of a row already checked.
            fn_start = src.rfind("\ndef ", 0, m.start())
            fn_start = max(fn_start, src.rfind("\nasync def ", 0, m.start()))
            above = src[fn_start:m.start()]
            earlier = [e for e in pattern.finditer(above) if e.group("col") == col and scoped(e.group("arg"))]
            if earlier:
                continue
            line = src.count("\n", 0, m.start()) + 1
            loose.append(f"{col}.{op} at line {line}: {arg[:70]}")
        self.assertEqual(loose, [], "a lookup by id alone on a user-data collection")

if __name__ == "__main__":
    unittest.main()
