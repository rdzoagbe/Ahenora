"""What the OTA guard is allowed to conclude, and what it must refuse to.

This is the one piece of automation in the repository that can act on
production without a person, so the interesting tests are the ones about when
it declines.

The signal it acts on is deliberately the shape of the 2026-09-03 outage —
almost every launch failing — and not a raised crash rate. At a 20% rollout
across a few dozen households the sample is single digits, where one broken
phone is a large fraction of the data. A threshold tuned for that would be
noise with a number attached.

Run with:  python3 -m unittest discover -s tests -v
"""
import json
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import ota_guard  # noqa: E402

NOW = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)


def when(hours_ago: float) -> str:
    return (NOW - timedelta(hours=hours_ago)).isoformat().replace("+00:00", "Z")


def updates(group="g1", rollout=20, hours_ago=1.0):
    row = {"group": group, "branch": "production", "createdAt": when(hours_ago)}
    if rollout is not None:
        row["rolloutPercentage"] = rollout
    return json.dumps([row])


def insights(launches, crashes):
    return json.dumps({"metrics": {"launches": launches, "crashes": crashes}})


def eas_insights(platform, installs, crash_rate_percent, failed=0):
    """The shape eas-cli actually returns (2026-09-07)."""
    return json.dumps({
        "groupId": "g1", "timespan": {"daysBack": 1},
        "platforms": [{"platform": platform, "updateId": "u1",
                       "totals": {"uniqueUsers": installs, "installs": installs,
                                  "failedInstalls": failed,
                                  "crashRatePercent": crash_rate_percent},
                       "payload": {"launchAssetCount": 0},
                       "daily": [{"date": "2026-09-07T00:00:00.000Z",
                                  "installs": installs, "failedInstalls": failed}]}]})


class ItReadsWhatEasActuallyReturns(unittest.TestCase):
    def test_zero_installs_is_too_few_not_blind(self):
        v = ota_guard.decide(updates(rollout=None), {"android": eas_insights("android", 0, 0)}, NOW)
        self.assertEqual(v["action"], "none")
        self.assertIn("too few", " ".join(v["reasons"]))

    def test_a_crash_rate_over_the_line_is_a_rollback(self):
        v = ota_guard.decide(updates(rollout=None),
                             {"android": eas_insights("android", 40, 80)}, NOW)
        self.assertEqual(v["action"], "rollback")
        self.assertIn("32 crashes in 40", " ".join(v["reasons"]))

    def test_a_healthy_rate_is_nothing_to_do(self):
        v = ota_guard.decide(updates(rollout=None),
                             {"ios": eas_insights("ios", 60, 1.5)}, NOW)
        self.assertEqual(v["action"], "none")
        self.assertIn("(2%)", " ".join(v["reasons"]))


class ItActsOnAnOutage(unittest.TestCase):
    def test_almost_every_launch_failing_is_a_rollback(self):
        """The 2026-09-03 signature: the app does not start."""
        v = ota_guard.decide(updates(), {"android": insights(20, 19)}, NOW)
        self.assertEqual(v["action"], "rollback")
        self.assertEqual(v["group"], "g1")

    def test_one_platform_is_enough(self):
        """A native module missing from one binary breaks that store alone."""
        v = ota_guard.decide(
            updates(), {"android": insights(20, 19), "ios": insights(20, 0)}, NOW)
        self.assertEqual(v["action"], "rollback")

    def test_a_raised_error_rate_is_not_an_outage(self):
        """Ten percent is a bug to fix on Monday, not a reason to withdraw a
        release from everybody's phone tonight."""
        v = ota_guard.decide(updates(), {"android": insights(100, 10)}, NOW)
        self.assertNotEqual(v["action"], "rollback")

    def test_a_tiny_sample_never_triggers_anything(self):
        """Two launches, both crashed. That is one person with a bad phone as
        easily as it is an outage, and acting on it teaches nobody anything."""
        v = ota_guard.decide(updates(), {"android": insights(2, 2)}, NOW)
        self.assertNotEqual(v["action"], "rollback")
        self.assertIn("too few", " ".join(v["reasons"]))

    def test_a_healthy_recent_rollout_is_left_alone(self):
        v = ota_guard.decide(updates(hours_ago=2), {"android": insights(50, 0)}, NOW)
        self.assertEqual(v["action"], "none")


class ItRefusesToActOnWhatItCannotRead(unittest.TestCase):
    """eas-cli's JSON is not a contract. A future version can rename a field,
    and a guard that quietly does nothing when it stops understanding the world
    is worse than no guard — it is still trusted."""

    def test_an_unreadable_update_list_alarms_and_stops(self):
        for bad in ("", "not json", "{}", "[]", '{"unexpected": true}'):
            v = ota_guard.decide(bad, {"android": insights(20, 19)}, NOW)
            self.assertEqual(v["action"], "alarm", bad)
            self.assertIsNone(v["group"])

    def test_unreadable_insights_never_become_a_rollback(self):
        v = ota_guard.decide(updates(), {"android": "not json"}, NOW)
        self.assertEqual(v["action"], "blind")
        self.assertIn("could not read", " ".join(v["reasons"]).lower())

    def test_insights_missing_the_counts_say_so_and_show_the_payload(self):
        # Blind, not alarm: the first scheduled run alarmed on this and would
        # have every six hours until someone changed the parser — which they
        # can only do from the payload, so the verdict carries it.
        v = ota_guard.decide(updates(), {"android": json.dumps({"size": 12})}, NOW)
        self.assertEqual(v["action"], "blind")
        self.assertIn('{"size": 12}', " ".join(v["reasons"]))

    def test_an_empty_insights_file_is_named_as_such(self):
        v = ota_guard.decide(updates(), {"ios": ""}, NOW)
        self.assertEqual(v["action"], "blind")
        self.assertIn("produced nothing", " ".join(v["reasons"]))

    def test_blind_does_not_hide_a_stale_rollout(self):
        v = ota_guard.decide(updates(rollout=20, hours_ago=30), {"android": ""}, NOW)
        self.assertEqual(v["action"], "alarm")

    def test_no_insights_at_all_is_not_a_verdict_on_health(self):
        v = ota_guard.decide(updates(hours_ago=1), {}, NOW)
        self.assertNotEqual(v["action"], "rollback")


class ItNoticesAFixThatStoppedMoving(unittest.TestCase):
    def test_a_rollout_left_partial_raises_the_alarm(self):
        v = ota_guard.decide(updates(rollout=20, hours_ago=48),
                             {"android": insights(50, 0)}, NOW)
        self.assertEqual(v["action"], "alarm")
        self.assertIn("20%", " ".join(v["reasons"]))

    def test_a_soaking_rollout_is_not_stale_yet(self):
        v = ota_guard.decide(updates(rollout=20, hours_ago=3),
                             {"android": insights(50, 0)}, NOW)
        self.assertEqual(v["action"], "none")

    def test_a_promoted_update_is_never_called_stale(self):
        v = ota_guard.decide(updates(rollout=100, hours_ago=200),
                             {"android": insights(500, 0)}, NOW)
        self.assertEqual(v["action"], "none")

    def test_an_outage_outranks_staleness(self):
        """Both true at once: say the one that needs doing now."""
        v = ota_guard.decide(updates(rollout=20, hours_ago=48),
                             {"android": insights(20, 20)}, NOW)
        self.assertEqual(v["action"], "rollback")

    def test_an_unreadable_publish_time_alarms_rather_than_guesses(self):
        row = json.dumps([{"group": "g1", "rolloutPercentage": 20}])
        v = ota_guard.decide(row, {"android": insights(50, 0)}, NOW)
        self.assertEqual(v["action"], "alarm")


class ItReadsWhateverShapeItIsGiven(unittest.TestCase):
    def test_a_wrapped_list(self):
        blob = json.dumps({"currentPage": {"updates": [
            {"group": "g9", "rolloutPercentage": 30, "createdAt": when(1)}]}})
        self.assertEqual(ota_guard.newest_update(blob)["group"], "g9")

    def test_the_newest_wins_when_several_are_listed(self):
        blob = json.dumps([
            {"group": "old", "createdAt": when(50)},
            {"group": "new", "createdAt": when(1)},
        ])
        self.assertEqual(ota_guard.newest_update(blob)["group"], "new")

    def test_counts_nested_under_a_platform(self):
        blob = json.dumps({"android": {"totals": {"launchCount": 30,
                                                  "crashCount": 29}}})
        launches, crashes = ota_guard.crash_signal(blob)
        self.assertEqual((launches, crashes), (30.0, 29.0))

    def test_rollout_absent_means_absent_not_zero(self):
        """A missing percentage must never read as 0% and look stale."""
        self.assertIsNone(ota_guard.rollout_of({"group": "g"}))


if __name__ == "__main__":
    unittest.main()
