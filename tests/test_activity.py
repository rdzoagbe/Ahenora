"""Who did what: completion attribution and the household activity log.

The gap this closes: the app recorded that a task was finished but never by
whom, and showed no history at all — so a co-parent opening the app found
chores mysteriously done and had to ask.

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
OTHER = {"user_id": "u_o", "family_id": "fam2", "name": "Other", "email": "o@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ActivityLog(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def _card(self, user, title, shared=True):
        payload = server.CardIn(type="TASK", title=title, shared=shared)
        return asyncio.run(server.create_card(payload, user=dict(user)))

    def _feed_for(self, user):
        return asyncio.run(server.list_activity(user=dict(user)))

    def test_finishing_a_task_records_who_did_it(self):
        card = self._card(ROLAND, "Bins out")
        done = asyncio.run(server.update_card(
            card["card_id"], server.CardPatchIn(status="DONE"), user=dict(KEIGH)))
        self.assertEqual(done["status"], "DONE")
        self.assertEqual(done["completed_by_name"], "Keigh")

    def test_reopening_a_task_clears_the_attribution(self):
        card = self._card(ROLAND, "Bins out")
        asyncio.run(server.update_card(
            card["card_id"], server.CardPatchIn(status="DONE"), user=dict(KEIGH)))
        reopened = asyncio.run(server.update_card(
            card["card_id"], server.CardPatchIn(status="OPEN"), user=dict(ROLAND)))
        self.assertIsNone(reopened["completed_by_name"])

    def test_the_feed_shows_creation_and_completion_newest_first(self):
        card = self._card(ROLAND, "School forms")
        asyncio.run(server.update_card(
            card["card_id"], server.CardPatchIn(status="DONE"), user=dict(KEIGH)))
        feed = self._feed_for(ROLAND)
        self.assertEqual([e["kind"] for e in feed], ["task_done", "task_created"])
        self.assertEqual(feed[0]["actor_name"], "Keigh")
        self.assertEqual(feed[0]["subject"], "School forms")
        self.assertEqual(feed[1]["actor_name"], "Roland")

    def test_private_tasks_are_not_announced(self):
        self._card(ROLAND, "Therapy appointment", shared=False)
        self.assertEqual(self._feed_for(ROLAND), [])

    def test_another_household_sees_nothing(self):
        card = self._card(ROLAND, "Bins out")
        asyncio.run(server.update_card(
            card["card_id"], server.CardPatchIn(status="DONE"), user=dict(KEIGH)))
        self.assertEqual(self._feed_for(OTHER), [])

    def test_stars_land_in_the_feed_with_the_child_and_amount(self):
        asyncio.run(self.db["family_members"].insert_one(
            {"member_id": "m1", "family_id": "fam1", "name": "Ama",
             "role": "Child", "stars": 0}))
        asyncio.run(server.award_stars_to_member(
            self.db, "fam1", "m1", 5, "Tidy room", dict(ROLAND)))
        entry = self._feed_for(ROLAND)[0]
        self.assertEqual(entry["kind"], "stars_awarded")
        self.assertEqual(entry["subject"], "Ama")
        self.assertEqual(entry["amount"], 5)

    def test_an_unknown_kind_is_ignored_rather_than_stored(self):
        asyncio.run(server.log_activity(self.db, dict(ROLAND), "not_a_kind", "x"))
        self.assertEqual(self._feed_for(ROLAND), [])

    def test_logging_never_breaks_the_action_it_describes(self):
        # A broken activity write must not take a completed task down with it.
        class Exploding:
            async def insert_one(self, *a, **k):
                raise RuntimeError("db down")

        class DB:
            def __getitem__(self, name):
                return Exploding()

        asyncio.run(server.log_activity(DB(), dict(ROLAND), "task_done", "Bins"))


if __name__ == "__main__":
    unittest.main()
