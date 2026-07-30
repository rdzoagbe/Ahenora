"""Tests for calendar import: new events land, changed events move, cancelled
events go away.

The field bug these pin down: an already-imported event was skipped outright,
so a rescheduled meeting kept its old time in the app forever — "sync" only
ever discovered new events.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

# CI's backend-checks job runs without the backend dependencies installed;
# these tests skip there, the same way every other server-importing suite does.
try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server

USER = {"user_id": "u1", "family_id": "fam1", "name": "Roland", "role": "Parent"}


def gevent(event_id="ev1", summary="Dentist", when="2026-08-04T10:00:00Z", **extra):
    base = {"id": event_id, "summary": summary, "start": {"dateTime": when}}
    base.update(extra)
    return base


class FakeCards:
    def __init__(self, rows=None):
        self.rows = [dict(r) for r in (rows or [])]
        self.updates = []

    def _matches(self, row, query):
        return all(row.get(k) == v for k, v in query.items())

    async def find_one(self, query, *a, **k):
        for r in self.rows:
            if self._matches(r, query):
                return dict(r)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))

    async def update_one(self, query, update):
        self.updates.append((query, update))
        for r in self.rows:
            if self._matches(r, query):
                r.update(update.get("$set", {}))
                return SimpleNamespace(matched_count=1)
        return SimpleNamespace(matched_count=0)

    async def delete_one(self, query):
        for i, r in enumerate(self.rows):
            if self._matches(r, query):
                del self.rows[i]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _Cursor:
    def sort(self, *a, **k):
        return self

    def __aiter__(self):
        async def gen():
            return
            yield
        return gen()


class FakeContacts:
    async def update_one(self, *a, **k):
        return None

    def find(self, *a, **k):
        return _Cursor()


class FakeDB:
    def __init__(self, cards):
        self.cards = cards

    def __getitem__(self, name):
        if name == "cards":
            return self.cards
        return FakeContacts()


def existing_card(event_id="ev1", title="Dentist", when="2026-08-04T10:00:00Z",
                  status="OPEN", shared=False, provider="google"):
    key = "google_event_id" if provider == "google" else "ms_event_id"
    return {
        "card_id": "c1", "family_id": "fam1", "title": title,
        # Stored the way Mongo hands it back: naive UTC.
        "due_date": datetime.fromisoformat(when.replace("Z", "+00:00")).replace(tzinfo=None),
        "status": status, "shared": shared, key: event_id,
    }


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class GoogleImport(unittest.TestCase):
    def setUp(self):
        self._orig = server._fetch_google_calendar_events

    def tearDown(self):
        server._fetch_google_calendar_events = self._orig

    # The handler reads the db via get_db(); patch it per call.
    def run_import2(self, events, cards):
        async def fake_fetch(token, days):
            return events
        server._fetch_google_calendar_events = fake_fetch
        db = FakeDB(cards)
        orig_get_db = server.get_db
        server.get_db = lambda: db
        try:
            payload = server.CalendarImportIn(access_token="tok", days=30)
            result = asyncio.run(server.import_google_calendar(payload, user=dict(USER)))
        finally:
            server.get_db = orig_get_db
        return result, db

    def test_a_new_event_becomes_a_card(self):
        result, db = self.run_import2([gevent()], FakeCards())
        self.assertEqual(result["imported"], 1)
        self.assertEqual(db.cards.rows[0]["google_event_id"], "ev1")

    def test_an_unchanged_event_is_skipped_not_duplicated(self):
        result, db = self.run_import2([gevent()], FakeCards([existing_card()]))
        self.assertEqual(result["imported"], 0)
        self.assertEqual(result["updated"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(len(db.cards.rows), 1)

    def test_a_rescheduled_meeting_moves_here_too(self):
        moved = gevent(when="2026-08-05T15:30:00Z")
        result, db = self.run_import2([moved], FakeCards([existing_card()]))
        self.assertEqual(result["updated"], 1)
        self.assertEqual(
            db.cards.rows[0]["due_date"],
            datetime(2026, 8, 5, 15, 30, tzinfo=timezone.utc),
        )

    def test_a_renamed_meeting_renames_its_card(self):
        renamed = gevent(summary="Dentist — moved to Dr. K")
        result, db = self.run_import2([renamed], FakeCards([existing_card()]))
        self.assertEqual(result["updated"], 1)
        self.assertEqual(db.cards.rows[0]["title"], "Dentist — moved to Dr. K")

    def test_an_update_never_touches_status(self):
        moved = gevent(when="2026-08-05T15:30:00Z")
        _, db = self.run_import2([moved], FakeCards([existing_card(status="DONE")]))
        self.assertEqual(db.cards.rows[0]["status"], "DONE")

    def test_a_cancelled_meeting_removes_its_open_card(self):
        cancelled = {"id": "ev1", "status": "cancelled"}
        result, db = self.run_import2([cancelled], FakeCards([existing_card()]))
        self.assertEqual(result["removed"], 1)
        self.assertEqual(db.cards.rows, [])

    def test_a_cancelled_meeting_leaves_done_and_shared_cards_alone(self):
        cancelled = {"id": "ev1", "status": "cancelled"}
        for card in [existing_card(status="DONE"), existing_card(shared=True)]:
            result, db = self.run_import2([cancelled], FakeCards([card]))
            self.assertEqual(result["removed"], 0, card)
            self.assertEqual(len(db.cards.rows), 1, card)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class MicrosoftImport(unittest.TestCase):
    """The Graph mirror gets the same three behaviours."""

    def setUp(self):
        self._orig = server._fetch_microsoft_calendar_events

    def tearDown(self):
        server._fetch_microsoft_calendar_events = self._orig

    def run_import(self, events, cards):
        async def fake_fetch(token, days):
            return events
        server._fetch_microsoft_calendar_events = fake_fetch
        db = FakeDB(cards)
        orig_get_db = server.get_db
        server.get_db = lambda: db
        try:
            payload = server.CalendarImportIn(access_token="tok", days=30)
            result = asyncio.run(server.import_microsoft_calendar(payload, user=dict(USER)))
        finally:
            server.get_db = orig_get_db
        return result, db

    @staticmethod
    def msevent(event_id="ev1", subject="Dentist", when="2026-08-04T10:00:00Z", **extra):
        base = {"id": event_id, "subject": subject, "start": {"dateTime": when.replace("Z", "")}}
        base.update(extra)
        return base

    def test_a_rescheduled_meeting_moves_here_too(self):
        moved = self.msevent(when="2026-08-05T15:30:00Z")
        result, db = self.run_import([moved], FakeCards([existing_card(provider="ms")]))
        self.assertEqual(result["updated"], 1)
        self.assertEqual(
            db.cards.rows[0]["due_date"],
            datetime(2026, 8, 5, 15, 30, tzinfo=timezone.utc),
        )

    def test_a_cancelled_meeting_removes_its_open_card(self):
        cancelled = {"id": "ev1", "isCancelled": True}
        result, db = self.run_import([cancelled], FakeCards([existing_card(provider="ms")]))
        self.assertEqual(result["removed"], 1)
        self.assertEqual(db.cards.rows, [])


if __name__ == "__main__":
    unittest.main()
