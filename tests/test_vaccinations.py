"""Vaccination dates — the one part of a child's record that is a LIST.

Everything else in the record is a fact you write once and correct rarely:
an allergy, a blood group, a doctor's number. Vaccinations are rows. "Tetanus,
2024-03-11" is not a sentence a parent wants to keep re-typing into a free-text
box, and the question that actually costs people something — "is she due?" —
cannot be answered by a paragraph at all.

So the tests here are about the two things a list has and a text field does not:

  * CONCURRENCY. Two parents adding two different shots from two phones must
    both end up in the record. The whole-array write that would have been
    simpler loses whichever one saved second, silently, and a vaccination you
    entered and cannot find is worse than one you never entered.
  * REFUSING A BAD DATE. "2024-13-45" stored is worse than nothing stored,
    because it reads as an answer. A date is either a real day or it is absent.

Who may read and write is inherited from the record and re-checked here, since
it is a child's health information and an inherited guarantee is still a
guarantee somebody can break.

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
    from fastapi import HTTPException
    from fake_mongo import FakeDatabase

PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
OTHER_PARENT = {"user_id": "u_p2", "family_id": "fam1", "name": "Afi", "email": "a@x.com"}
NANNY = {"user_id": "u_n", "family_id": "fam1", "name": "Esi", "email": "e@x.com",
         "is_helper": True}
OUTSIDER = {"user_id": "u_o", "family_id": "fam2", "name": "Stranger", "email": "s@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Vaccinations(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        for u in (PARENT, OTHER_PARENT, NANNY, OUTSIDER):
            asyncio.run(self.db["users"].insert_one({**u, "language": "en"}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_ama", "family_id": "fam1", "name": "Ama",
            "role": "child", "stars": 0}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_other", "family_id": "fam2", "name": "Elsewhere",
            "role": "child", "stars": 0}))

    def tearDown(self):
        server.get_db = self._get_db

    # --- helpers ----------------------------------------------------------

    def add(self, who=PARENT, member="m_ama", **fields):
        return asyncio.run(server.add_member_vaccination(
            member, server.VaccinationIn(**fields), user=dict(who)))

    def patch(self, vax_id, who=PARENT, member="m_ama", **fields):
        return asyncio.run(server.update_member_vaccination(
            member, vax_id, server.VaccinationPatchIn(**fields), user=dict(who)))

    def remove(self, vax_id, who=PARENT, member="m_ama"):
        return asyncio.run(server.delete_member_vaccination(
            member, vax_id, user=dict(who)))

    def read(self, who=PARENT, member="m_ama"):
        return asyncio.run(server.get_member_record(member, user=dict(who)))

    def names(self, who=PARENT):
        return [v["name"] for v in self.read(who)["vaccinations"]]

    # --- the thing itself -------------------------------------------------

    def test_a_shot_can_be_written_and_read_back(self):
        self.add(name="Tetanus", given_on="2024-03-11", next_due="2034-03-11",
                 note="left arm")
        got = self.read()["vaccinations"]
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["name"], "Tetanus")
        self.assertEqual(got[0]["given_on"], "2024-03-11")
        self.assertEqual(got[0]["next_due"], "2034-03-11")
        self.assertEqual(got[0]["note"], "left arm")
        self.assertTrue(got[0]["vax_id"])

    def test_a_name_is_enough(self):
        # A parent who remembers the vaccine but not the day must still be able
        # to write it down — otherwise the list only holds what you can prove,
        # and a half-remembered MMR goes unrecorded.
        self.add(name="MMR")
        got = self.read()["vaccinations"]
        self.assertEqual(got[0]["name"], "MMR")
        self.assertEqual(got[0]["given_on"], "")

    def test_an_empty_record_carries_an_empty_list_not_a_missing_key(self):
        # The screen renders a list; it should not have to guess at a shape.
        self.assertEqual(self.read()["vaccinations"], [])

    # --- concurrency, which is the reason for per-entry writes -------------

    def racing(self, fn):
        """Run `fn` with another parent writing BETWEEN our read and our write.

        Two adds one after the other prove nothing: the second one re-reads and
        sees the first, so even a whole-array rewrite looks correct. The bug
        only appears when a write is built from a STALE read, which is what an
        interleave reproduces and a sequence does not.
        """
        original = server._load_member_for_record
        fired = []

        async def interleaved(database, user, member_id):
            member = await original(database, user, member_id)
            if not fired:
                fired.append(True)
                # The other parent's write, landing in the gap. Pushed straight
                # at the store because we are already inside the handler's
                # event loop — the shape that matters is that it is IN the
                # database and NOT in the `member` we just read.
                await database["family_members"].update_one(
                    {"family_id": "fam1", "member_id": member_id},
                    {"$push": {"record.vaccinations": {
                        "vax_id": "vax_other", "name": "MMR",
                        "given_on": "2023-01-09", "next_due": "", "note": ""}}})
            return member

        server._load_member_for_record = interleaved
        try:
            fn()
        finally:
            server._load_member_for_record = original
        self.assertTrue(fired, "the interleave never ran — the test proves nothing")

    def test_a_parent_adding_during_our_add_is_not_erased(self):
        # If this fails, whichever parent saved second has silently erased the
        # other, and the vaccination they entered is simply gone.
        self.racing(lambda: self.add(who=PARENT, name="Tetanus",
                                     given_on="2024-03-11"))
        self.assertEqual(sorted(self.names()), ["MMR", "Tetanus"])

    def test_two_parents_adding_in_turn_both_survive(self):
        self.add(who=PARENT, name="Tetanus", given_on="2024-03-11")
        self.add(who=OTHER_PARENT, name="MMR", given_on="2023-01-09")
        self.assertEqual(sorted(self.names()), ["MMR", "Tetanus"])

    def test_editing_one_row_leaves_the_others_alone(self):
        a = self.add(name="Tetanus", given_on="2024-03-11")["vaccinations"]
        self.add(name="MMR", given_on="2023-01-09")
        vax_id = next(v["vax_id"] for v in self.read()["vaccinations"]
                      if v["name"] == "Tetanus")
        self.patch(vax_id, note="left arm")
        rows = {v["name"]: v for v in self.read()["vaccinations"]}
        self.assertEqual(rows["Tetanus"]["note"], "left arm")
        self.assertEqual(rows["Tetanus"]["given_on"], "2024-03-11")
        self.assertEqual(rows["MMR"]["note"], "")
        self.assertEqual(rows["MMR"]["given_on"], "2023-01-09")
        self.assertTrue(a)

    def test_a_row_added_after_our_read_is_not_clobbered_by_an_edit(self):
        # The positional write is addressed by vax_id, not by array index. An
        # index computed before the other parent's push points at their row.
        self.add(name="Tetanus", given_on="2024-03-11")
        target = self.read()["vaccinations"][0]["vax_id"]
        self.add(who=OTHER_PARENT, name="MMR", given_on="2023-01-09")
        self.patch(target, name="Tetanus booster")
        self.assertEqual(sorted(self.names()), ["MMR", "Tetanus booster"])

    def test_removing_one_row_removes_exactly_that_row(self):
        self.add(name="Tetanus", given_on="2024-03-11")
        self.add(name="MMR", given_on="2023-01-09")
        vax_id = next(v["vax_id"] for v in self.read()["vaccinations"]
                      if v["name"] == "MMR")
        self.remove(vax_id)
        self.assertEqual(self.names(), ["Tetanus"])

    def test_a_wrong_row_can_be_removed_entirely(self):
        # Entered against the wrong child, which is the common mistake. A
        # wrong vaccination date is worse than an absent one.
        self.add(name="Tetanus")
        vax_id = self.read()["vaccinations"][0]["vax_id"]
        self.remove(vax_id)
        self.assertEqual(self.read()["vaccinations"], [])

    # --- dates are real days, or nothing ----------------------------------

    def test_a_nonsense_date_is_refused_not_stored(self):
        for bad in ("2024-13-45", "11/03/2024", "yesterday", "2024-02-30"):
            with self.subTest(bad=bad):
                with self.assertRaises(HTTPException) as e:
                    self.add(name="Tetanus", given_on=bad)
                self.assertEqual(e.exception.status_code, 400)
        # and nothing was written on the way out
        self.assertEqual(self.read()["vaccinations"], [])

    def test_a_nonsense_next_due_is_refused_too(self):
        with self.assertRaises(HTTPException) as e:
            self.add(name="Tetanus", next_due="soon")
        self.assertEqual(e.exception.status_code, 400)

    def test_a_date_can_be_cleared_after_a_mistake(self):
        self.add(name="Tetanus", given_on="2024-03-11")
        vax_id = self.read()["vaccinations"][0]["vax_id"]
        self.patch(vax_id, given_on="")
        self.assertEqual(self.read()["vaccinations"][0]["given_on"], "")

    def test_a_row_cannot_be_left_nameless(self):
        # A date with no vaccine is a row nobody can act on.
        self.add(name="Tetanus")
        vax_id = self.read()["vaccinations"][0]["vax_id"]
        with self.assertRaises(HTTPException) as e:
            self.patch(vax_id, name="   ")
        self.assertEqual(e.exception.status_code, 400)
        self.assertEqual(self.names(), ["Tetanus"])

    # --- order --------------------------------------------------------------

    def test_newest_first_and_undated_last(self):
        # "When was the last one?" is the question this list is read for.
        self.add(name="MMR", given_on="2023-01-09")
        self.add(name="Tetanus", given_on="2024-03-11")
        self.add(name="Polio")
        self.assertEqual(self.names(), ["Tetanus", "MMR", "Polio"])

    # --- who may read and write -------------------------------------------

    def test_a_helper_can_read_the_dates(self):
        # A nanny at a clinic desk is exactly who is asked "when was the last
        # one?" — the same reasoning that lets a helper read an allergy.
        self.add(name="Tetanus", given_on="2024-03-11")
        self.assertEqual(self.names(NANNY), ["Tetanus"])

    def test_a_helper_cannot_add_edit_or_remove(self):
        # Through the REAL gate. Calling the handler with a helper dict would
        # skip require_full_member entirely and prove nothing — the refusal
        # lives in the dependency, so the dependency is what gets run.
        self.add(name="Tetanus")
        vax_id = self.read()["vaccinations"][0]["vax_id"]
        for label in ("add", "patch", "remove"):
            with self.subTest(call=label):
                with self.assertRaises(HTTPException) as caught:
                    gated = asyncio.run(server.require_full_member(user=dict(NANNY)))
                    if label == "add":
                        self.add(who=gated, name="Sneaky")
                    elif label == "patch":
                        self.patch(vax_id, who=gated, name="Changed")
                    else:
                        self.remove(vax_id, who=gated)
                self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(self.names(), ["Tetanus"])

    def test_every_write_route_actually_declares_the_gate(self):
        """The wiring, not just the guard.

        Every other "a helper cannot write this" test in the suite — including
        the one above — calls require_full_member itself and passes the result
        in. That proves the GUARD refuses a helper. It cannot notice somebody
        changing a route's Depends() to require_user, which is the change that
        would actually open the record up, and it would ship green.

        So this reads the dependency the app really declares.
        """
        want = {
            ("POST", "/api/family/members/{member_id}/vaccinations"):
                "require_full_member",
            ("PATCH", "/api/family/members/{member_id}/vaccinations/{vax_id}"):
                "require_full_member",
            ("DELETE", "/api/family/members/{member_id}/vaccinations/{vax_id}"):
                "require_full_member",
            # The read is deliberately the wider gate: a helper who cannot see
            # the date cannot answer "when was the last one?" at the desk.
            ("GET", "/api/family/members/{member_id}/record"): "require_user",
        }
        seen = {}
        for route in server.app.routes:
            path = getattr(route, "path", "")
            for method in getattr(route, "methods", ()) or ():
                if (method, path) in want:
                    seen[(method, path)] = [
                        d.call.__name__ for d in route.dependant.dependencies]
        for key, gate in want.items():
            with self.subTest(route=f"{key[0]} {key[1]}"):
                self.assertIn(key, seen, "route is not registered at all")
                self.assertIn(gate, seen[key])

    def test_another_household_cannot_touch_this_child(self):
        self.add(name="Tetanus")
        vax_id = self.read()["vaccinations"][0]["vax_id"]
        with self.assertRaises(HTTPException) as e:
            self.add(who=OUTSIDER, name="Sneaky")
        self.assertEqual(e.exception.status_code, 404)
        with self.assertRaises(HTTPException):
            self.patch(vax_id, who=OUTSIDER, name="Changed")
        with self.assertRaises(HTTPException):
            self.remove(vax_id, who=OUTSIDER)

    def test_an_unknown_row_is_a_404_not_a_silent_no_op(self):
        # A PATCH that quietly does nothing is how a parent believes they
        # corrected a date they did not correct.
        with self.assertRaises(HTTPException) as e:
            self.patch("vax_nope", name="Changed")
        self.assertEqual(e.exception.status_code, 404)
        with self.assertRaises(HTTPException) as e:
            self.remove("vax_nope")
        self.assertEqual(e.exception.status_code, 404)

    # --- where it must never turn up --------------------------------------

    def test_vaccinations_stay_out_of_the_public_member(self):
        # public_member is an explicit allowlist and feeds every AI path that
        # reads cards. A child's health information does not go through it.
        self.add(name="Tetanus", given_on="2024-03-11")
        member = asyncio.run(self.db["family_members"].find_one({"member_id": "m_ama"}))
        public = server.public_member(member)
        self.assertNotIn("vaccinations", public)
        self.assertNotIn("record", public)

    def test_the_list_is_capped(self):
        # Room for a full childhood schedule without room for somebody to use
        # a child's record as storage.
        for i in range(server.VACCINATION_MAX):
            self.add(name=f"Shot {i}")
        with self.assertRaises(HTTPException) as e:
            self.add(name="One too many")
        self.assertEqual(e.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
