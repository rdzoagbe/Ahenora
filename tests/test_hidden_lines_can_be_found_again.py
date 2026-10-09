"""A household line cleared from Home can be found again, and put back.

Hiding was one-way. The X on a line in "In the household" removed it from
your Home and nothing anywhere listed it again, so a tap on the wrong line
lost it for good as far as you could tell. The completed-history screen now
lists what you hid under its own heading, with "Show again". The record was
always kept for the co-parent; this only gives it back to the person who hid
it.

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
    import server
    from fake_mongo import FakeDatabase
    HAVE = True
except ImportError:
    HAVE = False


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@unittest.skipUnless(HAVE, "backend deps not installed")
class HiddenLinesCanBeFoundAgain(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        run(self._seed())

    def tearDown(self):
        server.get_db = self._get_db

    async def _seed(self):
        now = server.utcnow()
        # Keigh finished the bins: a shared line both parents see.
        await self.db["activity"].insert_one({
            "activity_id": "a_bins", "family_id": "fam1", "actor_user_id": "u_k",
            "actor_name": "Keigh", "kind": "task_done", "subject": "Bins out",
            "shared": True, "hidden_by": [], "created_at": now})
        # Roland's own private line: only he sees it, and deleting it erases it.
        await self.db["activity"].insert_one({
            "activity_id": "a_mine", "family_id": "fam1", "actor_user_id": "u_r",
            "actor_name": "Roland", "kind": "task_created", "subject": "Dentist",
            "shared": False, "hidden_by": [], "created_at": now})
        # Another household's line, hidden by one of its own people.
        await self.db["activity"].insert_one({
            "activity_id": "a_other", "family_id": "fam2", "actor_user_id": "u_x",
            "actor_name": "Someone", "kind": "task_done", "subject": "Lawn",
            "shared": True, "hidden_by": ["u_y"], "created_at": now})

    @staticmethod
    def _user(uid="u_r", fam="fam1"):
        return {"user_id": uid, "family_id": fam, "name": {"u_r": "Roland", "u_k": "Keigh"}.get(uid, "Y")}

    @staticmethod
    def _ids(rows):
        return [r["activity_id"] for r in rows]

    def test_a_hidden_line_leaves_home_and_appears_under_hidden(self):
        run(server.delete_activity("a_bins", user=self._user()))
        home = run(server.list_activity(limit=12, user=self._user()))
        hidden = run(server.list_hidden_activity(user=self._user()))
        self.assertNotIn("a_bins", self._ids(home))
        self.assertEqual(self._ids(hidden), ["a_bins"])
        # The line reads as the household line it is: who did what.
        self.assertEqual(hidden[0]["actor_name"], "Keigh")
        self.assertEqual(hidden[0]["kind"], "task_done")

    def test_show_again_puts_it_back_on_home_for_me_only(self):
        run(server.delete_activity("a_bins", user=self._user()))
        # Keigh never hid it, so her Home carried it throughout.
        self.assertIn("a_bins", self._ids(run(server.list_activity(limit=12, user=self._user("u_k")))))
        self.assertEqual(run(server.list_hidden_activity(user=self._user("u_k"))), [])

        self.assertEqual(run(server.unhide_activity("a_bins", user=self._user())), {"ok": True})
        self.assertIn("a_bins", self._ids(run(server.list_activity(limit=12, user=self._user()))))
        self.assertEqual(run(server.list_hidden_activity(user=self._user())), [])

    def test_nothing_hidden_means_an_empty_list_not_an_error(self):
        self.assertEqual(run(server.list_hidden_activity(user=self._user())), [])

    def test_a_private_line_is_deleted_not_hidden_so_it_is_not_listed(self):
        run(server.delete_activity("a_mine", user=self._user()))
        self.assertEqual(run(server.list_hidden_activity(user=self._user())), [])
        self.assertNotIn("a_mine", self._ids(run(server.list_activity(limit=12, user=self._user()))))

    def test_showing_again_a_line_you_never_hid_is_not_found(self):
        with self.assertRaises(fastapi.HTTPException) as caught:
            run(server.unhide_activity("a_bins", user=self._user()))
        self.assertEqual(caught.exception.status_code, 404)

    def test_another_household_cannot_see_or_touch_your_hidden_lines(self):
        run(server.delete_activity("a_bins", user=self._user()))
        stranger = self._user("u_y", "fam2")
        self.assertEqual(self._ids(run(server.list_hidden_activity(user=stranger))), ["a_other"])
        with self.assertRaises(fastapi.HTTPException) as caught:
            run(server.unhide_activity("a_bins", user=stranger))
        self.assertEqual(caught.exception.status_code, 404)
        # Still hidden for Roland, exactly as he left it.
        self.assertEqual(self._ids(run(server.list_hidden_activity(user=self._user()))), ["a_bins"])


if __name__ == "__main__":
    unittest.main()
