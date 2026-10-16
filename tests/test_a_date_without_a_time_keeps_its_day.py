"""A date without a time keeps its day in every timezone.

An audit on 2026-10-16 found the day printed on a letter, a passport's expiry
and an all-day calendar event were all pinned to midnight UTC. For a family in
Montreal (UTC-4) that is the evening before: the vaccination showed on the
19th, the passport expired a day early, "Grandma's birthday" was a 5 AM event
with a push at 4 in the morning. One rule now: a day with no clock sits at
noon UTC, which reads as that same day from Hawaii to Tokyo (UTC-11 to UTC+11),
and carries `time_set: False` so the app shows "All day" and schedules no
"60 minutes before".

Run with:  python3 -m unittest tests.test_a_date_without_a_time_keeps_its_day -v
"""
import asyncio
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    import server
    from fake_mongo import FakeDatabase
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com", "role": "parent"}
MONTREAL = timezone(timedelta(hours=-4))
PARIS = timezone(timedelta(hours=2))
HONOLULU = timezone(timedelta(hours=-10))
TOKYO = timezone(timedelta(hours=9))


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheRule(unittest.TestCase):
    def test_a_bare_date_is_noon_utc(self):
        dt = server.parse_dt("2026-10-20")
        self.assertEqual(dt, datetime(2026, 10, 20, 12, tzinfo=timezone.utc))

    def test_which_is_the_same_day_everywhere_a_family_lives(self):
        dt = server.parse_dt("2026-10-20")
        # Noon UTC holds from UTC-11 to UTC+11; nothing holds across all 26 hours
        # of the world's clocks, and that span is every market the app is sold in.
        for zone in (MONTREAL, PARIS, HONOLULU, TOKYO):
            self.assertEqual(dt.astimezone(zone).date().isoformat(), "2026-10-20", str(zone))

    def test_a_moment_is_still_a_moment(self):
        self.assertEqual(server.parse_dt("2026-10-20T14:30:00+02:00"),
                         datetime(2026, 10, 20, 12, 30, tzinfo=timezone.utc))
        self.assertEqual(server.parse_dt("2026-10-20T00:00:00Z"),
                         datetime(2026, 10, 20, 0, 0, tzinfo=timezone.utc), "midnight asked for is midnight")

    def test_a_malformed_date_is_a_400(self):
        from fastapi import HTTPException
        with self.assertRaises(HTTPException):
            server.parse_dt("2026-13-45")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class OnACard(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._send = server.send_expo_push_messages

        async def quiet(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = quiet

        async def seed():
            await self.db["families"].insert_one({
                "family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
                "grandfathered": False, "updated_at": server.utcnow(),
                "ai_scans_used": 0, "ai_scans_period_start": server.utcnow(), "vault_bytes_used": 0})
            await self.db["users"].insert_one({**ROLAND})
            await self.db["family_members"].insert_one({
                "member_id": "m_r", "family_id": "fam1", "user_id": "u_r", "name": "Roland", "role": "parent"})
        run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._send

    def test_a_scanned_letter_lands_on_the_day_it_names(self):
        """The camera hands the app a bare date; the app sends it on as is."""
        out = run(server.create_card(server.CardIn(type="APPOINTMENT", title="Vaccination",
                                                   due_date="2026-10-20", time_set=False), user=dict(ROLAND)))
        self.assertEqual(out["due_date"], "2026-10-20T12:00:00+00:00")
        self.assertIs(out["time_set"], False)

    def test_a_card_from_before_the_flag_says_so(self):
        """Absent is neither True nor False: the app keeps guessing for those,
        so an old card with a real time is not relabelled "All day"."""
        run(self.db["cards"].insert_one({
            "card_id": "old", "family_id": "fam1", "type": "TASK", "title": "Old", "status": "OPEN",
            "source": "MANUAL", "due_date": datetime(2026, 10, 20, 7, tzinfo=timezone.utc),
            "created_at": server.utcnow()}))
        card = run(self.db["cards"].find_one({"card_id": "old"}, {"_id": 0}))
        self.assertIsNone(server.public_card(card)["time_set"])

    def test_a_scanned_appointment_staged_for_review_has_no_clock_and_no_night_push(self):
        out = run(server.stage_scanned_event(
            server.ScanEventIn(title="Dentist", due_date="2026-10-20"), user=dict(ROLAND), database=self.db))
        self.assertTrue(out["staged"])
        cand = run(self.db["event_candidates"].find_one({"family_id": "fam1"}, {"_id": 0}))
        self.assertEqual(server.ensure_aware_utc(cand["due_date"]), datetime(2026, 10, 20, 12, tzinfo=timezone.utc))
        self.assertIs(cand["time_set"], False)
        self.assertEqual(cand["reminder_minutes"], 0)
        # Accepting it keeps all of that.
        run(server.decide_event_candidates(server.CandidateDecisionIn(keep=[cand["candidate_id"]], drop=[]),
                                           user=dict(ROLAND), database=self.db))
        card = run(self.db["cards"].find_one({"family_id": "fam1", "title": "Dentist"}, {"_id": 0}))
        self.assertIs(card["time_set"], False)
        self.assertEqual(card["reminder_minutes"], 0)

    def test_a_scanned_appointment_with_a_time_keeps_it(self):
        run(server.stage_scanned_event(
            server.ScanEventIn(title="Dentist", due_date="2026-10-20T14:30:00+02:00"), user=dict(ROLAND), database=self.db))
        cand = run(self.db["event_candidates"].find_one({"family_id": "fam1"}, {"_id": 0}))
        self.assertIs(cand["time_set"], True)
        self.assertEqual(cand["reminder_minutes"], 60)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class FromACalendar(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._g, self._m = server._fetch_google_calendar_events, server._fetch_microsoft_calendar_events
        run(self.db["families"].insert_one({"family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
                                            "grandfathered": False, "updated_at": server.utcnow()}))

    def tearDown(self):
        server.get_db = self._get_db
        server._fetch_google_calendar_events, server._fetch_microsoft_calendar_events = self._g, self._m

    def _google(self, events, review=False):
        async def fake(token, days):
            return events
        server._fetch_google_calendar_events = fake
        return run(server.import_google_calendar(
            server.CalendarImportIn(access_token="t", days=30, review=review), user=dict(ROLAND)))

    def test_an_all_day_google_event_is_a_day(self):
        self._google([{"id": "g1", "summary": "Grandma's birthday", "start": {"date": "2026-10-20"}},
                      {"id": "g2", "summary": "Dentist", "start": {"dateTime": "2026-10-21T09:30:00+02:00"}}])
        bday = run(self.db["cards"].find_one({"google_event_id": "g1"}, {"_id": 0}))
        self.assertEqual(server.ensure_aware_utc(bday["due_date"]), datetime(2026, 10, 20, 12, tzinfo=timezone.utc))
        self.assertIs(bday["time_set"], False)
        self.assertEqual(bday["reminder_minutes"], 0, "no push in the night for a day")
        dentist = run(self.db["cards"].find_one({"google_event_id": "g2"}, {"_id": 0}))
        self.assertIs(dentist["time_set"], True)
        self.assertEqual(dentist["reminder_minutes"], 60)

    def test_an_all_day_event_imported_before_the_rule_is_put_right_on_resync(self):
        run(self.db["cards"].insert_one({
            "card_id": "c1", "family_id": "fam1", "google_event_id": "g1", "title": "Grandma's birthday",
            "type": "BIRTHDAY", "status": "OPEN", "source": "CALENDAR", "shared": False,
            "due_date": datetime(2026, 10, 20, 9, tzinfo=timezone.utc), "reminder_minutes": 60,
            "created_at": server.utcnow()}))
        out = self._google([{"id": "g1", "summary": "Grandma's birthday", "start": {"date": "2026-10-20"}}])
        self.assertEqual(out["updated"], 1)
        card = run(self.db["cards"].find_one({"card_id": "c1"}, {"_id": 0}))
        self.assertEqual(server.ensure_aware_utc(card["due_date"]), datetime(2026, 10, 20, 12, tzinfo=timezone.utc))
        self.assertIs(card["time_set"], False)
        self.assertEqual(card["reminder_minutes"], 0)

    def test_an_all_day_event_accepted_from_the_review_list_stays_a_day(self):
        self._google([{"id": "g1", "summary": "Half term", "start": {"date": "2026-10-26"}}], review=True)
        cand = run(self.db["event_candidates"].find_one({"family_id": "fam1"}, {"_id": 0}))
        self.assertIs(cand["time_set"], False)
        run(server.decide_event_candidates(server.CandidateDecisionIn(keep=[cand["candidate_id"]], drop=[]),
                                           user=dict(ROLAND), database=self.db))
        card = run(self.db["cards"].find_one({"family_id": "fam1", "title": "Half term"}, {"_id": 0}))
        self.assertIs(card["time_set"], False)
        self.assertEqual(card["reminder_minutes"], 0)

    def test_an_all_day_outlook_event_is_a_day(self):
        async def fake(token, days):
            return [{"id": "m1", "subject": "Wedding anniversary", "isAllDay": True,
                     "start": {"dateTime": "2026-10-20T00:00:00.0000000", "timeZone": "UTC"}}]
        server._fetch_microsoft_calendar_events = fake
        run(server.import_microsoft_calendar(server.CalendarImportIn(access_token="t", days=30), user=dict(ROLAND)))
        card = run(self.db["cards"].find_one({"ms_event_id": "m1"}, {"_id": 0}))
        self.assertEqual(server.ensure_aware_utc(card["due_date"]), datetime(2026, 10, 20, 12, tzinfo=timezone.utc))
        self.assertIs(card["time_set"], False)
        self.assertEqual(card["reminder_minutes"], 0)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class APassportExpiry(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        run(self.db["vault"].insert_one({"doc_id": "d1", "family_id": "fam1", "title": "Passport",
                                         "created_by_user_id": "u_r", "visibility": "family"}))

    def test_set_as_a_day_reads_as_that_day_in_montreal_and_paris(self):
        out = run(server.set_vault_expiry("d1", expiry_date="2030-05-14", user=dict(ROLAND), database=self.db))
        self.assertEqual(out["expiry_date"], "2030-05-14T12:00:00+00:00")
        stored = server.ensure_aware_utc(run(self.db["vault"].find_one({"doc_id": "d1"}, {"_id": 0}))["expiry_date"])
        for zone in (MONTREAL, PARIS, HONOLULU):
            self.assertEqual(stored.astimezone(zone).date().isoformat(), "2030-05-14", str(zone))


if __name__ == "__main__":
    unittest.main()
