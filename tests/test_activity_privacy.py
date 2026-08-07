"""The feed is yours: everything you do is private unless it is shared.

Two people share a household. The rule the product settled on is "everything
you do is yours" — a co-parent's feed shows the household's shared lines and
nothing a co-parent did privately. Deleting is the other half: a private line
is erased, a shared line only leaves your own view. And a line about a thing
that has been deleted must not linger.

The failure this guards is quiet and serious: a private "Consult divorce
lawyer, done" leaking into the other parent's feed. It cannot be caught by
eye — the row looks identical either way — so it is pinned here, against the
double that now models array membership the way Mongo does (without which a
per-person hide list "works" in the test and never filters in production).
"""

import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone

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


ME = {"user_id": "u1", "family_id": "fam1", "name": "Roland"}
CO = {"user_id": "u9", "family_id": "fam1", "name": "Keigh"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheFeedIsYours(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self.db = FakeDatabase()
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def _log(self, user, kind, subject="", shared=True, ref=""):
        asyncio.run(server.log_activity(
            self.db, user, kind, subject=subject, shared=shared, ref=ref))

    def _feed(self, user):
        return asyncio.run(server.list_activity(limit=50, user=user))

    def _ids(self, user):
        return {r["activity_id"] for r in self._feed(user)}

    # ---- visibility ------------------------------------------------------

    def test_a_private_line_is_mine_alone(self):
        self._log(ME, "task_done", "Divorce lawyer", shared=False, ref="c1")
        mine = self._feed(ME)
        self.assertEqual(len(mine), 1)
        self.assertFalse(mine[0]["shared"])
        # The co-parent's feed never carries it.
        self.assertEqual(self._feed(CO), [])

    def test_a_shared_line_is_for_everyone(self):
        self._log(ME, "task_done", "Bins", shared=True, ref="c2")
        self.assertEqual(len(self._feed(ME)), 1)
        self.assertEqual(len(self._feed(CO)), 1)

    def test_a_legacy_line_with_no_flag_stays_visible_to_all(self):
        # Rows written before privacy existed carry no `shared` field. They
        # were family-visible then and must stay so — the query uses
        # `$ne: False`, not `== True`, exactly for this.
        asyncio.run(self.db["activity"].insert_one({
            "activity_id": "legacy1", "family_id": "fam1",
            "actor_user_id": "u1", "actor_name": "Roland",
            "kind": "task_done", "subject": "Old", "created_at": server.utcnow(),
        }))
        self.assertIn("legacy1", self._ids(ME))
        self.assertIn("legacy1", self._ids(CO))

    # ---- delete / hide ---------------------------------------------------

    def test_deleting_my_private_line_erases_it(self):
        self._log(ME, "task_done", "Private", shared=False, ref="c1")
        act_id = self._feed(ME)[0]["activity_id"]
        out = asyncio.run(server.delete_activity(act_id, user=ME))
        self.assertTrue(out["deleted"])
        self.assertEqual(self._feed(ME), [])
        self.assertEqual(asyncio.run(self.db["activity"].count_documents({})), 0)

    def test_hiding_a_shared_line_keeps_it_for_the_co_parent(self):
        self._log(ME, "task_done", "Bins", shared=True, ref="c2")
        act_id = self._feed(ME)[0]["activity_id"]
        out = asyncio.run(server.delete_activity(act_id, user=ME))
        self.assertTrue(out["hidden"])
        # Gone from mine, still there for the co-parent, still on disk.
        self.assertEqual(self._feed(ME), [])
        self.assertIn(act_id, self._ids(CO))
        self.assertEqual(asyncio.run(self.db["activity"].count_documents({})), 1)

    def test_a_co_parent_cannot_delete_my_private_line(self):
        self._log(ME, "task_done", "Private", shared=False, ref="c1")
        act_id = self._feed(ME)[0]["activity_id"]
        with self.assertRaises(HTTPException) as e:
            asyncio.run(server.delete_activity(act_id, user=CO))
        self.assertEqual(e.exception.status_code, 403)
        # And it is untouched — still mine.
        self.assertIn(act_id, self._ids(ME))

    def test_deleting_a_missing_line_is_a_clean_404(self):
        with self.assertRaises(HTTPException) as e:
            asyncio.run(server.delete_activity("nope", user=ME))
        self.assertEqual(e.exception.status_code, 404)

    # ---- card deletion cascades -----------------------------------------

    def test_deleting_a_card_takes_its_feed_lines_with_it(self):
        self._log(ME, "task_created", "Bins", shared=True, ref="card42")
        self._log(ME, "task_done", "Bins", shared=True, ref="card42")
        self._log(ME, "task_done", "Other", shared=True, ref="card99")
        asyncio.run(server.delete_card("card42", user=ME))
        left = self._feed(ME)
        self.assertEqual(len(left), 1)
        self.assertEqual(left[0]["subject"], "Other")


if __name__ == "__main__":
    unittest.main()
