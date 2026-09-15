"""The failure every other OTA check is blind to: nothing published at all.

The OTA guard reads the newest production update and asks whether it is
crashing. The publish workflow says out loud when a night had nothing to ship.
Both watch an update that EXISTS. Neither can see a schedule that did not fire
— which has already happened here: it ran once in its first two days and eight
merged pull requests reached nobody, with every workflow green.

scripts/ota_is_stalled.py is the check for that, and these hold the two things
it has to get right. It must speak when real app work has been waiting too
long, and it must stay silent on a quiet day, because an alarm people learn to
ignore is worse than no alarm and this repository has made that mistake before.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import re
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import ota_is_stalled as stall  # noqa: E402

NOW = datetime(2026, 9, 15, 12, 0, tzinfo=timezone.utc)
TAG_SHA = "a" * 40
HEAD_SHA = "b" * 40


def ago(hours):
    return NOW - timedelta(hours=hours)


def at(stamp):
    return datetime.fromisoformat(stamp)


class ItSpeaksWhenTheAppStoppedShipping(unittest.TestCase):

    def test_work_waiting_past_the_grace_is_an_alarm(self):
        """The whole point. Nothing is broken on anyone's phone — they are
        running an older app than everyone believes shipped."""
        out = stall.verdict(TAG_SHA, HEAD_SHA, ago(40), NOW)
        self.assertEqual(out["action"], "alarm")

    def test_the_alarm_says_how_to_ship_it_now(self):
        # An alarm that leaves somebody to work out the remedy at the moment
        # they are already behind is half an alarm.
        said = " ".join(stall.verdict(TAG_SHA, HEAD_SHA, ago(40), NOW)["reasons"])
        self.assertIn("workflow_dispatch", said)
        self.assertIn("RUNBOOK-ota.md", said)

    def test_the_alarm_names_both_commits(self):
        said = " ".join(stall.verdict(TAG_SHA, HEAD_SHA, ago(40), NOW)["reasons"])
        self.assertIn(TAG_SHA[:12], said)
        self.assertIn(HEAD_SHA[:12], said)

    def test_it_says_why_everything_else_looks_green(self):
        # The confusing part for whoever reads it: every other check passed.
        said = " ".join(stall.verdict(TAG_SHA, HEAD_SHA, ago(40), NOW)["reasons"])
        self.assertIn("green", said)


class ItStaysQuietWhenNothingIsWrong(unittest.TestCase):

    def test_a_published_tip_says_nothing(self):
        out = stall.verdict(TAG_SHA, TAG_SHA, None, NOW)
        self.assertEqual(out["action"], "none")

    def test_a_backend_only_day_is_not_a_stall(self):
        """main moved, the bundle did not. An older update is the CORRECT one
        to be running, and alarming would be an alarm about working as
        designed."""
        out = stall.verdict(TAG_SHA, HEAD_SHA, None, NOW)
        self.assertEqual(out["action"], "none")

    def test_work_merged_after_tonights_window_waits_for_tomorrows(self):
        """The cry-wolf case, and the reason the deadline is not simply "a few
        hours". Merged at 05:01, one minute after the last attempt: the next
        window is nearly a day away and nothing is wrong in between."""
        merged = at("2026-09-14T05:01:00+00:00")
        self.assertEqual(
            stall.verdict(TAG_SHA, HEAD_SHA, merged,
                          at("2026-09-15T01:00:00+00:00"))["action"], "none")

    def test_but_it_does_alarm_once_that_window_has_also_gone(self):
        merged = at("2026-09-14T05:01:00+00:00")
        self.assertEqual(
            stall.verdict(TAG_SHA, HEAD_SHA, merged,
                          at("2026-09-15T06:30:00+00:00"))["action"], "alarm")

    def test_the_window_is_still_settling_at_half_past_five(self):
        """The last attempt starts at 05:00 and the run takes about six
        minutes. Alarming the instant the window closes would fire on every
        night that merely ran slowly."""
        merged = at("2026-09-14T10:41:00+00:00")
        self.assertEqual(
            stall.verdict(TAG_SHA, HEAD_SHA, merged,
                          at("2026-09-15T05:30:00+00:00"))["action"], "none")


class ItMeasuresWindowsRatherThanHours(unittest.TestCase):
    """The flat thirty-hour grace this replaced was tuned for the worst case —
    something merged a minute after a window closes — and so it was slack for
    everything else.

    On the night of 2026-09-15 the scheduler dropped all four attempts. The
    oldest waiting change was #601, merged at 10:41 the previous morning; its
    window opened at 02:00 and closed at 05:00 having published nothing. The
    miss was certain at 05:00. A flat thirty hours would have said nothing
    until 16:41 that evening.
    """

    MERGED = at("2026-09-14T10:41:00+00:00")

    def test_the_real_missed_night_is_caught_the_same_morning(self):
        out = stall.verdict(TAG_SHA, HEAD_SHA, self.MERGED,
                            at("2026-09-15T06:03:00+00:00"))
        self.assertEqual(out["action"], "alarm")

    def test_the_flat_grace_it_replaced_would_not_have(self):
        """Pinned as the difference, not as a description of it."""
        out = stall.verdict(TAG_SHA, HEAD_SHA, self.MERGED,
                            at("2026-09-15T06:03:00+00:00"), grace_hours=30)
        self.assertEqual(out["action"], "none")

    def test_the_alarm_names_the_window_that_published_nothing(self):
        said = " ".join(stall.verdict(TAG_SHA, HEAD_SHA, self.MERGED,
                                      at("2026-09-15T06:03:00+00:00"))["reasons"])
        self.assertIn("02:00-05:00", said)
        self.assertIn("2026-09-15 05:00", said)

    def test_a_change_merged_just_before_the_window_gets_it(self):
        # 01:00, an hour before the window opens: that night owes it an update
        # and a miss shows up five and a half hours later, not a day.
        merged = at("2026-09-15T01:00:00+00:00")
        self.assertEqual(
            stall.verdict(TAG_SHA, HEAD_SHA, merged,
                          at("2026-09-15T06:30:00+00:00"))["action"], "alarm")

    def test_the_deadline_is_the_close_plus_the_settle(self):
        due = stall.deadline_for(at("2026-09-14T10:41:00+00:00"))
        self.assertEqual(due, at("2026-09-15T06:00:00+00:00"))

    def test_a_commit_before_the_window_opens_uses_that_same_night(self):
        self.assertEqual(stall.deadline_for(at("2026-09-15T00:30:00+00:00")),
                         at("2026-09-15T06:00:00+00:00"))

    def test_a_commit_after_it_opens_waits_for_the_next(self):
        self.assertEqual(stall.deadline_for(at("2026-09-15T02:30:00+00:00")),
                         at("2026-09-16T06:00:00+00:00"))

    def test_a_commit_in_a_non_utc_zone_is_read_in_utc(self):
        """Commit stamps carry the committer's offset — %cI on this repository
        is routinely +02:00. Comparing a local wall clock against a UTC cron
        would shift every deadline by the offset."""
        paris = at("2026-09-15T03:30:00+02:00")   # 01:30 UTC, before the window
        self.assertEqual(stall.deadline_for(paris),
                         at("2026-09-15T06:00:00+00:00"))

    def test_the_hours_match_the_workflow_that_publishes(self):
        """A check calibrated to a schedule that has since moved is worse than
        no check: it would report a window that no longer exists."""
        with open(os.path.join(ROOT, ".github", "workflows",
                               "frontend-ci-eas-update.yml"), encoding="utf-8") as handle:
            workflow = handle.read()
        hours = sorted(int(h) for h in re.findall(r"cron: '0 (\d+) \* \* \*'", workflow))
        self.assertEqual(hours[0], stall.WINDOW_OPENS_HOUR)
        self.assertEqual(hours[-1], stall.WINDOW_CLOSES_HOUR)


class ItDoesNotFailTowardSilence(unittest.TestCase):
    """Every bug this codebase keeps finding has the same shape: nothing
    breaks, nothing alerts, the thing just never happens. A stall check that
    goes quiet when it cannot do its job would be another one."""

    def test_a_missing_tag_is_said_out_loud(self):
        out = stall.verdict(None, HEAD_SHA, None, NOW)
        self.assertEqual(out["action"], "alarm")

    def test_it_names_the_checkout_as_a_possible_cause(self):
        # Most likely cause by far, and the fix is a workflow line.
        said = " ".join(stall.verdict(None, HEAD_SHA, None, NOW)["reasons"])
        self.assertIn("fetch-tags", said)

    def test_an_unreadable_head_is_said_out_loud_too(self):
        out = stall.verdict(TAG_SHA, None, None, NOW)
        self.assertEqual(out["action"], "alarm")


class ItWatchesTheSamePathsThePublisherDoes(unittest.TestCase):
    """If the two sets drift apart this alarms about work the publisher was
    right to skip, or stays quiet about work it would have shipped. Either way
    the check becomes a liar, and nothing else would notice."""

    def test_the_paths_match_ota_should_publish(self):
        with open(os.path.join(ROOT, "scripts", "ota_should_publish.sh"),
                  encoding="utf-8") as handle:
            script = handle.read()
        declared = script.split("OTA_PATHS=(", 1)[1].split(")", 1)[0].split()
        self.assertEqual(sorted(declared), sorted(stall.OTA_PATHS))

    def test_it_reads_the_tag_the_publisher_moves(self):
        with open(os.path.join(ROOT, "scripts", "ota_should_publish.sh"),
                  encoding="utf-8") as handle:
            self.assertIn(f'OTA_TAG:-{stall.TAG}', handle.read())


class AgainstARealRepository(unittest.TestCase):
    """The decision is testable without git; reading the history is not. A
    backend-only commit starting a clock would be a false alarm every time
    somebody worked on the server, so it is checked against real commits."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.git("git", "init", "-q", "-b", "main")
        self.git("git", "config", "user.email", "t@t.test")
        self.git("git", "config", "user.name", "Test")

    # NOT named `run`: TestCase.run is what executes the test, and shadowing it
    # made every case in this class fail before setUp had finished.
    def git(self, *args):
        subprocess.run(args, cwd=self.dir, check=True,
                       capture_output=True, text=True)

    def commit(self, path, message, when=None):
        """Commit, optionally AT A GIVEN TIME.

        The time is not decoration. Without it every commit in this class
        lands in the same second, oldest and newest carry the same stamp, and
        the one assertion that separates them passes whichever end the code
        reads — which is precisely how the newest/oldest bug survived its own
        regression test until a mutation run said so.
        """
        full = os.path.join(self.dir, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "a", encoding="utf-8") as handle:
            handle.write("x\n")
        self.git("git", "add", "-A")
        env = dict(os.environ)
        if when:
            env["GIT_COMMITTER_DATE"] = when
            env["GIT_AUTHOR_DATE"] = when
        subprocess.run(("git", "commit", "-q", "-m", message), cwd=self.dir,
                       check=True, capture_output=True, text=True, env=env)
        return subprocess.run(("git", "rev-parse", "HEAD"), cwd=self.dir,
                              capture_output=True, text=True).stdout.strip()

    def head(self):
        return subprocess.run(("git", "rev-parse", "HEAD"), cwd=self.dir,
                              capture_output=True, text=True).stdout.strip()

    def test_a_backend_commit_starts_no_clock(self):
        base = self.commit("frontend/app.tsx", "shipped")
        self.commit("backend/server.py", "server only")
        self.assertIsNone(stall.oldest_unpublished_app_commit(self.dir, base, self.head()))

    def test_a_frontend_commit_does(self):
        base = self.commit("backend/server.py", "shipped")
        self.commit("frontend/app.tsx", "app change")
        self.assertIsNotNone(stall.oldest_unpublished_app_commit(self.dir, base, self.head()))

    def test_legal_counts_as_app_too(self):
        # legal/ ships inside the bundle, so a terms change reaching nobody is
        # the same failure as a code change reaching nobody.
        base = self.commit("backend/server.py", "shipped")
        self.commit("legal/terms.md", "terms")
        self.assertIsNotNone(stall.oldest_unpublished_app_commit(self.dir, base, self.head()))

    def test_it_takes_the_OLDEST_of_SEVERAL_and_this_is_the_whole_check(self):
        """A pipeline that stopped on Monday still has something merged this
        evening in front of it. Measured from the NEWEST unpublished commit the
        clock never runs out, and the check goes quiet for as long as people
        keep working. The first version did exactly that, and it survived every
        unit test above because those hand the decision a date.
        """
        base = self.commit("backend/server.py", "shipped",
                           "2026-09-10T09:00:00+00:00")
        self.commit("frontend/one.tsx", "first — waiting longest",
                    "2026-09-11T09:00:00+00:00")
        self.commit("backend/later.py", "backend after",
                    "2026-09-12T09:00:00+00:00")
        self.commit("frontend/two.tsx", "second",
                    "2026-09-13T09:00:00+00:00")
        when = stall.oldest_unpublished_app_commit(self.dir, base, self.head())
        self.assertIsNotNone(when)
        self.assertEqual(when, datetime(2026, 9, 11, 9, 0, tzinfo=timezone.utc))

    def test_and_the_verdict_built_from_it_alarms_where_the_newest_would_not(self):
        """The end-to-end shape of the bug: three days of stall with a fresh
        commit on top. Read from the newest, this is quiet."""
        base = self.commit("backend/server.py", "shipped",
                           "2026-09-10T09:00:00+00:00")
        self.commit("frontend/one.tsx", "waiting since the 11th",
                    "2026-09-11T09:00:00+00:00")
        self.commit("frontend/two.tsx", "merged an hour ago",
                    "2026-09-14T23:00:00+00:00")
        when = stall.oldest_unpublished_app_commit(self.dir, base, self.head())
        out = stall.verdict(base, self.head(), when,
                            datetime(2026, 9, 15, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(out["action"], "alarm")

    def test_a_backend_commit_in_the_middle_does_not_hide_the_waiting_one(self):
        base = self.commit("frontend/app.tsx", "shipped")
        self.commit("frontend/waiting.tsx", "app change, waiting")
        self.commit("backend/server.py", "backend since")
        self.assertIsNotNone(
            stall.oldest_unpublished_app_commit(self.dir, base, self.head()))

    def test_a_repository_git_cannot_read_returns_nothing_rather_than_guessing(self):
        self.assertIsNone(stall.oldest_unpublished_app_commit(self.dir, "nope", "alsonope"))


if __name__ == "__main__":
    unittest.main()
