"""A recurring card completed late must not come straight back.

Reported from the app: "I marked this done and it keeps coming back when I
refresh the feed." The next occurrence was one interval after the OLD due
date, which for anything finished late is still in the past.
"""
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


if __name__ == "__main__":
    unittest.main()
