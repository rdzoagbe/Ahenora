"""Adding to the shared shopping list tells the other adults.

Asked for on 2026-09-08: the list is open to everyone in the household, so
the parent doing the shop must hear when something is put on it.
"""
import asyncio
import os
import sys
import unittest

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
        run(self.db["users"].insert_one({"user_id": "u_r", "family_id": "fam", "name": "Roland", "language": "fr"}))
        run(self.db["users"].insert_one({"user_id": "u_k", "family_id": "fam", "name": "Keigh", "language": "en"}))
        run(self.db["family_members"].insert_one({"member_id": "m1", "family_id": "fam", "name": "Roland", "role": "parent", "user_id": "u_r"}))
        run(self.db["family_members"].insert_one({"member_id": "m2", "family_id": "fam", "name": "Keigh", "role": "co-parent", "user_id": "u_k"}))
        run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_r", "token": "ExponentPushToken[r]", "active": True, "platform": "android", "updated_at": server.utcnow()}))
        self.keigh = {"user_id": "u_k", "family_id": "fam", "name": "Keigh"}

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web

    def test_one_item_pushes_the_other_parent_in_their_language(self):
        asyncio.run(server.add_shopping_item(Item("Lait"), user=self.keigh))
        self.assertEqual(len(self.expo), 1)
        self.assertEqual(self.expo[0]["to"], "ExponentPushToken[r]")
        self.assertEqual(self.expo[0]["title"], "Keigh a ajouté à la liste de courses")
        self.assertEqual(self.expo[0]["body"], "Lait")
        self.assertEqual(self.expo[0]["data"]["type"], "shopping_added")

    def test_bulk_names_up_to_three_and_counts_the_rest(self):
        asyncio.run(server.bulk_add_shopping(Bulk(["Rice", "Beans", "Milk", "Bread", "Eggs"]), user=self.keigh))
        self.assertEqual(len(self.expo), 1)
        self.assertEqual(self.expo[0]["body"], "Rice, Beans, Milk +2")

    def test_the_author_is_not_told_about_their_own_add(self):
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_k", "token": "ExponentPushToken[k]", "active": True, "platform": "ios", "updated_at": server.utcnow()}))
        asyncio.run(server.add_shopping_item(Item("Milk"), user=self.keigh))
        self.assertEqual([m["to"] for m in self.expo], ["ExponentPushToken[r]"])

    def test_nothing_new_means_no_push(self):
        asyncio.run(server.add_shopping_item(Item("Milk"), user=self.keigh))
        self.expo.clear()
        asyncio.run(server.bulk_add_shopping(Bulk(["milk"]), user=self.keigh))
        self.assertEqual(self.expo, [])


if __name__ == "__main__":
    unittest.main()
