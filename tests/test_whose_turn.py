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

    def test_deleting_removes_it(self):
        t = self.create()
        run(server.delete_turn(t["turn_id"], user=dict(PARENT), database=self.db))
        self.assertEqual(self.listed(), [])
        with self.assertRaises(HTTPException):
            run(server.delete_turn(t["turn_id"], user=dict(PARENT), database=self.db))


if __name__ == "__main__":
    unittest.main()
