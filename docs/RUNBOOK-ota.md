# Shipping over the air, and taking it back

Ahenora is live on both stores. An over-the-air update reaches installed apps
without going through review, which is what makes fixing things fast — and what
took the app down on 3 September 2026, when a native module shipped as JS and
every Android install stopped starting.

Everything below exists because recovery that day was improvised.

## What happens on a merge to main

`frontend-ci-eas-update.yml` publishes to the `production` branch, on both
platforms, **to everyone on runtime 2.0.0**.

The job summary prints the **update group id**. Rollback and watch both take
it. Copy it — hunting for it in the Expo dashboard while trying to undo a bad
release is exactly the wrong moment.

### Why this is not staged, and what it would take

A `--rollout-percentage` was added here on 2026-09-07 and removed the same day.
It worked exactly once. The next merge could not publish at all:

> Cannot publish a new update with this runtime version while a rollout is in
> progress for the same runtime version. Before publishing a new update, the
> latest rollout percentage must be set to 100% or the rollout update deleted.

**EAS permits one rollout in progress per runtime version.** Nothing
auto-promoted, so every merge after the first jammed until a person promoted by
hand. On a repository that merges several times a day, that is not a safety
feature — it stops fixes reaching anybody, urgent ones included.

Staging is still the right idea. Bringing it back needs an answer to one
question first: **what happens to the previous canary when a new update is
published?**

* **Promote it to 100%** — simple, but a bad canary reaches everyone the moment
  somebody merges anything, possibly minutes later.
* **Delete it** — nobody is ever left on unblessed code, but a fix can sit at
  20% forever while each merge replaces the canary, which is the silent
  non-delivery this repository keeps rediscovering.
* **Refuse and require a human** — what was shipped, and what jammed.

Whichever is chosen has to be designed against that constraint rather than
found by breaking production. `tests/test_workflow_publish_steps.py` fails if
the flag comes back without that work.

## Watching it

**Actions → OTA watch**, paste the group id.

It runs `eas update:insights` per platform: launches, crashes, unique users.
iOS and Android are reported separately on purpose — they fail differently, and
a combined number hides one store behind the other.

A crash count climbing while the rollout is partial is the whole reason the
rollout is partial. Roll back; do not promote.

## Sending it to everyone

Not needed while publishing is unstaged — an update already reaches everyone.

**Actions → OTA promote** remains, and is what unjams things if a rollout is
ever left partial (by a manual `eas update` with a percentage, or by staging
being switched back on). Group id, percentage 100.

## Taking it back

**Actions → OTA rollback**, group id, a reason, and type `ROLLBACK` to confirm.

`eas update:rollback` republishes the update group published *before* the one
you name. If there is none, it rolls back to the update embedded in the store
binary. Either way people stop running the bad JS on their next launch.

### The one constraint that decides everything

From `eas update:rollback --help`, the group *"must be the latest update for its
branch and runtime version"*.

**So roll back before anything else publishes to production.** If a merge to
main lands first, it takes that position and rollback is no longer available.
The way back then is to revert the offending commit and let the pipeline publish
the fix forward — slower, and it needs CI to be green.

If something is badly wrong: roll back first, diagnose second.

### Rolling back is not the end

The bad commit is still on `main`. Revert it, or the next merge republishes the
same problem.

## What this does not cover

- **The web app.** `docs/app` deploys to ahenora.com through GitHub Pages and
  reaches every browser at once. No staged rollout exists for it.
- **The backend.** Railway deploys from `main` automatically. Recovery there is
  a revert.
- **Anything needing a new binary.** A native dependency cannot ship over the
  air — that is the outage — and `frontend/scripts/check-native-deps.js` fails
  the build rather than letting it try.
