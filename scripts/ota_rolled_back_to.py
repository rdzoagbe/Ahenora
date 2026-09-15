"""After a rollback, what is actually on people's phones?

`ota-published` is a git tag the publish workflow moves only after `eas update`
succeeds, so everything downstream reads it as "the last commit that genuinely
reached a phone". scripts/ota_should_publish.sh decides whether tonight has
anything to ship from it, and scripts/ota_is_stalled.py decides whether the
pipeline has died.

A ROLLBACK broke that promise and nobody noticed. `eas update:rollback`
republishes the previous update group, so the bundle on every phone changes —
and the tag stayed pointing at the bundle that had just been pulled. For an
hour on 2026-09-15 it named a commit that had crashed on a real phone and was
no longer serving anybody, and the stall check written that same morning would
have reported it as happily shipped.

A lying tag is worse than a missing one. Both of its readers are built to fail
toward publishing again — "the failure mode of this design has to be
'publishes again', never 'silently stops publishing'" — so an ABSENT tag is
safe, and a WRONG one is the only way to get silence.

So this resolves what the rollback restored, from the branch listing itself:

  * the publish workflow writes `--message "GitHub <sha>"`, so a group's own
    message names the commit it was built from;
  * a rollback restores the group published BEFORE the one named, so the answer
    is the newest group older than it that carries a commit;
  * and when that cannot be read with confidence, the answer is None — the
    caller then DELETES the tag rather than guessing, because the next publish
    treats a missing tag as a first publish and ships again.

Usage:  python3 scripts/ota_rolled_back_to.py --list-json list.json --group <id>
        prints the restored commit sha, or nothing at all.
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ota_guard import _updates, _when  # noqa: E402

# What the publish step writes: `--message "GitHub $GITHUB_SHA"`.
COMMIT_IN_MESSAGE = re.compile(r"\bGitHub\s+([0-9a-f]{7,40})\b", re.IGNORECASE)

OLDEST = datetime.min.replace(tzinfo=timezone.utc)


def commit_of(row: dict) -> Optional[str]:
    """The commit a published group was built from, or None.

    Only the message is trusted. A group published by hand, or by some future
    step that words its message differently, simply has no commit here rather
    than a guessed one.
    """
    for key in ("message", "updateMessage", "description"):
        found = COMMIT_IN_MESSAGE.search(str(row.get(key) or ""))
        if found:
            return found.group(1)
    return None


def restored_commit(list_json: str, rolled_back_group: str) -> Optional[str]:
    """The commit now serving, after rolling back `rolled_back_group`.

    None means "could not tell" — never a best guess. The caller deletes the
    tag on None, which costs one republished update and cannot mislead.
    """
    if not rolled_back_group:
        return None
    try:
        blob = json.loads(list_json)
    except (ValueError, TypeError):
        return None

    rows = [r for r in _updates(blob) if r.get("group")]
    if not rows:
        return None

    # Newest first. eas already lists them that way, but the dates are what the
    # order actually means and a listing that changes shape should not silently
    # invert this.
    rows.sort(key=lambda r: _when(r) or OLDEST, reverse=True)

    target = next((i for i, r in enumerate(rows)
                   if r.get("group") == rolled_back_group), None)
    if target is None:
        # The group named is not on this branch. Refusing here matters: the
        # next-oldest group of a listing that does not contain the rolled-back
        # update is not related to it at all.
        return None

    for row in rows[target + 1:]:
        commit = commit_of(row)
        if commit:
            return commit
    return None


def main(argv=None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--list-json", required=True)
    ap.add_argument("--group", required=True)
    args = ap.parse_args(argv)

    try:
        with open(args.list_json, encoding="utf-8") as handle:
            blob = handle.read()
    except OSError:
        return 1

    commit = restored_commit(blob, args.group)
    if not commit:
        return 1
    print(commit)
    return 0


if __name__ == "__main__":  # pragma: no cover - thin CLI over restored_commit
    raise SystemExit(main())
