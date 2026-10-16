"""The calendar import reads every calendar, every page, and keeps an all-day
event on its own day.

Roland, 2026-10-16: "items put in the calendar for the whole day don't appear
in the app — an anniversary put for the whole day was not imported, yet it
says all has been properly imported." The import read one page (100 events)
of the primary calendar only. Anything in a shared family calendar, in
Google's own birthdays calendar, or past the hundredth event of the month was
never fetched — and the summary, counting only what it had fetched, said the
sync had gone fine.

These tests stand in for the providers by URL (server._http_get_json), so a
second page or a second calendar that is never asked for is a failure here.

Run with:  python3 -m unittest tests.test_calendar_import_reads_every_calendar -v
"""
import asyncio
import os
import sys
import unittest
import urllib.parse
from datetime import timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    from fastapi import HTTPException
    import server
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class _Provider:
    """Answers by URL and remembers what was asked."""

    def __init__(self, routes):
        self.routes = routes      # callable(url) -> dict, or _UpstreamHTTPError to raise
        self.asked = []

    def __call__(self, url, headers, timeout=20):
        self.asked.append(url)
        for match, answer in self.routes:
            if match(url):
                if isinstance(answer, Exception):
                    raise answer
                return answer(url) if callable(answer) else answer
        raise AssertionError(f"unexpected request: {url}")


def _q(url):
    return urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class GoogleReadsEverything(unittest.TestCase):
    def setUp(self):
        self._orig = server._http_get_json

    def tearDown(self):
        server._http_get_json = self._orig

    def test_a_second_page_is_asked_for(self):
        page1 = {"items": [{"id": f"e{i}", "iCalUID": f"u{i}"} for i in range(250)], "nextPageToken": "p2"}
        page2 = {"items": [{"id": "e250", "iCalUID": "u250", "summary": "Anniversaire"}]}
        provider = _Provider([
            (lambda u: "calendarList" in u, server._UpstreamHTTPError(403, "insufficient scope")),
            (lambda u: "/calendars/primary/events" in u and "pageToken" not in u, page1),
            (lambda u: "/calendars/primary/events" in u and _q(u).get("pageToken") == ["p2"], page2),
            (lambda u: "addressbook" in u, {"items": []}),
        ])
        server._http_get_json = provider
        events = run(server._fetch_google_calendar_events("tok", 30))
        self.assertEqual(len(events), 251)
        self.assertEqual(events[-1]["summary"], "Anniversaire")

    def test_the_birthdays_calendar_is_read_even_without_the_list_scope(self):
        provider = _Provider([
            (lambda u: "calendarList" in u, server._UpstreamHTTPError(403, "insufficient scope")),
            (lambda u: "/calendars/primary/events" in u, {"items": [{"id": "d1", "iCalUID": "u-d1", "summary": "Dentist"}]}),
            (lambda u: "addressbook" in u, {"items": [
                {"id": "b1", "iCalUID": "u-b1", "summary": "Efua's birthday", "eventType": "birthday",
                 "start": {"date": "2026-11-03"}}]}),
        ])
        server._http_get_json = provider
        events = run(server._fetch_google_calendar_events("tok", 30))
        self.assertEqual([e["summary"] for e in events], ["Dentist", "Efua's birthday"])
        self.assertTrue(any("addressbook%23contacts%40group.v.calendar.google.com" in u for u in provider.asked),
                        "the birthdays calendar is asked for by its id")

    def test_every_ticked_calendar_is_read_when_the_list_is_allowed(self):
        provider = _Provider([
            (lambda u: "calendarList" in u, {"items": [
                {"id": "roland@gmail.com", "primary": True, "selected": True},
                {"id": "family@group.calendar.google.com", "selected": True},
                {"id": "work@group.calendar.google.com", "selected": False},
                {"id": "old@group.calendar.google.com", "selected": True, "deleted": True},
            ]}),
            (lambda u: "/calendars/primary/events" in u, {"items": [{"id": "p1", "iCalUID": "u-p1"}]}),
            (lambda u: "family%40group" in u, {"items": [{"id": "f1", "iCalUID": "u-f1", "summary": "Wedding anniversary", "start": {"date": "2026-10-20"}}]}),
            (lambda u: "addressbook" in u, {"items": []}),
        ])
        server._http_get_json = provider
        events = run(server._fetch_google_calendar_events("tok", 30))
        self.assertEqual({e["id"] for e in events}, {"p1", "f1"})
        self.assertFalse(any("work%40group" in u for u in provider.asked), "an unticked calendar is left alone")
        self.assertFalse(any("old%40group" in u for u in provider.asked), "a deleted calendar is left alone")

    def test_the_same_invitation_in_two_calendars_counts_once(self):
        provider = _Provider([
            (lambda u: "calendarList" in u, {"items": [{"id": "shared@group.calendar.google.com", "selected": True}]}),
            (lambda u: "/calendars/primary/events" in u, {"items": [{"id": "a", "iCalUID": "same@google.com"}]}),
            (lambda u: "shared%40group" in u, {"items": [{"id": "b", "iCalUID": "same@google.com"}]}),
            (lambda u: "addressbook" in u, server._UpstreamHTTPError(404, "not found")),
        ])
        server._http_get_json = provider
        events = run(server._fetch_google_calendar_events("tok", 30))
        self.assertEqual([e["id"] for e in events], ["a"])

    def test_a_refused_primary_calendar_is_still_a_clear_error(self):
        provider = _Provider([
            (lambda u: "calendarList" in u, server._UpstreamHTTPError(403, "no")),
            (lambda u: "/calendars/primary/events" in u, server._UpstreamHTTPError(401, "expired")),
        ])
        server._http_get_json = provider
        with self.assertRaises(HTTPException) as ctx:
            run(server._fetch_google_calendar_events("tok", 30))
        self.assertEqual(ctx.exception.status_code, 400, "never our own 401: that signs the person out")

    def test_an_all_day_event_keeps_its_day(self):
        start = server._parse_google_event_start({"start": {"date": "2026-10-20"}})
        self.assertEqual((start.year, start.month, start.day, start.hour, start.tzinfo), (2026, 10, 20, 9, timezone.utc))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class OutlookReadsEverything(unittest.TestCase):
    def setUp(self):
        self._orig = server._http_get_json

    def tearDown(self):
        server._http_get_json = self._orig

    def test_every_calendar_and_every_page(self):
        provider = _Provider([
            (lambda u: u.endswith("me/calendars?$select=id,name,isDefaultCalendar&$top=50"),
             {"value": [{"id": "fam", "name": "Family"}, {"id": "main", "name": "Calendar", "isDefaultCalendar": True}]}),
            (lambda u: "/calendars/main/calendarView" in u and "skip" not in u,
             {"value": [{"id": "m1", "iCalUId": "u-m1"}], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars/main/calendarView?skip=1"}),
            (lambda u: "/calendars/main/calendarView?skip=1" in u, {"value": [{"id": "m2", "iCalUId": "u-m2"}]}),
            (lambda u: "/calendars/fam/calendarView" in u,
             {"value": [{"id": "f1", "iCalUId": "u-f1", "subject": "Wedding anniversary", "isAllDay": True,
                         "start": {"dateTime": "2026-10-20T00:00:00.0000000", "timeZone": "UTC"}}]}),
        ])
        server._http_get_json = provider
        events = run(server._fetch_microsoft_calendar_events("tok", 30))
        self.assertEqual([e["id"] for e in events], ["m1", "m2", "f1"], "default calendar first, then the rest")
        self.assertIn("isAllDay", provider.asked[1], "the all-day flag is asked for")

    def test_without_the_calendar_list_the_default_calendar_is_read_as_before(self):
        provider = _Provider([
            (lambda u: "me/calendars?" in u, server._UpstreamHTTPError(403, "no")),
            (lambda u: "me/calendarView?" in u, {"value": [{"id": "m1", "iCalUId": "u-m1"}]}),
        ])
        server._http_get_json = provider
        events = run(server._fetch_microsoft_calendar_events("tok", 30))
        self.assertEqual([e["id"] for e in events], ["m1"])

    def test_an_all_day_event_keeps_its_day_everywhere(self):
        start = server._parse_ms_event_start({"isAllDay": True, "start": {"dateTime": "2026-10-20T00:00:00.0000000", "timeZone": "UTC"}})
        self.assertEqual((start.year, start.month, start.day, start.hour), (2026, 10, 20, 9),
                         "midnight UTC is the evening before west of Greenwich; 09:00 UTC is the same day everywhere")
        timed = server._parse_ms_event_start({"start": {"dateTime": "2026-10-20T14:30:00.0000000", "timeZone": "UTC"}})
        self.assertEqual((timed.hour, timed.minute), (14, 30), "a timed event keeps its time")


if __name__ == "__main__":
    unittest.main()
