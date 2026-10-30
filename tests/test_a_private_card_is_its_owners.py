"""A private card is its owner's, to change or to remove.

Roland, 2026-10-30: "private remains private". #720 had let a co-parent
correct the text of the other's private card, on the grounds that the save
did not move its sharing. The listing, the search, the brief and the lock
screen already keep a private card out of the other person's sight; this
closes the write side too, so a card reached by its id alone cannot be
edited or deleted from under its owner.

What stays as it was: the owner changes and removes their own private card;
a SHARED card of the other's can still be corrected (tests/test_coparent_can_edit.py);
a card written before ownership was recorded has no owner and stays the
household's.

Run with:  python3 -m pytest tests/test_a_private_card_is_its_owners.py -q
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase
    from fastapi import HTTPException


@unittest.skipUnless(HAVE, "backend deps not installed")
class APrivateCardIsItsOwners(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

        async def quiet(*a, **k):
            return {"sent": 0}
        self._expo, server.send_expo_push_messages = server.send_expo_push_messages, quiet
        self._web = server.send_web_push_to_user

        async def no_web(database, user_id, title, body, data):
            return 0
        server.send_web_push_to_user = no_web

        run = asyncio.run
        for uid, name, member in (("u_k", "Keigh", "m_k"), ("u_r", "Roland", "m_r")):
            run(self.db["users"].insert_one(
                {"user_id": uid, "family_id": "fam", "name": name, "language": "en"}))
            run(self.db["family_members"].insert_one(
                {"member_id": member, "family_id": "fam", "name": name,
                 "role": "parent", "user_id": uid}))
        self.keigh = {"user_id": "u_k", "family_id": "fam", "name": "Keigh"}
        self.roland = {"user_id": "u_r", "family_id": "fam", "name": "Roland"}

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._expo
        server.send_web_push_to_user = self._web

    def _keighs_card(self, shared, title="Passport renewal"):
        return asyncio.run(server.create_card(
            server.CardIn(type="TASK", title=title, shared=shared), user=self.keigh))

    def _edit(self, who, card, **fields):
        payload = server.CardPatchIn(**{
            "title": fields.get("title", card["title"]),
            "description": fields.get("description", card.get("description") or ""),
            "assignee": fields.get("assignee", card.get("assignee") or ""),
            "shared": fields.get("shared", card.get("shared")),
        })
        return asyncio.run(server.update_card(card["card_id"], payload, user=who))

    def _stored(self, card):
        return asyncio.run(self.db["cards"].find_one({"card_id": card["card_id"]}, {"_id": 0}))

    def test_the_other_parent_cannot_change_its_text(self):
        card = self._keighs_card(shared=False)
        with self.assertRaises(HTTPException) as caught:
            self._edit(self.roland, card, title="Passport renewal form")
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(self._stored(card)["title"], "Passport renewal")

    def test_the_other_parent_cannot_tick_it_off(self):
        card = self._keighs_card(shared=False)
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.update_card(
                card["card_id"], server.CardPatchIn(status="DONE"), user=self.roland))
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(self._stored(card)["status"], "OPEN")

    def test_the_other_parent_cannot_delete_it(self):
        card = self._keighs_card(shared=False)
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.delete_card(card["card_id"], user=self.roland))
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIsNotNone(self._stored(card), "the refusal must not have deleted")

    def test_the_owner_still_changes_and_removes_their_own(self):
        card = self._keighs_card(shared=False)
        out = self._edit(self.keigh, card, title="Passport renewal form")
        self.assertEqual(out["title"], "Passport renewal form")
        asyncio.run(server.delete_card(card["card_id"], user=self.keigh))
        self.assertIsNone(self._stored(card))

    def test_a_shared_card_of_the_others_is_still_correctable(self):
        card = self._keighs_card(shared=True, title="Book the dentits")
        out = self._edit(self.roland, card, title="Book the dentist")
        self.assertEqual(out["title"], "Book the dentist")

    def test_a_card_with_no_owner_is_still_everybodys(self):
        card = self._keighs_card(shared=False)
        asyncio.run(self.db["cards"].update_one(
            {"card_id": card["card_id"]}, {"$unset": {"created_by_user_id": ""}}))
        out = self._edit(self.roland, card, title="Legacy, edited")
        self.assertEqual(out["title"], "Legacy, edited")

    def test_the_refusal_is_a_rule_not_a_lost_session(self):
        # A 403 is "not yours", which the app says in its own words
        # (src/apiError.ts, err_not_allowed); a 401 would send them to sign in.
        card = self._keighs_card(shared=False)
        with self.assertRaises(HTTPException) as caught:
            self._edit(self.roland, card, title="x")
        self.assertEqual(caught.exception.status_code, 403)
        self.assertIn("private", caught.exception.detail)


if __name__ == "__main__":
    unittest.main()
