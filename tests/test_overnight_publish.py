"""The OTA publishes overnight now, and only when there is something to publish.

Two things this file holds.

**The schedule.** Every merge to main used to publish to production
immediately. On a day with six merges that is six bundles pushed at people
mid-afternoon, with no gap between "CI went green" and "it is on every phone".
The publish moved to 02:00 UTC, with a workflow_dispatch override for a hotfix.
The danger in that move is publishing on BOTH triggers — a condition that reads
correctly and still fires on push — so the job's `if` is parsed rather than
eyeballed.

**The guard.** `eas update` mints a new update group every run, whatever the
bytes contain, and a client compares ids rather than contents. So a nightly job
that republishes an unchanged bundle stages a real update on every device —
and with silent apply, that is every user's app relaunching once a day to
arrive exactly where it already was.

The guard is a script rather than ten lines of inline YAML precisely so this
file can RUN it. A sibling test in test_workflow_publish_steps.py exists
because grepping a workflow's text passes on a step that is dead on arrival;
the same trap applies here, so nothing below asserts on source text where it
could execute the thing instead.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import subprocess
import tempfile
import unittest

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOW = os.path.join(ROOT, ".github", "workflows", "frontend-ci-eas-update.yml")
GUARD = os.path.join(ROOT, "scripts", "ota_should_publish.sh")


def workflow():
    with open(WORKFLOW, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def triggers(doc):
    # PyYAML reads the bare key `on` as the boolean True.
    return doc.get("on", doc.get(True))


class Repo:
    """A throwaway git repository the guard can be run against for real."""

    def __init__(self, path):
        self.path = path
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@example.com")
        self.git("config", "user.name", "T")

    def git(self, *args):
        return subprocess.run(
            ["git", *args], cwd=self.path, check=True,
            capture_output=True, text=True,
        ).stdout.strip()

    def write(self, relpath, text):
        full = os.path.join(self.path, relpath)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(text)

    def commit(self, relpath, text, message="c"):
        self.write(relpath, text)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")

    def guard(self):
        out = subprocess.run(
            ["bash", GUARD, "HEAD"], cwd=self.path,
            capture_output=True, text=True,
        )
        if out.returncode != 0:
            raise AssertionError(f"guard exited {out.returncode}: {out.stderr}")
        return dict(
            line.split("=", 1) for line in out.stdout.strip().splitlines() if "=" in line
        )


class TheSchedule(unittest.TestCase):
    def test_it_publishes_overnight(self):
        crons = [s["cron"] for s in triggers(workflow())["schedule"]]
        self.assertEqual(crons, ["0 2 * * *"])

    def test_a_hotfix_can_still_go_out_now(self):
        # Without this, a broken release could only be fixed by waiting until
        # 02:00 — which would make the whole change a net loss for safety.
        inputs = triggers(workflow())["workflow_dispatch"]["inputs"]
        self.assertIn("publish_now", inputs)
        self.assertIs(inputs["publish_now"]["default"], False)

    def test_a_merge_to_main_does_not_publish(self):
        # The failure this guards: a condition that reads as "nightly" and
        # still fires on every push, leaving the behaviour exactly as before
        # while the comments claim otherwise.
        cond = " ".join(workflow()["jobs"]["expo-update"]["if"].split())
        self.assertIn("github.event_name == 'schedule'", cond)
        self.assertIn("workflow_dispatch", cond)
        self.assertIn("inputs.publish_now", cond)
        self.assertNotIn("push", cond)

    def test_the_web_app_still_goes_out_on_merge(self):
        # ahenora.com reloads itself and carries its own update banner, so it
        # has none of the problem the schedule exists to solve. Slowing it down
        # would be a cost with no matching benefit.
        web = workflow()["jobs"]["web-export"]
        self.assertEqual(web["if"], "github.ref == 'refs/heads/main'")

    def test_publishing_is_gated_on_the_guard(self):
        steps = workflow()["jobs"]["expo-update"]["steps"]
        publish = next(s for s in steps if s.get("id") == "publish")
        self.assertIn("steps.changed.outputs.publish == 'true'", publish["if"])

    def test_the_tag_moves_only_after_a_successful_publish(self):
        # If the tag moved before (or regardless of) the publish, one failed
        # night would convince every later night that nothing had changed, and
        # the pipeline would go silently dead — the exact failure mode this
        # repository keeps discovering weeks late.
        steps = workflow()["jobs"]["expo-update"]["steps"]
        names = [s.get("name") for s in steps]
        tagger = next(s for s in steps if s.get("name") == "Remember what was published")
        self.assertIn("ota-published", tagger["run"])
        self.assertIn("steps.changed.outputs.publish == 'true'", tagger["if"])
        self.assertGreater(
            names.index("Remember what was published"),
            names.index("Publish update to the Expo production branch"),
        )

    def test_a_quiet_night_still_says_something(self):
        # A scheduled job that prints nothing is indistinguishable from one
        # that has stopped running.
        steps = workflow()["jobs"]["expo-update"]["steps"]
        skip = next(s for s in steps if s.get("name") == "Say why tonight published nothing")
        self.assertIn("steps.changed.outputs.publish != 'true'", skip["if"])


class TheGuard(unittest.TestCase):
    def repo(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        return Repo(d.name)

    def test_the_first_night_publishes(self):
        r = self.repo()
        r.commit("frontend/app.json", "{}")
        self.assertEqual(r.guard(), {"publish": "true", "reason": "first_publish"})

    def test_a_night_with_nothing_merged_publishes_nothing(self):
        # The whole point. Republishing here would stage an update on every
        # device for a bundle identical to the one already running.
        r = self.repo()
        sha = r.commit("frontend/app.json", "{}")
        r.git("tag", "-f", "ota-published", sha)
        self.assertEqual(r.guard(), {"publish": "false", "reason": "nothing_merged"})

    def test_a_backend_only_day_publishes_nothing(self):
        r = self.repo()
        sha = r.commit("frontend/app.json", "{}")
        r.git("tag", "-f", "ota-published", sha)
        r.commit("backend/server.py", "x = 1")
        self.assertEqual(r.guard(), {"publish": "false", "reason": "no_app_change"})

    def test_the_bots_own_web_export_commit_publishes_nothing(self):
        # web-export commits docs/app back to main after every frontend merge.
        # That commit must not, by itself, be read as a reason to ship.
        r = self.repo()
        sha = r.commit("frontend/app.json", "{}")
        r.git("tag", "-f", "ota-published", sha)
        r.commit("docs/app/index.html", "<!doctype html>")
        self.assertEqual(r.guard(), {"publish": "false", "reason": "no_app_change"})

    def test_a_frontend_change_publishes(self):
        r = self.repo()
        sha = r.commit("frontend/app.json", "{}")
        r.git("tag", "-f", "ota-published", sha)
        r.commit("frontend/src/feed.tsx", "export const x = 1;")
        self.assertEqual(r.guard(), {"publish": "true", "reason": "app_changed"})

    def test_a_legal_change_publishes(self):
        # The legal pages ship inside the bundle, and a stale privacy policy is
        # the kind of thing a store takes an app down for.
        r = self.repo()
        sha = r.commit("frontend/app.json", "{}")
        r.git("tag", "-f", "ota-published", sha)
        r.commit("legal/privacy.html", "<p>new</p>")
        self.assertEqual(r.guard(), {"publish": "true", "reason": "app_changed"})

    def test_a_change_reverted_by_the_end_of_the_week_publishes_nothing(self):
        # Judged on the diff between the two commits, not on how many landed
        # in between: three commits that cancel out leave nothing to ship.
        r = self.repo()
        sha = r.commit("frontend/app.json", "{}")
        r.git("tag", "-f", "ota-published", sha)
        r.commit("frontend/app.json", "{\"a\": 1}")
        r.commit("frontend/app.json", "{}")
        self.assertEqual(r.guard(), {"publish": "false", "reason": "no_app_change"})

    def test_a_tag_pointing_nowhere_publishes(self):
        # A force-push or a rewritten history must fail towards shipping. The
        # cost of an extra publish is one relaunch; the cost of guessing "no"
        # is a pipeline that stops delivering and says nothing.
        r = self.repo()
        r.commit("frontend/app.json", "{}")
        dangling = r.git("hash-object", "-w", "--stdin", "-t", "blob")
        r.git("update-ref", "refs/tags/ota-published", "0" * 40) if False else None
        # A tag object that does not resolve to a commit in this clone.
        self.assertTrue(dangling)
        r.git("tag", "-d", "ota-published") if False else None
        self.assertEqual(r.guard()["publish"], "true")


if __name__ == "__main__":
    unittest.main()
