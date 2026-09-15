"""The tag said a crashed bundle was live, and two tools believed it.

`ota-published` is moved only after `eas update` succeeds, so everything
downstream reads it as "the last commit that genuinely reached a phone".
scripts/ota_should_publish.sh decides whether tonight has anything to ship
from it; scripts/ota_is_stalled.py decides whether the pipeline has died.

`eas update:rollback` changes the bundle on every phone and the rollback
workflow did not touch the tag. On 2026-09-15 that left it naming a commit
that had crashed on a real device and was no longer serving anyone, while the
stall check written the same morning would have reported it as shipped.

A lying tag is worse than a missing one, and the asymmetry is the whole
design: both readers treat an absent tag as "publish again", which costs one
extra update. Only a WRONG tag can produce silence.

So these hold two things: that the restored commit is read from the listing
rather than assumed, and that anything less than certainty returns None so the
caller can delete the tag instead of guessing.

Run with:  python3 -m unittest discover -s tests -v
"""
import json
import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from ota_rolled_back_to import commit_of, restored_commit  # noqa: E402

BAD = "fd506fda-3490-4c61-9189-df9a02150ea9"
GOOD = "aaaa1111-2222-3333-4444-555566667777"
OLDER = "bbbb1111-2222-3333-4444-555566667777"


def listing(*rows):
    return json.dumps(list(rows))


def row(group, sha=None, when=None, message=None):
    out = {"group": group, "createdAt": when or "2026-09-15T12:00:00.000Z"}
    if message is not None:
        out["message"] = message
    elif sha:
        out["message"] = f"GitHub {sha}"
    return out


class ItReadsWhatTheRollbackRestored(unittest.TestCase):

    def test_the_group_below_the_rolled_back_one(self):
        blob = listing(
            row(BAD, "35a668a9f52174b4ed0cd148f87e5fbcc21cf579",
                when="2026-09-15T17:37:00.000Z"),
            row(GOOD, "8cfb96c7646b84c29513c81f2508b382ef0153b3",
                when="2026-09-14T23:41:00.000Z"),
        )
        self.assertEqual(restored_commit(blob, BAD),
                         "8cfb96c7646b84c29513c81f2508b382ef0153b3")

    def test_it_skips_a_group_with_no_commit_in_its_message(self):
        """A hand-published update, or an earlier rollback's own entry, names
        no commit. Stopping at it returns nothing when the answer is one row
        further down.

        The timestamps matter and the first version of this test got them
        wrong: it put the commitless row ABOVE the rolled-back group, where
        sorting lifts it clear and it is never looked at. A mutation that
        took rows[target + 1] blindly passed. It has to sit BETWEEN the two.
        """
        blob = listing(
            row(BAD, "35a668a9", when="2026-09-15T17:37:00.000Z"),
            row("published-by-hand", message="hotfix, no CI",
                when="2026-09-15T15:00:00.000Z"),
            row(GOOD, "8cfb96c7", when="2026-09-14T23:41:00.000Z"),
        )
        self.assertEqual(restored_commit(blob, BAD), "8cfb96c7")

    def test_it_skips_several_in_a_row(self):
        blob = listing(
            row(BAD, "35a668a9", when="2026-09-15T17:37:00.000Z"),
            row("by-hand-1", message="hotfix", when="2026-09-15T15:00:00.000Z"),
            row("by-hand-2", message="another", when="2026-09-15T14:00:00.000Z"),
            row(GOOD, "8cfb96c7", when="2026-09-14T23:41:00.000Z"),
        )
        self.assertEqual(restored_commit(blob, BAD), "8cfb96c7")

    def test_order_comes_from_the_dates_not_the_listing(self):
        """eas lists newest first today. Relying on that is an assumption about
        formatting standing in for one about time."""
        blob = listing(
            row(GOOD, "8cfb96c7", when="2026-09-14T23:41:00.000Z"),
            row(BAD, "35a668a9", when="2026-09-15T17:37:00.000Z"),
        )
        self.assertEqual(restored_commit(blob, BAD), "8cfb96c7")

    def test_a_short_sha_is_accepted(self):
        blob = listing(row(BAD, "35a668a9", when="2026-09-15T17:37:00.000Z"),
                       row(GOOD, "8cfb96c", when="2026-09-14T23:41:00.000Z"))
        self.assertEqual(restored_commit(blob, BAD), "8cfb96c")


class ItReturnsNothingRatherThanAGuess(unittest.TestCase):
    """Every case here makes the caller DELETE the tag, which costs one
    republished update and cannot mislead anybody."""

    def test_the_rolled_back_group_is_not_on_this_branch(self):
        # The next-oldest group of a listing that does not contain the
        # rolled-back update is not related to it at all.
        blob = listing(row(GOOD, "8cfb96c7"), row(OLDER, "aaaaaaa"))
        self.assertIsNone(restored_commit(blob, BAD))

    def test_there_is_nothing_older_to_fall_back_to(self):
        blob = listing(row(BAD, "35a668a9"))
        self.assertIsNone(restored_commit(blob, BAD))

    def test_no_older_group_names_a_commit(self):
        blob = listing(row(BAD, "35a668a9"),
                       row(GOOD, message="published by hand"))
        self.assertIsNone(restored_commit(blob, BAD))

    def test_an_unreadable_listing(self):
        self.assertIsNone(restored_commit("not json at all", BAD))

    def test_an_empty_listing(self):
        self.assertIsNone(restored_commit("[]", BAD))

    def test_no_group_given(self):
        self.assertIsNone(restored_commit(listing(row(BAD, "35a668a9")), ""))


class TheCommitIsReadFromTheMessageTheWorkflowWrites(unittest.TestCase):

    def test_the_exact_shape_the_publish_step_uses(self):
        # frontend-ci-eas-update.yml: --message "GitHub $GITHUB_SHA"
        self.assertEqual(commit_of({"message": "GitHub 974d13028071b6d0"}),
                         "974d13028071b6d0")

    def test_the_publish_workflow_still_writes_that_shape(self):
        """If the message format changes, this resolver silently stops finding
        commits and every rollback deletes the tag instead of moving it."""
        with open(os.path.join(ROOT, ".github", "workflows",
                               "frontend-ci-eas-update.yml"), encoding="utf-8") as handle:
            self.assertIn('--message "GitHub $GITHUB_SHA"', handle.read())

    def test_prose_around_it_does_not_matter(self):
        self.assertEqual(commit_of({"message": "Update from GitHub abc1234 (ci)"}),
                         "abc1234")

    def test_something_that_is_not_a_sha_is_not_taken_for_one(self):
        self.assertIsNone(commit_of({"message": "GitHub actions were slow"}))

    def test_a_message_with_no_commit(self):
        self.assertIsNone(commit_of({"message": "Rollback: scan crashed"}))

    def test_a_row_with_no_message_at_all(self):
        self.assertIsNone(commit_of({"group": BAD}))


class TheRollbackWorkflowActsOnIt(unittest.TestCase):
    """A resolver nothing calls leaves the tag exactly as wrong as before."""

    def workflow(self):
        with open(os.path.join(ROOT, ".github", "workflows", "ota-rollback.yml"),
                  encoding="utf-8") as handle:
            return handle.read()

    def test_it_runs_the_resolver(self):
        self.assertIn("ota_rolled_back_to.py", self.workflow())

    def test_it_moves_the_tag_when_the_commit_is_known(self):
        self.assertIn("refs/tags/ota-published", self.workflow())

    def test_it_deletes_the_tag_when_it_is_not(self):
        # The safe direction: a missing tag republishes, a wrong one goes quiet.
        self.assertIn(":refs/tags/ota-published", self.workflow())


if __name__ == "__main__":
    unittest.main()
