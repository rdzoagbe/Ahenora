"""A star lands on the day it was earned, where the family is.

The child's weekday row is drawn in UTC days because the server's week turns
at Monday 00:00 UTC. A star stamped with the clock therefore sat in
tomorrow's column for a chore done at 21:00 in Montreal, and in yesterday's
for one done at 07:00 in Tokyo. Now the star is stamped with the family's
calendar day pinned to noon UTC (the date rule of #696), read from the zone
the parent's device registered or sent, and the server's week is left alone.

Run with:  python3 -m unittest tests.test_a_star_lands_on_the_day_it_was_earned -v
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

PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Amara", "email": "a@x.com"}

# Wednesday 2026-10-14 01:00 UTC: Tuesday 21:00 in Montreal, Wednesday 10:00 in Tokyo.
MONTREAL_EVENING = datetime(2026, 10, 14, 1, 0, tzinfo=timezone.utc)
# Monday 2026-10-12 22:00 UTC: Tuesday 07:00 in Tokyo, Monday 18:00 in Montreal.
TOKYO_MORNING = datetime(2026, 10, 12, 22, 0, tzinfo=timezone.utc)


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class _Household(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._utcnow = server.utcnow
        self._alert = server.send_star_milestone_alert

        async def quiet(*a, **k):
            return None
        server.send_star_milestone_alert = quiet
        run(self.db["family_members"].insert_one({
            "member_id": "kid1", "family_id": "fam1", "name": "Kofi",
            "role": "Child", "stars": 0, "week_earned": 0}))

    def tearDown(self):
        server.get_db = self._get_db
        server.utcnow = self._utcnow
        server.send_star_milestone_alert = self._alert

    def freeze(self, when):
        server.utcnow = lambda: when

    def device_in(self, zone):
        run(self.db["notification_tokens"].insert_one({
            "token": "ExponentPushToken[x]", "user_id": PARENT["user_id"], "family_id": "fam1",
            "platform": "ios", "timezone": zone, "active": True, "updated_at": server.utcnow()}))

    def chore_done(self):
        return run(server.award_stars_to_member(self.db, "fam1", "kid1", 1, "Dishes", dict(PARENT)))

    def parent_gives(self, **kw):
        return run(server.adjust_member_stars(
            "kid1", server.StarAdjustmentIn(delta=1, reason="Helped", **kw), user=dict(PARENT)))

    def ledger_day(self):
        txn = run(self.db["star_transactions"].find_one({"member_id": "kid1"}, {"_id": 0}))
        return server.ensure_aware_utc(txn["awarded_for"]).date()


class AChoreDoneInTheEvening(_Household):
    def test_lands_on_the_family_day_in_montreal(self):
        self.freeze(MONTREAL_EVENING)
        self.device_in("America/Montreal")
        self.chore_done()
        self.assertEqual(self.ledger_day(), datetime(2026, 10, 13).date(), "Tuesday, where they are")

    def test_lands_on_the_family_day_in_tokyo(self):
        self.freeze(TOKYO_MORNING)
        self.device_in("Asia/Tokyo")
        self.chore_done()
        self.assertEqual(self.ledger_day(), datetime(2026, 10, 13).date(), "Tuesday, where they are")

    def test_with_no_device_on_record_the_clock_decides_as_before(self):
        self.freeze(MONTREAL_EVENING)
        self.chore_done()
        self.assertEqual(self.ledger_day(), datetime(2026, 10, 14).date())

    def test_the_pin_is_noon_utc_so_the_day_holds_in_every_zone(self):
        self.freeze(MONTREAL_EVENING)
        self.device_in("America/Montreal")
        self.chore_done()
        txn = run(self.db["star_transactions"].find_one({"member_id": "kid1"}, {"_id": 0}))
        self.assertEqual(server.ensure_aware_utc(txn["awarded_for"]).hour, server.DATE_ONLY_HOUR_UTC)
        self.assertEqual(server.ensure_aware_utc(txn["created_at"]), MONTREAL_EVENING, "when it was recorded is still the clock")


class TheServersWeekIsLeftAlone(_Household):
    def test_sunday_evening_in_montreal_is_already_the_new_week(self):
        # Monday 2026-10-19 01:00 UTC is Sunday 21:00 in Montreal. The meter has
        # turned; a star pinned to Sunday would be a star the row could not show
        # under a meter that counts it. It lands on the clock, as it always has.
        monday_0100 = datetime(2026, 10, 19, 1, 0, tzinfo=timezone.utc)
        self.freeze(monday_0100)
        self.device_in("America/Montreal")
        self.chore_done()
        self.assertEqual(self.ledger_day(), datetime(2026, 10, 19).date())
        member = run(self.db["family_members"].find_one({"member_id": "kid1"}, {"_id": 0}))
        self.assertEqual(member["week_earned"], 1)

    def test_monday_morning_in_tokyo_is_still_the_old_week(self):
        # Sunday 2026-10-18 22:00 UTC is Monday 07:00 in Tokyo. The meter has
        # not turned; pinning to Monday would hide the star until it did.
        sunday_2200 = datetime(2026, 10, 18, 22, 0, tzinfo=timezone.utc)
        self.freeze(sunday_2200)
        self.device_in("Asia/Tokyo")
        self.chore_done()
        self.assertEqual(self.ledger_day(), datetime(2026, 10, 18).date())


class AParentGivingAStar(_Household):
    def test_today_is_the_parents_today(self):
        self.freeze(MONTREAL_EVENING)
        self.parent_gives(timezone="America/Montreal")
        self.assertEqual(self.ledger_day(), datetime(2026, 10, 13).date())

    def test_the_zone_sent_wins_over_the_device_on_record(self):
        self.freeze(MONTREAL_EVENING)
        self.device_in("Asia/Tokyo")
        self.parent_gives(timezone="America/Montreal")
        self.assertEqual(self.ledger_day(), datetime(2026, 10, 13).date())

    def test_a_nonsense_zone_falls_back_to_the_device_on_record(self):
        self.freeze(MONTREAL_EVENING)
        self.device_in("America/Montreal")
        self.parent_gives(timezone="Mars/Olympus")
        self.assertEqual(self.ledger_day(), datetime(2026, 10, 13).date())

    def test_todays_cell_is_not_the_future_at_seven_in_tokyo(self):
        # The row offers Tuesday at noon UTC; it is 07:00 Tuesday in Tokyo and
        # Monday 22:00 in Greenwich. Refusing it told a parent their own day
        # had not happened yet.
        self.freeze(TOKYO_MORNING)
        self.parent_gives(timezone="Asia/Tokyo", awarded_for="2026-10-13T12:00:00.000Z")
        self.assertEqual(self.ledger_day(), datetime(2026, 10, 13).date())

    def test_tomorrow_is_still_refused(self):
        self.freeze(MONTREAL_EVENING)
        with self.assertRaises(server.HTTPException) as e:
            self.parent_gives(timezone="America/Montreal", awarded_for="2026-10-14T12:00:00.000Z")
        self.assertEqual(e.exception.status_code, 400)

    def test_last_week_is_still_refused(self):
        self.freeze(MONTREAL_EVENING)
        with self.assertRaises(server.HTTPException) as e:
            self.parent_gives(timezone="America/Montreal", awarded_for="2026-10-11")
        self.assertEqual(e.exception.status_code, 400)

    def test_without_a_zone_anywhere_the_old_rule_holds(self):
        self.freeze(TOKYO_MORNING)
        with self.assertRaises(server.HTTPException) as e:
            self.parent_gives(awarded_for="2026-10-13T12:00:00.000Z")
        self.assertEqual(e.exception.status_code, 400, "noon Tuesday has not struck in Greenwich")


class TheFullWeekCountsLocalDays(_Household):
    def test_seven_evenings_in_montreal_are_seven_days(self):
        # Monday 21:00 to Sunday 21:00 Montreal is Tuesday 01:00 to Monday 01:00
        # UTC: on the clock that is six columns and a star in next week. Pinned
        # to the family's days it is Monday to Saturday here plus Sunday's star
        # on the week's edge — still six distinct days, so no bonus; and the
        # weekday evenings land on their own days.
        self.device_in("America/Montreal")
        monday_2100 = datetime(2026, 10, 13, 1, 0, tzinfo=timezone.utc)   # Monday 21:00 Montreal
        for i in range(6):
            self.freeze(monday_2100 + timedelta(days=i))
            self.chore_done()
        days = sorted({server.ensure_aware_utc(t["awarded_for"]).date()
                       for t in run(self.db["star_transactions"].find({"member_id": "kid1"}, {"_id": 0}).to_list(None))})
        self.assertEqual([d.day for d in days], [12, 13, 14, 15, 16, 17], "Monday to Saturday, where they are")


if __name__ == "__main__":
    unittest.main()
