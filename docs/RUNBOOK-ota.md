# Shipping over the air, and taking it back

Ahenora is live on both stores. An over-the-air update reaches installed apps
without going through review, which is what makes fixing things fast — and what
took the app down on 3 September 2026, when a native module shipped as JS and
every Android install stopped starting.

Everything below exists because recovery that day was improvised.

## What happens on a merge to main

`frontend-ci-eas-update.yml` publishes to the `production` branch at a
**percentage**, not to everybody. The default is 20%, set by the repository
variable `OTA_ROLLOUT_PERCENTAGE`.

The important part is what the other 80% get: from `eas update --help`, *"users
not in the rollout will be served the previous latest update on the branch"*.
They are not on something new and untested — they stay exactly where they
already were. That is the property that makes a partial publish safe rather
than merely smaller.

The job summary prints the **update group id**. Promote and rollback both take
it. Copy it.

## Watching it

**Actions → OTA watch**, paste the group id.

It runs `eas update:insights` per platform: launches, crashes, unique users.
iOS and Android are reported separately on purpose — they fail differently, and
a combined number hides one store behind the other.

A crash count climbing while the rollout is partial is the whole reason the
rollout is partial. Roll back; do not promote.

## Sending it to everyone

**Actions → OTA promote**, group id, percentage 100.

Nothing promotes itself. Reaching every household is a decision a person makes
after looking.

The cost of that choice is real: a fix can sit at 20% while its author believes
it shipped. The publish summary says so loudly, and the six-hourly stability
check flags a rollout left partial.

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
