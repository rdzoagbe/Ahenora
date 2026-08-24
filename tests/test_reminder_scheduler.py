"""The server-side reminder scheduler.

A card's reminder used to be scheduled on the device, so it only fired if that
person had opened the app — never for an unopened app, a reboot, or a co-parent
who never loaded the card. send_due_card_reminders is the server half: it scans
open cards, fires the ones that have reached due_date − reminder_minutes, and
does it once per occurrence.

Run with:  python3 -m unittest discover -s tests -v
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
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ReminderScheduler(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._real_send = server.send_expo_push_messages
        self.sent = []

        async def fake_send(messages, database=None):
            self.sent.extend(messages)
            return {"sent": len(messages)}
        server.send_expo_push_messages = fake_send

        async def seed():
            for uid, nm, lang in [("u1", "Roland", "fr"), ("u2", "Kim", "en")]:
                await self.db["users"].insert_one({
                    "user_id": uid, "family_id": "fam1", "name": nm,
                    "email": f"{uid}@x.com", "language": lang})
                await self.db["family_members"].insert_one({
                    "member_id": f"m_{uid}", "family_id": "fam1", "user_id": uid,
                    "name": nm, "role": "Parent"})
                await self.db["notification_tokens"].insert_one({
                    "user_id": uid, "family_id": "fam1",
                    "token": f"ExponentPushToken[{uid}]", "active": True,
                    "updated_at": server.utcnow()})
        asyncio.run(seed())
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._real_send

    def _card(self, **over):
        doc = {
            "card_id": over.get("card_id", "card_1"),
            "family_id": "fam1", "type": "TASK", "title": "Sign the slip",
            "status": "OPEN", "shared": True, "assignee": None,
            "created_by_user_id": "u1", "recurrence": "none",
            # due in 10 min, remind 60 min before → trigger 50 min ago
            "due_date": self.now + timedelta(minutes=10),
            "reminder_minutes": 60,
        }
        doc.update(over)
        asyncio.run(self.db["cards"].insert_one(doc))
        return doc

    def _run(self):
        return asyncio.run(server.send_due_card_reminders(self.db, now=self.now))

    def _recipients(self):
        return {m["to"] for m in self.sent}

    def test_shared_unassigned_reminds_whole_household(self):
        self._card()
        n = self._run()
        self.assertEqual(n, 2)
        self.assertEqual(self._recipients(), {"ExponentPushToken[u1]", "ExponentPushToken[u2]"})
        self.assertTrue(all(m["data"]["type"] == "card_reminder" for m in self.sent))

    def test_idempotent_second_pass_sends_nothing(self):
        self._card()
        self._run()
        self.sent.clear()
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.sent, [])

    def test_assigned_card_reminds_only_the_assignee(self):
        self._card(assignee="Kim")
        self._run()
        self.assertEqual(self._recipients(), {"ExponentPushToken[u2]"})

    def test_private_card_reminds_only_the_creator(self):
        self._card(shared=False, created_by_user_id="u1")
        self._run()
        self.assertEqual(self._recipients(), {"ExponentPushToken[u1]"})

    def test_not_yet_due_sends_nothing(self):
        # due in 10 min, remind only 1 min before → trigger 9 min in the future
        self._card(reminder_minutes=1)
        self.assertEqual(self._run(), 0)

    def test_opt_out_excludes_that_person(self):
        edited = self.now - timedelta(days=1)
        asyncio.run(self.db["notification_settings"].insert_one({
            "user_id": "u2", "card_reminders": False, "new_card_alerts": True,
            "created_at": edited, "updated_at": self.now}))  # edited → obeyed
        self._card()
        self._run()
        self.assertEqual(self._recipients(), {"ExponentPushToken[u1]"})

    def test_stale_reminder_is_marked_but_not_sent(self):
        # trigger far in the past (beyond the catch-up window): no backlog blast
        self._card(due_date=self.now - timedelta(hours=6), reminder_minutes=60)
        self.assertEqual(self._run(), 0)
        self.assertEqual(self.sent, [])
        card = asyncio.run(self.db["cards"].find_one({"card_id": "card_1"}))
        self.assertIsNotNone(card.get("reminder_sent_for"))  # marked, won't fire late

    def test_reminder_is_localized_per_recipient(self):
        self._card()
        self._run()
        by_token = {m["to"]: m for m in self.sent}
        self.assertEqual(by_token["ExponentPushToken[u1]"]["title"], server.PUSH_I18N["fr"]["reminder_title"])
        self.assertEqual(by_token["ExponentPushToken[u2]"]["title"], server.PUSH_I18N["en"]["reminder_title"])

    def test_new_occurrence_fires_again(self):
        # Same card id, but a later due date (as a recurrence spawn / an edit
        # would produce) is a new occurrence, so it earns a fresh reminder.
        self._card()
        self._run()
        self.sent.clear()
        asyncio.run(self.db["cards"].update_one(
            {"card_id": "card_1"},
            {"$set": {"due_date": self.now + timedelta(minutes=5)}}))
        self.assertEqual(self._run(), 2)


if __name__ == "__main__":
    unittest.main()
