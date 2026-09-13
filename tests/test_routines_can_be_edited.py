"""A routine can be corrected in place.

`PATCH /api/routines/{id}` has existed all along and nothing ever called it —
the client had list, create, delete and log, and no update. So a routine could
be run and deleted but never fixed: a typo in its name, a step in the wrong
order, the wrong child, meant deleting it and building it again, which takes
its completion history with it.

And the endpoint was itself incomplete. RoutineIn accepts member_id and
star_reward; RoutinePatchIn accepted neither. Even once wired, you could not
have moved a routine to the right child or corrected what finishing it is
worth — the two things most likely to be wrong, since both are chosen before
anybody has used the thing once.

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
    from fastapi import HTTPException
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase

A = {"user_id": "u1", "family_id": "fam1", "name": "Roland"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class EditingARoutine(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()

    def _create(self, **kw):
        body = server.RoutineIn(
            name=kw.pop("name", "Morning"),
            steps=kw.pop("steps", [{"label": "Teeth", "duration_seconds": 120}]),
            **kw)
        return asyncio.run(server.create_routine(body, user=dict(A), database=self.db))

    def _patch(self, rid, **kw):
        return asyncio.run(server.update_routine(
            rid, server.RoutinePatchIn(**kw), user=dict(A), database=self.db))

    def test_the_name_can_be_fixed(self):
        r = self._create(name="Mroning")
        self.assertEqual(self._patch(r["routine_id"], name="Morning")["name"], "Morning")

    def test_the_steps_can_be_fixed(self):
        r = self._create()
        steps = [{"label": "Shoes", "duration_seconds": 60}]
        self.assertEqual(self._patch(r["routine_id"], steps=steps)["steps"], steps)

    def test_it_can_be_moved_to_the_right_child(self):
        # The likeliest thing to be wrong, and until now uncorrectable: a
        # routine set up from the wrong child's page is invisible on the right
        # one, and looks to a parent like it was never saved.
        r = self._create(member_id="m1")
        self.assertEqual(self._patch(r["routine_id"], member_id="m2")["member_id"], "m2")

    def test_what_it_is_worth_can_be_fixed(self):
        r = self._create(star_reward=2)
        self.assertEqual(self._patch(r["routine_id"], star_reward=5)["star_reward"], 5)

    def test_it_can_be_made_worth_nothing(self):
        # 0 is a real value, not "unset". A filter that drops falsy values
        # would refuse this forever while appearing to succeed.
        r = self._create(star_reward=3)
        self.assertEqual(self._patch(r["routine_id"], star_reward=0)["star_reward"], 0)

    def test_a_negative_reward_is_clamped_exactly_as_create_clamps_it(self):
        # Two endpoints disagreeing about a valid value has bitten this file
        # twice, and the permissive one is always the one somebody reaches.
        created = self._create(star_reward=-5)
        self.assertEqual(created["star_reward"], 0)
        self.assertEqual(self._patch(created["routine_id"], star_reward=-5)["star_reward"], 0)

    def test_an_edit_leaves_the_fields_it_does_not_mention_alone(self):
        # Saving after fixing only the name must not quietly reset the stars —
        # the bug a card edit already had to learn.
        r = self._create(name="Mroning", star_reward=4, member_id="m1")
        out = self._patch(r["routine_id"], name="Morning")
        self.assertEqual(out["star_reward"], 4)
        self.assertEqual(out["member_id"], "m1")

    def test_another_family_cannot_edit_it(self):
        r = self._create()
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.update_routine(
                r["routine_id"], server.RoutinePatchIn(name="Theirs"),
                user={"user_id": "u9", "family_id": "fam2", "name": "Stranger"},
                database=self.db))
        self.assertEqual(caught.exception.status_code, 404)
        still = asyncio.run(self.db["routines"].find_one({"routine_id": r["routine_id"]}))
        self.assertEqual(still["name"], "Morning")

    def test_everything_create_accepts_can_also_be_edited(self):
        # The invariant, not the four fields. A field addable at creation and
        # not afterwards is a field somebody is stuck with — which is how this
        # gap existed at all.
        creatable = set(server.RoutineIn.model_fields)
        editable = set(server.RoutinePatchIn.model_fields)
        self.assertEqual(creatable - editable, set())


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheAppCanActuallyReachIt(unittest.TestCase):
    def test_the_client_has_an_update_method(self):
        # The endpoint existed for months with no caller. An endpoint nothing
        # calls is a feature nobody has.
        here = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "api.ts")
        with open(here, encoding="utf-8") as fh:
            api = fh.read()
        self.assertIn("updateRoutine:", api)
        self.assertIn("method: 'PATCH'", api[api.index("updateRoutine:"):][:400])

    def test_the_kids_screen_offers_it(self):
        here = os.path.join(os.path.dirname(__file__), "..", "frontend", "app", "(tabs)", "kids.tsx")
        with open(here, encoding="utf-8") as fh:
            kids = fh.read()
        self.assertIn("openRoutineForEdit", kids)
        self.assertIn("api.updateRoutine(", kids)


if __name__ == "__main__":
    unittest.main()
