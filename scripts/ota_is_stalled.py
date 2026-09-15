"""Is the app on main actually reaching phones?

Everything that watches the OTA today watches an update that EXISTS. The OTA
guard reads the newest production update and asks whether it is crashing;
the publish workflow says out loud when a night had nothing to ship. Neither
of them can see the failure that has already happened here:

    the schedule does not fire, no update is published, and every workflow
    stays green.

It fired ONCE in its first two days and eight merged pull requests sat on
main reaching nobody, with nothing anywhere saying so. The response was four
attempts a night instead of one, which makes it less likely and not
impossible — GitHub runs scheduled workflows on a best-effort queue and drops
them under load. Four dropped attempts look exactly like four nights with
nothing to publish: silence.

So this asks the one question none of the others do, and it asks it from the
two facts that cannot be faked. `ota-published` is a tag the workflow moves
ONLY after `eas update` has succeeded, so it is the last thing that genuinely
reached a phone. main is what people merged. If there is app work between the
two and it has been sitting there longer than the schedule could legitimately
take, the pipeline has stopped and somebody needs to know.

WHY IT CANNOT CRY WOLF, which matters more than the check itself. A quiet day
is not a fault: an old update with nothing merged behind it is CORRECT, and
this says nothing at all about it. It speaks only when real app work is
waiting, and only past the longest wait the schedule can honestly produce —
something merged just after the window closes waits until the next night,
about twenty-nine hours. The grace is thirty. Below that, saying anything
would be an alarm about the schedule working as designed, and an alarm people
learn to ignore is worse than no alarm, which is written down here because
this repository has already made that mistake once.

Usage:  python3 scripts/ota_is_stalled.py [--repo DIR] [--grace-hours N]
        --json    print the verdict as JSON
Exit:   0 when there is nothing to say, 1 when a person is needed.
"""
from __future__ import annotations

import json
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Optional

# The publish window is 02:00-05:00 UTC. Work merged a minute after it closes
# waits until the next night: 05:01 to 02:00 is twenty-one hours, and the last
# attempt of that night is another three. Thirty gives a night that is merely
# late all the room it needs and still catches a night that never happened.
GRACE_HOURS = 30

# The paths whose contents end up in the OTA bundle. Deliberately the same set
# scripts/ota_should_publish.sh uses: if the two ever disagree, this alarms
# about work the publisher was right to skip, or stays quiet about work it
# would have shipped. tests hold them together.
OTA_PATHS = ("frontend", "legal")

TAG = "ota-published"


def _git(repo: str, *args: str) -> Optional[str]:
    """Run git, or return None. A git that cannot answer is not a verdict."""
    try:
        out = subprocess.run(("git", "-C", repo) + args, capture_output=True,
                             text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def oldest_unpublished_app_commit(repo: str, tag_sha: str,
                                  head_sha: str) -> Optional[datetime]:
    """When the EARLIEST unpublished change to the bundle was committed.

    Oldest, not newest, and the difference is the whole check. A pipeline that
    stopped on Monday still has something merged this evening sitting in front
    of it, so the newest unpublished commit is always fresh and a clock started
    from it never runs out — the check would go quiet for exactly as long as
    people kept working, which is to say permanently. This was written the
    other way round first and only showed up when a three-day stall was
    simulated against a real history; the unit tests could not see it, because
    they hand the decision a date rather than a repository.

    What was actually reported that first time was "eight merged pull requests
    sat on main reaching nobody" — a sentence about the OLDEST of them.

    Not the oldest commit on main either: a backend-only afternoon publishes
    nothing and must not start a clock.
    """
    # --reverse and -1 do not combine dependably (the limit is applied before
    # the reversal), so take the whole list and read the far end.
    stamps = _git(repo, "log", "--format=%cI",
                  f"{tag_sha}..{head_sha}", "--", *OTA_PATHS)
    if not stamps:
        return None
    try:
        return datetime.fromisoformat(stamps.splitlines()[-1].replace("Z", "+00:00"))
    except (ValueError, IndexError):
        return None


def verdict(tag_sha: Optional[str], head_sha: Optional[str],
            waiting_since: Optional[datetime], now: datetime,
            grace_hours: int = GRACE_HOURS) -> dict:
    """What to say, and why, from facts a caller has already gathered.

    Split out from the git calls so the decision can be tested at every age
    without a repository whose history moves.
    """
    if not head_sha:
        return {"action": "alarm", "reasons": [
            "Could not read main's HEAD, so nothing could be compared. This is "
            "a checkout problem, not an OTA problem — but it means the stall "
            "check is not running, so it is said out loud rather than skipped."]}

    if not tag_sha:
        return {"action": "alarm", "reasons": [
            f"There is no `{TAG}` tag. Either no over-the-air update has ever "
            f"published, or this checkout fetched no tags (the workflow needs "
            f"`fetch-tags: true` and `fetch-depth: 0`). Both are worth a look; "
            f"neither is safe to assume away."]}

    if tag_sha == head_sha:
        return {"action": "none", "reasons": [
            "The last published update is main's tip. Everything merged is out."]}

    if waiting_since is None:
        # Commits exist between the two, but none of them touch the bundle.
        return {"action": "none", "reasons": [
            f"main has moved since the last publish, but not inside "
            f"{'/, '.join(OTA_PATHS)}/ — a backend or docs day ships no bundle, "
            f"so an older update is the correct one to be running."]}

    waited = now - waiting_since
    hours = waited.total_seconds() / 3600
    if waited <= timedelta(hours=grace_hours):
        return {"action": "none", "reasons": [
            f"The earliest unpublished app change has waited {hours:.0f}h, inside "
            f"the {grace_hours}h "
            f"the nightly window can honestly take. Tonight has not missed yet."]}

    return {"action": "alarm", "reasons": [
        f"The earliest unpublished app change has been waiting {hours:.0f} hours "
        f"— past the {grace_hours}h a nightly window can account for. The last thing that "
        f"actually reached a phone is `{tag_sha[:12]}`; main is `{head_sha[:12]}`.",
        "Nothing is broken on anyone's phone. They are simply running an older "
        "app than everyone believes shipped, and every other check is green "
        "because each of them watches an update that exists.",
        "Run the 'Frontend CI and Expo update' workflow by hand "
        "(workflow_dispatch) to ship it, then find out why four scheduled "
        "attempts produced nothing: see docs/RUNBOOK-ota.md."]}


def main() -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Has the OTA pipeline stopped?")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--grace-hours", type=int, default=GRACE_HOURS)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    head = _git(args.repo, "rev-parse", "--verify", f"{args.head}^{{commit}}")
    tag = _git(args.repo, "rev-parse", "--verify", f"refs/tags/{TAG}^{{commit}}")
    since = (oldest_unpublished_app_commit(args.repo, tag, head)
             if (tag and head) else None)
    out = verdict(tag, head, since, datetime.now(timezone.utc), args.grace_hours)

    if args.json:
        print(json.dumps(out, indent=2))
    else:
        for line in out["reasons"]:
            print(f"* {line}")
    return 1 if out["action"] == "alarm" else 0


if __name__ == "__main__":  # pragma: no cover - thin CLI over verdict()
    raise SystemExit(main())
