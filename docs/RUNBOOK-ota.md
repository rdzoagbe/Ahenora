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
  the build rather than letting it try. The order it has to go in is below.

## Shipping a native module

Twice now this has gone wrong the same way, so the order is written here
rather than reasoned out again.

**2026-09-03** — `expo-audio` was added for a voice recorder, merged, and
published over the air. Its module loaded during the Feed's first render, so
the home screen threw on launch and the app was dead for everyone on Android.

**2026-09-15** — a document scanner for automatic framing. Same mistake, with
a guard in front of it: the plugin was reached through a `require` inside a
`try`, with ten tests proving the fallback held. Scan opened a grey screen and
the app crashed on a real phone within minutes of the publish.

### Why the guard could not work

`TurboModuleRegistry.getEnforcing()` does not throw a catchable JavaScript
error when the native module is missing. It goes into native code and aborts
the process. A `try`/`catch` in JavaScript cannot survive that, so **feature
detection is not a safety mechanism here** — it is a test that passes.

`check-native-deps.js` says this in its own header, and it was read, quoted
and satisfied on the way to making the mistake anyway. Read it as a
constraint, not as a warning to be handled.

### The order

1. Add the dependency and its config plugin. Update `frontend/native-modules.json`
   — the guard fails until you do, deliberately.
2. **Bump `runtimeVersion` in `app.json`.** This is the step that makes it
   safe: an OTA only reaches binaries on a matching runtime, so JavaScript
   built for the new module can never arrive on a build that lacks it. Not
   bumping it is what made 2026-09-15 possible.
3. Build, and **test on a real device** — both that the new feature works and
   that the previous store build still works. A simulator with the module
   present proves nothing about the phones already out there.
4. Submit to **both** stores and wait for them to be live.
5. Only then merge the JavaScript that uses it.

Between 2 and 5, existing installs receive no OTA updates at all — they are on
the old runtime. That is the cost, it is known, and it is smaller than the
alternative. Plan the sequence so the gap is short rather than trying to
remove it.

### What CI will and will not tell you

The browser harnesses drive the scan sheet, but on web `Platform.OS`
short-circuits before any native require, and the harness uses the photo
library rather than the camera. **The code path that matters is not executed
anywhere in CI.** Green means the rest of the app still works; it says nothing
about the native module.
