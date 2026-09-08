"""Adding to the shared shopping list tells the other adults — once.

Asked for on 2026-09-08: the list is open to everyone in the household, so the
parent doing the shop must hear when something is put on it.

The first version pushed on every add. That was a defect, not a feature: the
Kitchen screen adds a recipe's missing ingredients with one request PER
INGREDIENT, fired in parallel, so cooking one recipe would have buzzed the
co-parent nine times. Adds are now queued and drained by the scheduler once
the burst goes quiet.

Run with:  python3 -m pytest tests/test_shopping_notify.py -q
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
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase


class Item:
    def __init__(self, name, category=None):
        self.name, self.category = name, category


class Bulk:
    def __init__(self, names, categories=None):
        self.names, self.categories = names, categories or []


@unittest.skipUnless(HAVE, "backend deps not installed")
class ShoppingNotify(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.expo = []

        async def to_expo(messages, database=None):
            self.expo.extend(messages)
            return {"sent": len(messages)}

        async def to_web(database, user_id, title, body, data):
            return 0

        self._expo, server.send_expo_push_messages = server.send_expo_push_messages, to_expo
        self._web, server.send_web_push_to_user = server.send_web_push_to_user, to_web

        run = asyncio.run
        for uid, name, member in (("u_roland", "Roland", "m_r"), ("u_keigh", "Keigh", "m_k")):
            run(self.db["users"].insert_one(
                {"user_id": uid, "family_id": "fam", "name": name, "language": "en"}))
            run(self.db["family_members"].insert_one(
                {"member_id": member, "family_id": "fam", "name": name,
                 "role": "parent", "user_id": uid}))
        run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_keigh", "token": "ExponentPushToken[keigh]", "active": True,
             "platform": "ios", "updated_at": server.utcnow()}))
        self.roland = {"user_id": "u_roland", "family_id": "fam", "name": "Roland"}

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web

    def _add(self, name):
        return asyncio.run(server.add_shopping_item(Item(name), user=self.roland))

    def _pending(self):
        return asyncio.run(self.db["shopping_pending"].find_one({}, {"_id": 0}))

    def _flush(self, seconds_later=0):
        when = server.utcnow() + timedelta(seconds=seconds_later)
        return asyncio.run(server.flush_shopping_notifications(self.db, now=when))

    # --- the burst -------------------------------------------------------

    def test_adding_sends_nothing_immediately(self):
        self._add("Rice")
        self.assertEqual(self.expo, [])
        self.assertEqual(self._pending()["names"], ["Rice"])

    def test_a_whole_recipe_of_ingredients_is_one_push(self):
        # The exact shape of the Kitchen screen's "add what's missing".
        for name in ("Rice", "Beans", "Milk", "Bread", "Eggs", "Oil", "Salt", "Onion", "Curry"):
            self._add(name)
        self.assertEqual(self.expo, [], "nothing may go out mid-burst")

        sent = self._flush(server.SHOPPING_QUIET_SECONDS + 1)
        self.assertEqual(sent, 1)
        self.assertEqual(len(self.expo), 1)
        body = self.expo[0]["body"]
        self.assertEqual(body, "Rice, Beans, Milk +6")
        self.assertIn("Roland", self.expo[0]["title"])
        self.assertEqual(self.expo[0]["to"], "ExponentPushToken[keigh]")

    def test_nothing_goes_out_while_the_burst_is_still_running(self):
        self._add("Rice")
        self.assertEqual(self._flush(), 0)
        self.assertEqual(self.expo, [])
        # The row survives, so the next quiet tick still tells them.
        self.assertIsNotNone(self._pending())
        self.assertEqual(self._flush(server.SHOPPING_QUIET_SECONDS + 1), 1)

    def test_a_bulk_add_is_also_one_push(self):
        asyncio.run(server.bulk_add_shopping(
            Bulk(["Rice", "Beans", "Milk"]), user=self.roland))
        self.assertEqual(self.expo, [])
        self._flush(server.SHOPPING_QUIET_SECONDS + 1)
        self.assertEqual(len(self.expo), 1)
        self.assertEqual(self.expo[0]["body"], "Rice, Beans, Milk")

    def test_the_same_item_twice_is_named_once(self):
        self._add("Rice")
        self._add("Rice")
        self.assertEqual(self._pending()["names"], ["Rice"])

    # --- who hears it ----------------------------------------------------

    def test_the_person_who_added_hears_nothing(self):
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_roland", "token": "ExponentPushToken[roland]", "active": True,
             "platform": "android", "updated_at": server.utcnow()}))
        self._add("Rice")
        self._flush(server.SHOPPING_QUIET_SECONDS + 1)
        self.assertTrue(all(m["to"] != "ExponentPushToken[roland]" for m in self.expo))

    def test_each_person_adding_gets_their_own_window(self):
        keigh = {"user_id": "u_keigh", "family_id": "fam", "name": "Keigh"}
        self._add("Rice")
        asyncio.run(server.add_shopping_item(Item("Nappies"), user=keigh))
        rows = asyncio.run(self.db["shopping_pending"].find({}, {"_id": 0}).to_list(10))
        self.assertEqual(len(rows), 2)

    # --- it must never get in the way ------------------------------------

    def test_the_queue_is_emptied_even_when_the_push_fails(self):
        async def explode(*a, **k):
            raise RuntimeError("exp.host down")
        server.send_expo_push_messages = explode
        self._add("Rice")
        self._flush(server.SHOPPING_QUIET_SECONDS + 1)
        # Otherwise the row is retried on every tick, for ever.
        self.assertIsNone(self._pending())

    def test_an_add_still_succeeds_when_the_queue_write_fails(self):
        async def explode(*a, **k):
            raise RuntimeError("mongo down")
        self.db["shopping_pending"].update_one = explode
        item = self._add("Rice")
        self.assertEqual(item["name"], "Rice")

    def test_a_blank_name_queues_nothing(self):
        queued = asyncio.run(server.queue_shopping_notification(self.db, self.roland, ["  ", ""]))
        self.assertEqual(queued, 0)
        self.assertIsNone(self._pending())


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheSchedulerDrainsIt(unittest.TestCase):
    def test_the_tick_flushes_the_queue(self):
        import inspect
        source = inspect.getsource(server._reminder_scheduler_loop)
        self.assertIn("flush_shopping_notifications", source)


if __name__ == "__main__":
    unittest.main()
