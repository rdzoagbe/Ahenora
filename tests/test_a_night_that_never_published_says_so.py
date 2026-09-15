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

    def test_work_merged_this_evening_is_not_late(self):
        out = stall.verdict(TAG_SHA, HEAD_SHA, ago(7), NOW)
        self.assertEqual(out["action"], "none")

    def test_the_longest_honest_wait_is_inside_the_grace(self):
        """Merged a minute after the window closed at 05:00: it waits until
        02:00 the next night, and the last attempt is three hours after that.
        Twenty-nine hours is the schedule working."""
        self.assertEqual(stall.verdict(TAG_SHA, HEAD_SHA, ago(29), NOW)["action"],
                         "none")

    def test_the_boundary_itself_does_not_alarm(self):
        self.assertEqual(
            stall.verdict(TAG_SHA, HEAD_SHA, ago(stall.GRACE_HOURS), NOW)["action"],
            "none")

    def test_one_minute_past_it_does(self):
        self.assertEqual(
            stall.verdict(TAG_SHA, HEAD_SHA,
                          ago(stall.GRACE_HOURS) - timedelta(minutes=1),
                          NOW)["action"],
            "alarm")

    def test_the_grace_covers_a_late_night_but_not_a_missed_one(self):
        # A night entirely dropped means the next window is 45h after work
        # merged at 05:01. The grace has to sit between the two.
        self.assertGreater(stall.GRACE_HOURS, 29)
        self.assertLess(stall.GRACE_HOURS, 45)


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
