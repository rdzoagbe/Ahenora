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

Per `docs/ROADMAP.md`, yes: **MongoDB Atlas M10 dedicated, backups Active** —
a deliberate upgrade from the free M0 tier, made for exactly this reason. So
this drill is not asking whether backups exist. It is asking the question
that upgrade did NOT answer: whether what they produce comes back.

Confirm it is still true — a plan downgrade silently turns snapshots off:

- Atlas → Backup → snapshot schedule still enabled: yes / no
- Retention: `____________`
- Most recent snapshot: `____________`

**2. Is the database reachable from the internet?**

**This is the one no code can check, including everything in this repository.**
A process that connects successfully learns nothing about who else could
connect. `/api/health/config` reports what it CAN see from inside — scheme,
TLS, and what kind of host is on the other end — and that is genuinely all of
it. The access list is a person opening a browser.

Atlas → Network Access → IP Access List. Anything reading `0.0.0.0/0`
(sometimes shown as "ALLOW ACCESS FROM ANYWHERE") means the database accepts
connections from any address on the internet, and only the password stands
between a stranger and every family's data. On an M10 the right answers are a
**Private Endpoint** or **VPC peering**; failing that, an allowlist holding
only the app's egress addresses.

- Network access rule: `____________`
- Checked on: `____________`

If you find `0.0.0.0/0`, do not simply delete it — the running app is using
it. Add the correct rule first, confirm the app still serves traffic, and only
then remove the open one.

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
