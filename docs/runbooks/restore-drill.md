# Restore drill

**A backup nobody has restored from is a belief, not a backup.**

This is the drill that turns the belief into a fact. Run it quarterly, and
after any change to the database or the hosting.

It takes about fifteen minutes. Nothing here touches production data — the
restore step refuses to write into the database `MONGO_URL` points at unless
you explicitly override it.

---

## Before the first drill: check the two things code cannot check

**1. Is anything actually being backed up?**

Open the database provider's console (Atlas, or Railway's Mongo plugin) and
find the backup/snapshot settings. Write down here what you found:

- Provider: `____________`
- Automatic backups: on / off
- Frequency: `____________`
- Retention: `____________`

If automatic backups are **off**, that is the finding — turn them on before
doing anything else. The rest of this drill still works (it takes its own
archive), but a drill you have to remember to run is not a backup strategy.

**2. Is the database reachable from the internet?**

Atlas → Network Access. Anything that reads `0.0.0.0/0` means the database
accepts connections from anywhere, and only the password is between a stranger
and every family's data. It should be a private endpoint, or an allowlist
containing only your app's egress addresses.

- Network access rule: `____________`

---

## The drill

### 1. Take an archive

From anywhere with `MONGO_URL` in the environment — a Railway one-off shell is
fine, and needs no extra tooling since this uses `pymongo`, already installed:

```bash
python3 scripts/mongo_backup.py dump --out backups/$(date +%F)
```

Expect a line like `dumped 12481 documents across 29 collections`. If a
collection you know has data reports `0`, stop — that is the drill finding
something, and it is exactly what it is for.

### 2. Restore into a scratch database

Create an empty database — a free Atlas cluster, a local Mongo, or a second
database on the same cluster named `ahenora_drill`. Never the live one.

```bash
export DRILL_MONGO_URL="mongodb+srv://.../ahenora_drill"
python3 scripts/mongo_backup.py restore --from backups/$(date +%F) --into "$DRILL_MONGO_URL"
```

If the archive is corrupt or truncated, this refuses **before writing
anything**. A restore that half-succeeds and then fails has turned one problem
into two, at the worst possible moment.

### 3. Verify it is usable

This is the step people skip, and the reason the whole exercise exists.
"`mongorestore` exited 0" is not a restored database.

```bash
python3 scripts/mongo_backup.py verify --from backups/$(date +%F) --against "$DRILL_MONGO_URL"
```

It checks four things, in order of how quietly they fail:

| Check | What it catches |
|---|---|
| Counts match the manifest | Rows silently lost in transit |
| Dates are dates, and timezone-aware | The quiet one — a stringified or naive datetime leaves an app that boots fine and then matches nothing on any date query, or raises `TypeError` comparing against `utcnow()` |
| Nothing orphaned | A collection dropped, leaving the rest pointing at households that no longer exist |
| No collection came back empty | A file that restored as zero rows |

A pass prints `restore verified`. A failure names each problem and exits 1.

### 4. Open the app against it

The last mile that no script can assert. Point a local backend at the drill
database and open the app:

```bash
MONGO_URL="$DRILL_MONGO_URL" uvicorn server:app --app-dir backend --port 8001
```

Log in as a real household and check: the calendar shows the right events on
the right days, a child's star balance is right, the vault lists its
documents. **Dates on the right days** is the one to look hardest at — it is
what a timezone fault destroys, and it is invisible in any row count.

### 5. Write down what happened

Date, how long it took, what failed. A drill whose result nobody recorded gets
re-argued from memory six months later.

| Date | Archive size | Restore time | Result | Notes |
|---|---|---|---|---|
| | | | | |

### 6. Delete the scratch database

It holds a full copy of every family's data. It is exactly as sensitive as
production and it has none of production's attention.

---

## If you are here because something is actually broken

Not a drill. The order changes:

1. **Stop writes first** if data is being corrupted — pause the service. A
   backup restored under an active corruption gets corrupted again.
2. Take an archive of the CURRENT state before restoring anything over it,
   however bad it looks. It is evidence, and it may hold rows the backup
   predates.
3. Restore into a **scratch** database and verify there first. Resist
   restoring straight over production: if the backup is also bad, you have
   destroyed the only copy of the damaged-but-partial data.
4. Only then, with a verified scratch restore in front of you, decide whether
   to promote it — `--into` the live URL with
   `--i-know-this-is-production`.

The flag exists to make that a sentence you have to type deliberately, at the
moment you are most tired and least careful.
