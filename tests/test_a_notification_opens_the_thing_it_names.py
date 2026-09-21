"""A notification that names one thing opens that thing.

Reported twice, in the same words both times: "no notification I click on
takes me to the place where it's located". The routing table was not the
fault. The morning digest landed on the Feed — which is the screen the app
opens on anyway — so a tap that worked perfectly was indistinguishable from
launching the app. And "1 thing still open from earlier" is the worst case of
all: it names a single item, then lands on a screen showing today, where
something from last week is not what the eye finds.

So the digest now names the card when there is exactly one, and only then.
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
class OneThingMeansOneDestination(unittest.TestCase):
    def test_exactly_one_id_is_the_one(self):
        self.assertEqual(server._only(["c1"]), "c1")

    def test_several_have_no_single_right_answer(self):
        # Guessing which of three the reader meant is worse than landing on
        # the list that holds all three.
        self.assertIsNone(server._only(["c1", "c2"]))

    def test_none_is_none(self):
        self.assertIsNone(server._only([]))

    def test_a_missing_id_does_not_count_as_one(self):
        # The count that matters is how many things the MESSAGE named, not how
        # many of them happen to carry an id. A digest built from two cards
        # says "2 things today"; opening one of them because the other lost
        # its id is a tap that lands somewhere plausible and wrong, which is
        # harder to notice than one that lands nowhere.
        self.assertIsNone(server._only([None, "c1", None]))
        self.assertIsNone(server._only([None, "c1"]))
        self.assertIsNone(server._only([None]))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatTheMorningDigestPointsAt(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self.now = server.utcnow()
        self.user = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
        self.local = self.now
        self.L = server.PUSH_I18N["en"]

    def add(self, card_id, days):
        async def go():
            await self.db["cards"].insert_one(
                {"card_id": card_id, "family_id": "fam1", "title": f"Thing {card_id}",
                 "type": "TASK", "status": "OPEN", "created_at": self.now, "source": "MANUAL",
                 "due_date": self.now + timedelta(days=days)})
        asyncio.run(go())

    def build(self):
        return asyncio.run(server._build_morning_digest(self.db, self.user, self.local, self.L))

    def card_id_of(self, built):
        # The fifth element is a dict of what the message is about, not a bare
        # card id: not everything these jobs talk about is a card. The dinner
        # reminder names a meal, the nightly calendar names a day.
        extra = built[4] if built and len(built) > 4 else None
        return (extra or {}).get("card_id")

    def test_a_day_with_one_thing_names_that_thing(self):
        self.add("c_today", 0)
        built = self.build()
        self.assertEqual(self.card_id_of(built), "c_today")

    def test_a_day_with_several_names_none_of_them(self):
        self.add("c_a", 0)
        self.add("c_b", 0)
        built = self.build()
        self.assertIsNone(self.card_id_of(built))

    def test_a_single_backlog_item_is_named(self):
        # This is the exact notification that was reported: "1 thing still
        # open from earlier", landing nowhere useful.
        self.add("c_old", -(server.DIGEST_OVERDUE_DAYS + 5))
        built = self.build()
        self.assertIn("1", built[1])
        self.assertEqual(self.card_id_of(built), "c_old")

    def test_several_backlog_items_are_not_named(self):
        self.add("c_old1", -(server.DIGEST_OVERDUE_DAYS + 5))
        self.add("c_old2", -(server.DIGEST_OVERDUE_DAYS + 6))
        built = self.build()
        self.assertIsNone(self.card_id_of(built))

    def test_a_quiet_day_names_nothing_and_stays_a_tip(self):
        built = self.build()
        self.assertEqual(built[3], "daily_tip")
        self.assertIsNone(self.card_id_of(built))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheCardRidesOnThePush(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.sent = []

        async def capture(database, user_id, title, body, data, channel=None, **kw):
            self.sent.append({"title": title, "body": body, "data": data, "channel": channel})
            return {"sent": 1}
        self._push = server.send_push_to_user
        server.send_push_to_user = capture

    def tearDown(self):
        server.get_db = self._get_db
        server.send_push_to_user = self._push

    def run_job(self, built):
        async def build(database, user, local, L):
            return built
        now = server.utcnow()

        async def go():
            await self.db["users"].insert_one(
                {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com",
                 "timezone": "UTC", "language": "en"})
            await self.db["notification_settings"].insert_one(
                {"user_id": "u_r", "card_reminders": True})
            # The audience comes from registered devices, not from the users
            # collection: a household with no phone and no browser registered
            # hears nothing, which is correct and is why this row is needed.
            await self.db["notification_tokens"].insert_one(
                {"user_id": "u_r", "active": True, "timezone": "UTC",
                 "token": "ExponentPushToken[test]"})
            job = dict(server.DAILY_PUSH_JOBS[0])
            job["build"] = build
            # The slot is checked against the household's local clock; run the
            # job at exactly its own hour so it is always due.
            at = now.replace(hour=server.DIGEST_HOUR, minute=server.DIGEST_MINUTE, second=0,
                             microsecond=0)
            return await server.run_daily_local_push(self.db, job, at)
        return asyncio.run(go())

    def test_a_named_card_reaches_the_phone(self):
        self.run_job(("Today", "1 thing still open from earlier", None, None, {"card_id": "c_old"}))
        self.assertEqual(len(self.sent), 1)
        self.assertEqual(self.sent[0]["data"]["type"], "morning_digest")
        self.assertEqual(self.sent[0]["data"]["card_id"], "c_old")

    def test_a_meal_or_any_other_thing_rides_the_same_way(self):
        # The dinner reminder is about a meal, not a card. One mechanism for
        # both, so a new daily job does not need a new field on the wire.
        self.run_job(("Dinner tonight", "Lasagne", None, None, {"meal_id": "m_1"}))
        self.assertEqual(self.sent[0]["data"]["meal_id"], "m_1")
        self.assertNotIn("card_id", self.sent[0]["data"])

    def test_an_empty_value_is_not_sent_at_all(self):
        # A key with nothing behind it asks the screen to open something that
        # does not exist — a tap that looks like it worked and does not.
        self.run_job(("Today", "3 things today", None, None, {"card_id": None, "meal_id": ""}))
        self.assertEqual(set(self.sent[0]["data"]), {"type"})

    def test_no_named_card_sends_no_empty_key(self):
        # An empty card_id would route to the Feed asking it to open a card
        # that does not exist — a tap that looks like it worked and does not.
        self.run_job(("Today", "3 things today", None, None, None))
        self.assertNotIn("card_id", self.sent[0]["data"])

    def test_a_builder_that_overrides_the_type_still_does(self):
        # The quiet-day tip passes None for channel and type positionally now
        # that a fifth element exists; a falsy override must fall back to the
        # job's own, not become None on the wire.
        self.run_job(("Today", "Quiet day", "daily-tips", "daily_tip", None))
        self.assertEqual(self.sent[0]["data"]["type"], "daily_tip")
        self.assertEqual(self.sent[0]["channel"], "daily-tips")

    def test_a_builder_that_overrides_nothing_uses_the_job_s_own(self):
        self.run_job(("Today", "3 things today", None, None, None))
        self.assertEqual(self.sent[0]["data"]["type"], "morning_digest")
        self.assertEqual(self.sent[0]["channel"], "card-reminders")


if __name__ == "__main__":
    unittest.main()
