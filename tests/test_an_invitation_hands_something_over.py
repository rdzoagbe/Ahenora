"""An invitation hands over one real thing, and joining collects it.

Two of 92 households have a second adult. The ask that produced that number
was an optional email field at the end of onboarding: it named nobody, offered
nothing, and the person who accepted arrived in an empty app. Work package 1
replaces it with an invitation that carries one card, and a join that has
already moved it.

Sending an invitation stays optional — a household is allowed to be one adult.
Choosing what to hand over is not optional once you are sending one, and that
is enforced in the screens; the API stays tolerant so a client that has not yet
picked up the new build can still invite somebody. What the API does refuse is
a handover that is not real, which these pin.
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
    from fastapi import HTTPException


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class HandingSomethingOver(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._send = server.send_expo_push_messages

        async def quiet(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = quiet

        self.now = server.utcnow()
        self.roland = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}

        async def seed():
            await self.db["users"].insert_one(dict(self.roland))
            await self.db["families"].insert_one({"family_id": "fam1", "plan": "village"})
            await self.db["family_members"].insert_one(
                {"member_id": "m_r", "family_id": "fam1", "user_id": "u_r",
                 "name": "Roland", "role": "parent"})
            await self.db["cards"].insert_one(
                {"card_id": "c_pickup", "family_id": "fam1", "title": "Tuesday school pickup",
                 "type": "TASK", "status": "OPEN", "assignee": "Roland", "icon": "car",
                 "recurrence": "weekly", "due_date": self.now + timedelta(days=2),
                 "created_at": self.now, "source": "MANUAL"})
            await self.db["cards"].insert_one(
                {"card_id": "c_done", "family_id": "fam1", "title": "Already handled",
                 "type": "TASK", "status": "DONE", "assignee": "Roland",
                 "created_at": self.now, "source": "MANUAL"})
            await self.db["cards"].insert_one(
                {"card_id": "c_theirs", "family_id": "fam1", "title": "Ella's reading",
                 "type": "CHORE", "status": "OPEN", "assignee": "Ella",
                 "created_at": self.now, "source": "MANUAL"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._send

    # --- what may be offered -------------------------------------------------

    def test_the_candidates_are_things_that_are_mine_to_give(self):
        out = asyncio.run(server.invite_handover_candidates(user=dict(self.roland)))
        ids = [c["card_id"] for c in out["candidates"]]
        self.assertIn("c_pickup", ids)
        self.assertNotIn("c_done", ids, "a finished task is not a handover")
        self.assertNotIn("c_theirs", ids, "handing over somebody else's job is not mine to offer")

    def test_a_candidate_carries_what_the_screen_needs_to_draw_it(self):
        card = asyncio.run(server.invite_handover_candidates(user=dict(self.roland)))["candidates"][0]
        self.assertEqual(card["title"], "Tuesday school pickup")
        self.assertEqual(card["icon"], "car")
        self.assertEqual(card["recurrence"], "weekly")
        self.assertIsNotNone(card["due_date"])

    def test_dated_things_are_offered_before_undated_ones(self):
        async def add_undated():
            await self.db["cards"].insert_one(
                {"card_id": "c_someday", "family_id": "fam1", "title": "Sort the garage",
                 "type": "TASK", "status": "OPEN", "assignee": "", "created_at": self.now,
                 "source": "MANUAL"})
        asyncio.run(add_undated())
        ids = [c["card_id"] for c in
               asyncio.run(server.invite_handover_candidates(user=dict(self.roland)))["candidates"]]
        self.assertLess(ids.index("c_pickup"), ids.index("c_someday"))

    # --- what may be promised ------------------------------------------------

    def test_a_promise_of_nothing_is_allowed(self):
        # The API stays tolerant: the screens require a choice, the wire does
        # not, so a client on the old build can still send an invitation.
        self.assertIsNone(asyncio.run(server._resolve_handover(self.db, dict(self.roland), None)))
        self.assertIsNone(asyncio.run(server._resolve_handover(self.db, dict(self.roland), "  ")))

    def test_a_promise_of_a_real_card_is_kept(self):
        self.assertEqual(
            asyncio.run(server._resolve_handover(self.db, dict(self.roland), "c_pickup")),
            "c_pickup")

    def test_a_promise_of_something_that_is_not_there_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server._resolve_handover(self.db, dict(self.roland), "c_nope"))
        self.assertEqual(caught.exception.status_code, 404)

    def test_a_promise_of_something_finished_is_refused(self):
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server._resolve_handover(self.db, dict(self.roland), "c_done"))
        self.assertEqual(caught.exception.status_code, 400)

    def test_a_promise_of_another_household_s_card_is_refused(self):
        async def other():
            await self.db["cards"].insert_one(
                {"card_id": "c_other", "family_id": "fam2", "title": "Not ours",
                 "type": "TASK", "status": "OPEN", "created_at": self.now, "source": "MANUAL"})
        asyncio.run(other())
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server._resolve_handover(self.db, dict(self.roland), "c_other"))
        self.assertEqual(caught.exception.status_code, 404)

    # --- the join collects it ------------------------------------------------

    def invite_with_handover(self, card_id="c_pickup"):
        invite = server._new_invite_doc(self.roland, email="k@x.com", handover_card_id=card_id)
        asyncio.run(self.db["family_invites"].insert_one(dict(invite)))
        return invite

    def join(self, invite):
        keigh = {"user_id": "u_k", "family_id": "fam_other", "name": "Keigh", "email": "k@x.com",
                 "created_at": self.now}
        asyncio.run(self.db["users"].insert_one(dict(keigh)))
        return asyncio.run(server._accept_invite_for_user(self.db, keigh, invite, "fam1"))

    def card(self, card_id="c_pickup"):
        return asyncio.run(self.db["cards"].find_one({"card_id": card_id}))

    def test_joining_puts_the_promised_card_on_the_newcomer(self):
        invite = self.invite_with_handover()
        self.join(invite)
        self.assertEqual(self.card()["assignee"], "Keigh",
                         "the whole point: something has already moved when they arrive")

    def test_the_handover_is_stamped_so_it_can_be_measured(self):
        invite = self.invite_with_handover()
        self.join(invite)
        stored = asyncio.run(self.db["family_invites"].find_one({"invite_id": invite["invite_id"]}))
        self.assertIsNotNone(stored.get("handover_done_at"))

    def test_an_invitation_that_promised_nothing_moves_nothing(self):
        invite = server._new_invite_doc(self.roland, email="k@x.com")
        asyncio.run(self.db["family_invites"].insert_one(dict(invite)))
        self.join(invite)
        self.assertEqual(self.card()["assignee"], "Roland")

    def test_a_card_finished_between_the_ask_and_the_join_is_left_alone(self):
        invite = self.invite_with_handover()

        async def finish():
            await self.db["cards"].update_one({"card_id": "c_pickup"}, {"$set": {"status": "DONE"}})
        asyncio.run(finish())
        _, joined = self.join(invite)
        self.assertTrue(joined, "a missing welcome gift must never fail somebody's arrival")
        self.assertEqual(self.card()["assignee"], "Roland")

    def test_a_card_deleted_between_the_ask_and_the_join_is_survived(self):
        invite = self.invite_with_handover()

        async def remove():
            await self.db["cards"].delete_one({"card_id": "c_pickup"})
        asyncio.run(remove())
        _, joined = self.join(invite)
        self.assertTrue(joined)

    def test_the_handover_happens_once(self):
        invite = self.invite_with_handover()
        self.join(invite)
        stored = asyncio.run(self.db["family_invites"].find_one({"invite_id": invite["invite_id"]}))

        async def give_back():
            await self.db["cards"].update_one({"card_id": "c_pickup"},
                                              {"$set": {"assignee": "Roland"}})
        asyncio.run(give_back())
        asyncio.run(server._perform_handover(self.db, stored, {"user_id": "u_k", "name": "Keigh"}))
        self.assertEqual(self.card()["assignee"], "Roland",
                         "handing it back must stick; the invitation does not keep re-taking it")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatTheInvitedPersonIsShown(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.now = server.utcnow()
        roland = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}

        async def seed():
            await self.db["users"].insert_one(dict(roland))
            await self.db["cards"].insert_one(
                {"card_id": "c_pickup", "family_id": "fam1", "title": "Tuesday school pickup",
                 "type": "TASK", "status": "OPEN", "icon": "car", "assignee": "Roland",
                 "due_date": self.now + timedelta(days=2), "created_at": self.now,
                 "source": "MANUAL"})
            await self.db["cards"].insert_one(
                {"card_id": "c_soon", "family_id": "fam1", "title": "Dentist", "type": "EVENT",
                 "status": "OPEN", "due_date": self.now + timedelta(days=3),
                 "created_at": self.now, "source": "MANUAL"})
            await self.db["cards"].insert_one(
                {"card_id": "c_far", "family_id": "fam1", "title": "Next month", "type": "TASK",
                 "status": "OPEN", "due_date": self.now + timedelta(days=30),
                 "created_at": self.now, "source": "MANUAL"})
            for mid, role in (("m_a", "child"), ("m_b", "child"), ("m_r", "parent")):
                await self.db["family_members"].insert_one(
                    {"member_id": mid, "family_id": "fam1", "role": role, "name": mid})
            await self.db["shopping_list"].insert_one(
                {"item_id": "i1", "family_id": "fam1", "name": "Milk", "checked": False,
                 "created_at": self.now})
            await self.db["shopping_list"].insert_one(
                {"item_id": "i2", "family_id": "fam1", "name": "Bread", "checked": True,
                 "created_at": self.now})
            self.invite = server._new_invite_doc(roland, email="k@x.com",
                                                 handover_card_id="c_pickup")
            await self.db["family_invites"].insert_one(dict(self.invite))
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db

    def lookup(self):
        return asyncio.run(server.family_invite_lookup(self.invite["token"]))

    def test_it_names_who_asked_and_what_is_waiting(self):
        out = self.lookup()
        self.assertEqual(out["inviter_name"], "Roland")
        self.assertEqual(out["handover"]["title"], "Tuesday school pickup")
        self.assertEqual(out["handover"]["icon"], "car")

    def test_it_counts_the_household_without_naming_its_contents(self):
        # The reader has not joined and may never join: they see how big the
        # thing is, never what is in it.
        household = self.lookup()["household"]
        self.assertEqual(household["things_this_week"], 2)   # pickup + dentist, not next month
        self.assertEqual(household["children"], 2)
        self.assertEqual(household["shopping_items"], 1)     # the bought one does not count
        self.assertNotIn("Dentist", str(household))

    def test_a_handover_completed_before_they_looked_is_not_advertised(self):
        async def finish():
            await self.db["cards"].update_one({"card_id": "c_pickup"}, {"$set": {"status": "DONE"}})
        asyncio.run(finish())
        self.assertIsNone(self.lookup()["handover"],
                          "promising a card that is already done is worse than promising nothing")

    def test_an_invitation_with_no_handover_still_looks_up(self):
        bare = server._new_invite_doc({"user_id": "u_r", "family_id": "fam1", "name": "Roland"},
                                      email="z@x.com")
        asyncio.run(self.db["family_invites"].insert_one(dict(bare)))
        out = asyncio.run(server.family_invite_lookup(bare["token"]))
        self.assertIsNone(out["handover"])
        self.assertEqual(out["household"]["children"], 2)


if __name__ == "__main__":
    unittest.main()
