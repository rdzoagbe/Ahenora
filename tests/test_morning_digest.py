"""The morning digest, sent from the server instead of scheduled on the phone.

Reported as "I didn't get notifications from my agenda this morning and I had
appointments". It was a single one-shot LOCAL notification, set for TOMORROW
07:30, and only when somebody opened the Feed. So it arrived only on days
following a day the app had been opened, and carried the agenda as it looked at
that moment — a local notification cannot know about anything added afterwards.

What is held here: it fires at 07:30 in the person's OWN zone, once per local
day, only to people who can receive it, and it never says "0 things today".

Run with:  python3 -m unittest discover -s tests -v
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
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase
    from zoneinfo import ZoneInfo


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhenItFires(unittest.TestCase):
    def test_before_half_seven_it_waits(self):
        local = datetime(2026, 8, 30, 6, 59, tzinfo=ZoneInfo("Europe/Paris"))
        self.assertFalse(server.digest_is_due(local))

    def test_at_half_seven_it_goes(self):
        local = datetime(2026, 8, 30, 7, 30, tzinfo=ZoneInfo("Europe/Paris"))
        self.assertTrue(server.digest_is_due(local))

    def test_a_missed_pass_is_still_worth_saying_shortly_after(self):
        """A deploy or a restart must not cost somebody their morning."""
        local = datetime(2026, 8, 30, 8, 15, tzinfo=ZoneInfo("Europe/Paris"))
        self.assertTrue(server.digest_is_due(local))

    def test_but_not_hours_later(self):
        """A "today" digest at teatime is worse than none."""
        local = datetime(2026, 8, 30, 16, 0, tzinfo=ZoneInfo("Europe/Paris"))
        self.assertFalse(server.digest_is_due(local))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatItSays(unittest.TestCase):
    def test_it_counts_and_lists(self):
        self.assertEqual(
            server.digest_body(["Bins", "Dentist"], "thing today", "things today"),
            "2 things today: Bins · Dentist")

    def test_one_is_singular(self):
        self.assertEqual(
            server.digest_body(["Bins"], "thing today", "things today"),
            "1 thing today: Bins")

    def test_a_long_day_is_summarised(self):
        body = server.digest_body(["A", "B", "C", "D", "E"], "thing today", "things today")
        self.assertEqual(body, "5 things today: A · B · C +2")

    def test_nothing_on_means_nothing_to_send(self):
        self.assertIsNone(server.digest_body([], "thing today", "things today"))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheDigestPass(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.sent = []

        async def fake_push(database, user_id, title, body, data, **kw):
            self.sent.append({"user_id": user_id, "title": title, "body": body,
                              "type": data.get("type"),
                              "channel": kw.get("channel")})
        self._push = server.send_push_to_user
        server.send_push_to_user = fake_push
        # 07:35 in Paris.
        self.now = datetime(2026, 8, 30, 5, 35, tzinfo=timezone.utc)

    def tearDown(self):
        server.send_push_to_user = self._push

    def seed(self, tz="Europe/Paris", due_in_hours=4, active=True, settings=None):
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u1", "family_id": "fam1", "email": "r@x.test"}))
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"token": "t1", "user_id": "u1", "family_id": "fam1",
             "active": active, "timezone": tz}))
        if due_in_hours is not None:
            asyncio.run(self.db["cards"].insert_one(
                {"card_id": "c1", "family_id": "fam1", "status": "OPEN",
                 "title": "Dentist", "due_date": self.now + timedelta(hours=due_in_hours)}))
        if settings is not None:
            asyncio.run(self.db["notification_settings"].insert_one(
                {"user_id": "u1", **settings}))

    def run_pass(self):
        return asyncio.run(server.send_morning_digests(self.db, self.now))

    def test_it_arrives_without_anyone_opening_the_app(self):
        """The whole point. No client involvement anywhere in this test."""
        self.seed()
        self.assertEqual(self.run_pass(), 1)
        self.assertIn("Dentist", self.sent[0]["body"])

    def test_it_is_sent_once_per_local_day(self):
        """The loop ticks every minute. A digest every minute would get the app
        muted by lunchtime."""
        self.seed()
        self.assertEqual(self.run_pass(), 1)
        self.assertEqual(self.run_pass(), 0)
        self.assertEqual(len(self.sent), 1)

    def test_a_quiet_day_never_says_zero_things(self):
        """"0 things today" is noise, and noise is how people turn alerts off."""
        self.seed(due_in_hours=None)
        self.run_pass()
        for msg in self.sent:
            self.assertNotIn("0 ", msg["body"])

    def test_a_quiet_day_sends_the_tip_instead(self):
        """The tip used to be scheduled on the phone for 07:30 — every day,
        regardless — while the server sent the digest at 07:30 too. A busy day
        produced both, under the same title. Only the server knows whether a
        day is actually quiet, so the tip is decided here."""
        self.seed(due_in_hours=None)
        self.assertEqual(self.run_pass(), 1)
        self.assertEqual(self.sent[0]["type"], "daily_tip")
        self.assertEqual(self.sent[0]["channel"], "daily-tips")

    def test_a_busy_day_sends_the_digest_and_not_the_tip(self):
        """The exact collision: never both."""
        self.seed()
        self.assertEqual(self.run_pass(), 1)
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0]["type"], "morning_digest")

    def test_tomorrow_is_not_today(self):
        self.seed(due_in_hours=30)
        self.run_pass()
        self.assertEqual(self.sent[0]["type"], "daily_tip")

    def test_somebody_in_another_zone_waits_for_their_own_morning(self):
        """05:35 UTC is 07:35 in Paris and 00:35 in New York."""
        self.seed(tz="America/New_York")
        self.assertEqual(self.run_pass(), 0)

    def test_turning_reminders_off_turns_this_off(self):
        self.seed(settings={"card_reminders": False,
                            "created_at": self.now - timedelta(days=2),
                            "updated_at": self.now})
        self.assertEqual(self.run_pass(), 0)

    def test_a_device_that_logged_out_is_not_written_to(self):
        self.seed(active=False)
        self.assertEqual(self.run_pass(), 0)

    def test_an_unknown_zone_falls_back_rather_than_raising(self):
        """A bad zone string must not take down everyone later in the pass."""
        self.seed(tz="Mars/Olympus_Mons")
        self.assertEqual(self.run_pass(), 1)

    def test_one_bad_user_does_not_stop_the_others(self):
        self.seed()
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"token": "t2", "user_id": "u_ghost", "active": True,
             "timezone": "Europe/Paris"}))
        self.assertEqual(self.run_pass(), 1)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheZoneIsChecked(unittest.TestCase):
    def test_a_real_zone_is_kept(self):
        self.assertEqual(server._valid_timezone("Europe/Paris"), "Europe/Paris")

    def test_nonsense_is_dropped_rather_than_stored(self):
        for bad in ("Mars/Olympus_Mons", "", "   ", None, "'; DROP TABLE"):
            with self.subTest(value=bad):
                self.assertIsNone(server._valid_timezone(bad))


if __name__ == "__main__":
    unittest.main()
