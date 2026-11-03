"""A chore about a cat carries a cat, not the dog.

Roland, 2026-11-03, looking at the child's screen: "fix the dog icon for feed
the cat". There was one "pet" picture, a dog, for every animal. A cat now has
its own, in the four languages the app speaks; the dog stays for dogs and the
rest. Chores already written with the guessed dog are looked at again once,
so the fix reaches the screens families already have.

Run with:  python3 -m unittest tests.test_a_cat_is_not_a_dog -v
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from card_icons import ICONS, guess_icon  # noqa: E402

try:
    import fastapi  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase


class ACatIsNotADog(unittest.TestCase):
    def test_a_cat_has_its_own_picture(self):
        self.assertEqual(ICONS["cat"], "🐱")
        self.assertEqual(ICONS["pet"], "🐶")

    def test_a_cat_in_any_of_the_four_languages(self):
        for title in ("Feed the cat", "Nourrir le chat", "Dar de comer al gato",
                      "Katze füttern", "Change the cat litter", "Litière du chat", "Kitten to the vet"):
            self.assertEqual(guess_icon(title), "cat", title)

    def test_a_dog_and_other_animals_keep_the_dog(self):
        for title in ("Walk the dog", "Promener le chien", "Feed the fish", "Hamster food"):
            self.assertEqual(guess_icon(title), "pet", title)

    def test_the_english_word_chat_is_not_a_cat(self):
        self.assertNotEqual(guess_icon("Family chat"), "cat")
        self.assertNotEqual(guess_icon("Chat with the teacher"), "cat")


@unittest.skipUnless(HAVE, "backend deps not installed")
class ChoresAlreadyWritten(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()

        async def seed():
            await self.db["chores"].insert_one({"chore_id": "h1", "title": "Feed the cat",
                                                "icon": "pet", "icon_auto": True})
            await self.db["chores"].insert_one({"chore_id": "h2", "title": "Walk the dog",
                                                "icon": "pet", "icon_auto": True})
            # Chosen by a person: never second-guessed.
            await self.db["chores"].insert_one({"chore_id": "h3", "title": "Feed the cat",
                                                "icon": "pet", "icon_auto": False})
            await self.db["cards"].insert_one({"card_id": "c1", "title": "Nourrir le chat", "type": "TASK",
                                               "icon": "pet", "icon_auto": True})
        asyncio.run(seed())

    def icon(self, coll, key, ident):
        return asyncio.run(self.db[coll].find_one({key: ident}))["icon"]

    def test_a_guessed_dog_on_a_cat_becomes_a_cat_and_nothing_else_moves(self):
        asyncio.run(server.backfill_icons(self.db))
        self.assertEqual(self.icon("chores", "chore_id", "h1"), "cat")
        self.assertEqual(self.icon("cards", "card_id", "c1"), "cat")
        self.assertEqual(self.icon("chores", "chore_id", "h2"), "pet")
        self.assertEqual(self.icon("chores", "chore_id", "h3"), "pet")

    def test_running_it_again_changes_nothing(self):
        asyncio.run(server.backfill_icons(self.db))
        again = asyncio.run(server.backfill_icons(self.db))
        self.assertEqual(again, {"cards": 0, "chores": 0, "routines": 0})


if __name__ == "__main__":
    unittest.main()
