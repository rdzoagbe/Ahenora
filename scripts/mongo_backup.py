#!/usr/bin/env python3
"""Dump, restore and — the part that matters — VERIFY a restore.

A backup nobody has restored from is a belief, not a backup. This exists so
the belief can be tested, on a schedule, before the night it matters.

    python3 scripts/mongo_backup.py dump    --out backups/2026-09-14
    python3 scripts/mongo_backup.py restore --from backups/2026-09-14 \
                                            --into "$DRILL_MONGO_URL"
    python3 scripts/mongo_backup.py verify  --from backups/2026-09-14 \
                                            --against "$DRILL_MONGO_URL"

Why not mongodump
-----------------
mongodump is not installed on the app's runtime, and adding a binary
dependency to the one tool you need during an incident is how the tool turns
out to be missing during the incident. This uses pymongo, which is already a
dependency, and writes Extended JSON via bson.json_util.

That choice carries the single most important correctness requirement here:
**types must survive the round trip.** A naive `json.dumps` turns every
datetime into a string, the restore puts strings back, and every date query in
the app silently stops matching — due dates, reminders, expiry alerts. The
database restores, the app starts, and nothing works for reasons nobody can
see. Extended JSON round-trips datetimes as datetimes, and `verify` checks it
rather than trusting it.

Safety
------
`restore` refuses to write into the database named by MONGO_URL unless
--i-know-this-is-production is passed. A drill that can destroy the thing it
is rehearsing for is not a drill.
"""
import argparse
import asyncio
import gzip
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

from bson import json_util

# Datetimes must come back TIMEZONE-AWARE.
#
# json_util.loads returns naive datetimes by default. Restored into real
# MongoDB that would look harmless — the driver coerces a naive datetime to
# UTC on write, and the app reads with tz_aware=True — but relying on that
# coercion is the exact dependency that has already broken this app once:
# server.py records that without tz_aware "every stored datetime returns NAIVE,
# while utcnow() is aware, so `stored < utcnow()` raises TypeError... it took
# out invite acceptance in production."
#
# An archive is also read by things that are not MongoDB, including `verify`
# below. So the fidelity is guaranteed here rather than borrowed from whatever
# happens to be underneath.
AWARE = json_util.JSONOptions(tz_aware=True, tzinfo=timezone.utc)

BATCH = 500

# Collections holding household data. Taken from the app's own deletion list,
# which is the only place that has to be exhaustive already — if a collection
# is missing HERE it is not backed up, and if it is missing THERE it is not
# deleted on request. Keeping one source for both is deliberate.
def household_collections():
    server_py = os.path.join(os.path.dirname(__file__), "..", "backend", "server.py")
    with open(server_py, encoding="utf-8") as handle:
        src = handle.read()
    start = src.index("_FAMILY_SCOPED_COLLECTIONS")
    block = src[start:src.index("]", start)]
    import re
    return sorted(set(re.findall(r'"([a-z_]+)"', block)))


def _utcnow():
    return datetime.now(timezone.utc)


async def dump(database, out_dir, collections=None):
    """Write every collection to <out_dir>/<name>.json.gz plus a manifest."""
    os.makedirs(out_dir, exist_ok=True)
    names = collections if collections is not None else await _names(database)
    manifest = {"taken_at": _utcnow().isoformat(), "collections": {}}

    for name in sorted(names):
        path = os.path.join(out_dir, f"{name}.json.gz")
        count = 0
        digest = hashlib.sha256()
        # Streamed a batch at a time: a household database that fits in memory
        # today is not a reason to write a tool that needs it to.
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            cursor = database[name].find({})
            async for doc in cursor:
                doc.pop("_id", None)
                line = json_util.dumps(doc)
                handle.write(line + "\n")
                digest.update(line.encode("utf-8"))
                count += 1
        manifest["collections"][name] = {"count": count, "sha256": digest.hexdigest()}

    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
    return manifest


async def _names(database):
    names = database.list_collection_names()
    if asyncio.iscoroutine(names):
        names = await names
    return [n for n in names if not n.startswith("system.")]


def read_manifest(archive):
    with open(os.path.join(archive, "manifest.json"), encoding="utf-8") as handle:
        return json.load(handle)


def read_collection(archive, name):
    """Documents as stored, with types restored. Raises if the file was
    tampered with or truncated — checked BEFORE anything is written."""
    path = os.path.join(archive, f"{name}.json.gz")
    docs, digest = [], hashlib.sha256()
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if not line:
                continue
            digest.update(line.encode("utf-8"))
            docs.append(json_util.loads(line, json_options=AWARE))
    return docs, digest.hexdigest()


async def restore(database, archive, collections=None):
    """Replace each collection in `database` with the archive's copy.

    Every file is read and checksummed first. A restore that half-succeeds and
    then discovers a corrupt file has turned one problem into two.
    """
    manifest = read_manifest(archive)
    names = collections if collections is not None else sorted(manifest["collections"])

    staged = {}
    for name in names:
        expected = manifest["collections"][name]
        docs, digest = read_collection(archive, name)
        if digest != expected["sha256"]:
            raise SystemExit(f"{name}: archive is corrupt (checksum mismatch)")
        if len(docs) != expected["count"]:
            raise SystemExit(
                f"{name}: archive has {len(docs)} rows, manifest says {expected['count']}")
        staged[name] = docs

    written = {}
    for name, docs in staged.items():
        await database[name].delete_many({})
        if docs:
            await database[name].insert_many(docs)
        written[name] = len(docs)
    return written


async def verify(database, archive, collections=None, expect_aware=True):
    """The drill's actual question: is the restored database USABLE?

    Not "did the restore exit 0". Four things, in order of how quietly they
    fail:

    1. Counts match the manifest.
    2. Datetimes came back as datetimes. This is the silent one — a JSON
       round-trip that stringifies dates leaves an app that starts cleanly and
       then matches nothing on any date query.
    3. Nothing is orphaned: every row's family_id still names a household that
       exists. A restore that drops one collection leaves the rest pointing at
       nothing.
    4. A collection that had rows is not now empty.

    Returns a list of problems. Empty means the drill passed.

    `expect_aware` describes THE READER, not the archive. BSON has no timezone,
    so the bytes on the wire are always naive; the app gets aware datetimes
    because its client sets tz_aware=True, and the CLI below reads the same
    way. Against such a client a naive datetime is a real fault — it means
    something bypassed the client's decoding, and `stored < utcnow()` will
    raise TypeError rather than answer wrongly. Against a reader that models
    raw BSON (the in-memory double the tests use) naive is simply correct, so
    the check is turned off there rather than made meaningless everywhere.
    """
    manifest = read_manifest(archive)
    names = collections if collections is not None else sorted(manifest["collections"])
    problems = []

    families = set()
    async for row in database["families"].find({}):
        if row.get("family_id"):
            families.add(row["family_id"])

    for name in names:
        expected = manifest["collections"][name]["count"]
        actual = await database[name].count_documents({})
        if actual != expected:
            problems.append(f"{name}: {actual} rows restored, expected {expected}")
        if expected > 0 and actual == 0:
            problems.append(f"{name}: restored empty but the backup had {expected} rows")

        async for row in database[name].find({}):
            for field, value in row.items():
                if field.endswith("_at") or field.endswith("_date"):
                    if isinstance(value, str):
                        problems.append(
                            f"{name}.{field} came back as a string, not a datetime — "
                            "every date query against it will silently match nothing")
                        break
                    if expect_aware and isinstance(value, datetime) and value.tzinfo is None:
                        problems.append(
                            f"{name}.{field} came back naive (no timezone) — the app "
                            "compares stored datetimes against an aware utcnow(), so "
                            "this raises TypeError rather than returning a wrong answer")
                        break
            owner = row.get("family_id")
            if owner and families and owner not in families:
                problems.append(f"{name}: a row belongs to household {owner}, which was not restored")
                break

    return problems


# ── CLI ───────────────────────────────────────────────────────────────────

def _client(uri):
    from motor.motor_asyncio import AsyncIOMotorClient
    # tz_aware=True to match the app's own client. Reading the drill database
    # any other way would verify something the app never sees.
    client = AsyncIOMotorClient(uri, tz_aware=True)
    return client, client.get_default_database()


def _db_name(uri):
    tail = uri.rsplit("/", 1)[-1]
    return tail.split("?")[0]


async def _main(args):
    if args.command == "dump":
        client, database = _client(args.uri or os.environ["MONGO_URL"])
        manifest = await dump(database, args.out)
        total = sum(c["count"] for c in manifest["collections"].values())
        print(f"dumped {total} documents across "
              f"{len(manifest['collections'])} collections to {args.out}")
        client.close()

    elif args.command == "restore":
        live = os.environ.get("MONGO_URL", "")
        if live and _db_name(args.into) == _db_name(live) and not args.i_know_this_is_production:
            raise SystemExit(
                f"refusing to restore into {_db_name(args.into)!r}: that is the database "
                "MONGO_URL points at. Restore into a scratch database for a drill, or pass "
                "--i-know-this-is-production if you are genuinely recovering.")
        client, database = _client(args.into)
        written = await restore(database, getattr(args, "from"))
        print(f"restored {sum(written.values())} documents into {_db_name(args.into)}")
        client.close()

    elif args.command == "verify":
        client, database = _client(args.against)
        problems = await verify(database, getattr(args, "from"))
        client.close()
        if problems:
            print("RESTORE NOT USABLE:")
            for problem in problems:
                print(f"  - {problem}")
            return 1
        print("restore verified: counts match, dates are dates, nothing orphaned")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    d = sub.add_parser("dump", help="write every collection to an archive")
    d.add_argument("--out", required=True)
    d.add_argument("--uri", default="")

    r = sub.add_parser("restore", help="load an archive into a database")
    r.add_argument("--from", required=True)
    r.add_argument("--into", required=True)
    r.add_argument("--i-know-this-is-production", action="store_true")

    v = sub.add_parser("verify", help="check a restored database is usable")
    v.add_argument("--from", required=True)
    v.add_argument("--against", required=True)

    args = parser.parse_args(argv)
    return asyncio.run(_main(args))


if __name__ == "__main__":
    sys.exit(main())
