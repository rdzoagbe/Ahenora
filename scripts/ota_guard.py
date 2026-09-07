"""Decide what to do about the update people are currently running.

Two jobs, and the split between them is the whole design.

STALE ROLLOUT — an alarm. Production publishes to a percentage and nothing
promotes itself, which buys containment at the cost of a new silent failure:
a fix sitting at 20% while its author believes it shipped. Nobody notices a
thing that did not happen, so something has to go looking.

CATASTROPHIC UPDATE — an action. On 2026-09-03 an update reached every Android
install and the app did not start. That signature is unmistakable even at this
size: not a raised crash rate, but almost every launch failing. Rolling back
unnecessarily costs a few hours of a fix not being out; failing to roll back
costs an outage. The asymmetry is why this one is allowed to act.

WHAT IT WILL NOT DO. A marginal crash rate is not a trigger. At a 20% rollout
over a few dozen households the sample is single digits, where one person with
a failing phone is a large fraction of the data — a threshold tuned for that is
noise with a number attached. It acts only on the shape of a total failure, and
only with enough launches to mean anything.

AND IT NEVER ACTS ON DATA IT DID NOT UNDERSTAND. The JSON shapes here come from
eas-cli and are not pinned by any contract; a future version can rename a field.
An unreadable update LIST raises the alarm and stops. Unreadable INSIGHTS make
the verdict "blind": the guard says, in the job summary and with the raw
payload it was given, that it cannot see crash data — and does not fail the
run. Its first scheduled run (2026-09-07) alarmed on exactly this, and an
alarm the guard raises about its own instrumentation every six hours is
noise that trains people to ignore the one that matters. Blind is still
loud on the page, never quiet: the summary title says it.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

# A rollout still partial after this long is a fix that has stopped moving.
STALE_HOURS = 24
# Below this many launches there is no signal, only coincidence.
MIN_LAUNCHES = 5
# The share of launches that must be crashing. Half is not "worse than usual";
# it is the app failing to start.
CRASH_RATIO = 0.5


def _num(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _find_number(blob: Any, names: tuple[str, ...]) -> Optional[float]:
    """First numeric value under any of `names`, anywhere in the structure.

    Deliberately shape-tolerant: the payload may nest these under a platform,
    a metrics object or a list, and this has to keep working when it does.
    """
    if isinstance(blob, dict):
        for key, val in blob.items():
            if key.lower() in names:
                found = _num(val)
                if found is not None:
                    return found
        for val in blob.values():
            found = _find_number(val, names)
            if found is not None:
                return found
    elif isinstance(blob, list):
        for item in blob:
            found = _find_number(item, names)
            if found is not None:
                return found
    return None


def _updates(blob: Any) -> list[dict]:
    """Every object that looks like an update group, however it is wrapped."""
    out: list[dict] = []
    if isinstance(blob, dict):
        if blob.get("group") or blob.get("id"):
            out.append(blob)
        for val in blob.values():
            out.extend(_updates(val))
    elif isinstance(blob, list):
        for item in blob:
            out.extend(_updates(item))
    # De-duplicate on identity: nested structures can yield the same dict twice.
    seen: set[int] = set()
    unique = []
    for row in out:
        if id(row) not in seen:
            seen.add(id(row))
            unique.append(row)
    return unique


def _when(row: dict) -> Optional[datetime]:
    for key in ("createdAt", "created_at", "publishedAt", "updatedAt"):
        raw = row.get(key)
        if not isinstance(raw, str):
            continue
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            continue
    return None


def newest_update(list_json: str) -> Optional[dict]:
    """The update at the top of the branch — the only one rollback can touch."""
    try:
        blob = json.loads(list_json)
    except (ValueError, TypeError):
        return None
    rows = [r for r in _updates(blob) if r.get("group")]
    if not rows:
        return None
    dated = [(r, _when(r)) for r in rows]
    if all(when is None for _, when in dated):
        return rows[0]        # already newest-first in eas output
    return max(dated, key=lambda pair: pair[1] or datetime.min.replace(
        tzinfo=timezone.utc))[0]


def rollout_of(row: dict) -> Optional[float]:
    return _find_number(row, ("rolloutpercentage", "rollout_percentage", "rollout"))


def crash_signal(insights_json: str) -> tuple[Optional[float], Optional[float]]:
    """(launches, crashes). Either None when the payload does not say.

    The real shape, seen on 2026-09-07 from `eas update:insights --json`:

        {"groupId": ..., "timespan": {...},
         "platforms": [{"platform": "android", "updateId": ...,
                        "totals": {"uniqueUsers": 0, "installs": 0,
                                   "failedInstalls": 0, "crashRatePercent": 0},
                        "payload": {...}, "daily": [...]}]}

    Expo counts installs of the update and a crash rate, not launches and
    crashes. An install is a device that took the update and ran it, which
    is the launch this guard cares about; the crash count is derived from
    the rate. The older, guessed names are still accepted so a future rename
    towards them keeps working.
    """
    try:
        blob = json.loads(insights_json)
    except (ValueError, TypeError):
        return None, None
    totals = _find_dict(blob, "totals") or blob
    launches = _find_number(totals, ("installs", "uniqueusers", "launches",
                                     "launchcount", "totallaunches"))
    crashes = _find_number(totals, ("crashes", "crashcount", "totalcrashes"))
    if crashes is None and launches is not None:
        rate = _find_number(totals, ("crashratepercent", "crashrate"))
        if rate is not None:
            crashes = launches * rate / 100.0
    return launches, crashes


def _find_dict(blob: Any, name: str) -> Optional[dict]:
    """The first dict stored under `name`, anywhere in the structure."""
    if isinstance(blob, dict):
        for key, val in blob.items():
            if key.lower() == name and isinstance(val, dict):
                return val
        for val in blob.values():
            found = _find_dict(val, name)
            if found is not None:
                return found
    elif isinstance(blob, list):
        for item in blob:
            found = _find_dict(item, name)
            if found is not None:
                return found
    return None


def decide(list_json: str, insights: dict[str, str], now: datetime,
           stale_hours: int = STALE_HOURS,
           min_launches: int = MIN_LAUNCHES,
           crash_ratio: float = CRASH_RATIO) -> dict:
    """What to do, and why, in words a person can act on."""
    update = newest_update(list_json)
    if not update:
        return {"action": "alarm", "group": None,
                "reasons": ["Could not read the production update list. "
                            "Nothing was changed. Check `eas update:list "
                            "--branch production --json` by hand."]}

    group = update.get("group")
    reasons: list[str] = []
    action = "none"
    blind = False

    # Catastrophe first: it outranks everything else about this update.
    for platform, payload in sorted(insights.items()):
        launches, crashes = crash_signal(payload)
        if launches is None or crashes is None:
            # Whole payload, whitespace collapsed: it is counts and ids, and it
            # is the only way the next parser gets written from evidence.
            head = " ".join((payload or "").split())[:2000]
            reasons.append(
                f"{platform}: could not read launch/crash counts, so no "
                f"conclusion was drawn from them. The payload began: "
                f"`{head or '(empty — the eas command produced nothing)'}`")
            blind = True
            continue
        if launches < min_launches:
            reasons.append(
                f"{platform}: only {launches:.0f} launches — too few to mean "
                f"anything either way.")
            continue
        ratio = crashes / launches
        if ratio >= crash_ratio:
            reasons.append(
                f"{platform}: {crashes:.0f} crashes in {launches:.0f} launches "
                f"({ratio:.0%}). That is the app failing to start, not a raised "
                f"error rate.")
            action = "rollback"
        else:
            reasons.append(
                f"{platform}: {crashes:.0f} crashes in {launches:.0f} launches "
                f"({ratio:.0%}).")

    if action == "rollback":
        return {"action": "rollback", "group": group, "reasons": reasons}

    # Not broken. Has it stopped moving?
    rollout = rollout_of(update)
    published = _when(update)
    if rollout is not None and rollout < 100:
        age = (now - published) if published else None
        if age is None:
            reasons.append(
                f"At {rollout:.0f}% and its publish time could not be read.")
            action = "alarm"
        elif age > timedelta(hours=stale_hours):
            hours = age.total_seconds() / 3600
            reasons.append(
                f"Still at {rollout:.0f}% after {hours:.0f} hours. Whoever "
                f"merged it is entitled to think it shipped; {100 - rollout:.0f}% "
                f"of households are still on the previous update.")
            action = "alarm"
        else:
            reasons.append(f"At {rollout:.0f}%, published recently. Soaking.")

    if action == "none" and blind:
        action = "blind"
    return {"action": action, "group": group, "reasons": reasons}


if __name__ == "__main__":  # pragma: no cover - thin CLI over decide()
    import argparse
    import sys

    ap = argparse.ArgumentParser(description="Decide about the newest OTA update")
    ap.add_argument("--list-json", required=True)
    ap.add_argument("--android-insights", default="")
    ap.add_argument("--ios-insights", default="")
    # So the workflow can ask for the group id without embedding a python
    # one-liner in YAML, where the quoting is its own source of bugs.
    ap.add_argument("--group-only", action="store_true",
                    help="print just the newest update group id, or nothing")
    args = ap.parse_args()

    def read(path: str) -> str:
        if not path:
            return ""
        try:
            with open(path) as fh:
                return fh.read()
        except OSError:
            return ""

    if args.group_only:
        row = newest_update(read(args.list_json))
        print((row or {}).get("group") or "")
        sys.exit(0)

    payloads = {k: v for k, v in (("android", read(args.android_insights)),
                                  ("ios", read(args.ios_insights))) if v.strip()}
    verdict = decide(read(args.list_json), payloads, datetime.now(timezone.utc))
    print(json.dumps(verdict))
    sys.exit(0)
