"""The drill, run as a test.

There was no backup tooling in this repository at all. Every `restore` in the
codebase was the shopping-list restore banner — a UX feature. So the honest
position was: the data is protected by whatever the managed database does by
default, and nobody has ever checked that it comes back.

A backup nobody has restored from is a belief, not a backup.

This runs the whole cycle — seed, dump, wipe, restore, verify — every time the
suite runs. What it CANNOT do is prove a production restore: that needs the
real database, real credentials and a real scratch instance, and it is a thing
a person does deliberately. See docs/runbooks/restore-drill.md. What it proves
is that the tooling is correct, so the night somebody runs it for real the
script is not the thing that fails.

The half that people skip
-------------------------
Most of these tests would be written as "dump, restore, assert the counts
match" and would pass while the restore was useless. So the sharper half of
this file is about `verify` itself: a verification that cannot FAIL is
decoration. Each check below is paired with a test that breaks exactly that
property and insists it is caught — a dropped collection, stringified dates,
an orphaned household, a truncated archive.

The datetime one is the reason this matters. A naive JSON round trip turns
every datetime into a string. The restore reports success, the app boots, and
then no due date, reminder or expiry alert ever matches again — because a
string is never equal to a datetime. It is the quietest way to lose a database
while believing you got it back.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import gzip
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from bson import json_util  # noqa: E402

from fake_mongo import FakeDatabase  # noqa: E402
import mongo_backup  # noqa: E402


def run(coro):
    return asyncio.run(coro)


NOW = datetime(2026, 9, 14, 8, 30, tzinfo=timezone.utc)


def seeded():
    """A household with the shapes that actually break: datetimes, nested
    documents, unicode, an empty collection and a cross-collection reference."""
    database = FakeDatabase()
    run(database["families"].insert_many([
        {"family_id": "fam_1", "name": "Dzoagbé", "created_at": NOW},
        {"family_id": "fam_2", "name": "Second household", "created_at": NOW},
    ]))
    run(database["cards"].insert_many([
        {"card_id": "c1", "family_id": "fam_1", "title": "Dentiste à 15h30",
         "due_date": NOW + timedelta(days=1), "created_at": NOW,
         "time_set": True, "recurrence": "none",
         "reminder": {"minutes": 60, "sent": False}},
        {"card_id": "c2", "family_id": "fam_2", "title": "Buy milk",
         "due_date": NOW + timedelta(days=2), "created_at": NOW,
         "time_set": False, "recurrence": "none"},
    ]))
    run(database["family_members"].insert_many([
        {"member_id": "m1", "family_id": "fam_1", "name": "Ama", "role": "child",
         "stars": 12, "created_at": NOW},
    ]))
    # Deliberately empty: a collection with no rows must round-trip as a
    # collection with no rows, not vanish from the archive.
    database["carpools"]
    return database


class TheRoundTrip(unittest.TestCase):

    def setUp(self):
        self.archive = tempfile.mkdtemp(prefix="drill-")

    def test_a_seeded_database_comes_back_intact(self):
        source = seeded()
        manifest = run(mongo_backup.dump(source, self.archive))

        target = FakeDatabase()
        run(mongo_backup.restore(target, self.archive))

        self.assertEqual(run(target["cards"].count_documents({})), 2)
        self.assertEqual(run(target["families"].count_documents({})), 2)
        self.assertEqual(manifest["collections"]["cards"]["count"], 2)
        self.assertEqual(
            run(mongo_backup.verify(target, self.archive, expect_aware=False)), [])

    def test_the_archive_holds_datetimes_not_strings(self):
        """The whole reason this uses Extended JSON rather than json.dumps.

        Asserted on the ARCHIVE, which is the layer the tool owns. A naive
        json.dumps would put an ISO string here, the restore would insert
        strings, and every date query in the app would quietly match nothing.
        """
        run(mongo_backup.dump(seeded(), self.archive))
        docs, _ = mongo_backup.read_collection(self.archive, "cards")
        due = {d["card_id"]: d["due_date"] for d in docs}["c1"]
        self.assertIsInstance(due, datetime)
        self.assertEqual(due, NOW + timedelta(days=1))

    def test_the_archive_keeps_the_timezone(self):
        """Read back AWARE, so the archive does not depend on something
        downstream re-attaching UTC for it.

        server.py records what happens when a naive datetime reaches code that
        compares it with an aware utcnow(): "it took out invite acceptance in
        production". Relying on the driver to coerce it back would be borrowing
        correctness from the exact mechanism that has already failed here once.
        """
        run(mongo_backup.dump(seeded(), self.archive))
        docs, _ = mongo_backup.read_collection(self.archive, "cards")
        self.assertIsNotNone(docs[0]["created_at"].tzinfo)

    def test_the_raw_store_is_naive_and_that_is_correct(self):
        """BSON has no timezone, and the double models the wire, not the
        client. The app sees aware datetimes because ITS client sets
        tz_aware=True — which is why the awareness check describes the reader
        rather than the data."""
        run(mongo_backup.dump(seeded(), self.archive))
        target = FakeDatabase()
        run(mongo_backup.restore(target, self.archive))
        card = run(target["cards"].find_one({"card_id": "c1"}))
        self.assertIsInstance(card["due_date"], datetime)
        self.assertIsNone(card["due_date"].tzinfo)
        self.assertEqual(card["due_date"].replace(tzinfo=timezone.utc),
                         NOW + timedelta(days=1))

    def test_unicode_and_nested_documents_survive(self):
        source = seeded()
        run(mongo_backup.dump(source, self.archive))
        target = FakeDatabase()
        run(mongo_backup.restore(target, self.archive))

        card = run(target["cards"].find_one({"card_id": "c1"}))
        self.assertEqual(card["title"], "Dentiste à 15h30")
        self.assertEqual(card["reminder"], {"minutes": 60, "sent": False})
        self.assertIs(card["time_set"], True)

    def test_an_empty_collection_is_still_backed_up(self):
        # Otherwise a restore silently reintroduces a collection that the
        # archive never mentioned, and verify has nothing to compare against.
        source = seeded()
        manifest = run(mongo_backup.dump(source, self.archive))
        self.assertIn("carpools", manifest["collections"])
        self.assertEqual(manifest["collections"]["carpools"]["count"], 0)

    def test_restoring_over_existing_rows_replaces_rather_than_doubles(self):
        source = seeded()
        run(mongo_backup.dump(source, self.archive))
        target = seeded()                      # already has the same data
        run(mongo_backup.restore(target, self.archive))
        self.assertEqual(run(target["cards"].count_documents({})), 2)


class VerifyCanActuallyFail(unittest.TestCase):
    """A verification that cannot fail is decoration.

    Each test breaks exactly one property the drill is supposed to notice.
    """

    def setUp(self):
        self.archive = tempfile.mkdtemp(prefix="drill-")
        self.source = seeded()
        run(mongo_backup.dump(self.source, self.archive))

    def _restored(self):
        target = FakeDatabase()
        run(mongo_backup.restore(target, self.archive))
        return target

    def test_it_notices_a_collection_that_came_back_empty(self):
        target = self._restored()
        run(target["cards"].delete_many({}))
        problems = run(mongo_backup.verify(target, self.archive, expect_aware=False))
        self.assertTrue(any("cards" in p for p in problems), problems)

    def test_it_notices_rows_missing(self):
        target = self._restored()
        run(target["cards"].delete_one({"card_id": "c2"}))
        problems = run(mongo_backup.verify(target, self.archive, expect_aware=False))
        self.assertTrue(any("1 rows restored, expected 2" in p for p in problems), problems)

    def test_it_notices_dates_that_came_back_as_strings(self):
        """The silent one. Counts match, app boots, nothing ever matches."""
        target = self._restored()
        run(target["cards"].update_one(
            {"card_id": "c1"}, {"$set": {"due_date": "2026-09-15T08:30:00Z"}}))
        problems = run(mongo_backup.verify(target, self.archive, expect_aware=False))
        self.assertTrue(any("string" in p for p in problems), problems)

    def test_it_notices_an_orphaned_household(self):
        target = self._restored()
        run(target["families"].delete_one({"family_id": "fam_2"}))
        problems = run(mongo_backup.verify(target, self.archive, expect_aware=False))
        self.assertTrue(any("fam_2" in p for p in problems), problems)

    def test_a_clean_restore_reports_no_problems(self):
        # The other half: verify must not cry wolf, or the drill gets ignored.
        self.assertEqual(
            run(mongo_backup.verify(self._restored(), self.archive, expect_aware=False)), [])

    def test_it_notices_naive_datetimes_when_the_reader_should_see_aware_ones(self):
        """Against the app's own client (tz_aware=True) a naive datetime means
        something bypassed the decoding, and the next `stored < utcnow()`
        raises TypeError. The double stores raw BSON, so it is exactly the
        shape that check has to catch."""
        problems = run(mongo_backup.verify(self._restored(), self.archive, expect_aware=True))
        self.assertTrue(any("naive" in p for p in problems), problems)


class ACorruptArchiveIsRefusedBeforeAnythingIsWritten(unittest.TestCase):
    """A restore that half-succeeds and then hits a bad file has turned one
    problem into two — and it does it at the worst possible moment."""

    def setUp(self):
        self.archive = tempfile.mkdtemp(prefix="drill-")
        run(mongo_backup.dump(seeded(), self.archive))

    def test_a_tampered_file_is_caught_by_its_checksum(self):
        path = os.path.join(self.archive, "cards.json.gz")
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            rows = handle.read().replace("Buy milk", "Buy bread")
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            handle.write(rows)

        with self.assertRaises(SystemExit) as caught:
            run(mongo_backup.restore(FakeDatabase(), self.archive))
        self.assertIn("corrupt", str(caught.exception))

    def test_a_truncated_file_is_caught(self):
        path = os.path.join(self.archive, "cards.json.gz")
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            first = handle.read().split("\n")[0]
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            handle.write(first + "\n")

        with self.assertRaises(SystemExit):
            run(mongo_backup.restore(FakeDatabase(), self.archive))

    def test_nothing_is_written_when_a_later_file_turns_out_bad(self):
        """The point of checking EVERY file before touching the database.

        The corrupted collection has to sort LAST, or this test cannot tell a
        safe implementation from a dangerous one. A first version corrupted
        `cards` and asserted `families` survived — but cards sorts first, so it
        failed before anything was wiped no matter how the restore was written.
        A mutation that moved the delete inside the read loop passed it. The
        collections are restored in sorted order, so the only arrangement that
        discriminates is: break the last one, check the first one survived.
        """
        collections = sorted(mongo_backup.read_manifest(self.archive)["collections"])
        self.assertEqual(collections[-1], "family_members")   # the ordering this relies on

        path = os.path.join(self.archive, "family_members.json.gz")
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            handle.write('{"member_id": "wrong"}\n{"member_id": "also_wrong"}\n')

        target = FakeDatabase()
        run(target["cards"].insert_one({"card_id": "survivor", "family_id": "fam_1"}))
        with self.assertRaises(SystemExit):
            run(mongo_backup.restore(target, self.archive))

        # `cards` is restored FIRST. An implementation that deletes as it reads
        # would have emptied it before ever reaching the bad file.
        self.assertEqual(run(target["cards"].count_documents({})), 1)
        self.assertEqual(
            run(target["cards"].find_one({}))["card_id"], "survivor")


class TheBackupCoversEveryCollectionTheAppDeletes(unittest.TestCase):
    """The two lists have to agree.

    A collection missing from the backup list is data that is never saved. The
    same collection missing from the deletion list is data that survives a
    "delete my account". Reading both from one place is what stops the two
    drifting.
    """

    def test_the_household_collection_list_is_read_from_the_server(self):
        names = mongo_backup.household_collections()
        for expected in ("cards", "family_members", "vault", "expenses", "meals"):
            self.assertIn(expected, names)

    def test_it_is_not_a_stub(self):
        # If the parse ever breaks it must not quietly return a short list —
        # that would look like a working backup covering almost nothing.
        self.assertGreater(len(mongo_backup.household_collections()), 20)


if __name__ == "__main__":
    unittest.main()


class ARestoreDoesNotReadTheWholeDatabaseIntoMemory(unittest.TestCase):
    """The ceiling nobody had measured.

    restore staged every document of every collection in a dict before writing
    anything, to get its "nothing is written until every file is proved sound"
    guarantee. Vault rows carry their file inline as base64 and the Household
    plan sells 10 GB of vault, so that guarantee was being bought with an
    amount of memory a real household can exceed — in a container, at the one
    moment the database is at its largest and somebody is actually restoring
    it.

    The guarantee is kept. It is now bought with a checksum pass that retains
    nothing, followed by a write pass that streams.
    """

    def setUp(self):
        self.archive = tempfile.mkdtemp(prefix="stream-")
        self.addCleanup(shutil.rmtree, self.archive, ignore_errors=True)
        source = FakeDatabase()
        for i in range(1205):        # comfortably more than two batches
            run(source["cards"].insert_one({"card_id": f"c{i}", "family_id": "f1"}))
        run(mongo_backup.dump(source, self.archive))

    def test_every_row_still_arrives(self):
        target = FakeDatabase()
        written = run(mongo_backup.restore(target, self.archive))
        self.assertEqual(written["cards"], 1205)
        self.assertEqual(run(target["cards"].count_documents({})), 1205)

    def test_it_is_written_in_batches_rather_than_one_call(self):
        """The actual behaviour, not the constant. A single insert_many of
        everything is the thing being fixed."""
        target = FakeDatabase()
        sizes = []
        real = target["cards"].insert_many

        async def counted(docs, *a, **k):
            sizes.append(len(docs))
            return await real(docs, *a, **k)

        target["cards"].insert_many = counted
        run(mongo_backup.restore(target, self.archive))
        self.assertGreater(len(sizes), 1, "everything went in one insert_many")
        self.assertLessEqual(max(sizes), mongo_backup.BATCH)

    def test_the_batch_constant_is_actually_used(self):
        # It was defined and never referenced — batching had been intended and
        # never wired up, which is why this went unnoticed.
        batches = list(mongo_backup.stream_collection(self.archive, "cards"))
        self.assertEqual([len(b) for b in batches[:2]],
                         [mongo_backup.BATCH, mongo_backup.BATCH])

    def test_a_corrupt_file_is_still_refused_before_anything_is_written(self):
        """The property the staging existed to provide. Losing it while
        removing the memory cost would be a bad trade."""
        path = os.path.join(self.archive, "cards.json.gz")
        with gzip.open(path, "at", encoding="utf-8") as handle:
            handle.write(json_util.dumps({"card_id": "smuggled"}) + "\n")
        target = FakeDatabase()
        with self.assertRaises(SystemExit):
            run(mongo_backup.restore(target, self.archive))
        self.assertEqual(run(target["cards"].count_documents({})), 0)

    def test_the_checksum_pass_agrees_with_reading_the_file(self):
        count, digest = mongo_backup.check_collection(self.archive, "cards")
        docs, whole = mongo_backup.read_collection(self.archive, "cards")
        self.assertEqual((count, digest), (len(docs), whole))

    def test_a_manifest_that_disagrees_with_the_file_is_refused(self):
        """The count check, which the checksum cannot stand in for.

        Tampering with the DATA changes the checksum, so that case is caught
        either way. This is the other one: the file is intact and its
        checksum matches, but the manifest claims a different number of rows
        — a hand-edited manifest, or a dump that miscounted. Restoring then
        would put the archive's rows in while believing a different figure,
        and verify's count check would compare the restored database against
        the same wrong manifest and agree with it.
        """
        path = os.path.join(self.archive, "manifest.json")
        with open(path, encoding="utf-8") as handle:
            manifest = json.load(handle)
        manifest["collections"]["cards"]["count"] = 1204   # one short, sha untouched
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(manifest, handle)

        target = FakeDatabase()
        with self.assertRaises(SystemExit):
            run(mongo_backup.restore(target, self.archive))
        self.assertEqual(run(target["cards"].count_documents({})), 0)
