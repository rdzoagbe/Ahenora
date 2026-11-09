"""Whose turn? — a fair rotation between siblings.

"It's MY turn for the front seat!" "You went last time!" The app remembers, so
the parent does not have to referee. Front seat, choosing the film, choosing
Friday's dinner: each rotation is a list of people in order, whose turn it is
now, and the last few turns taken, which is the proof a child asks for.

What must hold, because the whole point is that it is FAIR:
  * a turn never skips anybody: two taps on "done" (a double tap, or two
    parents at once) move it ONE place, never two;
  * a rotation can only hold people from this household, each once, at least two;
  * removing a child from the family hands their turn on, and never leaves a
    rotation pointing at someone who is gone;
  * another household can read and touch nothing;
  * a helper (grandparent, nanny) can say "done" but cannot change the rules.

Run with:  python3 -m pytest -q tests/test_whose_turn.py
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
    from fastapi import HTTPException
    from pydantic import ValidationError
    from fake_mongo import FakeDatabase

PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
NANNY = {"user_id": "u_n", "family_id": "fam1", "name": "Esi", "email": "e@x.com", "is_helper": True}
OUTSIDER = {"user_id": "u_o", "family_id": "fam2", "name": "Stranger", "email": "s@x.com"}


def run(coro):
    return asyncio.run(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhoseTurn(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        for u in (PARENT, NANNY, OUTSIDER):
            run(self.db["users"].insert_one({**u, "language": "en"}))
        for mid, name, fam in (("m_ama", "Ama", "fam1"), ("m_leo", "Leo", "fam1"),
                               ("m_kofi", "Kofi", "fam1"), ("m_far", "Elsewhere", "fam2")):
            run(self.db["family_members"].insert_one({
                "member_id": mid, "family_id": fam, "name": name, "role": "child", "stars": 0}))

    def tearDown(self):
        server.get_db = self._get_db

    def create(self, members=("m_ama", "m_leo", "m_kofi"), name="Front seat", who=PARENT):
        return run(server.create_turn(server.TurnIn(name=name, member_ids=list(members)),
                                      user=dict(who), database=self.db))

    def done(self, turn_id, from_member, who=PARENT):
        return run(server.next_turn(turn_id, server.TurnNextIn(from_member_id=from_member),
                                    user=dict(who), database=self.db))

    def listed(self, who=PARENT):
        return run(server.list_turns(user=dict(who), database=self.db))

    # --- the rotation itself ------------------------------------------------
    def test_it_starts_with_the_first_person_and_says_who_is_next(self):
        t = self.create()
        self.assertEqual(t["current_member_id"], "m_ama")
        self.assertEqual(t["next_member_id"], "m_leo")
        self.assertEqual(t["name"], "Front seat")

    def test_done_passes_it_on_in_order_and_wraps_round(self):
        t = self.create()
        t = self.done(t["turn_id"], "m_ama")
        self.assertEqual(t["current_member_id"], "m_leo")
        t = self.done(t["turn_id"], "m_leo")
        t = self.done(t["turn_id"], "m_kofi")
        self.assertEqual(t["current_member_id"], "m_ama", "after the last, back to the first")

    def test_the_last_turns_are_remembered_newest_first(self):
        t = self.create()
        self.done(t["turn_id"], "m_ama")
        t = self.done(t["turn_id"], "m_leo")
        self.assertEqual([h["member_id"] for h in t["history"]], ["m_leo", "m_ama"])
        self.assertEqual(t["history"][0]["by"], "Roland")
        self.assertTrue(t["history"][0]["at"])

    def test_history_is_kept_short(self):
        t = self.create(members=("m_ama", "m_leo"))
        who = "m_ama"
        for _ in range(server.TURN_HISTORY_KEPT + 5):
            t = self.done(t["turn_id"], who)
            who = t["current_member_id"]
        self.assertEqual(len(t["history"]), server.TURN_HISTORY_KEPT)

    # --- fairness: never skips anyone ---------------------------------------
    def test_a_second_tap_on_the_same_turn_does_not_skip_anyone(self):
        t = self.create()
        self.done(t["turn_id"], "m_ama")
        with self.assertRaises(HTTPException) as ctx:
            self.done(t["turn_id"], "m_ama")   # the double tap / the other parent
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(self.listed()[0]["current_member_id"], "m_leo", "Leo keeps his turn")

    def test_two_parents_racing_move_it_once(self):
        t = self.create()
        async def both():
            return await asyncio.gather(
                server.next_turn(t["turn_id"], server.TurnNextIn(from_member_id="m_ama"),
                                 user=dict(PARENT), database=self.db),
                server.next_turn(t["turn_id"], server.TurnNextIn(from_member_id="m_ama"),
                                 user=dict(PARENT), database=self.db),
                return_exceptions=True)
        results = run(both())
        self.assertEqual(sum(1 for r in results if isinstance(r, HTTPException)), 1)
        self.assertEqual(self.listed()[0]["current_member_id"], "m_leo")
        self.assertEqual(len(self.listed()[0]["history"]), 1)

    # --- who can be in it ---------------------------------------------------
    def test_a_rotation_needs_two_people(self):
        with self.assertRaises(ValidationError):
            server.TurnIn(name="Solo", member_ids=["m_ama"])

    def test_nobody_twice(self):
        with self.assertRaises(HTTPException) as ctx:
            self.create(members=("m_ama", "m_leo", "m_ama"))
        self.assertEqual(ctx.exception.status_code, 400)

    def test_nobody_from_another_family(self):
        with self.assertRaises(HTTPException) as ctx:
            self.create(members=("m_ama", "m_far"))
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(self.listed(), [])

    def test_a_name_is_required_and_kept_short(self):
        with self.assertRaises(ValidationError):
            server.TurnIn(name="", member_ids=["m_ama", "m_leo"])
        with self.assertRaises(ValidationError):
            server.TurnIn(name="x" * (server.TURN_NAME_MAX + 1), member_ids=["m_ama", "m_leo"])
        with self.assertRaises(HTTPException):
            self.create(name="   ")

    # --- putting it right by hand ------------------------------------------
    def test_a_parent_can_set_whose_turn_it_is(self):
        t = self.create()
        t = run(server.update_turn(t["turn_id"], server.TurnPatchIn(current_member_id="m_kofi"),
                                   user=dict(PARENT), database=self.db))
        self.assertEqual(t["current_member_id"], "m_kofi")
        self.assertEqual(t["next_member_id"], "m_ama")

    def test_setting_the_turn_to_someone_outside_the_rotation_is_refused(self):
        t = self.create(members=("m_ama", "m_leo"))
        with self.assertRaises(HTTPException):
            run(server.update_turn(t["turn_id"], server.TurnPatchIn(current_member_id="m_kofi"),
                                   user=dict(PARENT), database=self.db))

    def test_taking_the_current_person_out_hands_the_turn_on(self):
        t = self.create()
        t = run(server.update_turn(t["turn_id"], server.TurnPatchIn(member_ids=["m_leo", "m_kofi"]),
                                   user=dict(PARENT), database=self.db))
        self.assertEqual(t["current_member_id"], "m_leo")

    def test_renaming_keeps_whose_turn_it_is(self):
        t = self.create()
        t = self.done(t["turn_id"], "m_ama")
        t = run(server.update_turn(t["turn_id"], server.TurnPatchIn(name="Choose the film"),
                                   user=dict(PARENT), database=self.db))
        self.assertEqual((t["name"], t["current_member_id"]), ("Choose the film", "m_leo"))

    # --- removing a child from the family -----------------------------------
    def test_removing_the_child_whose_turn_it_was_passes_it_on(self):
        t = self.create()
        self.done(t["turn_id"], "m_ama")          # Leo's turn now
        run(server.delete_family_member("m_leo", user=dict(PARENT)))
        after = self.listed()[0]
        self.assertEqual(after["member_ids"], ["m_ama", "m_kofi"])
        self.assertEqual(after["current_member_id"], "m_kofi", "the one after Leo")

    def test_a_rotation_left_with_one_person_goes(self):
        t = self.create(members=("m_ama", "m_leo"))
        run(server.delete_family_member("m_leo", user=dict(PARENT)))
        self.assertEqual(self.listed(), [])
        self.assertIsNone(run(self.db["turns"].find_one({"turn_id": t["turn_id"]})))

    # --- races with an edit (review of 2026-11-09) ---------------------------
    def test_a_rename_saved_after_a_done_does_not_undo_the_turn(self):
        t = self.create()
        self.done(t["turn_id"], "m_ama")            # someone else: Leo's turn now
        # The sheet was opened while it was Ama's turn, and is now saved with
        # only a new name: nothing about whose turn it is goes with it.
        t2 = run(server.update_turn(t["turn_id"], server.TurnPatchIn(name="Car front seat"),
                                    user=dict(PARENT), database=self.db))
        self.assertEqual(t2["current_member_id"], "m_leo")

    def test_setting_the_turn_from_a_stale_sheet_is_refused(self):
        t = self.create()
        self.done(t["turn_id"], "m_ama")            # Leo's turn now
        with self.assertRaises(HTTPException) as ctx:
            run(server.update_turn(t["turn_id"], server.TurnPatchIn(
                current_member_id="m_kofi", seen_current_member_id="m_ama"),
                user=dict(PARENT), database=self.db))
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(self.listed()[0]["current_member_id"], "m_leo")
        # Seen right, it goes through.
        t3 = run(server.update_turn(t["turn_id"], server.TurnPatchIn(
            current_member_id="m_kofi", seen_current_member_id="m_leo"),
            user=dict(PARENT), database=self.db))
        self.assertEqual(t3["current_member_id"], "m_kofi")

    def test_a_done_read_before_an_edit_of_the_rotation_does_not_land(self):
        t = self.create()
        stale = run(self.db["turns"].find_one({"turn_id": t["turn_id"]}))
        # A parent takes Leo out of the rotation...
        run(server.update_turn(t["turn_id"], server.TurnPatchIn(member_ids=["m_ama", "m_kofi"]),
                               user=dict(PARENT), database=self.db))
        # ...while a "done" that read the rotation before that edit lands.
        result = run(self.db["turns"].update_one(
            {"turn_id": t["turn_id"], "family_id": "fam1",
             "current_member_id": stale["current_member_id"], "updated_at": stale["updated_at"]},
            {"$set": {"current_member_id": "m_leo"}}))
        self.assertEqual(result.matched_count, 0, "the version moved, so the stale write matches nothing")
        self.assertEqual(self.listed()[0]["current_member_id"], "m_ama")
        src = open(server.__file__, encoding="utf-8").read()
        self.assertIn('"current_member_id": turn.get("current_member_id"), "updated_at": turn.get("updated_at")}', src)

    # --- every way a member leaves ------------------------------------------
    def test_a_teen_joining_takes_their_child_profiles_place(self):
        t = self.create(members=("m_ama", "m_leo"))
        self.done(t["turn_id"], "m_ama")             # Leo's turn
        teen = {"user_id": "u_leo", "family_id": "fam1", "name": "Leo", "email": "leo@x.com"}
        run(self.db["users"].insert_one(dict(teen)))
        member = run(server.add_user_to_family_if_needed(self.db, dict(teen), "fam1", role="teen"))
        after = self.listed()[0]
        self.assertEqual(after["member_ids"], ["m_ama", member["member_id"]])
        self.assertEqual(after["current_member_id"], member["member_id"], "still Leo's turn")
        self.assertEqual(after["history"][0]["member_id"], "m_ama")

    def test_removal_drops_their_past_turns_too(self):
        t = self.create()
        self.done(t["turn_id"], "m_ama")
        self.done(t["turn_id"], "m_leo")
        run(server._turns_without_member(self.db, "fam1", "m_leo"))
        after = self.listed()[0]
        self.assertEqual([h["member_id"] for h in after["history"]], ["m_ama"])
        self.assertEqual(after["current_member_id"], "m_kofi")

    def test_every_path_that_removes_a_member_tidies_the_rotations(self):
        """A rotation still holding someone who left passes the turn to nobody.
        Any function that deletes a family_members row must tidy rotations, or
        purge the whole household, or be one of the named exceptions."""
        import ast
        src = open(server.__file__, encoding="utf-8").read()
        tree = ast.parse(src)
        exceptions = {
            # Test accounts of the production smoke run, never in a rotation.
            "smoke_cleanup",
        }
        offenders = []
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            body = ast.get_source_segment(src, fn) or ""
            if 'family_members"].delete_' not in body:
                continue
            if fn.name in exceptions or "_turns_without_member" in body or fn.name == "_purge_family":
                continue
            offenders.append(fn.name)
        self.assertEqual(offenders, [], "these remove a member without tidying rotations")

    # --- who may do what ----------------------------------------------------
    def test_another_household_sees_and_touches_nothing(self):
        t = self.create()
        self.assertEqual(self.listed(OUTSIDER), [])
        for call in (
            lambda: self.done(t["turn_id"], "m_ama", who=OUTSIDER),
            lambda: run(server.update_turn(t["turn_id"], server.TurnPatchIn(name="Mine"),
                                           user=dict(OUTSIDER), database=self.db)),
            lambda: run(server.delete_turn(t["turn_id"], user=dict(OUTSIDER), database=self.db)),
        ):
            with self.assertRaises(HTTPException) as ctx:
                call()
            self.assertEqual(ctx.exception.status_code, 404)
        self.assertEqual(self.listed()[0]["current_member_id"], "m_ama")

    def test_a_helper_can_say_done_but_not_change_the_rules(self):
        t = self.create()
        self.assertEqual(self.done(t["turn_id"], "m_ama", who=NANNY)["current_member_id"], "m_leo")
        # The rules are a parent's: the routes that change them sit behind
        # require_full_member, which refuses a helper.
        with self.assertRaises(HTTPException) as ctx:
            run(server.require_full_member(dict(NANNY)))
        self.assertEqual(ctx.exception.status_code, 403)
        import inspect
        for fn in (server.create_turn, server.update_turn, server.delete_turn):
            dep = inspect.signature(fn).parameters["user"].default.dependency
            self.assertIs(dep, server.require_full_member, fn.__name__)
        for fn in (server.list_turns, server.next_turn):
            dep = inspect.signature(fn).parameters["user"].default.dependency
            self.assertIs(dep, server.require_user, fn.__name__)

    # --- the household's data, everywhere it must be ------------------------
    def test_turns_go_with_the_household_and_come_with_its_export(self):
        self.assertIn("turns", server._FAMILY_SCOPED_COLLECTIONS)
        self.assertIn("turns", server.INDEXES)
        src = open(server.__file__, encoding="utf-8").read()
        self.assertIn('"turns": await household_rows("turns", public_turn)', src)

    def test_a_family_has_a_bounded_number_of_rotations(self):
        for i in range(server.TURNS_PER_FAMILY_MAX):
            self.create(name=f"Rotation {i}")
        with self.assertRaises(HTTPException) as ctx:
            self.create(name="One too many")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(len(self.listed()), server.TURNS_PER_FAMILY_MAX, "every one stored is listed")

    def test_deleting_removes_it(self):
        t = self.create()
        run(server.delete_turn(t["turn_id"], user=dict(PARENT), database=self.db))
        self.assertEqual(self.listed(), [])
        with self.assertRaises(HTTPException):
            run(server.delete_turn(t["turn_id"], user=dict(PARENT), database=self.db))


if __name__ == "__main__":
    unittest.main()
