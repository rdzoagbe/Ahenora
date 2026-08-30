"""The four other wall-clock reminders, moved off the phone and onto the server.

The morning digest was not alone. The dinner nudge, the nightly agenda, the
Sunday recap and the allowance heads-up were all one-shot LOCAL notifications
too, and each was only (re)scheduled while somebody had the app open on the
screen that owns it — the Calendar tab for the nightly agenda, the Kids tab for
allowances, the Feed for the rest. Miss the screen, miss the reminder; and the
one that did get scheduled carried whatever the data looked like at that
moment.

What is held here: each fires at its own local wall-clock time, once per local
day, in the person's language, only when there is something real to say.

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

PARIS = "Europe/Paris"


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheJobTable(unittest.TestCase):
    def test_every_reminder_that_left_the_phone_is_here(self):
        self.assertEqual(
            [j["key"] for j in server.DAILY_PUSH_JOBS],
            ["morning_digest", "dinner_reminder", "sunday_recap",
             "calendar_nightly", "allowance_reminder"])

    def test_each_job_claims_its_own_day(self):
        """A quiet dinner must not silence tomorrow's digest, so no two jobs may
        share the field that records "already sent today"."""
        claims = [j["claim"] for j in server.DAILY_PUSH_JOBS]
        self.assertEqual(len(claims), len(set(claims)))

    def test_every_string_exists_in_every_language(self):
        """A missing key would raise inside the pass and silence the rest of it."""
        english = set(server.PUSH_I18N["en"])
        for lang in ("fr", "es", "de"):
            self.assertEqual(english - set(server.PUSH_I18N[lang]), set(),
                             f"{lang} is missing push strings")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheSlot(unittest.TestCase):
    def at(self, hour, minute=0):
        return datetime(2026, 8, 30, hour, minute, tzinfo=ZoneInfo(PARIS))

    def test_it_waits_for_the_hour(self):
        self.assertFalse(server.local_slot_is_due(self.at(17, 29), 17, 30, 120))

    def test_it_goes_on_the_hour(self):
        self.assertTrue(server.local_slot_is_due(self.at(17, 30), 17, 30, 120))

    def test_a_missed_pass_still_lands_inside_the_grace_window(self):
        self.assertTrue(server.local_slot_is_due(self.at(18, 30), 17, 30, 120))

    def test_but_a_dinner_nudge_at_bedtime_is_worse_than_none(self):
        self.assertFalse(server.local_slot_is_due(self.at(22, 0), 17, 30, 120))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class PassBase(unittest.TestCase):
    """A single reachable adult in Paris, and a fake push sink."""

    # Sunday 30 August 2026 is a Sunday, which the recap job needs.
    def setUp(self):
        self.db = FakeDatabase()
        self.sent = []

        async def fake_push(database, user_id, title, body, data, **kw):
            self.sent.append({"user_id": user_id, "title": title,
                              "body": body, "type": data.get("type")})
        self._push = server.send_push_to_user
        server.send_push_to_user = fake_push

    def tearDown(self):
        server.send_push_to_user = self._push

    def seed_user(self, language="en", is_teen=False, tz=PARIS):
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u1", "family_id": "fam1", "email": "r@x.test",
             "language": language, "is_teen": is_teen}))
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"token": "t1", "user_id": "u1", "family_id": "fam1",
             "active": True, "timezone": tz}))

    def job(self, key):
        return next(j for j in server.DAILY_PUSH_JOBS if j["key"] == key)

    def run_job(self, key, now):
        return asyncio.run(server.run_daily_local_push(self.db, self.job(key), now))

    def utc(self, hour, minute=0, day=30):
        """A local Paris wall-clock time expressed as the UTC instant it is."""
        local = datetime(2026, 8, day, hour, minute, tzinfo=ZoneInfo(PARIS))
        return local.astimezone(timezone.utc)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheDinnerNudge(PassBase):
    def seed_meal(self, day="sunday", meal_type="dinner", title="Lasagne"):
        asyncio.run(self.db["meals"].insert_one(
            {"meal_id": "m1", "family_id": "fam1", "day": day,
             "meal_type": meal_type, "title": title}))

    def test_it_names_tonights_meal(self):
        self.seed_user()
        self.seed_meal()
        self.assertEqual(self.run_job("dinner_reminder", self.utc(17, 35)), 1)
        self.assertIn("Lasagne", self.sent[0]["body"])

    def test_it_counts_what_is_still_unbought(self):
        """The nudge is only useful if it arrives while the shop is still open."""
        self.seed_user()
        self.seed_meal()
        for i, checked in enumerate([False, False, True]):
            asyncio.run(self.db["shopping_list"].insert_one(
                {"item_id": f"i{i}", "family_id": "fam1", "name": "x",
                 "checked": checked}))
        self.run_job("dinner_reminder", self.utc(17, 35))
        self.assertIn("2", self.sent[0]["body"])

    def test_no_meal_planned_means_silence(self):
        self.seed_user()
        self.assertEqual(self.run_job("dinner_reminder", self.utc(17, 35)), 0)

    def test_a_meal_on_another_day_is_not_tonight(self):
        self.seed_user()
        self.seed_meal(day="tuesday")
        self.assertEqual(self.run_job("dinner_reminder", self.utc(17, 35)), 0)

    def test_it_speaks_the_persons_language(self):
        self.seed_user(language="fr")
        self.seed_meal()
        self.run_job("dinner_reminder", self.utc(17, 35))
        self.assertEqual(self.sent[0]["title"], server.PUSH_I18N["fr"]["dinner_title"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheNightlyAgenda(PassBase):
    def seed_card(self, when):
        asyncio.run(self.db["cards"].insert_one(
            {"card_id": f"c{when.isoformat()}", "family_id": "fam1",
             "status": "OPEN", "title": "Swimming", "due_date": when}))

    def test_it_describes_tomorrow(self):
        self.seed_user()
        self.seed_card(self.utc(9, 0, day=31))
        self.assertEqual(self.run_job("calendar_nightly", self.utc(20, 20)), 1)
        self.assertIn("1", self.sent[0]["body"])

    def test_it_arrives_without_the_calendar_tab_being_opened(self):
        """It used to need that tab opened that very day. This test never
        touches a client at all."""
        self.seed_user()
        self.seed_card(self.utc(9, 0, day=31))
        self.seed_card(self.utc(14, 0, day=31))
        self.run_job("calendar_nightly", self.utc(20, 20))
        self.assertIn("2", self.sent[0]["body"])

    def test_todays_events_are_not_tomorrows(self):
        self.seed_user()
        self.seed_card(self.utc(21, 30, day=30))
        self.assertEqual(self.run_job("calendar_nightly", self.utc(20, 20)), 0)

    def test_an_empty_tomorrow_says_nothing(self):
        self.seed_user()
        self.assertEqual(self.run_job("calendar_nightly", self.utc(20, 20)), 0)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheSundayRecap(PassBase):
    def seed_done(self, n=2):
        for i in range(n):
            asyncio.run(self.db["cards"].insert_one(
                {"card_id": f"d{i}", "family_id": "fam1", "status": "DONE",
                 "title": "Bins", "completed_at": self.utc(10, 0) - timedelta(days=1)}))

    def test_it_celebrates_the_week(self):
        self.seed_user()
        self.seed_done()
        self.assertEqual(self.run_job("sunday_recap", self.utc(18, 5)), 1)
        self.assertIn("2", self.sent[0]["body"])

    def test_a_week_with_nothing_done_is_not_celebrated(self):
        self.seed_user()
        self.assertEqual(self.run_job("sunday_recap", self.utc(18, 5)), 0)

    def test_it_only_happens_on_sunday(self):
        """31 August 2026 is a Monday."""
        self.seed_user()
        self.seed_done()
        self.assertEqual(self.run_job("sunday_recap", self.utc(18, 5, day=31)), 0)

    def test_last_months_work_is_not_this_week(self):
        self.seed_user()
        asyncio.run(self.db["cards"].insert_one(
            {"card_id": "old", "family_id": "fam1", "status": "DONE",
             "title": "Bins", "completed_at": self.utc(10, 0) - timedelta(days=40)}))
        self.assertEqual(self.run_job("sunday_recap", self.utc(18, 5)), 0)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheAllowanceHeadsUp(PassBase):
    def seed_allowance(self, last_paid_days_ago=6, amount=10):
        asyncio.run(self.db["family_members"].insert_one(
            {"member_id": "kid1", "family_id": "fam1", "name": "Ana", "role": "child"}))
        asyncio.run(self.db["allowances"].insert_one(
            {"allowance_id": "a1", "family_id": "fam1", "member_id": "kid1",
             "amount": amount, "frequency": "weekly",
             "created_at": self.utc(9, 0) - timedelta(days=30),
             "last_paid_at": self.utc(9, 0) - timedelta(days=last_paid_days_ago)}))

    def test_a_day_of_warning_before_the_money_is_due(self):
        self.seed_user()
        self.seed_allowance()
        self.assertEqual(self.run_job("allowance_reminder", self.utc(9, 5)), 1)
        self.assertIn("Ana", self.sent[0]["body"])

    def test_money_due_next_week_is_not_due_tomorrow(self):
        self.seed_user()
        self.seed_allowance(last_paid_days_ago=0)
        self.assertEqual(self.run_job("allowance_reminder", self.utc(9, 5)), 0)

    def test_a_teen_is_not_told_about_the_household_budget(self):
        self.seed_user(is_teen=True)
        self.seed_allowance()
        self.assertEqual(self.run_job("allowance_reminder", self.utc(9, 5)), 0)

    def test_a_zero_allowance_is_not_a_reminder(self):
        self.seed_user()
        self.seed_allowance(amount=0)
        self.assertEqual(self.run_job("allowance_reminder", self.utc(9, 5)), 0)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheWholePass(PassBase):
    def test_each_job_fires_at_most_once_per_local_day(self):
        """The loop ticks every minute; a nudge every minute gets an app muted."""
        self.seed_user()
        asyncio.run(self.db["meals"].insert_one(
            {"meal_id": "m1", "family_id": "fam1", "day": "sunday",
             "meal_type": "dinner", "title": "Lasagne"}))
        now = self.utc(17, 35)
        self.assertEqual(asyncio.run(server.send_daily_local_pushes(self.db, now)), 1)
        self.assertEqual(asyncio.run(server.send_daily_local_pushes(self.db, now)), 0)

    def test_a_person_with_no_device_is_not_considered(self):
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u1", "family_id": "fam1", "language": "en"}))
        self.assertEqual(
            asyncio.run(server.send_daily_local_pushes(self.db, self.utc(17, 35))), 0)

    def test_turning_reminders_off_turns_all_of_them_off(self):
        self.seed_user()
        asyncio.run(self.db["meals"].insert_one(
            {"meal_id": "m1", "family_id": "fam1", "day": "sunday",
             "meal_type": "dinner", "title": "Lasagne"}))
        asyncio.run(self.db["notification_settings"].insert_one(
            {"user_id": "u1", "card_reminders": False,
             "created_at": self.utc(9, 0) - timedelta(days=2),
             "updated_at": self.utc(9, 0) - timedelta(days=1)}))
        self.assertEqual(
            asyncio.run(server.send_daily_local_pushes(self.db, self.utc(17, 35))), 0)

    def test_one_persons_bad_data_never_stops_the_pass(self):
        self.seed_user()
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"token": "t2", "user_id": "u2", "family_id": "fam2",
             "active": True, "timezone": "Mars/Olympus"}))
        asyncio.run(self.db["meals"].insert_one(
            {"meal_id": "m1", "family_id": "fam1", "day": "sunday",
             "meal_type": "dinner", "title": "Lasagne"}))
        self.assertEqual(
            asyncio.run(server.send_daily_local_pushes(self.db, self.utc(17, 35))), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhoTheServerCanEvenSee(PassBase):
    """Every one of these was found by review, and every one was invisible to
    the first round of tests because those tests wrote the DB directly instead
    of going through the route a real device uses."""

    def test_the_ordinary_register_route_stores_the_zone(self):
        """It did not. Only the TEEN route did — so every adult fell back to
        Europe/Paris and a New York user would have been woken at 01:30."""
        doc = asyncio.run(self._register("America/New_York"))
        self.assertEqual(doc.get("timezone"), "America/New_York")

    def test_a_nonsense_zone_is_refused_rather_than_stored(self):
        doc = asyncio.run(self._register("Mars/Olympus"))
        self.assertIsNone(doc.get("timezone"))

    async def _register(self, tz):
        import server as srv
        payload = srv.NotificationTokenIn(token="tok1", platform="android", timezone=tz)
        srv.get_db = lambda: self.db
        await srv.register_notification_token(
            payload, user={"user_id": "u1", "family_id": "fam1", "email": "r@x.test"})
        return await self.db["notification_tokens"].find_one({"token": "tok1"}, {"_id": 0})

    def test_a_browser_only_user_is_not_invisible(self):
        """_push_zones read the phone table only, so someone who uses the web
        app and nothing else received none of the five daily reminders — which
        is exactly the co-parent who reported the problem. send_push_to_user
        delivers to both rails; the scheduler has to look at both too."""
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "web1", "family_id": "fam1", "language": "en"}))
        asyncio.run(self.db["web_push_subscriptions"].insert_one(
            {"endpoint": "https://push.example/x", "user_id": "web1",
             "family_id": "fam1", "active": True, "timezone": PARIS}))
        zones = asyncio.run(server._push_zones(self.db))
        self.assertEqual(zones.get("web1"), PARIS)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatATeenIsToldAboutTheHousehold(PassBase):
    def seed_teen_and_cards(self):
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "teen1", "family_id": "fam1", "name": "Ana",
             "language": "en", "is_teen": True}))
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"token": "tt", "user_id": "teen1", "family_id": "fam1",
             "active": True, "timezone": PARIS}))
        # A parent's private card, and one handed to the teen.
        asyncio.run(self.db["cards"].insert_one(
            {"card_id": "priv", "family_id": "fam1", "status": "OPEN",
             "title": "Divorce lawyer", "shared": False,
             "created_by_user_id": "u1",
             "due_date": self.utc(12, 0)}))
        asyncio.run(self.db["cards"].insert_one(
            {"card_id": "hers", "family_id": "fam1", "status": "OPEN",
             "title": "Swimming kit", "shared": False, "assignee": "ana",
             "created_by_user_id": "u1", "due_date": self.utc(12, 0)}))

    def test_a_parents_private_card_never_reaches_a_teens_lock_screen(self):
        """The digest names card TITLES. Unfiltered, it read a teen their
        parents' private cards every morning — a worse leak than the missing
        notification this change is about."""
        self.seed_teen_and_cards()
        self.run_job("morning_digest", self.utc(7, 35))
        self.assertEqual(len(self.sent), 1)
        self.assertNotIn("Divorce lawyer", self.sent[0]["body"])

    def test_but_her_own_task_still_reaches_her(self):
        self.seed_teen_and_cards()
        self.run_job("morning_digest", self.utc(7, 35))
        self.assertIn("Swimming kit", self.sent[0]["body"])

    def test_the_nightly_agenda_counts_only_what_she_may_see(self):
        self.seed_teen_and_cards()
        asyncio.run(self.db["cards"].update_one(
            {"card_id": "priv"}, {"$set": {"due_date": self.utc(12, 0, day=31)}}))
        asyncio.run(self.db["cards"].update_one(
            {"card_id": "hers"}, {"$set": {"due_date": self.utc(12, 0, day=31)}}))
        self.run_job("calendar_nightly", self.utc(20, 20))
        self.assertIn("1", self.sent[0]["body"])

    def test_the_household_recap_is_not_a_teens_business(self):
        self.seed_teen_and_cards()
        asyncio.run(self.db["cards"].insert_one(
            {"card_id": "done1", "family_id": "fam1", "status": "DONE",
             "title": "Bins", "completed_at": self.utc(10, 0) - timedelta(days=1)}))
        self.assertEqual(self.run_job("sunday_recap", self.utc(18, 5)), 0)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheClaim(PassBase):
    def test_only_the_call_that_wins_the_claim_sends(self):
        """The claim was written and its result thrown away, so the idempotency
        held within one process only: two workers overlapping during a rolling
        deploy would both read "not sent", both write, and both send."""
        self.seed_user()
        asyncio.run(self.db["meals"].insert_one(
            {"meal_id": "m1", "family_id": "fam1", "day": "sunday",
             "meal_type": "dinner", "title": "Lasagne"}))
        # The real interleaving: BOTH workers read the user doc before either
        # writes, so the early "already sent today" read passes for both and the
        # conditional write is the only thing left that can tell them apart.
        # Losing that write is what this worker is doing here.
        class Lost:
            modified_count = 0

        users = self.db["users"]
        real_update = users.update_one

        async def lost_race(flt, update, *a, **kw):
            if "dinner_sent_for" in (update.get("$set") or {}):
                return Lost()
            return await real_update(flt, update, *a, **kw)

        users.update_one = lost_race
        try:
            self.assertEqual(self.run_job("dinner_reminder", self.utc(17, 35)), 0)
        finally:
            users.update_one = real_update
        self.assertEqual(self.sent, [])
