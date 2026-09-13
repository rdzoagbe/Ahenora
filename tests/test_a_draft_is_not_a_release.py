"""The build workflow must not report a draft as a release.

"Submitted" is not "released", and reading it as one cost four days.

eas.json sets `releaseStatus: draft` on the production track on purpose: a
build should not reach families the moment a workflow finishes. But the job
ended on "Submitted to the production track." and "All done!", which reads as
shipped. Version 57 — carrying the fix that gave Android push back — sat in
Play Console as an unreleased draft from 8 to 12 September while three paying
households received no notifications at all. Every check on every run was green
for the whole of it, and the run page said the build had been submitted, which
was true and useless.

That is the same shape as the two other silences fixed the same week: the vault
expiry alerts that were computed and never sent, and the billing alarm that
could not clear. Work reported as done, nothing delivered.

What is held here is only that the workflow TELLS THE TRUTH about which of the
two happened. Whether draft or completed is the right setting is a decision for
a person; being unable to tell which one you got is not.

Run with:  python3 -m unittest discover -s tests -v
"""

import json
import os
import re
import unittest

import yaml

ROOT = os.path.join(os.path.dirname(__file__), "..")
WORKFLOW = os.path.join(ROOT, ".github", "workflows", "eas-build.yml")
EAS_JSON = os.path.join(ROOT, "frontend", "eas.json")


def workflow():
    with open(WORKFLOW, encoding="utf-8") as fh:
        return fh.read()


def runnable():
    """The workflow with its comments stripped.

    Every check below used to read the whole file, and the file carries a long
    comment explaining this very incident — so asserting that "eas.json" and
    "releaseStatus" appear passed on the strength of that prose while the code
    beneath it hard-coded the answer. A mutation proved it: replacing the
    lookup with `status=draft` left all eight tests green.

    Comments are where intent is written down; they are not where behaviour
    lives, and a test that cannot tell them apart is measuring the wrong file.
    """
    lines = []
    for line in workflow().splitlines():
        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue
        lines.append(line)
    return "\n".join(lines)


class ADraftIsNotARelease(unittest.TestCase):
    def test_the_comment_stripper_actually_strips(self):
        """Otherwise runnable() is workflow() and this all reverts to prose."""
        self.assertIn("# ", workflow(), "the file has no comments to strip")
        self.assertLess(len(runnable()), len(workflow()))
        # A phrase that lives ONLY in the comment. "four days" was the first
        # choice and was wrong: the step's own summary text says it too, so the
        # assertion failed against a working stripper — a reminder that a
        # fixture has to be checked, not assumed, the same as anything else.
        only_prose = "was green for the whole of it"
        self.assertIn(only_prose, workflow())
        self.assertNotIn(only_prose, runnable())

    def test_the_workflow_is_there_at_all(self):
        """A renamed file would make every check below pass by reading nothing."""
        self.assertTrue(os.path.exists(WORKFLOW))
        self.assertGreater(len(workflow()), 1500)

    def test_the_production_track_releases_itself(self):
        """Revisited, as the previous version of this test asked to be.

        It used to assert `draft`, and its docstring said that if the setting
        ever changed to `completed` this should be re-read rather than deleted.
        It changed, on 13 September, after the draft had twice done the damage
        it was supposed to prevent: version 57 sat unreleased for four days
        while Android push stayed broken for paying households, and a later
        build was superseded before anybody rolled it out.

        The manual gate still exists — it just moved to where a person is
        already making a decision. The build workflow is workflow_dispatch
        only, and submitting is an explicit input on it, so nothing reaches
        Play without somebody choosing to send it. The draft added a SECOND
        gate, in a console nobody was watching, which is where a release goes
        to be forgotten rather than reviewed.
        """
        with open(EAS_JSON, encoding="utf-8") as fh:
            profiles = json.load(fh).get("submit", {})
        self.assertIn("production", profiles)
        self.assertEqual(
            profiles["production"]["android"].get("releaseStatus"), "completed",
            "production is parked as a draft again — read this file's history "
            "before deciding that is what you want")

    def test_nothing_reaches_play_without_somebody_choosing_to_send_it(self):
        """The gate that replaced the draft, stated so it cannot quietly go.

        Auto-rollout is only safe because a human triggers the build AND opts
        into submitting AND picks the track. If this workflow ever grew a push
        or schedule trigger, `completed` would become "every merge ships
        itself to production", which is a different and much worse thing.
        """
        doc = yaml.safe_load(workflow())
        triggers = doc.get("on", doc.get(True))
        self.assertEqual(list(triggers), ["workflow_dispatch"],
                         "the build workflow fires on something other than a "
                         "person pressing it, and production now auto-releases")
        self.assertIn("submit", triggers["workflow_dispatch"]["inputs"])
        self.assertIn("track", triggers["workflow_dispatch"]["inputs"])

    def test_the_job_reads_the_release_status_rather_than_assuming(self):
        # Hard-coding "draft" in the workflow would be a second source of truth
        # that drifts the moment eas.json changes.
        code = runnable()
        self.assertIn("releaseStatus", code,
                      "the job never looks up what it actually submitted as")
        self.assertIn("require('./eas.json')", code,
                      "the status is not read from eas.json, so it is a second "
                      "source of truth that drifts the moment the config changes")

    def test_the_release_path_says_it_needs_nothing_further(self):
        # The draft path went quiet and that is how four days passed. The path
        # that now actually runs must not have the same hole in it: a build
        # that DID release should say so, or "submitted" reads the same either
        # way and we have moved the ambiguity rather than removed it.
        code = runnable()
        self.assertRegex(code, r"Released to the")
        self.assertRegex(code, r"without\n?\s*#?\s*anything further to do|anything further to do")

    def test_a_draft_is_announced_as_a_warning(self):
        # A line in the step summary is only seen by someone who opens the run.
        # ::warning puts it on the run page and in the Actions list.
        code = runnable()
        self.assertRegex(
            code, r"::warning[^\n]*NOT released",
            "a draft finishes quietly — which is exactly how one sat for four days")

    def test_it_says_what_to_do_about_it(self):
        # "Draft" on its own is a status. The thing a person needs is the step
        # that turns it into a release.
        code = runnable()
        self.assertIn("Play Console", code)
        self.assertRegex(code, r"Roll out")

    def test_it_no_longer_ends_on_a_bare_submitted(self):
        """The exact sentence that misled.

        "Submitted to the production track." as the last word of a successful
        run is true and reads as shipped.
        """
        code = runnable()
        self.assertNotIn('echo "Submitted to the ${{ github.event.inputs.track }} track."', code)

    def test_a_completed_release_says_so_too(self):
        # The other half: if the status is ever `completed`, the run must say
        # plainly that it went out, or the next person cannot tell either.
        code = runnable()
        self.assertRegex(code, r"Released to the")

    def test_the_two_outcomes_are_distinguishable(self):
        """Both branches exist and say different things.

        A warning that fires on every run is a warning nobody reads.
        """
        code = runnable()
        draft_at = code.find("DRAFT")
        released_at = code.find("Released to the")
        self.assertGreater(draft_at, 0)
        self.assertGreater(released_at, 0)
        self.assertNotEqual(draft_at, released_at)


if __name__ == "__main__":
    unittest.main()
