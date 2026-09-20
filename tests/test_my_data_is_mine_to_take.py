"""A person can take a copy of their data, as easily as they can delete it.

The privacy policy promised a portable copy and answered it by email; the
grant strategy's security baseline lists "account deletion/export" as one
item. This is the export: what the person can already see, in the shapes the
app already uses, and nothing secret.
"""
import asyncio
import json
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

ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com", "role": "parent",
          "password_hash": "pbkdf2$secret", "language": "fr"}
KEIGH = {"user_id": "u_k", "family_id": "fam1", "name": "Keigh", "email": "k@x.com", "role": "parent"}
NANA = {"user_id": "u_n", "family_id": "fam1", "name": "Nana", "email": "n@x.com", "role": "helper", "is_helper": True}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TakingACopy(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

        async def seed():
            await self.db["families"].insert_one({"family_id": "fam1", "plan": "household", "billing_cycle": "monthly", "grandfathered": False,
                                                  "updated_at": server.utcnow(), "ai_scans_used": 0,
                                                  "ai_scans_period_start": server.utcnow(), "vault_bytes_used": 0})
            for u, mid in ((ROLAND, "m_r"), (KEIGH, "m_k"), (NANA, "m_n")):
                await self.db["users"].insert_one({**u, "created_at": server.utcnow()})
                await self.db["family_members"].insert_one({
                    "member_id": mid, "family_id": "fam1", "user_id": u["user_id"], "name": u["name"],
                    "role": u["role"], "pin_hash": "pin$secret", "created_at": server.utcnow()})
            await self.db["user_sessions"].insert_one({"token_hash": "abc", "user_id": "u_r"})
            await self.db["notification_tokens"].insert_one({"user_id": "u_r", "token": "ExponentPushToken[x]"})
            now = server.utcnow()
            await self.db["cards"].insert_one({"card_id": "c_mine", "family_id": "fam1", "type": "TASK", "title": "Mine",
                                               "status": "OPEN", "source": "MANUAL", "created_at": now, "shared": False,
                                               "created_by_user_id": "u_r", "image_base64": "data:image/jpeg;base64,AAAA"})
            await self.db["cards"].insert_one({"card_id": "c_shared", "family_id": "fam1", "type": "TASK", "title": "Shared",
                                               "status": "OPEN", "source": "MANUAL", "created_at": now, "shared": True,
                                               "created_by_user_id": "u_k"})
            await self.db["cards"].insert_one({"card_id": "c_secret", "family_id": "fam1", "type": "TASK", "title": "Keigh's",
                                               "status": "OPEN", "source": "MANUAL", "created_at": now, "shared": False,
                                               "created_by_user_id": "u_k"})
            await self.db["vault"].insert_one({"doc_id": "d_mine", "family_id": "fam1", "title": "Passport", "category": "Medical",
                                               "image_base64": "data:image/jpeg;base64,BBBB", "visibility": "private",
                                               "owner_user_id": "u_r", "created_at": now})
            await self.db["vault"].insert_one({"doc_id": "d_keigh", "family_id": "fam1", "title": "Keigh's private", "category": "Medical",
                                               "image_base64": "data:image/jpeg;base64,CCCC", "visibility": "private",
                                               "owner_user_id": "u_k", "created_at": now})
            await self.db["messages"].insert_one({"message_id": "m1", "family_id": "fam1", "thread": "adults",
                                                  "sender_user_id": "u_r", "text": "hello", "created_at": now})
            await self.db["messages"].insert_one({"message_id": "m2", "family_id": "fam1", "thread": "adults",
                                                  "sender_user_id": "u_k", "text": "hi", "created_at": now})
            await self.db["activity"].insert_one({"activity_id": "a1", "family_id": "fam1", "actor_user_id": "u_r",
                                                  "kind": "task_created", "subject": "Mine", "created_at": now})
            await self.db["activity"].insert_one({"activity_id": "a2", "family_id": "fam1", "actor_user_id": "u_k",
                                                  "kind": "task_created", "subject": "Shared", "created_at": now})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db

    def export(self, user, **kw):
        return asyncio.run(server.export_my_data(user=dict(user), database=self.db, **kw))

    def test_it_is_one_json_document_that_serialises(self):
        out = self.export(ROLAND)
        text = json.dumps(out)
        self.assertEqual(out["format"], "ahenora-export/1")
        self.assertIn('"exported_at"', text)

    def test_nothing_secret_travels(self):
        text = json.dumps(self.export(ROLAND))
        for secret in ("password_hash", "pbkdf2$secret", "pin_hash", "pin$secret", "token_hash", "ExponentPushToken"):
            self.assertNotIn(secret, text, secret)

    def test_the_account_and_household_are_there(self):
        out = self.export(ROLAND)
        self.assertEqual(out["account"]["email"], "r@x.com")
        self.assertEqual(out["account"]["language"], "fr")
        self.assertTrue(out["account"]["has_password"])
        self.assertEqual(out["household"]["plan"], "household")
        self.assertEqual({m["name"] for m in out["household"]["members"]}, {"Roland", "Keigh", "Nana"})
        self.assertEqual(out["household"]["me"]["name"], "Roland")

    def test_cards_follow_the_same_visibility_rule_as_the_feed(self):
        ids = {c["card_id"] for c in self.export(ROLAND)["cards"]}
        self.assertEqual(ids, {"c_mine", "c_shared"}, "Keigh's private card is not Roland's to take")

    def test_documents_follow_the_same_rule_as_the_vault(self):
        ids = {d["doc_id"] for d in self.export(ROLAND)["documents"]}
        self.assertEqual(ids, {"d_mine"})

    def test_a_helper_gets_no_documents_because_the_vault_refuses_them(self):
        self.assertEqual(self.export(NANA)["documents"], [])

    def test_only_my_own_messages_and_actions(self):
        out = self.export(ROLAND)
        self.assertEqual([m["message_id"] for m in out["messages_sent"]], ["m1"])
        self.assertEqual([a["activity_id"] for a in out["activity"]], ["a1"])

    def test_images_stay_home_unless_asked_for(self):
        out = self.export(ROLAND)
        card = next(c for c in out["cards"] if c["card_id"] == "c_mine")
        self.assertNotIn("image_base64", card)
        self.assertTrue(card["has_image"])
        self.assertNotIn("image_base64", out["documents"][0])
        self.assertFalse(out["includes_files"])
        with_files = self.export(ROLAND, include_files=True)
        self.assertEqual(with_files["documents"][0]["image_base64"], "data:image/jpeg;base64,BBBB")
        self.assertTrue(with_files["includes_files"])


if __name__ == "__main__":
    unittest.main()
