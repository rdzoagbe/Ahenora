"""A co-parent can correct what the other one wrote.

Roland tried to edit a task Keigh had added and got:

    403: {"detail":"Only the person who added this can change its sharing"}

He was not changing its sharing. The edit sheet sends every field it holds on
every save — title, assignee, date, and `shared` — whether or not the person
touched them. The server saw a `shared` value on a card somebody else created
and refused, so in a two-parent household NOTHING either of them wrote could
ever be corrected by the other. Which is most of what a shared household app
is for.

A no-op is not a change. The rule underneath is worth keeping and is kept:
actually flipping someone else's card between shared and private is still
refused.

Run with:  python3 -m pytest tests/test_coparent_can_edit.py -q
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
class TwoParentsOneList(unittest.TestCase):
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

    def _keighs_card(self, shared=True, title="Book the dentist"):
        """Created through the real endpoint, so the row has whatever shape the
        app actually gives it rather than whatever this file remembers."""
        return asyncio.run(server.create_card(
            server.CardIn(type="TASK", title=title, shared=shared), user=self.keigh))

    def _edit(self, who, card, **fields):
        """What the edit sheet actually sends: every field it holds, including
        the sharing value it did not touch."""
        payload = server.CardPatchIn(**{
            "title": fields.get("title", card["title"]),
            "description": fields.get("description", card.get("description") or ""),
            "assignee": fields.get("assignee", card.get("assignee") or ""),
            "shared": fields.get("shared", card.get("shared")),
        })
        return asyncio.run(server.update_card(card["card_id"], payload, user=who))

    # --- the bug ---------------------------------------------------------

    def test_a_coparent_can_fix_a_typo_on_the_others_task(self):
        card = self._keighs_card(title="Book the dentits")
        out = self._edit(self.roland, card, title="Book the dentist")
        self.assertEqual(out["title"], "Book the dentist")

    def test_that_works_for_a_private_card_of_theirs_too(self):
        # Private-to-Keigh, resent unchanged. Still a no-op, still allowed —
        # and whether Roland can SEE it is a different question, answered by
        # the listing, not by the save.
        card = self._keighs_card(shared=False, title="Passport renewal")
        out = self._edit(self.roland, card, title="Passport renewal form")
        self.assertEqual(out["title"], "Passport renewal form")

    def test_and_the_sharing_is_left_exactly_as_it_was(self):
        for shared in (True, False):
            card = self._keighs_card(shared=shared, title=f"thing {shared}")
            self._edit(self.roland, card, title=f"thing {shared} edited")
            stored = asyncio.run(
                self.db["cards"].find_one({"card_id": card["card_id"]}, {"_id": 0}))
            self.assertEqual(bool(stored["shared"]), shared,
                             "an edit that did not touch sharing must not move it")

    # --- the rule it must not have broken ---------------------------------

    def test_you_still_cannot_make_someone_elses_card_private(self):
        card = self._keighs_card(shared=True)
        with self.assertRaises(HTTPException) as caught:
            self._edit(self.roland, card, shared=False)
        self.assertEqual(caught.exception.status_code, 403)
        stored = asyncio.run(
            self.db["cards"].find_one({"card_id": card["card_id"]}, {"_id": 0}))
        self.assertTrue(stored["shared"], "the refusal must also not have written")

    def test_you_still_cannot_publish_someone_elses_private_card(self):
        # The direction that actually leaks: Keigh's private note becoming
        # visible to the household because Roland flipped it.
        card = self._keighs_card(shared=False)
        with self.assertRaises(HTTPException) as caught:
            self._edit(self.roland, card, shared=True)
        self.assertEqual(caught.exception.status_code, 403)

    def test_the_person_who_added_it_can_still_change_it_either_way(self):
        card = self._keighs_card(shared=True)
        self.assertFalse(self._edit(self.keigh, card, shared=False)["shared"])
        card["shared"] = False
        self.assertTrue(self._edit(self.keigh, card, shared=True)["shared"])

    def test_a_card_with_no_owner_is_still_everybodys(self):
        # Cards created before ownership was recorded belong to the household.
        card = self._keighs_card(shared=True)
        asyncio.run(self.db["cards"].update_one(
            {"card_id": card["card_id"]}, {"$set": {"created_by_user_id": None}}))
        card["created_by_user_id"] = None
        self.assertFalse(self._edit(self.roland, card, shared=False)["shared"])


@unittest.skipUnless(HAVE, "backend deps not installed")
class WhatThePersonIsTold(unittest.TestCase):
    """The other half of the screenshot: `403: {"detail":"..."}` in a dialog."""

    def setUp(self):
        root = os.path.join(os.path.dirname(__file__), "..", "frontend", "src")
        with open(os.path.join(root, "components", "AddCardModal.tsx"),
                  encoding="utf-8") as fh:
            self.modal = fh.read()
        with open(os.path.join(root, "apiError.ts"), encoding="utf-8") as fh:
            self.api_error = fh.read()

    def test_the_card_editor_does_not_show_the_raw_response(self):
        self.assertNotIn("e?.message || t('addcard_save_failed_message')", self.modal)
        self.assertIn("apiErrorText(e, t, 'addcard_save_failed_message')", self.modal)

    def test_the_one_refusal_this_sheet_can_cause_says_what_happened(self):
        # "Save failed" and nothing else leaves someone guessing which of the
        # six fields they touched was the problem.
        self.assertIn("addcard_sharing_locked_title", self.modal)
        self.assertIn("addcard_sharing_locked_msg", self.modal)
        path = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "i18n.ts")
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
        self.assertEqual(body.count("addcard_sharing_locked_msg:"), 4)

    def test_it_tells_them_their_other_edits_survived(self):
        # True, and worth saying: the sheet only clears on success, so the
        # typo they came to fix is still in the box.
        path = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "i18n.ts")
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if "addcard_sharing_locked_msg:" in line and "Only the person" in line:
                    self.assertIn("still here", line)
                    return
        self.fail("no English sharing-locked message found")

    def test_a_refusal_is_not_reported_as_being_signed_out(self):
        # A revoked session is a 401. A 403 is a rule about this person and
        # this thing; sending them to check their login over it is a wrong
        # answer delivered confidently.
        self.assertIn("err_not_allowed", self.api_error)
        self.assertNotIn("err?.status === 401 || err?.status === 403", self.api_error)

    def test_that_sentence_exists_in_every_language(self):
        path = os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "i18n.ts")
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
        self.assertEqual(body.count("err_not_allowed:"), 4)


if __name__ == "__main__":
    unittest.main()
