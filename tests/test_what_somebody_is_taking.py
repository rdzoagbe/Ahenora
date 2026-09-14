"""A medicine on a record, written down properly rather than in a sentence.

The record already had a `medications` field: one free-text box. That is fine
for "penicillin allergy — carries an EpiPen" and useless for the thing Roland
walked out of a doctor's surgery with — a course, a dose, three times a day,
for ten days. Nothing could remind anybody, because nothing knew when.

So a medicine becomes a row, the same shape as a vaccination: name required,
everything else optional, and a parent able to write down what they know at
the pharmacy counter without being made to complete a form first.

The free-text field stays. People have typed things into it, none of which
this code can safely parse into a dose, and losing somebody's note about their
child's allergy to migrate them into a tidier schema would be an appalling
trade.

The rule that shapes the whole feature
--------------------------------------
Times are stored as explicit clock times, "08:00", never as "three times a
day". A frequency has to be turned into moments by SOMEBODY, and the safe
place for that decision is a parent looking at the label — not this code, and
emphatically not a model reading a photograph of a prescription. Everything
downstream then has nothing left to interpret.

The same instinct governs the refusals: a malformed time or a backwards course
is rejected, never coerced into something plausible. A dose shown at the wrong
hour does not read as a glitch. It reads as an instruction.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server

from fake_mongo import FakeDatabase  # noqa: E402

PARENT = {"user_id": "u1", "family_id": "fam_1", "email": "a@b.test"}


def run(coro):
    return asyncio.run(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AMedicineOnARecord(unittest.TestCase):

    def setUp(self):
        self._get_db = server.get_db
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        run(self.db["family_members"].insert_one({
            "member_id": "m1", "family_id": "fam_1", "name": "Ama",
            "role": "child", "created_at": server.utcnow(),
        }))

    def tearDown(self):
        server.get_db = self._get_db

    def add(self, **kwargs):
        kwargs.setdefault("name", "Amoxicillin 500mg")
        return run(server.add_member_medicine(
            "m1", server.MedicineIn(**kwargs), user=PARENT))

    def rows(self):
        member = run(self.db["family_members"].find_one({"member_id": "m1"}))
        return server.public_medicines(member)

    # ── writing one down ────────────────────────────────────────────────

    def test_a_name_alone_is_enough(self):
        """The pharmacy-counter case. Anything more can come later."""
        out = self.add()
        self.assertEqual(len(out["medicines"]), 1)
        self.assertEqual(out["medicines"][0]["name"], "Amoxicillin 500mg")
        self.assertEqual(out["medicines"][0]["times"], [])

    def test_a_course_keeps_its_dose_times_and_dates(self):
        self.add(dose="1 tablet", times=["08:00", "14:00", "20:00"],
                 starts_on="2026-09-14", ends_on="2026-09-24")
        row = self.rows()[0]
        self.assertEqual(row["dose"], "1 tablet")
        self.assertEqual(row["times"], ["08:00", "14:00", "20:00"])
        self.assertEqual(row["starts_on"], "2026-09-14")
        self.assertEqual(row["ends_on"], "2026-09-24")

    def test_times_come_back_sorted_and_deduplicated(self):
        # Two reminders at the same minute is one reminder, and out-of-order
        # times read as a mistake even when they are not.
        self.add(times=["20:00", "08:00", "08:00", "14:00"])
        self.assertEqual(self.rows()[0]["times"], ["08:00", "14:00", "20:00"])

    def test_a_name_is_required(self):
        with self.assertRaises(Exception):
            self.add(name="")

    def test_a_record_has_a_ceiling(self):
        for i in range(server.MEDICINE_MAX):
            self.add(name=f"Medicine {i}")
        with self.assertRaises(server.HTTPException) as caught:
            self.add(name="one too many")
        self.assertEqual(caught.exception.status_code, 400)

    # ── what it refuses, and why ────────────────────────────────────────

    def test_a_time_that_is_not_a_time_is_refused_rather_than_guessed(self):
        """Never coerced. A dose shown at the wrong hour reads as an
        instruction, not as a glitch."""
        for bad in (["25:00"], ["8am"], ["08:60"], ["noon"], ["8:00"], [""]):
            with self.assertRaises(server.HTTPException) as caught:
                self.add(times=bad)
            self.assertEqual(caught.exception.status_code, 400, bad)

    def test_more_times_than_a_household_should_manage_is_refused(self):
        with self.assertRaises(server.HTTPException):
            self.add(times=["06:00", "08:00", "10:00", "12:00",
                            "14:00", "16:00", "18:00"])

    def test_a_course_cannot_end_before_it_starts(self):
        # Otherwise it silently covers no days at all, and the reminder pass
        # this is groundwork for would simply never fire.
        with self.assertRaises(server.HTTPException) as caught:
            self.add(starts_on="2026-09-24", ends_on="2026-09-14")
        self.assertEqual(caught.exception.status_code, 400)

    def test_a_malformed_date_is_refused(self):
        with self.assertRaises(server.HTTPException):
            self.add(starts_on="2026-13-45")

    # ── correcting one ──────────────────────────────────────────────────

    def patch(self, med_id, **kwargs):
        return run(server.update_member_medicine(
            "m1", med_id, server.MedicinePatchIn(**kwargs), user=PARENT))

    def test_a_patch_touches_only_what_it_names(self):
        self.add(dose="1 tablet", times=["08:00"], note="with food")
        med_id = self.rows()[0]["med_id"]
        self.patch(med_id, dose="2 tablets")
        row = self.rows()[0]
        self.assertEqual(row["dose"], "2 tablets")
        self.assertEqual(row["times"], ["08:00"])
        self.assertEqual(row["note"], "with food")

    def test_a_wrongly_entered_dose_can_be_cleared(self):
        self.add(dose="3 tablets")
        med_id = self.rows()[0]["med_id"]
        self.patch(med_id, dose="")
        self.assertEqual(self.rows()[0]["dose"], "")

    def test_a_patch_cannot_invert_a_course_through_the_other_end(self):
        """Checked on the MERGED row, not on what was sent.

        Moving only the start date can still put it after an end set weeks
        ago — and a validator that only looks at the fields in this request
        would wave it through.
        """
        self.add(starts_on="2026-09-14", ends_on="2026-09-24")
        med_id = self.rows()[0]["med_id"]
        with self.assertRaises(server.HTTPException) as caught:
            self.patch(med_id, starts_on="2026-10-01")
        self.assertEqual(caught.exception.status_code, 400)

    def test_patching_an_unknown_medicine_is_a_404(self):
        with self.assertRaises(server.HTTPException) as caught:
            self.patch("med_nope", dose="1")
        self.assertEqual(caught.exception.status_code, 404)

    def test_a_medicine_is_addressed_by_id_not_by_position(self):
        # An index computed from our read points at somebody else's row if the
        # other parent added one meanwhile.
        self.add(name="First")
        self.add(name="Second")
        target = next(m for m in self.rows() if m["name"] == "First")["med_id"]
        self.patch(target, dose="changed")
        by_name = {m["name"]: m for m in self.rows()}
        self.assertEqual(by_name["First"]["dose"], "changed")
        self.assertEqual(by_name["Second"]["dose"], "")

    # ── taking one off ──────────────────────────────────────────────────

    def test_a_finished_course_can_be_removed(self):
        self.add(name="Amoxicillin")
        self.add(name="Ibuprofen")
        med_id = next(m for m in self.rows() if m["name"] == "Amoxicillin")["med_id"]
        run(server.delete_member_medicine("m1", med_id, user=PARENT))
        self.assertEqual([m["name"] for m in self.rows()], ["Ibuprofen"])

    def test_deleting_an_unknown_medicine_is_a_404(self):
        with self.assertRaises(server.HTTPException) as caught:
            run(server.delete_member_medicine("m1", "med_nope", user=PARENT))
        self.assertEqual(caught.exception.status_code, 404)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class HowTheListReads(unittest.TestCase):
    """A carer opening this wants the course that is about to end."""

    def member(self, medicines):
        return {"record": {"medicines": medicines}}

    def test_a_course_ending_soonest_comes_first(self):
        out = server.public_medicines(self.member([
            {"med_id": "b", "name": "Later", "ends_on": "2026-12-01"},
            {"med_id": "a", "name": "Sooner", "ends_on": "2026-09-20"},
        ]))
        self.assertEqual([m["name"] for m in out], ["Sooner", "Later"])

    def test_an_ongoing_medicine_sits_below_a_finishing_course(self):
        """An empty end date means "no end", not "ended long ago" — which is
        what a plain string sort would make of it."""
        out = server.public_medicines(self.member([
            {"med_id": "a", "name": "Ongoing", "ends_on": ""},
            {"med_id": "b", "name": "Finishing", "ends_on": "2026-09-20"},
        ]))
        self.assertEqual([m["name"] for m in out], ["Finishing", "Ongoing"])

    def test_a_record_with_nothing_on_it_reads_as_an_empty_list(self):
        self.assertEqual(server.public_medicines({}), [])
        self.assertEqual(server.public_medicines({"record": {}}), [])

    def test_rubbish_in_the_array_does_not_take_the_record_down(self):
        # The record is read by a carer who may be in a hurry. One bad row
        # must not cost them the rest.
        out = server.public_medicines(self.member([
            "not a dict", None, {"med_id": "a", "name": "Real"},
        ]))
        self.assertEqual([m["name"] for m in out], ["Real"])

    def test_every_field_is_present_even_when_empty(self):
        out = server.public_medicines(self.member([{"med_id": "a", "name": "X"}]))[0]
        self.assertEqual(set(out),
                         {"med_id", "name", "dose", "times",
                          "starts_on", "ends_on", "note"})


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheFreeTextFieldSurvives(unittest.TestCase):
    """People have already typed into `medications`, and none of it can be
    safely parsed into a dose. Migrating it would mean guessing."""

    def test_the_old_field_is_still_served(self):
        self.assertIn("medications", server.CARE_FIELDS)

    def test_a_record_carries_both(self):
        member = {"record": {"medications": "penicillin allergy",
                             "medicines": [{"med_id": "a", "name": "Amoxicillin"}]}}
        out = server.public_member_record(member, full_member=True)
        self.assertEqual(out["medications"], "penicillin allergy")
        self.assertEqual([m["name"] for m in out["medicines"]], ["Amoxicillin"])


if __name__ == "__main__":
    unittest.main()
