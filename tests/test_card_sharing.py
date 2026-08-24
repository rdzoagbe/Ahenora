"""An assigned task carries who set it, and defaults to shared.

Assigning defaults to shared (so a task handed to the co-parent is visible to
both without a thought), while an explicit private is still respected — that is
how a surprise stays a surprise. And the creator's name now rides along so an
assigned card can say who set it.

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
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase

A = {"user_id": "u1", "family_id": "fam1", "name": "Roland"}
B = {"user_id": "u2", "family_id": "fam1", "name": "Kim"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AssignedIsShared(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._real_send = server.send_expo_push_messages

        async def fake_send(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = fake_send

        async def seed():
            for u, mid in ((A, "m1"), (B, "m2")):
                await self.db["users"].insert_one({**u})
                await self.db["family_members"].insert_one({
                    "member_id": mid, "family_id": "fam1", "user_id": u["user_id"],
                    "name": u["name"], "role": "Parent"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._real_send

    def _create(self, user, **kw):
        payload = server.CardIn(type="TASK", title=kw.pop("title", "School run"), **kw)
        return asyncio.run(server.create_card(payload, user=dict(user)))

    def test_assigning_to_other_forces_shared(self):
        # Handing a task to someone else makes it shared, even if private is
        # asked for — you cannot assign a job and hide it from the assignee.
        card = self._create(A, assignee="Kim", shared=False)
        self.assertTrue(card["shared"])
        self.assertEqual(card["created_by_name"], "Roland")

    def test_self_assigned_private_stays_private(self):
        # A private personal to-do (assigned to yourself, or a surprise you are
        # planning) still obeys the toggle.
        card = self._create(A, title="Surprise party", assignee="Roland", shared=False)
        self.assertFalse(card["shared"])

    def test_editing_to_assign_an_old_private_task_shares_it(self):
        # The reported bug: an old private task, edited to assign to the other
        # parent, becomes visible.
        card = self._create(A, title="Old thing", assignee="Roland", shared=False)
        self.assertFalse(card["shared"])
        out = asyncio.run(server.update_card(
            card["card_id"], server.CardPatchIn(assignee="Kim"), user=dict(A)))
        self.assertTrue(out["shared"])

    def test_created_by_name_is_returned(self):
        card = self._create(B, assignee="Roland")
        self.assertEqual(card["created_by_name"], "Kim")

    def test_recurring_occurrence_keeps_the_creator_name(self):
        card = self._create(A, assignee="Kim", recurrence="weekly",
                            due_date="2026-08-25T08:00:00Z")
        asyncio.run(server.update_card(
            card["card_id"], server.CardPatchIn(status="DONE"), user=dict(A)))
        spawned = asyncio.run(self.db["cards"].find_one(
            {"family_id": "fam1", "status": "OPEN", "title": "School run"}))
        self.assertEqual(spawned["created_by_name"], "Roland")
        self.assertTrue(spawned["shared"])              # inherits parent's sharing


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AssignedTaskIsScopedNotHouseholdWide(unittest.TestCase):
    """An assigned task is shared with the people it concerns — the two parents
    (who answer for the household) and the person it lands on — not with the
    whole household. A helper or another child does not see a job that was not
    handed to them, and does not see a job the two parents keep between them."""

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._real_send = server.send_expo_push_messages

        async def fake_send(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = fake_send

        async def seed():
            members = [
                ("u1", "m1", "Roland", "Parent"),
                ("u2", "m2", "Kim", "Parent"),
                ("u3", "m3", "Grandma", "Helper"),   # a login, but not a parent
                ("u4", "m4", "Teo", "teen"),          # a login, a teen
            ]
            for uid, mid, name, role in members:
                await self.db["users"].insert_one(
                    {"user_id": uid, "family_id": "fam1", "name": name})
                await self.db["family_members"].insert_one({
                    "member_id": mid, "family_id": "fam1", "user_id": uid,
                    "name": name, "role": role})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._real_send

    def _create(self, uid, name, **kw):
        payload = server.CardIn(type="TASK", title=kw.pop("title", "A task"), **kw)
        return asyncio.run(server.create_card(
            payload, user={"user_id": uid, "family_id": "fam1", "name": name}))

    def _list_for(self, uid, name):
        return asyncio.run(server.list_cards(
            status=None, user={"user_id": uid, "family_id": "fam1", "name": name}))

    def _titles(self, uid, name):
        return {c["title"] for c in self._list_for(uid, name)}

    def test_parent_to_parent_task_is_seen_by_both_parents_only(self):
        self._create("u1", "Roland", title="Call the notaire", assignee="Kim")
        self.assertIn("Call the notaire", self._titles("u1", "Roland"))
        self.assertIn("Call the notaire", self._titles("u2", "Kim"))
        self.assertNotIn("Call the notaire", self._titles("u3", "Grandma"))
        self.assertNotIn("Call the notaire", self._titles("u4", "Teo"))

    def test_task_assigned_to_helper_reaches_the_helper_and_both_parents(self):
        self._create("u1", "Roland", title="Pick up meds", assignee="Grandma")
        self.assertIn("Pick up meds", self._titles("u3", "Grandma"))
        self.assertIn("Pick up meds", self._titles("u1", "Roland"))
        self.assertIn("Pick up meds", self._titles("u2", "Kim"))
        # ...but not another child who was not handed it.
        self.assertNotIn("Pick up meds", self._titles("u4", "Teo"))

    def test_task_assigned_to_teen_reaches_the_teen_and_both_parents(self):
        self._create("u1", "Roland", title="Homework", assignee="Teo")
        self.assertIn("Homework", self._titles("u4", "Teo"))
        self.assertIn("Homework", self._titles("u1", "Roland"))
        self.assertIn("Homework", self._titles("u2", "Kim"))
        self.assertNotIn("Homework", self._titles("u3", "Grandma"))

    def test_editing_the_assignee_moves_who_can_see_it(self):
        card = self._create("u1", "Roland", title="Move me", assignee="Grandma")
        self.assertIn("Move me", self._titles("u3", "Grandma"))
        asyncio.run(server.update_card(
            card["card_id"], server.CardPatchIn(assignee="Teo"),
            user={"user_id": "u1", "family_id": "fam1", "name": "Roland"}))
        self.assertNotIn("Move me", self._titles("u3", "Grandma"))
        self.assertIn("Move me", self._titles("u4", "Teo"))

    def test_an_unassigned_shared_card_is_still_whole_household(self):
        # Only assigned tasks are scoped. A plain shared card (a shopping list,
        # a note) is not, and everyone with a login still sees it.
        self._create("u1", "Roland", title="Weekend plan", shared=True)
        for uid, name in (("u2", "Kim"), ("u3", "Grandma"), ("u4", "Teo")):
            self.assertIn("Weekend plan", self._titles(uid, name))

    def test_a_private_self_assigned_task_is_never_widened_by_scoping(self):
        # The surprise case: a task assigned to yourself and kept private must
        # stay yours alone. Scoping only ever narrows a shared card; it must not
        # hand a private one to the other parent.
        self._create("u1", "Roland", title="Surprise venue",
                     assignee="Roland", shared=False)
        self.assertIn("Surprise venue", self._titles("u1", "Roland"))
        for uid, name in (("u2", "Kim"), ("u3", "Grandma"), ("u4", "Teo")):
            self.assertNotIn("Surprise venue", self._titles(uid, name))

    def test_the_shared_transparency_view_does_not_leak_a_scoped_task(self):
        # /cards/shared "in" shows what the other adults shared. A parent-to-parent
        # task is shared, but the helper is not in its set, so it must not appear.
        self._create("u1", "Roland", title="Between us", assignee="Kim")
        rows = asyncio.run(server.list_shared_with_coparent(
            direction="in", user={"user_id": "u3", "family_id": "fam1", "name": "Grandma"}))
        self.assertNotIn("Between us", {c["title"] for c in rows})


if __name__ == "__main__":
    unittest.main()
