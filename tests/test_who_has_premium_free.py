"""Who is getting premium without paying — and, more importantly, WHY.

Roland asked to find households using paid features without a payment, so he
can send a reminder. The list that already existed answered a narrower
question than the one he was asking, in a way that would have picked the wrong
people:

  `unpaid_premium` is decided from the STORED plan — a paid tier with no
  billing receipt behind it. It cannot see the two routes that hand out
  premium at RUNTIME and leave the stored plan alone:

    a household containing an admin/tester account gets the top tier; and

    while no paid rail is configured at all, EVERY household gets the top
    tier, because that is the launch preview working exactly as designed.

So a "you are using premium without paying" list built on the old flag would
have missed every tester, and — if billing is not yet live in production —
would have been a list of literally every family in the database. Sending any
of them a "start paying or lose access" message is a mistake that cannot be
taken back, which is why the reason travels with the flag.

Run with:  python3 -m pytest tests/test_who_has_premium_free.py -q
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
class TheList(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admins = set(server.ADMIN_EMAILS)
        server.ADMIN_EMAILS.clear()
        server.ADMIN_EMAILS.add("boss@ahenora.test")
        self._live = server.billing_is_live
        server.billing_is_live = lambda: True          # a paid rail exists
        self._marker = server.billing_marker
        server._ADMIN_FAMILY_CACHE.clear()
        self.admin = {"user_id": "u_boss", "email": "boss@ahenora.test",
                      "family_id": "fam_boss"}

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS.clear()
        server.ADMIN_EMAILS.update(self._admins)
        server.billing_is_live = self._live
        server.billing_marker = self._marker
        server._ADMIN_FAMILY_CACHE.clear()

    def _family(self, fid, plan="village", grandfathered=False, receipt=None):
        run = asyncio.run
        row = {"family_id": fid, "plan": plan, "billing_cycle": None,
               "grandfathered": grandfathered, "created_at": server.utcnow()}
        if receipt:
            row.update(receipt)
        run(self.db["families"].insert_one(row))
        run(self.db["users"].insert_one(
            {"user_id": f"u_{fid}", "family_id": fid, "name": fid,
             "email": f"{fid}@x.test", "created_at": server.utcnow()}))

    def _rows(self):
        out = asyncio.run(server.admin_subscribers(user=self.admin))
        return {r["family_id"]: r for r in out["subscribers"]}, out

    def test_a_paying_household_is_not_on_the_list(self):
        server.billing_marker = lambda fam: "stripe" if fam.get("family_id") == "fam_pay" else None
        self._family("fam_pay", plan="household")
        rows, _ = self._rows()
        self.assertFalse(rows["fam_pay"]["premium_without_paying"])
        self.assertIsNone(rows["fam_pay"]["unpaid_reason"])

    def test_a_paid_plan_with_no_receipt_is_named_as_such(self):
        server.billing_marker = lambda fam: None
        self._family("fam_ghost", plan="household")
        rows, _ = self._rows()
        self.assertTrue(rows["fam_ghost"]["premium_without_paying"])
        self.assertEqual(rows["fam_ghost"]["unpaid_reason"], "paid_plan_no_receipt")

    def test_a_tester_household_is_found_and_named(self):
        """The category the old flag could not see at all: the stored plan is
        free, and the top tier is granted at runtime."""
        server.billing_marker = lambda fam: None
        self._family("fam_boss", plan="village")
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u_admin", "family_id": "fam_boss",
             "email": "boss@ahenora.test", "created_at": server.utcnow()}))
        rows, _ = self._rows()
        self.assertTrue(rows["fam_boss"]["premium_without_paying"])
        self.assertEqual(rows["fam_boss"]["unpaid_reason"], "admin_or_tester")
        # And it is NOT reported as a paid plan with a missing receipt, which
        # is what would have put a tester in a chasing list.
        self.assertFalse(rows["fam_boss"]["unpaid_premium"])

    def test_a_grandfathered_family_is_named_as_grandfathered(self):
        server.billing_marker = lambda fam: None
        self._family("fam_thanks", plan="village", grandfathered=True)
        rows, _ = self._rows()
        self.assertTrue(rows["fam_thanks"]["premium_without_paying"])
        self.assertEqual(rows["fam_thanks"]["unpaid_reason"], "grandfathered")

    def test_before_billing_is_live_everybody_is_on_the_preview(self):
        """The one that stops a mass mistake.

        With no paid rail configured, every household gets the top tier by
        design. A list of "people using premium without paying" is then a list
        of every family there is, and the reason says so rather than leaving
        somebody to infer it from a count.
        """
        server.billing_is_live = lambda: False
        server.billing_marker = lambda fam: None
        self._family("fam_a")
        self._family("fam_b")
        rows, summary = self._rows()
        self.assertFalse(summary["billing_live"])
        for fid in ("fam_a", "fam_b"):
            self.assertTrue(rows[fid]["premium_without_paying"])
            self.assertEqual(rows[fid]["unpaid_reason"], "preview")
        self.assertEqual(summary["premium_without_paying"], 2)

    def test_the_summary_counts_what_the_rows_say(self):
        server.billing_marker = lambda fam: "stripe" if fam.get("family_id") == "fam_pay" else None
        self._family("fam_pay", plan="household")
        self._family("fam_ghost", plan="executive")
        self._family("fam_free", plan="village")
        rows, summary = self._rows()
        self.assertEqual(summary["premium_without_paying"],
                         sum(1 for r in rows.values() if r["premium_without_paying"]))
        self.assertEqual(summary["premium_without_paying"], 1)

    def test_only_an_admin_may_read_it(self):
        from fastapi import HTTPException
        self._family("fam_a")
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.admin_subscribers(
                user={"user_id": "u_x", "email": "someone@else.test", "family_id": "fam_a"}))
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
