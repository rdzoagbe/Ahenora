"""A document's expiry could be set by a scan and never corrected.

Expiry dates reach the Vault one way: a camera scan reading a passport or an
insurance certificate. `setVaultExpiry` existed on both sides of the wire with
no caller, so whatever the scan read was final.

A scan is wrong in two directions, and the second is the worse one:

  * the wrong date — an alert that fires early or, worse, late;
  * a date on a document that has none at all. A birth certificate does not
    expire. That put a permanent "expired" row on the Vault and a recurring
    push behind it, and nothing the household could do would stop either.

So clearing matters as much as setting, and the endpoint could only set: its
`expiry_date` was a required query parameter written straight through $set.

The `$unset` half has a second edge to it. scripts/fake_mongo.py — the double
every browser harness and end-to-end test runs against — did not implement
$unset at all. It accepted the operator and silently did nothing, so a clear
would have "passed" every test in the repository while leaving the date in
place. That is the failure mode a test double must never have, and the reason
the fake's own behaviour is pinned here alongside the endpoint's.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server

from fake_mongo import FakeDatabase  # noqa: E402


USER = {"user_id": "u1", "family_id": "fam_1", "email": "a@b.test", "role": "parent"}
DOC_ID = "doc_1"


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class SettingAndClearingAnExpiry(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        asyncio.run(self.db["vault"].insert_one({
            "doc_id": DOC_ID, "family_id": "fam_1", "title": "Passport",
            "category": "Identity", "image_base64": "x",
            "visibility": "shared", "created_at": server.utcnow(),
            "expiry_date": server.parse_dt("2027-01-01T00:00:00Z"),
        }))

    def _doc(self):
        return asyncio.run(self.db["vault"].find_one({"doc_id": DOC_ID}))

    def _set(self, value):
        return asyncio.run(server.set_vault_expiry(
            DOC_ID, expiry_date=value, user=USER, database=self.db))

    def test_a_misread_date_can_be_corrected(self):
        out = self._set("2030-06-01T00:00:00Z")
        self.assertTrue(out["ok"])
        self.assertIn("2030-06-01", out["expiry_date"])
        self.assertIn("2030", server.iso(self._doc()["expiry_date"]))

    def test_an_expiry_on_something_that_does_not_expire_can_be_removed(self):
        out = self._set("")
        self.assertTrue(out["ok"])
        self.assertIsNone(out["expiry_date"])
        # Removed, not set to None: "this document has no expiry" is a
        # different statement from "this document's expiry is nothing", and
        # only the first stops the alert job looking at it.
        self.assertNotIn("expiry_date", self._doc())

    def test_whitespace_is_a_clear_not_a_date(self):
        self._set("   ")
        self.assertNotIn("expiry_date", self._doc())

    def test_clearing_an_expiry_that_is_already_absent_is_fine(self):
        self._set("")
        out = self._set("")
        self.assertTrue(out["ok"])
        self.assertNotIn("expiry_date", self._doc())

    def test_something_that_is_not_a_date_is_refused_and_changes_nothing(self):
        for bad in ("soon", "next year", "13/13/2030"):
            with self.assertRaises(server.HTTPException) as caught:
                self._set(bad)
            self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("2027", server.iso(self._doc()["expiry_date"]))

    def test_another_household_cannot_touch_this_document(self):
        other = dict(USER, family_id="fam_2")
        with self.assertRaises(server.HTTPException) as caught:
            asyncio.run(server.set_vault_expiry(
                DOC_ID, expiry_date="", user=other, database=self.db))
        self.assertEqual(caught.exception.status_code, 404)
        self.assertIn("2027", server.iso(self._doc()["expiry_date"]))

    def test_a_private_document_somebody_else_owns_is_not_theirs_to_change(self):
        asyncio.run(self.db["vault"].update_one(
            {"doc_id": DOC_ID},
            {"$set": {"visibility": "private", "owner_user_id": "someone_else"}}))
        with self.assertRaises(server.HTTPException) as caught:
            self._set("")
        self.assertEqual(caught.exception.status_code, 404)
        self.assertIn("expiry_date", self._doc())


class TheFakeActuallyImplementsUnset(unittest.TestCase):
    """Pinned separately, because a double that accepts an operator and does
    nothing makes every test above pass while the product is broken."""

    def setUp(self):
        self.db = FakeDatabase()

    def test_unset_removes_the_field(self):
        asyncio.run(self.db["t"].insert_one({"id": "1", "keep": 1, "drop": 2}))
        asyncio.run(self.db["t"].update_one({"id": "1"}, {"$unset": {"drop": ""}}))
        row = asyncio.run(self.db["t"].find_one({"id": "1"}))
        self.assertEqual(row.get("keep"), 1)
        self.assertNotIn("drop", row)

    def test_unset_reaches_a_dotted_path(self):
        asyncio.run(self.db["t"].insert_one(
            {"id": "1", "record": {"a": 1, "b": 2}}))
        asyncio.run(self.db["t"].update_one({"id": "1"}, {"$unset": {"record.b": ""}}))
        row = asyncio.run(self.db["t"].find_one({"id": "1"}))
        self.assertEqual(row["record"], {"a": 1})

    def test_unsetting_what_is_not_there_is_a_no_op_not_an_error(self):
        asyncio.run(self.db["t"].insert_one({"id": "1"}))
        asyncio.run(self.db["t"].update_one({"id": "1"}, {"$unset": {"nope": ""}}))
        asyncio.run(self.db["t"].update_one({"id": "1"}, {"$unset": {"a.b.c": ""}}))
        self.assertIsNotNone(asyncio.run(self.db["t"].find_one({"id": "1"})))

    def test_unset_travels_with_the_other_operators(self):
        asyncio.run(self.db["t"].insert_one({"id": "1", "drop": 1}))
        asyncio.run(self.db["t"].update_one(
            {"id": "1"}, {"$set": {"kept": "yes"}, "$unset": {"drop": ""}}))
        row = asyncio.run(self.db["t"].find_one({"id": "1"}))
        self.assertEqual(row.get("kept"), "yes")
        self.assertNotIn("drop", row)


if __name__ == "__main__":
    unittest.main()
