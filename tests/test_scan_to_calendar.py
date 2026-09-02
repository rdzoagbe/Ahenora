"""A scanned dentist letter should end up on the calendar.

The photo path already extracted the date, and already knew the document was
an appointment card. What it could not do was say so: the scan was allowed to
produce only SIGN_SLIP, RSVP or TASK, and the app treats APPOINTMENT as the
type that belongs on the calendar. So the date was read correctly, shown in
the sheet, and then filed in the Feed where nobody was reminded of it.

This file covers the whole chain: the model may now type a document as an
event, the validator decides whether it IS one, and the route stages it as a
candidate so the keep-or-share decision happens in the review list rather than
being asked a second time in a second shape.

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
    import ai_safety
    from fake_mongo import FakeDatabase

USER = {"user_id": "u1", "family_id": "fam1", "name": "Ama", "email": "a@example.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheModelMayCallItAnEvent(unittest.TestCase):
    def scan(self, **over):
        parsed = {"kind": "document", "type": "APPOINTMENT",
                  "title": "Dentist — Kofi", "description": "Check-up",
                  "due_date": "2026-03-14T09:30:00", "vault_category": "Medical",
                  "save_to_vault": True, "amount": None}
        parsed.update(over)
        return ai_safety.validate_document_scan(parsed, [])

    def test_appointment_survives_validation(self):
        # It used to be rewritten to TASK, silently, which is why the feature
        # looked like it had never been built.
        self.assertEqual(self.scan()["type"], "APPOINTMENT")

    def test_a_school_date_survives_too(self):
        self.assertEqual(self.scan(type="SCHOOL")["type"], "SCHOOL")

    def test_an_invented_type_still_falls_back_to_task(self):
        self.assertEqual(self.scan(type="PARTY")["type"], "TASK")

    def test_an_appointment_with_a_date_is_an_event(self):
        self.assertTrue(self.scan()["is_event"])

    def test_an_appointment_with_no_date_is_not(self):
        # Nobody can be reminded of an event with no time. It stays a feed item.
        self.assertFalse(self.scan(due_date=None)["is_event"])

    def test_a_dated_bill_is_not_an_event(self):
        # A date on a TASK is a deadline, not something that happens somewhere.
        self.assertFalse(self.scan(type="TASK", due_date="2026-03-14")["is_event"])

    def test_an_expiry_is_read_separately_from_the_due_date(self):
        out = self.scan(due_date=None, expires_on="2031-08-01")
        self.assertEqual(out["expires_on"], "2031-08-01")
        self.assertIsNone(out["due_date"])
        self.assertFalse(out["is_event"])

    def test_a_junk_expiry_is_dropped_not_stored(self):
        self.assertIsNone(self.scan(expires_on="sometime next year")["expires_on"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class StagingAScannedEvent(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        asyncio.run(self.db["users"].insert_one({**USER}))

    def tearDown(self):
        server.get_db = self._get_db

    def stage(self, **over):
        body = {"title": "Dentist — Kofi", "description": "Check-up",
                "due_date": "2026-03-14T09:30:00", "type": "APPOINTMENT",
                "location": "12 Rue Pasteur"}
        body.update(over)
        return asyncio.run(server.stage_scanned_event(
            server.ScanEventIn(**body), user=dict(USER), database=self.db))

    def candidates(self):
        return asyncio.run(server.list_event_candidates(
            user=dict(USER), database=self.db))["candidates"]

    def cards(self):
        async def go():
            return [c async for c in self.db["cards"].find({}, {"_id": 0})]
        return asyncio.run(go())

    def test_it_stages_rather_than_creating(self):
        out = self.stage()
        self.assertTrue(out["staged"])
        self.assertEqual(self.cards(), [],
                         "a scan must not put a card on the calendar by itself")
        self.assertEqual(len(self.candidates()), 1)

    def test_the_candidate_carries_the_time_and_the_place(self):
        self.stage()
        c = self.candidates()[0]
        self.assertEqual(c["location"], "12 Rue Pasteur")
        self.assertEqual(c["type"], "APPOINTMENT")
        self.assertTrue(c["due_date"].startswith("2026-03-14"))
        self.assertEqual(c["source_kind"], "document_scan")

    def test_scanning_the_same_letter_twice_queues_it_once(self):
        self.stage()
        again = self.stage()
        self.assertFalse(again["staged"])
        self.assertEqual(again["reason"], "already_pending")
        self.assertEqual(len(self.candidates()), 1)

    def test_a_different_appointment_on_the_same_day_is_not_a_duplicate(self):
        self.stage()
        self.stage(title="Parents evening")
        self.assertEqual(len(self.candidates()), 2)

    def test_a_missing_date_is_refused(self):
        with self.assertRaises(server.HTTPException) as caught:
            self.stage(due_date="not a date")
        self.assertEqual(caught.exception.status_code, 400)

    def test_an_empty_title_is_refused(self):
        with self.assertRaises(server.HTTPException) as caught:
            self.stage(title="   ")
        self.assertEqual(caught.exception.status_code, 400)

    def test_an_unknown_type_becomes_an_appointment(self):
        self.stage(type="WHATEVER")
        self.assertEqual(self.candidates()[0]["type"], "APPOINTMENT")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class BugsThisWorkUncovered(unittest.TestCase):
    """Two things that were wrong before, found by tightening the rules."""

    def test_create_and_edit_agree_on_what_a_card_may_be(self):
        # POST validated neither type nor recurrence while PATCH validated
        # both, so the route people actually use was the permissive one.
        self.assertIn("APPOINTMENT", server.CARD_TYPE_VALUES)
        self.assertNotIn("EVENT", server.CARD_TYPE_VALUES)

    def test_yearly_is_a_recurrence_the_server_will_accept_back(self):
        # The server CREATES yearly cards on calendar import, and PATCH used to
        # reject "yearly" — so an imported birthday could not be edited at all.
        self.assertIn("yearly", server.RECURRENCE_VALUES)

    def test_a_teen_agenda_is_not_keyed_on_a_type_that_does_not_exist(self):
        # The teen home split on type == "EVENT", which is in no union, no
        # chip and no whitelist: every card fell through to the to-do branch,
        # so a teen's agenda was permanently empty and their appointments were
        # listed as chores.
        self.assertNotIn("EVENT", server.AGENDA_CARD_TYPES)
        self.assertTrue(server.AGENDA_CARD_TYPES <= server.CARD_TYPE_VALUES)
        self.assertIn("APPOINTMENT", server.AGENDA_CARD_TYPES)


if __name__ == "__main__":
    unittest.main()
