"""A publish somebody asked for cannot be cancelled by routine traffic.

On 20 September two manual publishes were killed seconds after starting, and
both read as "Ota failed" with no cause. The cause was the repository's own
housekeeping: every merge to main is followed by an automatic commit rebuilding
the web export, that push landed in the same concurrency group as the manual
run, and cancel-in-progress did the rest.

That mattered more than a wasted run. The nightly schedule is best-effort and
dropped an entire night on 20 September, leaving four merged pull requests
reaching nobody — so the manual lever was the only way to ship, and it could be
taken away by a push nobody made on purpose.

These hold the fix, and generalise it: anything that can move what people are
running must either be uncancellable or have a group of its own when a person
asks for it.
"""
import os
import unittest

import yaml

WORKFLOWS = os.path.join(os.path.dirname(__file__), "..", ".github", "workflows")


def load(name: str) -> dict:
    with open(os.path.join(WORKFLOWS, name)) as fh:
        return yaml.safe_load(fh)


def triggers(doc: dict) -> dict:
    # PyYAML reads the bare key `on` as the boolean True.
    raw = doc.get("on", doc.get(True)) or {}
    return raw if isinstance(raw, dict) else {}


class TheManualPublishHasAGroupOfItsOwn(unittest.TestCase):
    def setUp(self):
        self.doc = load("frontend-ci-eas-update.yml")
        self.group = self.doc["concurrency"]["group"]

    def test_it_can_still_be_asked_for_by_hand(self):
        self.assertIn("workflow_dispatch", triggers(self.doc))

    def test_a_dispatch_lands_in_a_different_group_from_a_push(self):
        # This is the whole fix: without the event in the key, the automatic
        # web-export commit cancels the publish a person just asked for.
        self.assertIn("github.event_name == 'workflow_dispatch'", self.group)
        self.assertIn("-manual", self.group)

    def test_the_group_is_still_keyed_on_the_branch(self):
        # Two branches must not cancel each other, which is what the original
        # key was for and must survive this change.
        self.assertIn("github.ref_name", self.group)
        self.assertIn("github.event.pull_request.head.ref", self.group)

    def test_a_newer_manual_publish_still_supersedes_an_older_one(self):
        # The one case where cancelling is right.
        self.assertTrue(self.doc["concurrency"]["cancel-in-progress"])


class NothingThatShipsCanBeCancelledByAccident(unittest.TestCase):
    """The general rule, so the next workflow does not repeat this."""

    # Workflows that change, or can change, what is running on somebody's
    # phone. A cancelled run here is not a wasted minute, it is an update that
    # did not ship or a rollback that did not happen.
    SHIPPING = [
        "frontend-ci-eas-update.yml",
        "ota-rollback.yml",
        "ota-promote.yml",
        "eas-build.yml",
        "ios-build.yml",
        "preview-update.yml",
    ]

    def test_each_one_is_either_uncancellable_or_has_its_own_manual_group(self):
        for name in self.SHIPPING:
            with self.subTest(workflow=name):
                doc = load(name)
                conc = doc.get("concurrency")
                if not isinstance(conc, dict):
                    continue  # no group at all: nothing can cancel it
                if not conc.get("cancel-in-progress"):
                    continue  # cannot be cancelled, which is the safe answer
                if "workflow_dispatch" not in triggers(doc):
                    continue  # no manual lever to protect
                self.assertIn(
                    "github.event_name", str(conc.get("group")),
                    f"{name} can be dispatched by hand AND cancels in progress, so an "
                    "ordinary push can kill the run a person asked for. Either set "
                    "cancel-in-progress: false or put the event in the group key.")

    def test_the_list_names_workflows_that_exist(self):
        # A rename that emptied this list would leave the rule guarding nothing.
        for name in self.SHIPPING:
            with self.subTest(workflow=name):
                self.assertTrue(os.path.exists(os.path.join(WORKFLOWS, name)))


if __name__ == "__main__":
    unittest.main()


class TheWebExportDoesNotRebuildItselfForEver(unittest.TestCase):
    """The export records the commit it was built from, so committing it
    guarantees the next build differs.

    BUILD_TAG is 39 bytes inside the bundle and it is what Settings shows next
    to the version. Committing the export makes a new commit, so the next build
    records a different tag, produces a different bundle, and commits again. On
    21 September that produced five commits in a row, each rebuilding "for" the
    previous rebuild.

    It never ran away — a docs/-only push does not retrigger the workflow — but
    it churned main, burned a build every run, and meant main never sat still,
    which matters because a deliberate publish has to be dispatched into a
    quiet moment.
    """

    def setUp(self):
        self.job = load("frontend-ci-eas-update.yml")["jobs"]["web-export"]
        self.steps = {s.get("name"): s for s in self.job["steps"]}

    def test_it_asks_whether_the_app_itself_changed(self):
        self.assertIn("Has the web app itself changed since the last export?", self.steps)

    def test_the_build_and_the_commit_both_wait_on_that_answer(self):
        # Guarding the export but not the commit would still commit whatever
        # happened to be on disk; guarding the commit alone would still burn
        # the build every run.
        for name in ("Export the web app", "Commit the rebuilt export"):
            with self.subTest(step=name):
                self.assertEqual(
                    self.steps[name].get("if"),
                    "steps.web_changed.outputs.build == 'true'")

    def test_the_job_has_the_history_that_answer_needs(self):
        # The guard finds the previous export by searching the log. A shallow
        # clone has no log to search, so the search finds nothing, falls
        # through to "build", and the guard becomes a comment that costs a
        # build every run while appearing to work. This is the half that is
        # easy to drop and impossible to notice.
        checkout = self.job["steps"][0]
        self.assertEqual(checkout["with"].get("fetch-depth"), 0)

    def test_it_compares_the_source_tree_rather_than_a_commit_range(self):
        # Comparing trees is what makes skipping safe: identical frontend
        # means the new export could differ only by its build tag, so nothing
        # a person can see is left stale.
        run = self.steps["Has the web app itself changed since the last export?"]["run"]
        self.assertIn("rev-parse \"$prev:frontend\"", run)
        self.assertIn("rev-parse \"HEAD:frontend\"", run)

    def test_it_builds_when_it_cannot_tell(self):
        # No previous export found must mean build, never skip: a wrong skip
        # leaves ahenora.com stale, a wrong build only costs a minute.
        run = self.steps["Has the web app itself changed since the last export?"]["run"]
        self.assertIn('if [ -z "$prev" ]', run)
        self.assertIn("No previous export commit found", run)
