"""Account deletion must actually delete everything, including the chat.

`/auth/delete-account` is a promise made to the user and to both stores: press
this and your data is gone. It keeps that promise by iterating two hand-written
lists of collection names, and a hand-written list is exactly the kind of thing
that stops being complete the moment someone adds a feature.

It had stopped being complete. `messages` — the household chat and the
parent↔teen threads, the most sensitive text in the product — was never in it,
so every deleted household left its conversations behind permanently. So did
`expense_items`, and `web_push_subscriptions` outlived the account that made
it, leaving a live push endpoint for a person who no longer exists.

The test that matters here is not "does the list contain messages" — that is
just restating the fix. It is the drift check: every collection the app writes
with a family_id must appear in the family list, so the NEXT feature to add one
fails here instead of silently escaping deletion for months.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import re
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

SOURCE = os.path.join(os.path.dirname(__file__), "..", "backend", "server.py")

# Collections that legitimately outlive a household or are not household data.
# Anything not listed here must be purged with the family.
NOT_FAMILY_DATA = {
    "users",              # handled by _purge_user_account
    "families",           # deleted by _purge_family itself
    "user_sessions", "notification_tokens", "notification_settings",
    "support_tickets", "web_push_subscriptions",   # per-user, purged per-user
    "billing_events",     # financial record, deliberately retained
    "password_resets", "metric_events", "app_opens", "push_claims",
    "daily_push_state", "account_active_since",
}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class DeletionCoverage(unittest.TestCase):
    def test_every_family_scoped_collection_is_purged_with_the_family(self):
        text = open(SOURCE).read()
        listed = set(server._FAMILY_SCOPED_COLLECTIONS)

        # A collection is family data if the source ever writes it together
        # with a family_id. Reading the source rather than a curated list is
        # the point: a new feature shows up here without anyone updating a test.
        family_scoped = set()
        for name in set(re.findall(r'database\["([a-z_]+)"\]', text)):
            for match in re.finditer(
                    r'database\["%s"\]\.(?:insert_one|update_one|update_many)\('
                    % re.escape(name), text):
                window = text[match.start():match.start() + 1200]
                if '"family_id"' in window:
                    family_scoped.add(name)
                    break

        missing = sorted(family_scoped - listed - NOT_FAMILY_DATA)
        self.assertEqual(
            missing, [],
            "these collections carry a family_id but survive household "
            "deletion: %s. Add them to _FAMILY_SCOPED_COLLECTIONS, or to this "
            "test's NOT_FAMILY_DATA with a reason." % missing)

    def test_the_chat_is_deleted_with_the_household(self):
        # Named explicitly because it is the one with the most at stake.
        self.assertIn("messages", server._FAMILY_SCOPED_COLLECTIONS)

    def test_a_web_push_subscription_does_not_outlive_its_account(self):
        db = FakeDatabase()

        async def go():
            await db["web_push_subscriptions"].insert_one(
                {"endpoint": "https://push.example/x", "user_id": "u1",
                 "family_id": "f1", "active": True})
            await server._purge_user_account(db, "u1", "gone@example.com")
            return [d async for d in
                    db["web_push_subscriptions"].find({"user_id": "u1"}, {"_id": 0})]

        self.assertEqual(asyncio.run(go()), [])

    def test_household_purge_removes_chat_and_expense_lines(self):
        db = FakeDatabase()

        async def go():
            await db["messages"].insert_one(
                {"family_id": "f1", "thread": "adults", "text": "private"})
            await db["expense_items"].insert_one(
                {"family_id": "f1", "expense_id": "e1", "name_key": "milk"})
            await server._purge_family(db, "f1")
            left = []
            for coll in ("messages", "expense_items"):
                left += [d async for d in db[coll].find({"family_id": "f1"}, {"_id": 0})]
            return left

        self.assertEqual(asyncio.run(go()), [])


if __name__ == "__main__":
    unittest.main()
