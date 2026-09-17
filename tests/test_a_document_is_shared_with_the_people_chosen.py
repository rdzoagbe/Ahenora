"""Share with THESE people — not everyone, not nobody.

Roland: "I need to be able to have a share button for co-parent before
register. Where it says who sees this. I need to be able to choose who I share
the doc with."

Cards already had two answers (shared with the household, or private) plus a
scope that follows an assignee. Vault documents had the same two. This adds
the third: a chosen list of members, resolved server-side to the accounts
behind the rows, with the creator always in. One rule on each side —
_card_visible_to and _may_see_vault_doc — so every read path (list, render,
search, expiry alerts, the morning brief) inherits it without being taught.

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
    from fastapi import HTTPException
    from fake_mongo import FakeDatabase

ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com", "role": "parent"}
KEIGH = {"user_id": "u_k", "family_id": "fam1", "name": "Keigh", "email": "k@x.com", "role": "parent"}
NANA = {"user_id": "u_n", "family_id": "fam1", "name": "Nana", "email": "n@x.com", "role": "helper"}
IMG = "data:image/jpeg;base64,AAAA"


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Household(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._send = server.send_expo_push_messages
        async def quiet(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = quiet

        async def seed():
            await self.db["families"].insert_one({
                "family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
                "grandfathered": False, "updated_at": server.utcnow(),
                "ai_scans_used": 0, "ai_scans_period_start": server.utcnow(), "vault_bytes_used": 0,
            })
            for u, mid in ((ROLAND, "m_r"), (KEIGH, "m_k"), (NANA, "m_n")):
                await self.db["users"].insert_one({**u})
                await self.db["family_members"].insert_one({
                    "member_id": mid, "family_id": "fam1", "user_id": u["user_id"],
                    "name": u["name"], "role": u["role"], "email": u["email"]})
            # A young child: a row, no account. Nobody to show anything to.
            await self.db["family_members"].insert_one({
                "member_id": "m_child", "family_id": "fam1", "name": "Ama", "role": "child"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._send

    # -- helpers --------------------------------------------------------
    def card(self, user, **kw):
        body = {"type": "TASK", "title": "Dentist letter", "shared": True, **kw}
        return asyncio.run(server.create_card(server.CardIn(**body), user=dict(user)))

    def card_ids_seen_by(self, user):
        rows = asyncio.run(server.list_cards(status=None, user=dict(user)))
        return {c["card_id"] for c in rows}

    def doc(self, user, **kw):
        body = {"title": "Passport", "category": "Medical", "image_base64": IMG, **kw}
        return asyncio.run(server.create_vault_doc(server.VaultIn(**body), user=dict(user)))

    def doc_ids_seen_by(self, user):
        return {d["doc_id"] for d in asyncio.run(server.list_vault(user=dict(user)))}


class ACardSharedWithChosenPeople(Household):

    def test_reaches_the_people_chosen_and_the_creator_and_nobody_else(self):
        c = self.card(ROLAND, visible_to_members=["m_k"])
        self.assertIn(c["card_id"], self.card_ids_seen_by(ROLAND))
        self.assertIn(c["card_id"], self.card_ids_seen_by(KEIGH))
        self.assertNotIn(c["card_id"], self.card_ids_seen_by(NANA))

    def test_is_reported_as_shared_and_narrowed(self):
        c = self.card(ROLAND, visible_to_members=["m_k"])
        self.assertTrue(c["shared"])
        self.assertEqual(c["visible_to"], ["u_k", "u_r"])
        self.assertEqual(c["chosen_visible_to"], ["u_k", "u_r"])

    def test_choosing_people_overrides_just_me(self):
        # The pills cannot express both; "these people" is the stronger claim.
        c = self.card(ROLAND, shared=False, visible_to_members=["m_n"])
        self.assertTrue(c["shared"])
        self.assertIn(c["card_id"], self.card_ids_seen_by(NANA))
        self.assertNotIn(c["card_id"], self.card_ids_seen_by(KEIGH))

    def test_a_child_with_no_account_counts_as_nobody(self):
        # Only the child picked: nothing resolves, so the ordinary rule applies
        # — shared with the household, NOT silently narrowed to the creator.
        c = self.card(ROLAND, visible_to_members=["m_child"])
        self.assertIsNone(c["chosen_visible_to"])
        self.assertIn(c["card_id"], self.card_ids_seen_by(KEIGH))

    def test_the_list_and_the_assignee_scope_are_a_union(self):
        # Assigned to Keigh (a parent) and shared with Nana (a helper). The
        # assignee scope is "both parents + the assignee" and would NEVER
        # include Nana on its own; the chosen list would never include Keigh
        # on its own. Both must see it. A first-scope-wins merge passed the
        # earlier version of this test, because it chose a parent — someone
        # the assignee scope already carried.
        c = self.card(ROLAND, assignee="Keigh", visible_to_members=["m_n"])
        self.assertEqual(set(c["visible_to"]), {"u_r", "u_k", "u_n"})
        self.assertIn(c["card_id"], self.card_ids_seen_by(NANA))
        self.assertIn(c["card_id"], self.card_ids_seen_by(KEIGH))

    def test_an_assignee_is_never_locked_out_by_the_list(self):
        # The other direction: assigned to Nana, list names only Keigh. An
        # assignee who cannot see her own job is the contradiction the
        # assignee toggle exists to prevent.
        c = self.card(ROLAND, assignee="Nana", visible_to_members=["m_k"])
        self.assertIn(c["card_id"], self.card_ids_seen_by(NANA))
        self.assertIn(c["card_id"], self.card_ids_seen_by(KEIGH))


class EditingAChosenCard(Household):

    def _patch(self, user, card_id, **kw):
        return asyncio.run(server.update_card(card_id, server.CardPatchIn(**kw), user=dict(user)))

    def test_a_title_edit_keeps_the_people_picked(self):
        c = self.card(ROLAND, visible_to_members=["m_k"])
        u = self._patch(ROLAND, c["card_id"], title="Dentist letter (Tue)")
        self.assertEqual(u["chosen_visible_to"], ["u_k", "u_r"])
        self.assertNotIn(c["card_id"], self.card_ids_seen_by(NANA))

    def test_the_list_can_be_changed_by_the_person_who_added_it(self):
        c = self.card(ROLAND, visible_to_members=["m_k"])
        u = self._patch(ROLAND, c["card_id"], visible_to_members=["m_n"])
        self.assertIn(c["card_id"], self.card_ids_seen_by(NANA))
        self.assertNotIn(c["card_id"], self.card_ids_seen_by(KEIGH))
        self.assertEqual(u["chosen_visible_to"], ["u_n", "u_r"])

    def test_an_empty_list_clears_the_choice(self):
        c = self.card(ROLAND, visible_to_members=["m_k"])
        u = self._patch(ROLAND, c["card_id"], visible_to_members=[])
        self.assertIsNone(u["chosen_visible_to"])
        self.assertIn(c["card_id"], self.card_ids_seen_by(NANA))   # back to household-wide

    def test_only_the_person_who_added_it_may_change_who_sees_it(self):
        c = self.card(ROLAND, visible_to_members=["m_k"])
        with self.assertRaises(HTTPException) as e:
            self._patch(KEIGH, c["card_id"], visible_to_members=["m_n"])
        self.assertEqual(e.exception.status_code, 403)


class ADocumentSharedWithChosenPeople(Household):

    def test_reaches_the_people_chosen_and_the_owner_and_nobody_else(self):
        d = self.doc(ROLAND, visibility="selected", visible_to_members=["m_k"])
        self.assertEqual(d["visibility"], "selected")
        self.assertEqual(d["visible_to"], ["u_k", "u_r"])
        self.assertIn(d["doc_id"], self.doc_ids_seen_by(ROLAND))
        self.assertIn(d["doc_id"], self.doc_ids_seen_by(KEIGH))
        self.assertNotIn(d["doc_id"], self.doc_ids_seen_by(NANA))

    def test_nobody_resolvable_stays_private_rather_than_becoming_shared(self):
        # The safe direction for a document. A passport scan must never widen
        # to the household because a picker was left empty.
        d = self.doc(ROLAND, visibility="selected", visible_to_members=["m_child"])
        self.assertEqual(d["visibility"], "private")
        self.assertNotIn(d["doc_id"], self.doc_ids_seen_by(KEIGH))

    def test_the_owner_can_narrow_a_shared_document_later(self):
        d = self.doc(ROLAND, visibility="shared")
        self.assertIn(d["doc_id"], self.doc_ids_seen_by(NANA))
        u = asyncio.run(server.set_vault_visibility(
            d["doc_id"], server.VaultVisibilityIn(visibility="selected", visible_to_members=["m_k"]),
            user=dict(ROLAND)))
        self.assertEqual(u["visibility"], "selected")
        self.assertNotIn(d["doc_id"], self.doc_ids_seen_by(NANA))
        self.assertIn(d["doc_id"], self.doc_ids_seen_by(KEIGH))

    def test_narrowing_to_nobody_is_refused_not_applied(self):
        d = self.doc(ROLAND, visibility="shared")
        with self.assertRaises(HTTPException) as e:
            asyncio.run(server.set_vault_visibility(
                d["doc_id"], server.VaultVisibilityIn(visibility="selected", visible_to_members=[]),
                user=dict(ROLAND)))
        self.assertEqual(e.exception.status_code, 400)

    def test_going_back_to_shared_drops_the_list(self):
        d = self.doc(ROLAND, visibility="selected", visible_to_members=["m_k"])
        u = asyncio.run(server.set_vault_visibility(
            d["doc_id"], server.VaultVisibilityIn(visibility="shared"), user=dict(ROLAND)))
        self.assertEqual(u["visibility"], "shared")
        self.assertIsNone(u["visible_to"])
        self.assertIn(d["doc_id"], self.doc_ids_seen_by(NANA))

    def test_the_search_follows_the_same_rule(self):
        d = self.doc(ROLAND, title="Dentist referral", visibility="selected", visible_to_members=["m_k"])
        def hits(user):
            out = asyncio.run(server.search_everything(q="Dentist", user=dict(user)))
            return {h["id"] for h in out["results"] if h["kind"] == "document"}
        self.assertIn(d["doc_id"], hits(KEIGH))
        self.assertNotIn(d["doc_id"], hits(NANA))
