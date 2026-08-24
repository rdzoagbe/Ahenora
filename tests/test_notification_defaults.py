"""A family that grants notification permission should hear from the app.

Both alert settings were written off by default, so a co-parent could assign the
school run and the other parent would find out days later by noticing their own
name in the app. That is the exact failure the product exists to prevent, and it
was the shipped default. These tests hold the new rule in place - and, just as
importantly, hold the other half: someone who deliberately turns an alert OFF
stays off.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AlertDefaults(unittest.TestCase):
    def test_no_settings_at_all_means_yes(self):
        # The overwhelmingly common case: nobody opens the notifications screen.
        self.assertTrue(server.alerts_enabled(None, "new_card_alerts"))
        self.assertTrue(server.alerts_enabled({}, "card_reminders"))

    def test_a_row_the_user_never_edited_means_yes(self):
        # These rows were written BY THE SERVER with everything off. The user
        # never chose silence; the app chose it for them.
        now = server.utcnow()
        row = {"card_reminders": False, "new_card_alerts": False,
               "created_at": now, "updated_at": now}
        self.assertTrue(server.alerts_enabled(row, "new_card_alerts"))
        self.assertTrue(server.alerts_enabled(row, "card_reminders"))

    def test_turning_an_alert_off_is_obeyed(self):
        # The half that matters just as much: a real choice is never overridden.
        now = server.utcnow()
        row = {"card_reminders": True, "new_card_alerts": False,
               "created_at": now, "updated_at": now + timedelta(minutes=5)}
        self.assertFalse(server.alerts_enabled(row, "new_card_alerts"))
        self.assertTrue(server.alerts_enabled(row, "card_reminders"))

    def test_the_screen_shows_what_the_server_will_do(self):
        # A settings screen reading "off" while alerts arrive - or "on" while
        # nothing does - is worse than either behaviour on its own.
        now = server.utcnow()
        untouched = {"card_reminders": False, "new_card_alerts": False,
                     "created_at": now, "updated_at": now}
        shown = server.public_notification_settings(untouched)
        self.assertTrue(shown["new_card_alerts"])
        self.assertTrue(shown["card_reminders"])

        chosen = {"card_reminders": False, "new_card_alerts": False,
                  "created_at": now, "updated_at": now + timedelta(minutes=1)}
        self.assertFalse(server.public_notification_settings(chosen)["new_card_alerts"])

    def test_a_fresh_row_is_written_on(self):
        db = FakeDatabase()
        self._swap(db)
        try:
            row = asyncio.run(server.get_notification_settings_doc("u_new"))
        finally:
            self._restore()
        self.assertTrue(row["new_card_alerts"])
        self.assertTrue(row["card_reminders"])

    def _swap(self, db):
        self._get_db = server.get_db
        server.get_db = lambda: db

    def _restore(self):
        server.get_db = self._get_db


if __name__ == "__main__":
    unittest.main()
