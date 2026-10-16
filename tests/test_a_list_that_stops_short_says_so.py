"""A list that stops short says so, and the rest can be reached.

An audit on 2026-10-16 found four places the app showed less than the family
had while looking complete: the chat (newest 200, no way back), past shopping
trips and saved meal plans (newest 30, no way back), and a pocket-money balance
summed over the first thousand transactions. Plus one silence: a cancelled
meeting whose card was shared was "skipped" and lived on for everyone.

Run with:  python3 -m unittest tests.test_a_list_that_stops_short_says_so -v
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
    import server
    from fake_mongo import FakeDatabase
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

AMA = {"user_id": "u_a", "family_id": "fam1", "name": "Ama", "email": "a@x.com", "role": "parent"}
KOFI = {"user_id": "u_k", "family_id": "fam1", "name": "Kofi", "email": "k@x.com", "role": "parent"}


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class _Household(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._push = server.send_push_to_user

        async def quiet(*a, **k):
            return {"devices": 0, "web": 0}
        server.send_push_to_user = quiet
        now = server.utcnow()
        run(self.db["families"].insert_one({"family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
                                            "grandfathered": False, "updated_at": now}))
        for u in (AMA, KOFI):
            run(self.db["users"].insert_one({**u, "language": "en"}))
            run(self.db["family_members"].insert_one({"member_id": "m_" + u["user_id"], "family_id": "fam1",
                                                      "user_id": u["user_id"], "name": u["name"], "role": "Parent"}))
        self.now = now

    def tearDown(self):
        server.get_db = self._get_db
        server.send_push_to_user = self._push


class TheChatReachesLastMonth(_Household):
    def seed_messages(self, n):
        for i in range(n):
            run(self.db["messages"].insert_one({
                "message_id": f"msg{i:04}", "family_id": "fam1", "thread": server.ADULTS_THREAD,
                "sender_user_id": AMA["user_id"] if i % 2 else KOFI["user_id"], "sender_kind": "user",
                "sender_name": "Ama" if i % 2 else "Kofi", "text": f"message {i}",
                "read_by": [AMA["user_id"], KOFI["user_id"]],
                "created_at": self.now - timedelta(minutes=n - i)}))

    def test_a_short_thread_has_nothing_older(self):
        self.seed_messages(5)
        page = run(server.family_chat_get(server.ADULTS_THREAD, user=dict(AMA)))
        self.assertEqual(len(page["messages"]), 5)
        self.assertIs(page["has_more"], False)

    def test_a_long_thread_says_there_is_more_and_the_rest_can_be_reached(self):
        self.seed_messages(server.CHAT_PAGE + 50)
        page = run(server.family_chat_get(server.ADULTS_THREAD, user=dict(AMA)))
        self.assertEqual(len(page["messages"]), server.CHAT_PAGE)
        self.assertIs(page["has_more"], True)
        self.assertEqual(page["messages"][-1]["text"], f"message {server.CHAT_PAGE + 49}", "newest last")
        oldest_on_screen = page["messages"][0]["created_at"]
        older = run(server.family_chat_get(server.ADULTS_THREAD, before=oldest_on_screen, user=dict(AMA)))
        self.assertEqual(len(older["messages"]), 50)
        self.assertEqual(older["messages"][0]["text"], "message 0")
        self.assertIs(older["has_more"], False, "that was the beginning")
        seen = {m["message_id"] for m in page["messages"]} | {m["message_id"] for m in older["messages"]}
        self.assertEqual(len(seen), server.CHAT_PAGE + 50, "no message counted twice or lost between pages")

    def test_a_poll_never_claims_history(self):
        self.seed_messages(server.CHAT_PAGE + 5)
        quiet = run(server.family_chat_get(server.ADULTS_THREAD, since=server.iso(self.now), user=dict(AMA)))
        self.assertEqual(quiet["messages"], [])
        self.assertIs(quiet["has_more"], False)


class PastTripsAndSavedPlansGoBack(_Household):
    def test_past_trips_page_back(self):
        for i in range(70):
            run(self.db["shopping_history"].insert_one({
                "history_id": f"h{i:03}", "family_id": "fam1", "items": [f"item {i}"],
                "created_at": self.now - timedelta(days=i)}))
        first = run(server.list_shopping_history(user=dict(AMA)))
        self.assertEqual(len(first), 30)
        self.assertEqual(first[0]["history_id"], "h000", "newest first")
        second = run(server.list_shopping_history(before=first[-1]["created_at"], user=dict(AMA)))
        self.assertEqual([h["history_id"] for h in second][:2], ["h030", "h031"])
        third = run(server.list_shopping_history(before=second[-1]["created_at"], user=dict(AMA)))
        self.assertEqual(len(third), 10, "the last page is short, which is how the app knows to stop")
        ids = [h["history_id"] for h in first + second + third]
        self.assertEqual(len(ids), len(set(ids)), "no trip twice across pages")

    def test_saved_plans_page_back(self):
        for i in range(31):
            run(self.db["meal_plans_saved"].insert_one({
                "plan_id": f"p{i:03}", "family_id": "fam1", "name": f"Week {i}", "meals": [],
                "created_at": self.now - timedelta(days=7 * i)}))
        first = run(server.list_saved_plans(user=dict(AMA), database=self.db))
        self.assertEqual(len(first), 30)
        rest = run(server.list_saved_plans(before=first[-1]["created_at"], user=dict(AMA), database=self.db))
        self.assertEqual([p["plan_id"] for p in rest], ["p030"])


class ThePocketMoneyBalanceCountsEverything(_Household):
    def test_beyond_a_thousand_transactions(self):
        for i in range(1200):
            run(self.db["allowance_txns"].insert_one({
                "txn_id": f"t{i}", "family_id": "fam1", "member_id": "m_child", "amount": 1.0,
                "txn_type": "deposit" if i % 3 else "withdrawal", "created_at": self.now - timedelta(hours=i)}))
        out = run(server.get_allowance_balance("m_child", user=dict(AMA), database=self.db))
        deposits = sum(1 for i in range(1200) if i % 3)
        self.assertEqual(out["balance"], float(deposits - (1200 - deposits)))


class ACancelledSharedMeetingIsSaid(_Household):
    def test_the_summary_counts_it(self):
        run(self.db["cards"].insert_one({
            "card_id": "c1", "family_id": "fam1", "google_event_id": "ev1", "title": "Parents' evening",
            "type": "TASK", "status": "OPEN", "source": "CALENDAR", "shared": True,
            "due_date": self.now + timedelta(days=3), "created_at": self.now}))

        async def fake(token, days):
            return [{"id": "ev1", "status": "cancelled"}]
        orig = server._fetch_google_calendar_events
        server._fetch_google_calendar_events = fake
        try:
            out = run(server.import_google_calendar(server.CalendarImportIn(access_token="t", days=30), user=dict(AMA)))
        finally:
            server._fetch_google_calendar_events = orig
        self.assertEqual(out["removed"], 0, "a shared card is the family's now: kept")
        self.assertEqual(out["cancelled_kept"], 1, "but said")
        self.assertIsNotNone(run(self.db["cards"].find_one({"card_id": "c1"}, {"_id": 0})))


if __name__ == "__main__":
    unittest.main()
