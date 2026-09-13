"""Which room a task belongs to.

Rooms are a CLOSED vocabulary, and every test here is downstream of that one
decision. Free text would mean "Kitchen", "kitchen" and "Cuisine" are three
different rooms inside one bilingual household — which is most of ours — so
the grouping that is the entire point of the feature would quietly split a
room into pieces nobody can reassemble. A fixed set translates for free and
groups reliably.

Three things that follow, each of which has a test:

  * an unknown room is REFUSED, not dropped. A room the server silently
    discards is a task filed under "bathroom" that can never be found again,
    with nothing anywhere to say why.
  * "" clears the room, and None leaves it alone. These are different, and a
    plain falsy check collapses them — which would mean nobody could ever
    take a task back out of a room.
  * the field survives the round trip. public_card is a separate list from the
    stored document, and a field written but never serialised is a field the
    app can set and never see again.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    from fastapi import HTTPException
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase

A = {"user_id": "u1", "family_id": "fam1", "name": "Roland"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TasksByRoom(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._real_send = server.send_expo_push_messages

        async def fake_send(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = fake_send

        async def seed():
            await self.db["users"].insert_one({**A})
            await self.db["family_members"].insert_one({
                "member_id": "m1", "family_id": "fam1", "user_id": "u1",
                "name": "Roland", "role": "Parent"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._real_send

    def _create(self, **kw):
        payload = server.CardIn(type="TASK", title=kw.pop("title", "Clean the sink"), **kw)
        return asyncio.run(server.create_card(payload, user=dict(A)))

    def _patch(self, card_id, **kw):
        return asyncio.run(server.update_card(
            card_id, server.CardPatchIn(**kw), user=dict(A)))

    # --- creating -------------------------------------------------------

    def test_a_task_can_be_put_in_a_room(self):
        card = self._create(room="kitchen")
        self.assertEqual(card["room"], "kitchen")

    def test_the_room_survives_the_round_trip(self):
        # public_card keeps its own list of fields. One written to the document
        # and left out of that list is a room the app can set and never read.
        card = self._create(room="garden")
        stored = asyncio.run(self.db["cards"].find_one({"card_id": card["card_id"]}))
        self.assertEqual(stored["room"], "garden")
        self.assertEqual(server.public_card(stored)["room"], "garden")

    def test_a_task_with_no_room_says_so_as_an_empty_string(self):
        # Not None. The client treats "" as "no room" and a null would have it
        # rendering the word "null" in a chip.
        card = self._create()
        self.assertEqual(card["room"], "")

    def test_a_room_that_is_not_a_room_is_refused(self):
        # Refused, not dropped — silently discarding it is how somebody files
        # a task somewhere they can never look.
        with self.assertRaises(HTTPException) as caught:
            self._create(room="dungeon")
        self.assertEqual(caught.exception.status_code, 400)

    def test_case_and_spacing_do_not_make_a_new_room(self):
        card = self._create(room="  Kitchen ")
        self.assertEqual(card["room"], "kitchen")

    # --- editing --------------------------------------------------------

    def test_a_task_can_be_moved_to_another_room(self):
        card = self._create(room="kitchen")
        out = self._patch(card["card_id"], room="bathroom")
        self.assertEqual(out["room"], "bathroom")

    def test_a_task_can_be_taken_out_of_a_room(self):
        # "" means "not in a room any more". A truthy check would refuse this
        # forever, and the composer offers exactly this by tapping the chosen
        # chip again.
        card = self._create(room="kitchen")
        out = self._patch(card["card_id"], room="")
        self.assertEqual(out["room"], "")

    def test_an_edit_that_does_not_mention_the_room_leaves_it_alone(self):
        # The difference between "" and None. Fixing a typo in the title must
        # not move a task out of the kitchen.
        card = self._create(room="kitchen")
        out = self._patch(card["card_id"], title="Clean the sink properly")
        self.assertEqual(out["room"], "kitchen")

    def test_an_unknown_room_is_refused_on_edit_too(self):
        # The bug this repository has hit twice already: two endpoints
        # disagreeing about what a valid value is, and the permissive one
        # being the route people actually use.
        card = self._create(room="kitchen")
        with self.assertRaises(HTTPException) as caught:
            self._patch(card["card_id"], room="dungeon")
        self.assertEqual(caught.exception.status_code, 400)
        stored = asyncio.run(self.db["cards"].find_one({"card_id": card["card_id"]}))
        self.assertEqual(stored["room"], "kitchen")

    # --- the vocabulary itself -------------------------------------------

    def test_the_client_and_the_server_agree_on_the_rooms(self):
        # Two copies of a vocabulary drift, and the direction they drift in is
        # one side offering a room the other refuses to store.
        here = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "rooms.ts")
        with open(here, encoding="utf-8") as fh:
            source = fh.read()
        listed = source[source.index("export const ROOMS"):source.index("];")]
        client = set(part.strip().strip("',") for part in listed.split("'") if part.strip().isalpha())
        client = {c for c in client if c not in {"Room", "export", "const", "ROOMS"}}
        self.assertEqual(client, set(server.ROOM_VALUES))


if __name__ == "__main__":
    unittest.main()
