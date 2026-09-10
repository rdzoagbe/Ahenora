"""The purchase that reached nobody is the row you can see.

Roland's screenshot of the billing screen: a red banner saying one event
arrived that could not be matched to a household — "real money landing
nowhere, the store got a 200 back and will not send it again" — above twelve
rows, not one of which was that event.

The list was ordered by arrival and capped. The unmatched row was four days
old, so every ordinary renewal that landed afterwards pushed it further down
until it fell off the end. The count stayed truthful and became useless: it
told him something needed doing and hid the only thing that would let him do
it.

The row carries the store's product id and the app_user_id the purchase named
— which is exactly what somebody needs to find that person in RevenueCat and
put the plan on their household by hand. It is worth nothing at the bottom of
a list.

Run with:  python3 -m pytest tests/test_billing_events_order.py -q
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
    from fastapi import HTTPException


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheBillingList(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admins = set(server.ADMIN_EMAILS)
        server.ADMIN_EMAILS.clear()
        server.ADMIN_EMAILS.add("boss@ahenora.test")
        self.admin = {"user_id": "u_boss", "email": "boss@ahenora.test",
                      "family_id": "fam_boss"}

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS.clear()
        server.ADMIN_EMAILS.update(self._admins)

    def _event(self, when_minutes_ago, matched, **extra):
        row = {
            "source": "revenuecat",
            "event_type": "RENEWAL" if matched else "INITIAL_PURCHASE",
            "matched": matched,
            "product_id": "ahenora_executive_monthly",
            "received_at": server.utcnow() - timedelta(minutes=when_minutes_ago),
        }
        row.update(extra)
        asyncio.run(self.db["billing_events"].insert_one(row))

    def _events(self, limit=12):
        return asyncio.run(server.admin_billing_events(user=self.admin, limit=limit))

    def test_the_unmatched_row_is_visible_however_old_it_is(self):
        """The exact situation in the screenshot: one old orphan, buried under
        a wall of ordinary renewals."""
        self._event(60 * 24 * 4, matched=False, app_user_id="user_stranded")
        for i in range(30):
            self._event(i, matched=True)
        out = self._events(limit=12)
        self.assertEqual(out["unmatched"], 1)
        shown = out["events"]
        self.assertEqual(len(shown), 12)
        self.assertFalse(shown[0]["matched"], "the row needing action must lead")
        self.assertEqual(shown[0]["app_user_id"], "user_stranded")

    def test_it_carries_what_a_person_needs_to_act(self):
        # The detail string says what happened. The ids say to whom.
        self._event(5, matched=False, app_user_id="user_stranded",
                    detail="no account carries this app_user_id")
        row = self._events()["events"][0]
        self.assertEqual(row["app_user_id"], "user_stranded")
        self.assertEqual(row["product_id"], "ahenora_executive_monthly")

    def test_several_orphans_all_come_first(self):
        for i in range(3):
            self._event(60 * 24 * (i + 2), matched=False, app_user_id=f"user_{i}")
        for i in range(20):
            self._event(i, matched=True)
        shown = self._events(limit=10)["events"]
        self.assertEqual([r["matched"] for r in shown[:3]], [False, False, False])

    def test_matched_rows_are_still_newest_first(self):
        # Reordering the orphans must not shuffle everything else.
        for minutes in (300, 100, 200):
            self._event(minutes, matched=True, app_user_id=f"u{minutes}")
        shown = [r["app_user_id"] for r in self._events()["events"]]
        self.assertEqual(shown, ["u100", "u200", "u300"])

    def test_a_clean_ledger_reads_normally(self):
        for i in range(5):
            self._event(i, matched=True, app_user_id=f"u{i}")
        out = self._events()
        self.assertEqual(out["unmatched"], 0)
        self.assertTrue(all(r["matched"] for r in out["events"]))

    def test_only_an_admin_may_read_it(self):
        self._event(1, matched=False, app_user_id="user_stranded")
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.admin_billing_events(
                user={"user_id": "u_x", "email": "nobody@else.test"}, limit=12))
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
