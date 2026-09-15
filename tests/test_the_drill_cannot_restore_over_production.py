"""The one script whose failure mode is destroying what it rehearses for.

scripts/restore_drill.py derives its scratch database from MONGO_URL rather
than asking for a second connection string — that piece of setup is most of
why the drill was not being run. The derivation is therefore the whole safety
story: get it wrong and a rehearsal writes a stale copy of the database over
the live one.

So it is tested against the shapes a real connection string comes in, and
against the ways a careless derivation goes wrong: dropping a query string
(losing retryWrites or a TLS flag), mangling credentials that contain a
slash, or — the one that matters — coming back with the live name.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import io
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stdout

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import mongo_backup  # noqa: E402
import restore_drill as drill  # noqa: E402

from fake_mongo import FakeDatabase  # noqa: E402

SRV = "mongodb+srv://app:secret@cluster0.abcde.mongodb.net/household_coo"
WITH_OPTS = SRV + "?retryWrites=true&w=majority&appName=Cluster0"
PLAIN = "mongodb://app:secret@10.0.0.4:27017/household_coo"


class TheScratchDatabaseIsNeverTheLiveOne(unittest.TestCase):

    def test_the_name_changes(self):
        self.assertNotEqual(drill._db_name_of(drill.scratch_uri(SRV)),
                            drill._db_name_of(SRV))

    def test_it_is_the_live_name_plus_a_suffix(self):
        self.assertEqual(drill._db_name_of(drill.scratch_uri(SRV)),
                         "household_coo_drill")

    def test_a_query_string_does_not_end_up_in_the_database_name(self):
        """The failure that would look like it worked: a scratch database
        literally named `household_coo_drill?retryWrites=true`, or worse, the
        suffix landing after the options and not in the name at all."""
        self.assertEqual(drill._db_name_of(drill.scratch_uri(WITH_OPTS)),
                         "household_coo_drill")

    def test_the_options_survive(self):
        # retryWrites and w=majority are not decoration. A restore that
        # silently drops them is a restore with different durability from the
        # thing it is rehearsing.
        out = drill.scratch_uri(WITH_OPTS)
        self.assertIn("retryWrites=true", out)
        self.assertIn("w=majority", out)
        self.assertIn("appName=Cluster0", out)

    def test_the_host_and_credentials_are_untouched(self):
        out = drill.scratch_uri(WITH_OPTS)
        self.assertTrue(out.startswith(
            "mongodb+srv://app:secret@cluster0.abcde.mongodb.net/"))

    def test_a_plain_mongodb_url_with_a_port_works_too(self):
        # A host:port has a colon but no slash, so it must not be mistaken for
        # the database segment.
        self.assertEqual(drill._db_name_of(drill.scratch_uri(PLAIN)),
                         "household_coo_drill")

    def test_running_it_twice_does_not_stack_suffixes(self):
        # Not a safety hole, but a drill database called
        # household_coo_drill_drill is a sign the derivation is being applied
        # to the wrong input.
        once = drill.scratch_uri(SRV)
        self.assertNotIn("_drill_drill", drill.scratch_uri(once))


class ItRefusesRatherThanGuesses(unittest.TestCase):

    def test_a_url_naming_no_database_is_refused(self):
        with self.assertRaises(ValueError):
            drill.scratch_uri("mongodb+srv://app:secret@cluster0.mongodb.net/")

    def test_a_url_naming_no_database_but_carrying_options_is_refused_too(self):
        # The nastier shape: there IS something after the slash, so a lazy
        # check for a non-empty tail passes and the scratch database comes out
        # named after the query string.
        with self.assertRaises(ValueError):
            drill.scratch_uri(
                "mongodb+srv://app:secret@cluster0.mongodb.net/?retryWrites=true")

    def test_an_empty_suffix_is_refused(self):
        """The direct route to writing over production, and the reason the
        suffix is not a parameter anybody passes in day to day."""
        with self.assertRaises(ValueError):
            drill.scratch_uri(SRV, suffix="")


class TheScriptSaysWhatItIsAbout(unittest.TestCase):
    """A recovery procedure nobody runs is the same as no recovery procedure,
    with the added cost that everyone believes there is one. These hold the
    parts that make it runnable without the runbook open."""

    def source(self):
        with open(os.path.join(ROOT, "scripts", "restore_drill.py"),
                  encoding="utf-8") as handle:
            return handle.read()

    def test_the_scratch_copy_is_deleted_by_default(self):
        # It holds every family's data and none of production's attention.
        self.assertIn("await client.drop_database(drill_name)", self.source())

    def test_the_drop_is_awaited(self):
        """Unawaited, motor's drop_database drops nothing, silently, while the
        script reports that it cleaned up. The first version did exactly
        that."""
        self.assertNotIn("\n            client.drop_database(", self.source())

    def test_keeping_it_comes_with_the_command_to_delete_it(self):
        self.assertIn("drop_database('{drill_name}')", self.source())

    def test_it_tells_you_to_look_at_dates(self):
        # The last mile no script can assert, and the one a timezone fault
        # destroys invisibly.
        self.assertIn("RIGHT DAYS", self.source())


if __name__ == "__main__":
    unittest.main()


class TheWholeDrillEndToEnd(unittest.TestCase):
    """The sequencing, not just the name.

    scratch_uri being right does not make the drill right: it has to dump the
    LIVE database, restore into the SCRATCH one, verify that, and delete the
    scratch copy afterwards — in that order, against the right two databases.
    A real mongod cannot be downloaded in this environment, but fake_mongo
    already drives mongo_backup in the round-trip tests next door, so the
    orchestration is exercised for real even though the server is not.

    This is what would have caught the unawaited drop_database, which reported
    a clean-up that never happened.
    """

    LIVE = "mongodb://u:p@host:27017/household_coo"

    def setUp(self):
        self.archive = tempfile.mkdtemp(prefix="drill-test-")
        self.addCleanup(shutil.rmtree, self.archive, ignore_errors=True)

        self.live = FakeDatabase()
        asyncio.run(self.live["families"].insert_one(
            {"family_id": "fam_1", "name": "Test", "created_at":
             mongo_backup.datetime.now(mongo_backup.timezone.utc)}))
        self.scratch = FakeDatabase()
        self.dropped = []
        self.opened = []

        test = self

        class FakeClient:
            def __init__(self, database):
                self._database = database

            async def drop_database(self, name):
                test.dropped.append(name)

            def close(self):
                pass

        def fake_client(uri):
            test.opened.append(uri)
            database = test.live if uri == test.LIVE else test.scratch
            return FakeClient(database), database

        self._real = mongo_backup._client
        mongo_backup._client = fake_client
        self.addCleanup(lambda: setattr(mongo_backup, "_client", self._real))

    def drill_it(self, keep=False):
        out = io.StringIO()
        with redirect_stdout(out):
            # expect_aware=False: fake_mongo models raw BSON, which carries
            # no timezone. Production reads through a tz_aware client, so the
            # script's own default of True is the right one there.
            code = asyncio.run(drill.run(self.LIVE, self.archive, keep,
                                         expect_aware=False))
        return code, out.getvalue()

    def test_it_passes_on_a_healthy_database(self):
        code, said = self.drill_it()
        self.assertEqual(code, 0, said)
        self.assertIn("The backups are real", said)

    def test_it_read_live_and_wrote_scratch(self):
        self.drill_it()
        self.assertEqual(self.opened[0], self.LIVE)
        self.assertIn("household_coo_drill", self.opened[1])
        # And never the other way round.
        self.assertNotIn(self.LIVE, self.opened[1:])

    def test_the_data_actually_landed_in_the_scratch_database(self):
        self.drill_it()
        got = asyncio.run(self.scratch["families"].find_one({"family_id": "fam_1"}))
        self.assertIsNotNone(got)

    def test_the_live_database_was_not_written_to(self):
        before = asyncio.run(self.live["families"].count_documents({}))
        self.drill_it()
        self.assertEqual(asyncio.run(self.live["families"].count_documents({})),
                         before)

    def test_the_scratch_copy_is_dropped_afterwards(self):
        self.drill_it()
        self.assertEqual(self.dropped, ["household_coo_drill"])

    def test_keep_leaves_it_and_says_how_to_delete_it(self):
        code, said = self.drill_it(keep=True)
        self.assertEqual(self.dropped, [])
        self.assertIn("drop_database", said)
        self.assertIn("RIGHT DAYS", said)

    def test_it_prints_a_row_for_the_runbook(self):
        # Step 5 of the drill is writing down what happened, and a drill whose
        # result nobody recorded gets re-argued from memory six months later.
        _, said = self.drill_it()
        self.assertIn("| passed |", said)

    def test_a_scratch_name_equal_to_the_live_one_stops_before_connecting(self):
        drill.SCRATCH_SUFFIX = "_drill"
        out = io.StringIO()
        with redirect_stdout(out):
            code = asyncio.run(drill.run(
                "mongodb://u:p@host:27017/household_coo_drill", self.archive,
                False, expect_aware=False))
        # Derived name would be household_coo_drill again (idempotent), which
        # IS the live name here — so it must refuse rather than dump over it.
        self.assertEqual(code, 1)
        self.assertIn("STOPPED", out.getvalue())
        self.assertEqual(self.opened, [])
