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

Run it **on the Railway backend service**, where `MONGO_URL` already lives.
The image carries the two recovery tools and their dependencies, so there is
nothing to install and no production connection string to paste anywhere.

To get a shell on the service, either:

- `railway ssh` from the Railway CLI (`npm i -g @railway/cli`, `railway login`,
  `railway link`, then `railway ssh`), or
- the service's own **Shell** / terminal option in the Railway dashboard.

Then, from `/app` (where the shell starts):

```bash
python3 scripts/restore_drill.py
```

> The Dockerfile copies `backend/` and, deliberately, only
> `scripts/mongo_backup.py` and `scripts/restore_drill.py` out of `scripts/`.
> This runbook told people to run the tool on the service for weeks while the
> image contained neither file; the drill had never been run, so nothing found
> out. `tests/test_the_recovery_tools_ship.py` fails if they stop shipping.

It dumps production, restores into a scratch database, verifies the restore is
actually usable, tells you in plain words whether the backups are real, prints
a row for the table below, and deletes the scratch copy.

**There is nothing to create first.** The scratch database is derived from
`MONGO_URL` — same cluster, same credentials, the database name with `_drill`
on the end — and MongoDB creates a database on first write. It will not write
to the live database: the derived name is checked against the live one before
anything connects, and `mongo_backup.py restore` refuses the live database
independently.

Add `--keep` if you want to open the app against it afterwards — the one part
no script can do for you. It then prints both the command to point a backend at
the drill database and the command to delete it when you are done.

### Then: open the app against it

The last mile no script can assert, and the reason `--keep` exists. Log in as a
real household and check: the calendar shows the right events on the right
days, a child's star balance is right, the vault lists its documents. **Dates
on the right days** is the one to look hardest at — it is what a timezone fault
destroys, and it is invisible in any row count.

### Then: write down what happened

The script prints the row. Paste it here and commit it. A drill whose result
nobody recorded gets re-argued from memory six months later.

| Date | Archive size | Restore time | Result | Notes |
|---|---|---|---|---|
| | | | | |

---

## By hand, if you ever need the steps apart

The one command above is `scripts/mongo_backup.py` run three times. If
something fails partway, or you want to restore into a cluster somewhere else
entirely, these are the pieces.

### 1. Take an archive

From the same shell on the Railway service (or anywhere else with `MONGO_URL`
set and the repo to hand):

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

### 4. Delete the scratch database

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
