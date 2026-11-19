"""Test phones on the next store build keep getting the app's updates.

2026-11-19: Roland's phones carried the 1.3.0 test build (runtime 4.0.0) and
did not have the Family redesign published the evening before, because main
publishes for the store's runtime only. .github/workflows/store-build-sync.yml
brings main into the open store-build branch after each merge and has that
branch publish for its own runtime.
"""
import pathlib
import unittest

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
TEXT = (ROOT / ".github" / "workflows" / "store-build-sync.yml").read_text()
FLOW = yaml.safe_load(TEXT)
RUN = FLOW["jobs"]["sync"]["steps"][-1]["run"]


class TheSync(unittest.TestCase):
    def test_it_runs_after_a_merge_to_main_that_changes_the_app(self):
        on = FLOW[True]  # YAML reads the key `on` as a boolean
        self.assertEqual(on["push"]["branches"], ["main"])
        self.assertIn("frontend/**", on["push"]["paths"])
        self.assertIn("workflow_dispatch", on)

    def test_it_only_touches_store_build_branches(self):
        self.assertIn("'refs/remotes/origin/claude/store-build-*'", RUN)

    def test_a_branch_with_mains_runtime_is_left_alone(self):
        # Merged, or never bumped: main already publishes for it, and a second
        # publish from here would reach every phone on the store version.
        self.assertIn('if [ -z "$mine" ] || ! newer "$mine" "$live"; then', RUN)

    def test_a_branch_left_behind_is_not_a_store_build(self):
        # Once 1.3.0 merges, main is 4.0.0 and an old claude/store-build-*
        # branch still says 3.0.0: only a runtime AHEAD of main's is synced.
        import subprocess
        newer = next(l for l in RUN.splitlines() if l.strip().startswith("newer()"))
        def ahead(a, b):
            return subprocess.run(["bash", "-c", f'{newer}\nnewer "{a}" "{b}"']).returncode == 0
        self.assertTrue(ahead("4.0.0", "3.0.0"))
        self.assertTrue(ahead("10.0.0", "9.0.0"))
        self.assertFalse(ahead("3.0.0", "4.0.0"))
        self.assertFalse(ahead("4.0.0", "4.0.0"))

    def test_it_can_be_switched_off_for_the_release(self):
        # With the stores, real families carry the new runtime too.
        paused = RUN.index("if [ -e .github/store-build-sync.paused ]; then")
        self.assertLess(paused, RUN.index("git for-each-ref"))
        self.assertIn("exit 0", RUN[paused:RUN.index("runtime()")])

    def test_one_branch_in_trouble_does_not_stop_the_others(self):
        self.assertNotIn("exit 1", RUN)
        self.assertEqual(RUN.count("failed=1"), 2)
        self.assertIn('exit "$failed"', RUN)

    def test_a_conflict_stops_loudly_and_pushes_nothing(self):
        conflict = RUN.index("if ! git merge --no-edit origin/main; then")
        self.assertLess(conflict, RUN.index("git push origin"))
        between = RUN[conflict:RUN.index("git push origin")]
        self.assertRegex(between, r"failed=1\s+continue")

    def test_the_merge_must_not_change_the_store_builds_runtime(self):
        self.assertIn('if [ "$after" != "$mine" ]; then', RUN)

    def test_publishing_goes_through_the_branchs_own_checked_publish(self):
        # Lint, typecheck and tests run there first, and its guard refuses the
        # live runtime: this workflow never calls `eas update` itself.
        self.assertIn("gh workflow run frontend-ci-eas-update.yml --ref \"$branch\" -f publish_now=true", RUN)
        self.assertNotIn("eas update", RUN.replace("Expo update", ""))
        self.assertNotIn("eas-cli", TEXT)

    def test_it_may_push_and_start_a_run_and_nothing_more(self):
        self.assertEqual(FLOW["permissions"], {"contents": "write", "actions": "write"})


if __name__ == "__main__":
    unittest.main()
