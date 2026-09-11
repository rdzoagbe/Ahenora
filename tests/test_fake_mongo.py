"""Tests for the test double itself.

Every backend test in this suite runs against fake_mongo, and none of them
tested fake_mongo. That is a strange place for 1487 tests to stand: when the
double is wrong, the tests do not fail — they pass, about the wrong thing. The
file's own docstring already records two of those (a dotted $set that stored a
literal dotted key; aware datetimes it handed back unchanged), each found only
because a feature happened to trip over it.

So these pin the properties the rest of the suite silently assumes. They are
about the double being no KINDER than the wire — every case below is one where
being helpful would hide a real bug:

  * A read hands back a document of its own. Real Mongo decodes fresh BSON
    every time, so a handler that mutates what find_one gave it changes
    nothing until it writes.
  * Dotted paths nest, on the way in and on the way out, for every operator.
  * The positional `$` writes the one element the query matched.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from fake_mongo import FakeDatabase  # noqa: E402


def run(coro):
    return asyncio.run(coro)


class ReadsAreIsolated(unittest.TestCase):
    """The property whose absence makes an unwritten change look persisted."""

    def setUp(self):
        self.db = FakeDatabase()
        run(self.db["things"].insert_one({
            "thing_id": "t1", "nested": {"list": [{"id": "a"}], "flag": 1}}))

    def test_mutating_a_read_document_does_not_touch_the_store(self):
        got = run(self.db["things"].find_one({"thing_id": "t1"}))
        got["nested"]["list"].append({"id": "SNEAKED_IN"})
        got["nested"]["flag"] = 99
        again = run(self.db["things"].find_one({"thing_id": "t1"}))
        self.assertEqual(len(again["nested"]["list"]), 1)
        self.assertEqual(again["nested"]["flag"], 1)

    def test_two_reads_do_not_share_nested_objects(self):
        a = run(self.db["things"].find_one({"thing_id": "t1"}))
        b = run(self.db["things"].find_one({"thing_id": "t1"}))
        self.assertIsNot(a["nested"], b["nested"])
        self.assertIsNot(a["nested"]["list"], b["nested"]["list"])

    def test_a_projected_read_is_isolated_too(self):
        got = run(self.db["things"].find_one({"thing_id": "t1"}, {"_id": 0}))
        got["nested"]["list"].append({"id": "SNEAKED_IN"})
        again = run(self.db["things"].find_one({"thing_id": "t1"}))
        self.assertEqual(len(again["nested"]["list"]), 1)


class DottedPaths(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        run(self.db["things"].insert_one({"thing_id": "t1"}))

    def read(self):
        return run(self.db["things"].find_one({"thing_id": "t1"}))

    def test_dotted_set_nests_and_creates_the_parent(self):
        run(self.db["things"].update_one(
            {"thing_id": "t1"}, {"$set": {"record.allergies": "Peanuts"}}))
        self.assertEqual(self.read()["record"]["allergies"], "Peanuts")
        self.assertNotIn("record.allergies", self.read())

    def test_dotted_push_nests(self):
        run(self.db["things"].update_one(
            {"thing_id": "t1"}, {"$push": {"record.rows": {"id": "a"}}}))
        run(self.db["things"].update_one(
            {"thing_id": "t1"}, {"$push": {"record.rows": {"id": "b"}}}))
        self.assertEqual([r["id"] for r in self.read()["record"]["rows"]], ["a", "b"])
        self.assertNotIn("record.rows", self.read())

    def test_dotted_pull_nests(self):
        for i in ("a", "b"):
            run(self.db["things"].update_one(
                {"thing_id": "t1"}, {"$push": {"record.rows": {"id": i}}}))
        run(self.db["things"].update_one(
            {"thing_id": "t1"}, {"$pull": {"record.rows": {"id": "a"}}}))
        self.assertEqual([r["id"] for r in self.read()["record"]["rows"]], ["b"])

    def test_a_dotted_query_key_matches(self):
        run(self.db["things"].update_one(
            {"thing_id": "t1"}, {"$set": {"record.allergies": "Peanuts"}}))
        hit = run(self.db["things"].find_one({"record.allergies": "Peanuts"}))
        self.assertIsNotNone(hit)
        self.assertIsNone(run(self.db["things"].find_one({"record.allergies": "Nope"})))

    def test_a_dotted_query_reaches_through_an_array(self):
        # This is what makes {"record.rows.id": "b"} select the PARENT
        # document, which is how the positional operator is addressed.
        for i in ("a", "b"):
            run(self.db["things"].update_one(
                {"thing_id": "t1"}, {"$push": {"record.rows": {"id": i}}}))
        self.assertIsNotNone(run(self.db["things"].find_one({"record.rows.id": "b"})))
        self.assertIsNone(run(self.db["things"].find_one({"record.rows.id": "zzz"})))


class PositionalOperator(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        run(self.db["things"].insert_one({"thing_id": "t1"}))
        for i in ("a", "b", "c"):
            run(self.db["things"].update_one(
                {"thing_id": "t1"},
                {"$push": {"record.rows": {"id": i, "name": i.upper()}}}))

    def rows(self):
        got = run(self.db["things"].find_one({"thing_id": "t1"}))
        return got["record"]["rows"]

    def test_it_writes_exactly_the_matched_element(self):
        run(self.db["things"].update_one(
            {"thing_id": "t1", "record.rows.id": "b"},
            {"$set": {"record.rows.$": {"id": "b", "name": "CHANGED"}}}))
        self.assertEqual([r["name"] for r in self.rows()], ["A", "CHANGED", "C"])

    def test_it_is_addressed_by_identity_not_by_position(self):
        # A row inserted at the head must not shift which element is written.
        run(self.db["things"].update_one(
            {"thing_id": "t1"}, {"$push": {"record.rows": {"id": "z", "name": "Z"}}}))
        run(self.db["things"].update_one(
            {"thing_id": "t1", "record.rows.id": "a"},
            {"$set": {"record.rows.$": {"id": "a", "name": "CHANGED"}}}))
        by_id = {r["id"]: r["name"] for r in self.rows()}
        self.assertEqual(by_id["a"], "CHANGED")
        self.assertEqual(by_id["z"], "Z")
        self.assertEqual(by_id["b"], "B")

    def test_a_field_under_the_positional_element_can_be_set(self):
        run(self.db["things"].update_one(
            {"thing_id": "t1", "record.rows.id": "c"},
            {"$set": {"record.rows.$.name": "JUST THE NAME"}}))
        by_id = {r["id"]: r["name"] for r in self.rows()}
        self.assertEqual(by_id["c"], "JUST THE NAME")
        self.assertEqual(by_id["a"], "A")

    def test_no_match_writes_nothing(self):
        run(self.db["things"].update_one(
            {"thing_id": "t1", "record.rows.id": "nope"},
            {"$set": {"record.rows.$": {"id": "nope", "name": "X"}}}))
        self.assertEqual([r["name"] for r in self.rows()], ["A", "B", "C"])


if __name__ == "__main__":
    unittest.main()
