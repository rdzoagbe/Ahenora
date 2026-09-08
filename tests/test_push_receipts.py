"""Whether Google or Apple actually delivered a push is a receipt, not a ticket.

2026-09-08: an iPhone got every notification with the app closed; an Android
phone got none. The send log was clean because a ticket only says Expo
accepted the message. Nothing ever read the receipts, where the Android
failure would have appeared. These tests pin the pipeline that reads them.
"""
import asyncio
import os
import sys
import unittest
from datetime import timedelta

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
class Receipts(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        run = asyncio.run
        run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_r", "token": "ExponentPushToken[android1]", "active": True,
             "platform": "android", "updated_at": server.utcnow()}))
        run(self.db["notification_tokens"].insert_one(
            {"user_id": "u_k", "token": "ExponentPushToken[ios1]", "active": True,
             "platform": "ios", "updated_at": server.utcnow()}))
        server._push_receipt_state.update({"last_check_at": None, "checked": 0, "errors": 0})

    def tearDown(self):
        server.get_db = self._get_db

    def test_tickets_are_kept_and_receipt_errors_recorded_per_platform(self):
        run = asyncio.run
        run(self.db["push_tickets"].insert_many([
            {"ticket_id": "t-and", "token": "ExponentPushToken[android1]",
             "sent_at": server.utcnow() - timedelta(minutes=20), "checked": False},
            {"ticket_id": "t-ios", "token": "ExponentPushToken[ios1]",
             "sent_at": server.utcnow() - timedelta(minutes=20), "checked": False},
            {"ticket_id": "t-new", "token": "ExponentPushToken[ios1]",
             "sent_at": server.utcnow() - timedelta(minutes=2), "checked": False},
        ]))
        asked = {}

        async def fake_receipts(ids):
            asked["ids"] = list(ids)
            return {"data": {
                "t-and": {"status": "error", "message": "The credentials are invalid",
                          "details": {"error": "InvalidCredentials"}},
                "t-ios": {"status": "ok"},
            }}
        real = server.fetch_expo_push_receipts
        server.fetch_expo_push_receipts = fake_receipts
        try:
            summary = run(server.check_push_receipts(self.db))
        finally:
            server.fetch_expo_push_receipts = real
        # Only tickets older than the delay are asked about.
        self.assertEqual(sorted(asked["ids"]), ["t-and", "t-ios"])
        self.assertEqual(summary, {"checked": 2, "errors": 1})
        errs = run(self.db["push_delivery_errors"].find({}, {"_id": 0}).to_list(10))
        self.assertEqual(len(errs), 1)
        self.assertEqual(errs[0]["platform"], "android")
        self.assertEqual(errs[0]["error"], "InvalidCredentials")
        self.assertEqual(errs[0]["stage"], "receipt")
        self.assertEqual(errs[0]["token_tail"], "ndroid1]")
        # Checked tickets are marked; the young one waits.
        rows = {t["ticket_id"]: t for t in run(self.db["push_tickets"].find({}, {"_id": 0}).to_list(10))}
        self.assertTrue(rows["t-and"]["checked"])
        self.assertFalse(rows["t-new"]["checked"])

    def test_a_dead_device_in_a_receipt_is_retired(self):
        run = asyncio.run
        run(self.db["push_tickets"].insert_one(
            {"ticket_id": "t1", "token": "ExponentPushToken[ios1]",
             "sent_at": server.utcnow() - timedelta(minutes=30), "checked": False}))

        async def fake_receipts(ids):
            return {"data": {"t1": {"status": "error", "message": "gone",
                                    "details": {"error": "DeviceNotRegistered"}}}}
        real = server.fetch_expo_push_receipts
        server.fetch_expo_push_receipts = fake_receipts
        try:
            run(server.check_push_receipts(self.db))
        finally:
            server.fetch_expo_push_receipts = real
        tok = run(self.db["notification_tokens"].find_one({"token": "ExponentPushToken[ios1]"}, {"_id": 0}))
        self.assertFalse(tok["active"])

    def test_health_reports_per_platform_and_recent_errors(self):
        run = asyncio.run
        server.ADMIN_EMAILS.add("boss@ahenora.test")
        run(self.db["users"].insert_one({"user_id": "u_boss", "email": "boss@ahenora.test", "family_id": "f"}))
        run(self.db["push_delivery_errors"].insert_one(
            {"at": server.utcnow(), "stage": "receipt", "platform": "android",
             "token_tail": "abcd", "error": "InvalidCredentials", "message": "bad key"}))
        try:
            out = run(server.health_push(user={"user_id": "u_boss", "email": "boss@ahenora.test"},
                                         database=self.db))
        finally:
            server.ADMIN_EMAILS.discard("boss@ahenora.test")
        self.assertEqual(out["reach"]["by_platform"], {"android": 1, "ios": 1})
        self.assertEqual(out["delivery"]["recent_errors"][0]["error"], "InvalidCredentials")
        self.assertEqual(out["delivery"]["tickets_pending"], 0)


if __name__ == "__main__":
    unittest.main()
