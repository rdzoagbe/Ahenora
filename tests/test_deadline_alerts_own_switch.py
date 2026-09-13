"""Passport and vaccination alerts have their own switch.

Six wall-clock jobs shared one preference, `card_reminders`: the morning
digest, the dinner reminder, the Sunday recap, tomorrow's calendar, the
allowance reminder — and the due-dates alert, which is a passport expiring and
a vaccination falling due.

Five of those are nudges about today. The sixth is a deadline with money and a
cancelled holiday behind it. A parent who switches off what reads as "task
reminders" because the chore nagging annoys them has not asked to stop hearing
that their child's passport expires in a month, and nothing anywhere told them
that is what the switch did.

So the due-dates job moves to `deadline_alerts`, which:

  * defaults to on, like every other preference here — and because
    `alerts_enabled` treats an absent key as yes, every household that already
    exists keeps the alert without touching anything;
  * is genuinely independent, in BOTH directions. Turning off chore reminders
    must not silence it, and turning it off must not silence the digest. A
    one-way test would pass on an implementation that simply renamed the key.

Run with:  python3 -m unittest discover -s tests -v
"""
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

NUDGE_JOBS = {"morning_digest", "dinner_reminder", "sunday_recap",
              "calendar_nightly", "allowance_reminder"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheSwitch(unittest.TestCase):
    def job(self, key):
        return next(j for j in server.DAILY_PUSH_JOBS if j["key"] == key)

    def test_the_due_dates_alert_has_its_own_preference(self):
        self.assertEqual(self.job("due_dates")["pref"], "deadline_alerts")

    def test_the_daily_nudges_keep_theirs(self):
        # The other five ARE about today, and sharing one switch is right for
        # them. Moving them too would be a different change with a different
        # argument, and this one should not quietly make it.
        for key in NUDGE_JOBS:
            self.assertEqual(self.job(key)["pref"], "card_reminders", key)

    def test_every_job_names_a_preference_the_server_can_read(self):
        # A misspelled pref key is a daily job that silently never fires: the
        # lookup falls through to a default and nobody finds out.
        known = set(server.public_notification_settings({}).keys()) - {"updated_at"}
        for job in server.DAILY_PUSH_JOBS:
            self.assertIn(job["pref"], known, job["key"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatTheScreenShows(unittest.TestCase):
    def test_the_new_switch_is_reported(self):
        # The screen must show what the server will actually do — a preference
        # the server obeys and never reports is one nobody can turn back on.
        self.assertIn("deadline_alerts", server.public_notification_settings({}))

    def test_a_household_that_already_exists_keeps_the_alert(self):
        # The key is absent from every row written before today. alerts_enabled
        # treats absent as yes, so nobody loses a passport reminder to this
        # change — which would be the change causing the exact harm it exists
        # to prevent.
        old_row = {"user_id": "u1", "card_reminders": False,
                   "created_at": "2026-01-01", "updated_at": "2026-02-01"}
        self.assertTrue(server.alerts_enabled(old_row, "deadline_alerts"))

    def test_turning_off_chore_reminders_no_longer_silences_it(self):
        # The whole point, stated as the user's own action.
        row = {"user_id": "u1", "card_reminders": False, "deadline_alerts": True,
               "created_at": "2026-01-01", "updated_at": "2026-02-01"}
        self.assertFalse(server.alerts_enabled(row, "card_reminders"))
        self.assertTrue(server.alerts_enabled(row, "deadline_alerts"))

    def test_and_it_can_still_be_switched_off_on_its_own(self):
        # Independent in both directions. Without this, an implementation that
        # merely renamed the key would pass everything above.
        row = {"user_id": "u1", "card_reminders": True, "deadline_alerts": False,
               "created_at": "2026-01-01", "updated_at": "2026-02-01"}
        self.assertFalse(server.alerts_enabled(row, "deadline_alerts"))
        self.assertTrue(server.alerts_enabled(row, "card_reminders"))

    def test_the_patch_model_accepts_it(self):
        # Reported by the GET and refused by the PUT would mean a switch that
        # renders, moves, and never saves.
        self.assertIn("deadline_alerts", server.NotificationPrefsIn.model_fields)


if __name__ == "__main__":
    unittest.main()
