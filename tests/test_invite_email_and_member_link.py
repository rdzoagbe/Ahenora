"""Three things a co-parent saw on 2026-09-07, the first day both stores were live.

1. The invite email arrived from "Household COO" — the product's old name,
   whatever display name the configured address carried.
2. It offered Google Play only, and told an iPhone to "open it in your browser
   instead", while the iOS app was in the App Store.
3. The Family tab showed the household's OWNER as "INVITED — hasn't joined yet",
   on every device including their own, because their member row predated
   user_id linkage and has_account is read straight off the row.

Run with:  python3 -m pytest tests/test_invite_email_and_member_link.py -q
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


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheSenderName(unittest.TestCase):
    def test_a_stale_display_name_is_replaced_by_the_apps(self):
        self.assertEqual(server.sender_as_app("Household COO <hello@ahenora.com>"),
                         f"{server.APP_NAME} <hello@ahenora.com>")
        self.assertEqual(server.sender_as_app('"Household COO" <hello@ahenora.com>'),
                         f"{server.APP_NAME} <hello@ahenora.com>")

    def test_a_bare_address_gets_the_apps_name(self):
        self.assertEqual(server.sender_as_app("hello@ahenora.com"),
                         f"{server.APP_NAME} <hello@ahenora.com>")

    def test_garbage_is_left_alone(self):
        self.assertEqual(server.sender_as_app(""), "")
        self.assertEqual(server.sender_as_app("not-an-address"), "not-an-address")


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheInviteEmail(unittest.TestCase):
    def setUp(self):
        self._from = server.INVITE_FROM_EMAIL
        server.INVITE_FROM_EMAIL = "Household COO <hello@ahenora.test>"

    def tearDown(self):
        server.INVITE_FROM_EMAIL = self._from

    def test_both_stores_and_the_apps_name(self):
        mail = server.build_invite_email(
            "k@x.test", "https://ahenora.com/app/?invite=tok", "Roland", "r@x.test")
        self.assertEqual(mail["from"], f"{server.APP_NAME} <hello@ahenora.test>")
        for body in (mail["text"], mail["html"]):
            self.assertIn(server.IOS_STORE_URL, body)
            self.assertIn(server.ANDROID_STORE_URL, body)
            self.assertNotIn("iPhone or a computer", body)
        self.assertIn("apps.apple.com", server.IOS_STORE_URL)


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheOwnerIsNotInvited(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        run = asyncio.run
        run(self.db["users"].insert_one(
            {"user_id": "u_roland", "email": "R@x.test", "name": "Roland Dzoagbe", "family_id": "fam"}))
        run(self.db["users"].insert_one(
            {"user_id": "u_keigh", "email": "k@x.test", "name": "Keigh", "family_id": "fam"}))
        # The founder's row: made before rows carried user_id, no email either.
        run(self.db["family_members"].insert_one(
            {"member_id": "m_roland", "family_id": "fam", "name": "Roland Dzoagbe",
             "role": "parent", "created_at": server.utcnow()}))
        run(self.db["family_members"].insert_one(
            {"member_id": "m_keigh", "family_id": "fam", "name": "Keigh", "role": "co-parent",
             "user_id": "u_keigh", "created_at": server.utcnow()}))
        # A genuinely pending co-parent: no account in the family at all.
        run(self.db["family_members"].insert_one(
            {"member_id": "m_nanny", "family_id": "fam", "name": "Nanny", "role": "helper",
             "email": "nanny@x.test", "created_at": server.utcnow()}))
        run(self.db["family_members"].insert_one(
            {"member_id": "m_kid", "family_id": "fam", "name": "Arielle", "role": "child",
             "created_at": server.utcnow()}))

    def tearDown(self):
        server.get_db = self._get_db

    def _rows(self, as_user):
        return {r["member_id"]: r for r in asyncio.run(server.family_members(user=as_user))}

    def test_the_founder_reads_as_joined_from_a_coparents_phone(self):
        rows = self._rows({"user_id": "u_keigh", "email": "k@x.test", "family_id": "fam"})
        self.assertTrue(rows["m_roland"]["has_account"])
        self.assertEqual(rows["m_roland"]["user_id"], "u_roland")
        self.assertTrue(rows["m_keigh"]["has_account"])
        # The helper who never signed up is still, truthfully, not joined.
        self.assertFalse(rows["m_nanny"]["has_account"])
        # A child has no login by design and is untouched.
        self.assertFalse(rows["m_kid"]["has_account"])

    def test_the_link_is_written_back_once(self):
        self._rows({"user_id": "u_keigh", "email": "k@x.test", "family_id": "fam"})
        stored = asyncio.run(self.db["family_members"].find_one({"member_id": "m_roland"}, {"_id": 0}))
        self.assertEqual(stored["user_id"], "u_roland")

    def test_the_founder_is_in_the_adults_conversation_and_gets_the_push(self):
        # Chat resolves participants from member rows with a user_id. The
        # founder's legacy row had none, so they were in no thread: their
        # co-parent's messages notified nobody. Roland's phone, 2026-09-07.
        who = asyncio.run(server._thread_participants(self.db, "fam", server.ADULTS_THREAD))
        self.assertEqual(who, {"u_roland", "u_keigh"})
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_roland", "token": "ExponentPushToken[roland]", "active": True,
             "platform": "android", "updated_at": server.utcnow()}))
        sent = []

        async def to_expo(messages, database=None):
            sent.extend(messages)
            return {"sent": len(messages)}

        async def to_web(database, user_id, title, body, data):
            return 0
        real = (server.send_expo_push_messages, server.send_web_push_to_user)
        server.send_expo_push_messages, server.send_web_push_to_user = to_expo, to_web
        try:
            asyncio.run(server._chat_notify(self.db, "fam", server.ADULTS_THREAD, "u_keigh", "Keigh", "Pick up Friday?"))
        finally:
            server.send_expo_push_messages, server.send_web_push_to_user = real
        self.assertEqual([m["to"] for m in sent], ["ExponentPushToken[roland]"])
        self.assertEqual(sent[0]["data"], {"type": "chat", "thread": server.ADULTS_THREAD})

    def test_the_founder_gets_coparent_alerts_too(self):
        # send_new_card_alert / send_coparent_alert pick recipients the same
        # way chat does, so the unlinked owner missed every one of them.
        asyncio.run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_roland", "token": "ExponentPushToken[roland]", "active": True,
             "platform": "android", "updated_at": server.utcnow()}))
        sent = []

        async def to_expo(messages, database=None):
            sent.extend(messages)
            return {"sent": len(messages)}

        async def to_web(database, user_id, title, body, data):
            return 0
        real = (server.send_expo_push_messages, server.send_web_push_to_user)
        server.send_expo_push_messages, server.send_web_push_to_user = to_expo, to_web
        try:
            asyncio.run(server.send_coparent_alert(
                "fam", "Hand-off note", "Isaiah has a cold", "handoff", created_by_user_id="u_keigh"))
        finally:
            server.send_expo_push_messages, server.send_web_push_to_user = real
        self.assertEqual([m["to"] for m in sent], ["ExponentPushToken[roland]"])

    def test_a_name_shared_by_two_accounts_is_not_guessed(self):
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u_other", "email": "o@x.test", "name": "Roland Dzoagbe", "family_id": "fam"}))
        rows = self._rows({"user_id": "u_keigh", "email": "k@x.test", "family_id": "fam"})
        self.assertFalse(rows["m_roland"]["has_account"])


if __name__ == "__main__":
    unittest.main()
