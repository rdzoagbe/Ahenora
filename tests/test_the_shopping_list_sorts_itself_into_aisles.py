"""Every item on the shopping list lands in its aisle, however it was added.

Roland, 2026-09-30: "every item we put there just goes in, but the category
side is not given — tomatoes should go to one category, washing liquid and
toilet paper to cleaning".

The aisles existed; only the Kitchen screen ever filled one in. The + button,
a typed message, a teen's add, a reused list and a meal plan all stored
"Other". Now the server sorts every item, a household can move an item to
another aisle, and that choice sticks for the next time.

Run with:  python3 -m unittest tests.test_the_shopping_list_sorts_itself_into_aisles -v
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
    import shopping_aisles
    from fake_mongo import FakeDatabase


class Item:
    def __init__(self, name, category="Other"):
        self.name, self.category = name, category


class Patch:
    def __init__(self, checked=None, name=None, category=None):
        self.checked, self.name, self.category = checked, name, category


class Bulk:
    def __init__(self, names, categories=None):
        self.names, self.categories = names, categories or []


USER = {"user_id": "u1", "family_id": "fam", "name": "Roland"}
OTHER_HOUSE = {"user_id": "u9", "family_id": "fam9", "name": "Neighbour"}


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheListSortsItself(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

        async def quiet(*a, **k):
            return 0
        self._queue, server.queue_shopping_notification = server.queue_shopping_notification, quiet

    def tearDown(self):
        server.get_db = self._get_db
        server.queue_shopping_notification = self._queue

    def add(self, name, category="Other", user=USER):
        return asyncio.run(server.add_shopping_item(Item(name, category), user))

    def listed(self, user=USER):
        return {i["name"]: i["category"] for i in asyncio.run(server.list_shopping(user))}

    def test_the_examples_roland_gave(self):
        self.assertEqual(self.add("Tomatoes")["category"], "Produce")
        self.assertEqual(self.add("Washing liquid")["category"], "Household")
        self.assertEqual(self.add("Toilet paper")["category"], "Household")

    def test_the_app_languages_and_the_way_people_type(self):
        for name, aisle in [
            ("tomates", "Produce"), ("papier toilette", "Household"),
            ("liquide vaisselle", "Household"), ("lessive", "Household"),
            ("Pampers", "Baby"), ("pâtes", "Pantry"), ("Œufs x6", "Dairy"),
            ("papel higiénico", "Household"), ("Klopapier", "Household"),
            ("Kartoffeln", "Produce"), ("jus d'orange", "Drinks"),
            ("pain au chocolat", "Bakery"), ("dentifrice", "Health"),
            ("cahiers", "School"), ("Tomatoes 400g", "Produce"),
        ]:
            self.assertEqual(shopping_aisles.classify(name), aisle, name)

    def test_the_most_specific_words_win(self):
        # One rule instead of a precedence table: the longest matching term.
        for name, aisle in [
            ("bottle of wine", "Drinks"), ("watermelon", "Produce"),
            ("water", "Drinks"), ("lait de coco", "Pantry"),
            ("lait infantile", "Baby"), ("sel lave-vaisselle", "Household"),
            ("sel", "Pantry"), ("black pepper", "Pantry"), ("pepper", "Produce"),
            ("pâté", "Meat"), ("penne", "Pantry"), ("pens", "School"),
            ("eau de javel", "Household"), ("frozen chips", "Frozen"),
            ("chips", "Snacks"), ("baby spinach", "Produce"),
        ]:
            self.assertEqual(shopping_aisles.classify(name), aisle, name)

    def test_an_unknown_item_is_other_not_a_guess(self):
        # A wrong aisle sends someone to the wrong end of the shop.
        self.assertIsNone(shopping_aisles.classify("present for Ama"))
        self.assertEqual(self.add("present for Ama")["category"], "Other")

    def test_the_app_guess_fills_a_gap_the_word_list_leaves(self):
        self.assertEqual(self.add("zorblax", "Snacks")["category"], "Snacks")
        # ...but never overrides a word the server knows.
        self.assertEqual(self.add("toilet paper", "Produce")["category"], "Household")
        # ...and an aisle that does not exist is ignored.
        self.assertEqual(self.add("zorblax two", "Groceries")["category"], "Other")

    def test_every_other_way_in_is_sorted_too(self):
        asyncio.run(server.bulk_add_shopping(Bulk(["milk", "bin bags", "nappies"]), USER))
        listed = self.listed()
        self.assertEqual(listed["milk"], "Dairy")
        self.assertEqual(listed["bin bags"], "Household")
        self.assertEqual(listed["nappies"], "Baby")

    def test_a_bulk_add_says_where_each_item_went(self):
        # So the app can say "Added to Fruit & veg: tomatoes" without the
        # person having to go and look.
        res = asyncio.run(server.bulk_add_shopping(Bulk(["tomatoes", "toilet paper"]), USER))
        self.assertEqual(res["added"], 2)
        self.assertEqual(res["items"], [
            {"name": "tomatoes", "category": "Produce"},
            {"name": "toilet paper", "category": "Household"},
        ])
        # Something already on the list is not added again, and not reported.
        again = asyncio.run(server.bulk_add_shopping(Bulk(["tomatoes"]), USER))
        self.assertEqual((again["added"], again["items"]), (0, []))

    def test_an_old_list_gains_its_aisles_without_a_rewrite(self):
        asyncio.run(self.db["shopping_list"].insert_one({
            "item_id": "shop_old", "family_id": "fam", "name": "bananas",
            "category": "Other", "checked": False, "added_by": "",
            "created_at": server.utcnow()}))
        self.assertEqual(self.listed()["bananas"], "Produce")
        stored = asyncio.run(self.db["shopping_list"].find_one({"item_id": "shop_old"}))
        self.assertEqual(stored["category"], "Other")

    def test_moving_an_item_is_remembered_for_the_household(self):
        item = self.add("chips")
        self.assertEqual(item["category"], "Snacks")
        # In this house "chips" are the frozen kind.
        moved = asyncio.run(server.update_shopping_item(
            item["item_id"], Patch(category="Frozen"), USER))
        self.assertEqual(moved["category"], "Frozen")
        # Next time anyone in the household adds them, they go there...
        self.assertEqual(self.add("Chips")["category"], "Frozen")
        # ...including through a bulk add...
        asyncio.run(server.bulk_add_shopping(Bulk(["chips x2"]), USER))
        self.assertEqual(self.listed()["chips x2"], "Frozen")
        # ...and never in somebody else's household.
        self.assertEqual(self.add("chips", user=OTHER_HOUSE)["category"], "Snacks")

    def test_a_renamed_item_is_sorted_again(self):
        item = self.add("tomatoes")
        renamed = asyncio.run(server.update_shopping_item(
            item["item_id"], Patch(name="toilet paper"), USER))
        self.assertEqual(renamed["category"], "Household")

    def test_an_aisle_that_does_not_exist_is_refused(self):
        item = self.add("tomatoes")
        with self.assertRaises(server.HTTPException) as err:
            asyncio.run(server.update_shopping_item(
                item["item_id"], Patch(category="Groceries"), USER))
        self.assertEqual(err.exception.status_code, 422)

    def test_the_aisles_are_the_ones_the_list_can_show(self):
        self.assertEqual(set(shopping_aisles.AISLES), set(server.SHOPPING_CATEGORIES))
        self.assertEqual(shopping_aisles.AISLES[-1], "Other")
        for aisle in shopping_aisles.TERMS:
            self.assertIn(aisle, server.SHOPPING_CATEGORIES)

    def test_a_deleted_household_takes_its_aisle_choices_with_it(self):
        self.assertIn("shopping_aisles", server._FAMILY_SCOPED_COLLECTIONS)


if __name__ == "__main__":
    unittest.main()
