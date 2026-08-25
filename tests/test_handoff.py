"""Hand-off: assigning something has to reach the person it lands on.

The quiet failure this closes — one parent writes the other's name into a
task and considers it delegated; the other finds out days later by noticing
their own name, or never. Writing a name in a field is not communication.

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

ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
KEIGH = {"user_id": "u_k", "family_id": "fam1", "name": "Keigh", "email": "k@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class HandOff(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        for u in (ROLAND, KEIGH):
            asyncio.run(self.db["users"].insert_one({**u, "language": "en"}))
            asyncio.run(self.db["family_members"].insert_one({
                "member_id": f"m_{u['user_id']}", "family_id": "fam1",
                "user_id": u["user_id"], "name": u["name"], "role": "Parent", "stars": 0}))
        # A child is a member without a login — nothing to push to.
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_ama", "family_id": "fam1", "name": "Ama",
            "role": "Child", "stars": 0}))
        self.pushes = []
        self._send = server.send_push_to_user

        async def capture(database, user_id, title, body, data, **kwargs):
            self.pushes.append({"user_id": user_id, "title": title, "body": body,
                                "data": data, **kwargs})

        server.send_push_to_user = capture

    def tearDown(self):
        server.get_db = self._get_db
        server.send_push_to_user = self._send

    def _card(self, user, title, assignee=None, shared=True, due_date=None):
        payload = server.CardIn(type="TASK", title=title, assignee=assignee,
                                shared=shared, due_date=due_date)
        return asyncio.run(server.create_card(payload, user=dict(user)))

    def _patch(self, card_id, user, **fields):
        return asyncio.run(server.update_card(
            card_id, server.CardPatchIn(**fields), user=dict(user)))

    def _mine(self, user):
        return asyncio.run(server.list_assigned_to_me(user=dict(user)))

    # --- the ping -------------------------------------------------------
    def test_assigning_a_new_task_reaches_the_other_parent(self):
        self._card(ROLAND, "School run", assignee="Keigh")
        self.assertEqual(len(self.pushes), 1)
        self.assertEqual(self.pushes[0]["user_id"], "u_k")
        self.assertIn("Roland", self.pushes[0]["title"])
        self.assertIn("School run", self.pushes[0]["body"])

    def test_the_due_date_travels_with_the_ping(self):
        self._card(ROLAND, "School run", assignee="Keigh", due_date="2026-03-14T09:00:00Z")
        self.assertIn("14/03", self.pushes[0]["body"])

    def test_handing_an_existing_task_over_pings_the_new_owner(self):
        card = self._card(ROLAND, "Bins out", assignee="Roland")
        self.pushes.clear()
        self._patch(card["card_id"], ROLAND, assignee="Keigh")
        self.assertEqual([p["user_id"] for p in self.pushes], ["u_k"])

    def test_it_speaks_the_recipients_language_not_the_senders(self):
        asyncio.run(self.db["users"].update_one(
            {"user_id": "u_k"}, {"$set": {"language": "fr"}}))
        self._card(ROLAND, "Course d'école", assignee="Keigh")
        self.assertIn("vous a confié", self.pushes[0]["title"])

    # --- the silences ---------------------------------------------------
    def test_assigning_something_to_yourself_says_nothing(self):
        self._card(ROLAND, "My own errand", assignee="Roland")
        self.assertEqual(self.pushes, [])

    def test_a_private_task_kept_to_yourself_is_nobodys_business(self):
        # Private + assigned to YOURSELF stays silent and private — the surprise
        # you are planning. (Assigning to someone else now forces it shared, so
        # a private task is one you keep to yourself or leave unassigned.)
        self._card(ROLAND, "Therapy booking", assignee="Roland", shared=False)
        self.assertEqual(self.pushes, [])

    def test_a_child_has_no_login_so_nothing_is_sent(self):
        self._card(ROLAND, "Tidy room", assignee="Ama")
        self.assertEqual(self.pushes, [])

    def test_resaving_without_touching_the_assignee_does_not_ping_again(self):
        card = self._card(ROLAND, "School run", assignee="Keigh")
        self.pushes.clear()
        self._patch(card["card_id"], ROLAND, title="School run (Tuesdays)")
        self.assertEqual(self.pushes, [])

    def test_a_failed_push_never_takes_the_task_down_with_it(self):
        async def explode(*a, **k):
            raise RuntimeError("expo down")
        server.send_push_to_user = explode
        card = self._card(ROLAND, "School run", assignee="Keigh")
        self.assertEqual(card["assignee"], "Keigh")

    # --- the list -------------------------------------------------------
    def test_my_list_holds_what_was_handed_to_me_and_nothing_else(self):
        self._card(ROLAND, "School run", assignee="Keigh")
        self._card(ROLAND, "Bins out", assignee="Roland")
        self._card(ROLAND, "Unassigned thing")
        self.assertEqual([c["title"] for c in self._mine(KEIGH)], ["School run"])

    def test_finished_work_leaves_my_list(self):
        card = self._card(ROLAND, "School run", assignee="Keigh")
        self._patch(card["card_id"], KEIGH, status="DONE")
        self.assertEqual(self._mine(KEIGH), [])

    def test_dated_work_comes_first_in_date_order(self):
        self._card(ROLAND, "Later", assignee="Keigh", due_date="2026-05-01T09:00:00Z")
        self._card(ROLAND, "Someday", assignee="Keigh")
        self._card(ROLAND, "Sooner", assignee="Keigh", due_date="2026-03-01T09:00:00Z")
        self.assertEqual([c["title"] for c in self._mine(KEIGH)],
                         ["Sooner", "Later", "Someday"])

    def test_a_co_parents_private_task_never_appears(self):
        # A private task the other parent keeps to themselves (here, planning a
        # surprise — assigned to self, not to Keigh) never shows on Keigh's list.
        self._card(ROLAND, "Surprise party planning", assignee="Roland", shared=False)
        self.assertEqual(self._mine(KEIGH), [])

    def test_assigning_an_old_private_task_shares_it_and_pings(self):
        # The reported bug: an old private task, edited to assign to the other
        # parent, must become visible and notify them — not stay hidden.
        card = self._card(ROLAND, "Old private thing", assignee="Roland", shared=False)
        self.pushes.clear()
        out = self._patch(card["card_id"], ROLAND, assignee="Keigh")
        self.assertTrue(out["shared"])
        self.assertEqual([p["user_id"] for p in self.pushes], ["u_k"])

    # --- the record -----------------------------------------------------
    def test_the_household_feed_records_who_it_was_given_to(self):
        self._card(ROLAND, "School run", assignee="Keigh")
        entry = asyncio.run(server.list_activity(user=dict(ROLAND)))[0]
        self.assertEqual(entry["kind"], "task_assigned")
        self.assertEqual(entry["subject"], "School run")
        self.assertEqual(entry["target"], "Keigh")


if __name__ == "__main__":
    unittest.main()
