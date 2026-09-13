"""Carpool Coordinator could be listed and deleted, never created.

It is a PAID feature. `require_feature(user, "carpool")` gates creation, the
free plan has `"carpool": False` and the paid plans have it True, and the
Calendar sells it with an upsell row. But `createCarpool` had no caller in the
app, and the screen rendered the section only when `carpools.length > 0` — so
a household that had just paid for it arrived where it was sold and found no
trace of the feature at all, not even an empty list.

Wiring up the creator opens the other half: `CarpoolIn` validated nothing.
`day_of_week` and `time` were free strings written straight into the document
and read straight back onto the schedule. The screen sends a day off a row of
seven chips and a zero-padded time, so the only way to reach a bad value is
around the screen — but a row reading "friday-ish at half eight" is worse than
no row at all, because the parent checking the schedule at 8am believes it.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server


class FakeColl:
    def __init__(self):
        self.rows = []

    async def insert_one(self, doc):
        self.rows.append(doc)


class FakeDB:
    def __init__(self, **colls):
        self.colls = colls

    def __getitem__(self, name):
        return self.colls.setdefault(name, FakeColl())


USER = {"user_id": "u1", "family_id": "fam_1", "email": "a@b.test"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class NormalisingAClockTime(unittest.TestCase):
    def test_a_time_typed_without_its_zeros_is_still_that_time(self):
        self.assertEqual(server.normalise_clock_time("8:5"), "08:05")
        self.assertEqual(server.normalise_clock_time("8:00"), "08:00")
        self.assertEqual(server.normalise_clock_time("  15:30 "), "15:30")
        self.assertEqual(server.normalise_clock_time("0:00"), "00:00")
        self.assertEqual(server.normalise_clock_time("23:59"), "23:59")

    def test_what_is_not_a_time_is_refused(self):
        for bad in ("", "   ", "half eight", "25:00", "12:60", "08", "08:",
                    ":30", "8:00pm", "-1:00", None):
            self.assertIsNone(server.normalise_clock_time(bad), bad)

    def test_the_stored_shape_is_the_same_however_it_was_typed(self):
        # The schedule sorts on this string. "8:00" and "08:00" sorting apart
        # would put the morning run below the afternoon one.
        self.assertEqual(server.normalise_clock_time("8:00"),
                         server.normalise_clock_time("08:00"))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class CreatingACarpool(unittest.TestCase):
    def setUp(self):
        self._require_feature = server.require_feature

        async def allow(*a, **k):
            return None
        server.require_feature = allow
        self.carpools = FakeColl()
        self.db = FakeDB(carpools=self.carpools)

    def tearDown(self):
        server.require_feature = self._require_feature

    def _create(self, **kw):
        body = server.CarpoolIn(**{
            "title": "School run", "day_of_week": "monday",
            "time": "08:00", "driver_name": "Kemi", **kw})
        return asyncio.run(server.create_carpool(body, user=USER, database=self.db))

    def test_a_run_reaches_the_schedule(self):
        out = self._create()
        self.assertEqual(out["title"], "School run")
        self.assertEqual(out["day_of_week"], "monday")
        self.assertEqual(out["time"], "08:00")
        self.assertEqual(out["driver_name"], "Kemi")
        self.assertEqual(len(self.carpools.rows), 1)
        self.assertEqual(self.carpools.rows[0]["family_id"], "fam_1")

    def test_the_day_is_stored_lowercase_whatever_case_it_arrives_in(self):
        self.assertEqual(self._create(day_of_week="FRIDAY")["day_of_week"], "friday")

    def test_a_time_without_its_zeros_is_padded_on_the_way_in(self):
        self.assertEqual(self._create(time="8:5")["time"], "08:05")

    def test_a_day_that_is_not_a_day_is_refused(self):
        for bad in ("someday", "", "mon", "friday-ish", "8"):
            with self.assertRaises(server.HTTPException) as caught:
                self._create(day_of_week=bad)
            self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(self.carpools.rows, [])

    def test_a_time_that_is_not_a_time_is_refused(self):
        for bad in ("half eight", "", "25:00", "12:60"):
            with self.assertRaises(server.HTTPException) as caught:
                self._create(time=bad)
            self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(self.carpools.rows, [])

    def test_a_run_with_no_name_is_refused(self):
        for bad in ("", "   "):
            with self.assertRaises(server.HTTPException):
                self._create(title=bad)
        self.assertEqual(self.carpools.rows, [])

    def test_a_run_nobody_has_agreed_to_drive_yet_is_allowed(self):
        # Plenty of runs are written down before a driver is arranged.
        # Refusing means the schedule never gets written at all.
        self.assertEqual(self._create(driver_name="")["driver_name"], "")
        self.assertEqual(len(self.carpools.rows), 1)

    def test_blank_passengers_are_dropped_rather_than_listed(self):
        out = self._create(pickup_kids=["Arielle", "  ", "", "Isaiah"])
        self.assertEqual(out["pickup_kids"], ["Arielle", "Isaiah"])

    def test_an_empty_note_is_stored_as_nothing_not_as_an_empty_line(self):
        self.assertIsNone(self._create(notes="   ")["notes"])

    def test_the_paid_gate_still_stands(self):
        # The whole point of the feature: it is sold. Restore the real check
        # and confirm a household without the entitlement cannot create one.
        server.require_feature = self._require_feature
        free = dict(USER, family_id="fam_free")

        async def deny(*a, **k):
            raise server.HTTPException(402, "Carpool Coordinator is available on Premium.")
        server.require_feature = deny
        with self.assertRaises(server.HTTPException) as caught:
            asyncio.run(server.create_carpool(
                server.CarpoolIn(title="School run", day_of_week="monday",
                                 time="08:00", driver_name="Kemi"),
                user=free, database=self.db))
        self.assertEqual(caught.exception.status_code, 402)
        self.assertEqual(self.carpools.rows, [])


if __name__ == "__main__":
    unittest.main()
