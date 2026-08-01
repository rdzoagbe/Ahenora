"""Vault documents are private to their uploader unless shared.

Field case: a co-parent joined the household and could see (though not
open) documents the other parent had never shared. Household membership
is not consent to read someone's passport scan.

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

ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
KEIGH = {"user_id": "u_k", "family_id": "fam1", "name": "Keigh", "email": "k@x.com"}
OUTSIDER = {"user_id": "u_o", "family_id": "fam2", "name": "Other", "email": "o@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class VaultPrivacy(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        asyncio.run(self.db["families"].insert_one({
            "family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
            "grandfathered": False, "updated_at": server.utcnow(),
            "ai_scans_used": 0, "ai_scans_period_start": server.utcnow(),
            "vault_bytes_used": 0,
        }))

    def tearDown(self):
        server.get_db = self._get_db

    def _upload(self, user, title, visibility=None):
        payload = server.VaultIn(
            title=title, category="Medical",
            image_base64="data:image/jpeg;base64,AAAA",
            visibility=visibility,
        )
        return asyncio.run(server.create_vault_doc(payload, user=dict(user)))

    def _titles_for(self, user):
        return [d["title"] for d in asyncio.run(server.list_vault(user=dict(user)))]

    def test_uploads_are_private_by_default(self):
        doc = self._upload(ROLAND, "Passport")
        self.assertEqual(doc["visibility"], "private")
        self.assertEqual(doc["owner_user_id"], "u_r")
        self.assertEqual(self._titles_for(ROLAND), ["Passport"])
        self.assertEqual(self._titles_for(KEIGH), [])

    def test_shared_uploads_are_visible_to_the_household(self):
        self._upload(ROLAND, "House insurance", visibility="shared")
        self.assertEqual(self._titles_for(KEIGH), ["House insurance"])

    def test_a_private_doc_cannot_be_rendered_or_deleted_by_others(self):
        doc = self._upload(ROLAND, "Payslip")
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.render_vault_doc(doc["doc_id"], user=dict(KEIGH)))
        self.assertEqual(ctx.exception.status_code, 404)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.delete_vault_doc(doc["doc_id"], user=dict(KEIGH)))
        self.assertEqual(ctx.exception.status_code, 403)
        # The owner still can.
        self.assertEqual(
            asyncio.run(server.delete_vault_doc(doc["doc_id"], user=dict(ROLAND))),
            {"ok": True},
        )

    def test_legacy_docs_stay_visible_until_claimed_then_go_private(self):
        # Uploaded before the feature existed: no owner, no visibility.
        asyncio.run(self.db["vault"].insert_one({
            "doc_id": "doc_legacy", "family_id": "fam1", "title": "Old lease",
            "category": "Legal", "image_base64": "data:image/jpeg;base64,AAAA",
            "created_at": server.utcnow(),
        }))
        self.assertEqual(self._titles_for(KEIGH), ["Old lease"])
        updated = asyncio.run(server.set_vault_visibility(
            "doc_legacy", server.VaultVisibilityIn(visibility="private"), user=dict(ROLAND)))
        self.assertEqual(updated["visibility"], "private")
        self.assertEqual(updated["owner_user_id"], "u_r")
        self.assertEqual(self._titles_for(KEIGH), [])
        self.assertEqual(self._titles_for(ROLAND), ["Old lease"])

    def test_only_the_owner_can_change_visibility(self):
        doc = self._upload(ROLAND, "Contract")
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.set_vault_visibility(
                doc["doc_id"], server.VaultVisibilityIn(visibility="shared"), user=dict(KEIGH)))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_sharing_makes_it_visible_and_unsharing_hides_it_again(self):
        doc = self._upload(ROLAND, "School form")
        asyncio.run(server.set_vault_visibility(
            doc["doc_id"], server.VaultVisibilityIn(visibility="shared"), user=dict(ROLAND)))
        self.assertEqual(self._titles_for(KEIGH), ["School form"])
        asyncio.run(server.set_vault_visibility(
            doc["doc_id"], server.VaultVisibilityIn(visibility="private"), user=dict(ROLAND)))
        self.assertEqual(self._titles_for(KEIGH), [])

    def test_another_household_never_sees_anything(self):
        self._upload(ROLAND, "Shared doc", visibility="shared")
        self.assertEqual(self._titles_for(OUTSIDER), [])

    def test_expiry_alerts_do_not_leak_private_titles(self):
        doc = self._upload(ROLAND, "Passport")
        asyncio.run(self.db["vault"].update_one(
            {"doc_id": doc["doc_id"]},
            {"$set": {"expiry_date": server.utcnow()}}))
        alerts = asyncio.run(server.vault_expiry_alerts(user=dict(KEIGH), database=self.db))
        self.assertEqual(alerts, [])
        mine = asyncio.run(server.vault_expiry_alerts(user=dict(ROLAND), database=self.db))
        self.assertEqual([a["title"] for a in mine], ["Passport"])


if __name__ == "__main__":
    unittest.main()
