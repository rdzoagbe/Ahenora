"""A recurring card completed late must not come straight back.

Reported from the app: "I marked this done and it keeps coming back when I
refresh the feed." The next occurrence was one interval after the OLD due
date, which for anything finished late is still in the past.
"""
import asyncio
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class RecurrenceRollForward(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 8, 28, 15, 0, tzinfo=timezone.utc)

    def test_a_daily_card_three_weeks_late_lands_in_the_future(self):
        overdue = self.now - timedelta(days=21)
        nxt = server.advance_due_date(overdue, "daily", after=self.now)
        self.assertGreater(nxt, self.now)

    def test_completing_it_again_does_not_reproduce_the_past(self):
        """The loop: each completion must move the card forward, not sideways."""
        due = self.now - timedelta(days=21)
        for _ in range(3):
            due = server.advance_due_date(due, "daily", after=self.now)
            self.assertGreater(due, self.now)

    def test_the_time_of_day_is_preserved(self):
        """A 07:30 chore stays a 07:30 chore, however late it was finished."""
        overdue = datetime(2026, 8, 1, 7, 30, tzinfo=timezone.utc)
        nxt = server.advance_due_date(overdue, "daily", after=self.now)
        self.assertEqual((nxt.hour, nxt.minute), (7, 30))

    def test_a_card_due_in_the_future_still_advances_exactly_one_step(self):
        """Completing early must not skip a month of occurrences."""
        future = self.now + timedelta(days=2)
        nxt = server.advance_due_date(future, "daily", after=self.now)
        self.assertEqual(nxt, future + timedelta(days=1))

    def test_weekly_keeps_its_weekday(self):
        overdue = self.now - timedelta(weeks=5)
        nxt = server.advance_due_date(overdue, "weekly", after=self.now)
        self.assertGreater(nxt, self.now)
        self.assertEqual(nxt.weekday(), overdue.weekday())

    def test_monthly_and_yearly_roll_forward_too(self):
        for rule, back in (("monthly", timedelta(days=200)), ("yearly", timedelta(days=800))):
            nxt = server.advance_due_date(self.now - back, rule, after=self.now)
            self.assertGreater(nxt, self.now, rule)

    def test_an_unknown_recurrence_cannot_spin_forever(self):
        """advance_due_date returns dt unchanged for anything it does not know.
        Looping on that would hang the request that completes the card."""
        nxt = server.advance_due_date(self.now - timedelta(days=99), "fortnightly",
                                      after=self.now)
        self.assertIsInstance(nxt, datetime)

    def test_without_after_the_old_single_step_behaviour_is_unchanged(self):
        d = datetime(2026, 3, 1, 9, 0, tzinfo=timezone.utc)
        self.assertEqual(server.advance_due_date(d, "daily"), d + timedelta(days=1))



@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheAppIsToldWhenTheNextOneIs(unittest.TestCase):
    """Ticking a recurring chore spawns its replacement immediately.

    From the outside that is indistinguishable from the tick not working: the
    row disappears and an identical one appears carrying a new date. It was
    reported twice as "a task I mark as done keeps coming back".

    Hiding the replacement was tried and was wrong — it removed the ability to
    finish a chore before its date, which is a thing people do. The card is not
    the problem. The silence is. So completing a recurring card now reports
    when the next one falls, and the app says it.
    """

    def setUp(self):
        self._get_db = server.get_db

    def tearDown(self):
        server.get_db = self._get_db

    def _complete(self, recurrence, due_days_ago=1):
        due = server.utcnow() - timedelta(days=due_days_ago)
        card = {"card_id": "c1", "family_id": "fam1", "type": "TASK",
                "title": "Bins out", "status": "OPEN", "recurrence": recurrence,
                "due_date": due, "assignee": "Roland", "shared": False,
                "source": "MANUAL", "created_at": server.utcnow()}
        db = FakeDatabase()
        asyncio.run(db["cards"].insert_one(dict(card)))
        asyncio.run(db["family_members"].insert_one(
            {"family_id": "fam1", "member_id": "m1", "name": "Roland", "role": "Parent"}))
        server.get_db = lambda: db
        user = {"user_id": "u1", "family_id": "fam1", "name": "Roland",
                "email": "r@x.test"}
        payload = server.CardPatchIn(status="DONE")
        return asyncio.run(server.update_card("c1", payload, user=user)), db

    def test_completing_a_recurring_chore_reports_when_the_next_one_is(self):
        out, db = self._complete("weekly")
        self.assertIn("next_occurrence", out)
        when = server.parse_dt(out["next_occurrence"])
        self.assertGreater(server.ensure_aware_utc(when), server.utcnow())

    def test_the_reported_date_is_the_one_actually_created(self):
        """The message must not be a second opinion. If it says Thursday, the
        card sitting in the household has to be Thursday."""
        out, db = self._complete("weekly")
        rows = asyncio.run(self._open_cards(db))
        self.assertEqual(len(rows), 1)
        spawned = server.ensure_aware_utc(rows[0]["due_date"])
        self.assertEqual(spawned, server.ensure_aware_utc(server.parse_dt(out["next_occurrence"])))

    async def _open_cards(self, db):
        return [c async for c in db["cards"].find({"status": "OPEN"}, {"_id": 0})]

    def test_a_one_off_chore_reports_nothing(self):
        """Nothing recurs, so there is nothing to say and the app stays quiet."""
        out, _ = self._complete("none")
        self.assertNotIn("next_occurrence", out)

    def test_every_recurrence_reports(self):
        for recurrence in ("daily", "weekly", "monthly", "yearly"):
            with self.subTest(recurrence=recurrence):
                out, _ = self._complete(recurrence)
                self.assertIn("next_occurrence", out)


if __name__ == "__main__":
    unittest.main()
