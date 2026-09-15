#!/usr/bin/env python3
"""The whole restore drill, as one command.

    python3 scripts/restore_drill.py

That is the entire thing. Run it from anywhere MONGO_URL is set — a Railway
one-off shell is the easy one — and it dumps production, restores into a
scratch database, verifies the restore is actually usable, tells you in plain
words whether the backups are real, and deletes the scratch copy afterwards.

WHY THIS EXISTS ON TOP OF mongo_backup.py

The drill was five commands and a piece of setup ("create an empty database
first"), and it did not get run. A recovery procedure nobody runs is the same
as no recovery procedure — with the added cost that everyone believes there is
one. The steps were never the point; knowing the data comes back is.

So the setup is gone. The scratch database is DERIVED from MONGO_URL — same
cluster, same credentials, a different database name — and MongoDB creates a
database on first write, so there is nothing to make beforehand and no second
connection string to find, paste, or accidentally leave in a shell history.

WHAT IT WILL NOT DO

It will not write to the live database. The scratch name is derived and then
checked against the live one, and if they match for any reason it stops before
connecting. mongo_backup.restore refuses the live database independently, so
that is two locks on the same door — deliberately, because this is the one
script in the repository whose failure mode is destroying the thing it is
rehearsing for.

It also deletes the scratch database when it finishes. That copy holds every
family's data and none of production's attention, and "I will tidy it up
later" is how it is still there in March. Pass --keep if you want to open the
app against it (step 4 of the runbook, and the one no script can assert), and
it prints the command to do that and the command to delete it after.

Usage:
    python3 scripts/restore_drill.py            # drill, then clean up
    python3 scripts/restore_drill.py --keep     # leave the scratch db to open
    python3 scripts/restore_drill.py --out DIR  # keep the archive too
"""
import argparse
import asyncio
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mongo_backup  # noqa: E402

SCRATCH_SUFFIX = "_drill"

# Re-exported so the derivation and the name-reading it is checked against come
# from one place: a test that parsed names its own way could agree with itself
# while disagreeing with the script.
_db_name_of = mongo_backup._db_name


def scratch_uri(live_uri: str, suffix: str = SCRATCH_SUFFIX) -> str:
    """The same cluster and credentials, a different database.

    Kept as string surgery on the path segment rather than a URL parse: a
    mongodb+srv URI carries options, and rebuilding one from parts is a good
    way to drop a parameter that turns out to have been load-bearing.
    """
    if not suffix:
        raise ValueError(
            "an empty scratch suffix would make the drill database the LIVE "
            "database. Refusing before anything connects.")
    head, _, tail = live_uri.rpartition("/")
    if not head:
        raise ValueError("MONGO_URL has no database path to work from")
    name, sep, query = tail.partition("?")
    if not name:
        raise ValueError(
            "MONGO_URL names no database, so no scratch name can be derived "
            "from it. Add one (…/household_coo) or run the steps by hand.")
    # Idempotent: deriving from an already-derived URL gives the same name
    # back rather than household_coo_drill_drill, which is harmless in itself
    # but is a reliable sign the derivation is being fed the wrong input.
    if not name.endswith(suffix):
        name += suffix
    return f"{head}/{name}{sep}{query}"


def _human(seconds: float) -> str:
    return f"{seconds:.0f}s" if seconds < 90 else f"{seconds / 60:.1f} min"


async def run(live_uri: str, archive_dir: str, keep: bool,
              expect_aware: bool = True) -> int:
    """expect_aware mirrors mongo_backup.verify's own switch, and exists for
    the same reason it does there: against real MongoDB read through the app's
    client (tz_aware=True) a naive datetime is a genuine fault, but the test
    double models RAW BSON, which has no timezone. True is the production
    answer and the default; the end-to-end test passes False."""
    live_name = mongo_backup._db_name(live_uri)
    drill_uri = scratch_uri(live_uri)
    drill_name = mongo_backup._db_name(drill_uri)

    # Belt and braces. mongo_backup.restore refuses the live database on its
    # own; this refuses to even connect. Two locks, because the failure mode
    # here is destroying the thing the drill exists to protect.
    if drill_name == live_name:
        print(f"STOPPED: the scratch name came out identical to the live "
              f"database ({live_name!r}). Nothing was read or written.")
        return 1

    print(f"Live database:    {live_name}")
    print(f"Scratch database: {drill_name}   (created on first write, deleted "
          f"{'on request' if keep else 'at the end'})")
    print()

    started = time.monotonic()

    # 1 ── take an archive
    print("1/3  Reading production into an archive...")
    client, database = mongo_backup._client(live_uri)
    try:
        # dump returns the MANIFEST, not a name->count map: {"taken_at": ...,
        # "collections": {name: {"count": n, "sha256": ...}}}. Summing it
        # directly added a timestamp string to an integer, which the
        # end-to-end test caught and reading the signature had not.
        manifest = await mongo_backup.dump(database, archive_dir)
    finally:
        client.close()
    counts = {name: info["count"]
              for name, info in manifest["collections"].items()}
    total = sum(counts.values())
    empty = sorted(name for name, n in counts.items() if n == 0)
    print(f"     {total} documents across {len(counts)} collections")
    if empty:
        # Not a failure on its own — a young app has collections nobody has
        # used. Said out loud because it is the drill's job to surface it.
        print(f"     empty: {', '.join(empty)}")
        print("     If one of those should have data, stop and look — that is "
              "the drill finding something.")
    dumped_at = time.monotonic()

    # 2 ── restore it somewhere safe
    print()
    print("2/3  Restoring into the scratch database...")
    client, database = mongo_backup._client(drill_uri)
    try:
        written = await mongo_backup.restore(database, archive_dir)
        print(f"     {sum(written.values())} documents written")
        restored_at = time.monotonic()

        # 3 ── the step that matters
        print()
        print("3/3  Checking the restore is usable...")
        problems = await mongo_backup.verify(database, archive_dir,
                                             expect_aware=expect_aware)
    finally:
        # await: this is a motor client, and drop_database returns a coroutine.
        # Unawaited it drops nothing, silently, and leaves a full copy of every
        # family's data sitting on the cluster while the script says it cleaned
        # up. Written down because that is exactly what the first version did.
        if not keep:
            await client.drop_database(drill_name)
        client.close()

    elapsed = time.monotonic() - started
    print()
    if problems:
        print("THE BACKUP DID NOT COME BACK CLEANLY.")
        for problem in problems:
            print(f"  - {problem}")
        print()
        print("This is the drill doing its job. Nothing in production changed. "
              "Fix what is named above, then run it again.")
        outcome = "FAILED"
    else:
        print("The backups are real. Counts match the manifest, dates came "
              "back as timezone-aware dates, nothing is orphaned, and every "
              "collection that had rows still has them.")
        outcome = "passed"

    print()
    if keep:
        print(f"The scratch database {drill_name!r} was KEPT, so you can open "
              f"the app against it — the last mile no script can check. Log in "
              f"as a real household and look hardest at DATES LANDING ON THE "
              f"RIGHT DAYS: that is what a timezone fault destroys, and it is "
              f"invisible in any row count.")
        print()
        print("    # same URL as MONGO_URL with the database name swapped:")
        print(f"    MONGO_URL=\"${{MONGO_URL/{live_name}/{drill_name}}}\" \\")
        print("        uvicorn server:app --app-dir backend --port 8001")
        print()
        print("It holds a full copy of every family's data and none of "
              "production's attention. Delete it when you are done:")
        print(f"    python3 -c \"import pymongo,os;"
              f"pymongo.MongoClient(os.environ['MONGO_URL'])"
              f".drop_database('{drill_name}')\"")
    else:
        print(f"Scratch database {drill_name!r} deleted.")

    print()
    print("Row for the table in docs/runbooks/restore-drill.md:")
    print(f"| {datetime.now(timezone.utc):%Y-%m-%d} | {total} docs | "
          f"{_human(restored_at - dumped_at)} | {outcome} | "
          f"drill took {_human(elapsed)} |")
    return 1 if problems else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--keep", action="store_true",
                    help="leave the scratch database in place to open the app against")
    ap.add_argument("--out", default="",
                    help="keep the archive in this directory (default: a temp dir, removed)")
    args = ap.parse_args(argv)

    live = os.environ.get("MONGO_URL", "")
    if not live:
        print("MONGO_URL is not set. Run this where the app's database URL "
              "lives — a Railway one-off shell on the backend service is the "
              "easy one.")
        return 1

    archive = args.out or tempfile.mkdtemp(prefix="restore-drill-")
    try:
        return asyncio.run(run(live, archive, args.keep))
    finally:
        if not args.out:
            shutil.rmtree(archive, ignore_errors=True)
        else:
            print(f"\nArchive kept at {archive}")


if __name__ == "__main__":
    sys.exit(main())
