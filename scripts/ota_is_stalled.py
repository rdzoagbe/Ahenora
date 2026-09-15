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
waiting, and only once a publish window has actually come and gone — the
first one that OPENS after the commit is the one that owed it an update, and
until that window has closed and settled there is nothing to report. Work
merged a minute after a window closes is not eligible for it, so the next
night being nearly a day away is the schedule working, not a fault. An alarm
people learn to ignore is worse than no alarm, which is written down here
because this repository has already made that mistake once.

Measuring WINDOWS rather than hours is the second version. The first used a
flat thirty-hour grace, tuned for that worst case and therefore slack for
everything else. On 2026-09-15 the scheduler dropped all four attempts; the
oldest waiting change had been merged at 10:41 the previous morning, so the
miss was certain when the window closed at 05:00 — and thirty hours would
have said nothing until 16:41 that evening. Half a day of an app that
everybody believed had shipped.

Usage:  python3 scripts/ota_is_stalled.py [--repo DIR] [--grace-hours N]
        --json    print the verdict as JSON
Exit:   0 when there is nothing to say, 1 when a person is needed.
"""
from __future__ import annotations

import json
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Optional

# The nightly publish window, in UTC: four cron attempts at 02:00, 03:00, 04:00
# and 05:00. Checked against the workflow's own cron lines by a test, because
# a check calibrated to a schedule that has since moved is worse than no check.
WINDOW_OPENS_HOUR = 2
WINDOW_CLOSES_HOUR = 5

# How long after the last attempt before its silence means something. The run
# itself takes about six minutes; an hour is room for a queued or slow one.
SETTLE_HOURS = 1

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


def deadline_for(waiting_since: datetime) -> datetime:
    """When a change committed at `waiting_since` must have been published by.

    Not a fixed number of hours, and the difference is what tonight showed.
    Work merged at 10:41 had its chance at 02:00 the next morning and the
    window closed at 05:00; a flat thirty-hour grace would not have said
    anything until 16:41 that evening, half a day after the miss was certain.

    So this asks the question the schedule actually answers: has a publish
    window come and gone? The first window that OPENS at or after the commit
    is the one that owed it an update. Once that window has closed and
    settled, silence is a stall.

    It still cannot cry wolf, which is the property worth keeping. Something
    merged a minute after a window closes is not eligible for it — the next
    window is nearly a day away, and nothing is said in between.
    """
    opens = waiting_since.astimezone(timezone.utc).replace(
        hour=WINDOW_OPENS_HOUR, minute=0, second=0, microsecond=0)
    if opens < waiting_since:
        opens += timedelta(days=1)
    closes = opens.replace(hour=WINDOW_CLOSES_HOUR)
    return closes + timedelta(hours=SETTLE_HOURS)


def verdict(tag_sha: Optional[str], head_sha: Optional[str],
            waiting_since: Optional[datetime], now: datetime,
            grace_hours: Optional[int] = None) -> dict:
    """grace_hours overrides the window arithmetic with a flat number of
    hours. Only tests use it; the schedule is the honest answer."""
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

    hours = (now - waiting_since).total_seconds() / 3600
    if grace_hours is not None:
        due = waiting_since + timedelta(hours=grace_hours)
    else:
        due = deadline_for(waiting_since)

    if now <= due:
        return {"action": "none", "reasons": [
            f"The earliest unpublished app change has waited {hours:.0f}h. Its "
            f"publish window has not closed yet — due by "
            f"{due:%Y-%m-%d %H:%M} UTC."]}

    return {"action": "alarm", "reasons": [
        f"The earliest unpublished app change has been waiting {hours:.0f} hours. "
        f"Its nightly publish window (0{WINDOW_OPENS_HOUR}:00-0{WINDOW_CLOSES_HOUR}:00 "
        f"UTC) closed at {due - timedelta(hours=SETTLE_HOURS):%Y-%m-%d %H:%M} UTC "
        f"and published nothing. The last thing that actually reached a phone is "
        f"`{tag_sha[:12]}`; main is `{head_sha[:12]}`.",
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
    ap.add_argument("--grace-hours", type=int, default=None,
                    help="override the window arithmetic with a flat number "
                         "of hours (diagnostics; the schedule is the honest "
                         "answer)")
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
