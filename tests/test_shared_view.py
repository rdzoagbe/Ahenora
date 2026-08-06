"""The two-way sharing view on the calendar.

"See what you share with each other" shows two directions: what I've shared
(what the co-parent sees of me) and what they've shared with me. Both must
show only shared items, name the right owner, and never cross households.

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

AMARA = {"user_id": "u_a", "family_id": "fam1", "name": "Amara", "email": "a@x.com"}
TOM = {"user_id": "u_t", "family_id": "fam1", "name": "Tom", "email": "t@x.com"}
OUTSIDER = {"user_id": "u_o", "family_id": "fam2", "name": "Nia", "email": "o@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class SharedView(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        # Both adults are family members with accounts, so the "in" view can
        # resolve owner user_id -> name.
        for u in (AMARA, TOM):
            asyncio.run(self.db["family_members"].insert_one(
                {"member_id": "m_" + u["user_id"], "family_id": "fam1",
                 "name": u["name"], "role": "Parent", "user_id": u["user_id"]}))

    def tearDown(self):
        server.get_db = self._get_db

    def _card(self, user, title, shared):
        payload = server.CardIn(type="TASK", title=title, shared=shared)
        return asyncio.run(server.create_card(payload, user=dict(user)))

    def _view(self, user, direction):
        return asyncio.run(server.list_shared_with_coparent(direction=direction, user=dict(user)))

    def test_out_shows_only_my_shared_items(self):
        self._card(AMARA, "Dentist for Kofi", shared=True)
        self._card(AMARA, "Therapy", shared=False)
        out = self._view(AMARA, "out")
        titles = [c["title"] for c in out]
        self.assertIn("Dentist for Kofi", titles)
        self.assertNotIn("Therapy", titles)

    def test_in_shows_what_the_other_parent_shared_named(self):
        self._card(TOM, "Football run", shared=True)
        self._card(TOM, "Tom's private thing", shared=False)
        inc = self._view(AMARA, "in")
        self.assertEqual([c["title"] for c in inc], ["Football run"])
        self.assertEqual(inc[0]["shared_by_name"], "Tom")

    def test_my_own_items_never_appear_in_the_in_view(self):
        self._card(AMARA, "Mine and shared", shared=True)
        self.assertEqual(self._view(AMARA, "in"), [])

    def test_a_private_item_is_in_neither_direction(self):
        self._card(AMARA, "Private A", shared=False)
        self._card(TOM, "Private T", shared=False)
        self.assertEqual(self._view(AMARA, "out"), [])
        self.assertEqual(self._view(AMARA, "in"), [])

    def test_another_household_is_never_visible(self):
        self._card(OUTSIDER, "Other family thing", shared=True)
        self.assertEqual(self._view(AMARA, "in"), [])
        self.assertEqual(self._view(AMARA, "out"), [])

    def test_making_a_shared_item_private_removes_it_from_the_out_view(self):
        card = self._card(AMARA, "Was shared", shared=True)
        self.assertEqual(len(self._view(AMARA, "out")), 1)
        asyncio.run(server.update_card(
            card["card_id"], server.CardPatchIn(shared=False), user=dict(AMARA)))
        self.assertEqual(self._view(AMARA, "out"), [])


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class SharingNumbersAgree(unittest.TestCase):
    """The panel's whole job is to be believed.

    The counts used to be inferred client-side from the agenda, which is a
    different population — it carries the co-parent's shared items and drops
    undated ones — so the banner and the panel stated different numbers one tap
    apart. Counted server-side against the same queries the lists use, they
    cannot drift.
    """

    A = {"user_id": "u_a", "family_id": "fam1", "name": "Amara", "email": "a@x.com"}
    B = {"user_id": "u_b", "family_id": "fam1", "name": "Tom", "email": "b@x.com"}

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def _card(self, cid, owner, shared, dated=True):
        asyncio.run(self.db["cards"].insert_one({
            "card_id": cid, "family_id": "fam1", "type": "TASK", "title": cid,
            "status": "OPEN", "source": "MANUAL", "created_at": server.utcnow(),
            "due_date": server.utcnow() if dated else None,
            "created_by_user_id": owner, "shared": shared}))

    def test_counts_match_the_lists_they_describe(self):
        self._card("mine_shared", "u_a", True)
        self._card("mine_shared_undated", "u_a", True, dated=False)
        self._card("mine_private", "u_a", False)
        self._card("theirs_shared", "u_b", True)
        self._card("legacy", None, True)          # ownerless: belongs to nobody

        summary = asyncio.run(server.sharing_summary(user=dict(self.A)))
        out = asyncio.run(server.list_shared_with_coparent(direction="out", user=dict(self.A)))
        inn = asyncio.run(server.list_shared_with_coparent(direction="in", user=dict(self.A)))

        # The number the banner shows IS the length of the list it opens.
        self.assertEqual(summary["shared_out"], len(out))
        self.assertEqual(summary["shared_in"], len(inn))
        # Undated items count too — they are just as visible.
        self.assertEqual(summary["shared_out"], 2)
        self.assertEqual(summary["shared_in"], 1)
        self.assertEqual(summary["private"], 1)

    def test_a_co_parents_private_item_is_counted_by_nobody(self):
        self._card("theirs_private", "u_b", False)
        summary = asyncio.run(server.sharing_summary(user=dict(self.A)))
        self.assertEqual(summary["shared_in"], 0)
        self.assertEqual(summary["private"], 0)   # not mine to count

    def test_unsharing_takes_it_out_of_their_view(self):
        self._card("c1", "u_a", True)
        asyncio.run(server.unshare_card("c1", user=dict(self.A)))
        self.assertEqual(asyncio.run(server.sharing_summary(user=dict(self.A)))["shared_out"], 0)
        self.assertEqual(asyncio.run(server.list_shared_with_coparent(direction="in", user=dict(self.B))), [])

    def test_only_the_owner_may_revoke(self):
        self._card("c1", "u_a", True)
        with self.assertRaises(server.HTTPException) as e:
            asyncio.run(server.unshare_card("c1", user=dict(self.B)))
        self.assertEqual(e.exception.status_code, 403)
        # and it is still shared
        self.assertEqual(asyncio.run(server.sharing_summary(user=dict(self.A)))["shared_out"], 1)
