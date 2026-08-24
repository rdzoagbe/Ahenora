"""A task added with the + button reaches the household.

It did not. CardIn.shared defaulted to False and the add-card screen never sent
the field, so every task created through the app's main button was stored
private: invisible to everyone else (list_cards returns shared items plus your
own) and silent (both push paths are gated on shared). A co-parent could add the
school run and the other parent would never see it or hear about it.

The other half matters just as much, and an earlier version of this change broke
it: private still means private. Somebody planning a surprise party puts a name
on the card and keeps it to themselves, and no rule about assignees may override
that. Filling in a value nobody supplied is not the same as overriding one
somebody chose.

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
class CardSharing(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        for u in (ROLAND, KEIGH):
            asyncio.run(self.db["users"].insert_one(dict(u)))
            asyncio.run(self.db["family_members"].insert_one(
                {"member_id": f"m_{u['user_id']}", "family_id": "fam1",
                 "user_id": u["user_id"], "name": u["name"], "role": "Parent"}))

    def tearDown(self):
        server.get_db = self._get_db

    def _create(self, actor, **kw):
        payload = server.CardIn(**kw)
        return asyncio.run(server.create_card(payload, user=dict(actor)))

    def _visible_to(self, actor):
        # status=None explicitly: called directly rather than through FastAPI,
        # the Query(default=None) sentinel is a truthy object, so omitting it
        # adds a status filter that matches nothing.
        return [c["title"] for c in
                asyncio.run(server.list_cards(status=None, user=dict(actor)))]

    def test_a_card_with_no_opinion_is_shared(self):
        # The bug: the + screen sends no `shared`, so the default decides. It
        # must decide in favour of the household, or the app's main button
        # produces something nobody else can see.
        card = self._create(ROLAND, title="Bin night")
        self.assertTrue(card["shared"])
        self.assertIn("Bin night", self._visible_to(KEIGH))

    def test_asking_for_private_is_honoured(self):
        card = self._create(ROLAND, title="Surprise party", shared=False)
        self.assertFalse(card["shared"])
        self.assertNotIn("Surprise party", self._visible_to(KEIGH))

    def test_private_survives_a_name_on_the_card(self):
        # An earlier attempt made an assignee force sharing. That silently
        # overrode a deliberate choice - and a surprise party planned FOR Keigh
        # is exactly the card that carries their name and must not reach them.
        card = self._create(ROLAND, title="Keigh's birthday", assignee="Keigh", shared=False)
        self.assertFalse(card["shared"])
        self.assertNotIn("Keigh's birthday", self._visible_to(KEIGH))

    def test_the_owner_still_sees_their_own_private_card(self):
        self._create(ROLAND, title="Therapy booking", shared=False)
        self.assertIn("Therapy booking", self._visible_to(ROLAND))


if __name__ == "__main__":
    unittest.main()
