"""A branch must not commit the generated web export.

docs/app is `npx expo export` output. It IS committed to main — the Pages
deploy uploads the checked-out docs/ folder, so the live site needs it there —
but exactly one thing is allowed to write it: the export bot, on main, after a
merge.

When a branch writes it too, both sides of every later merge have edited the
same hundred generated HTML files and git cannot reconcile them. This is not a
near-miss. Main's bot rewrites that export after EVERY merge, so every open
pull request conflicts the moment any other one lands. On 12 September that
cost five full CI rounds — roughly two hours — across six pull requests, and
every conflict was in generated markup nobody reads.

Leaving it out costs no coverage: the browser-harness job builds its own export
from the branch's source, precisely so it tests that commit rather than a stale
artefact.

The guard is a script rather than inline YAML so this file can RUN it against
real repositories. Grepping a workflow's text passes on a step that is dead on
arrival, which is a lesson this repository has already paid for twice.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import subprocess
import tempfile
import unittest

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GUARD = os.path.join(ROOT, "scripts", "check_no_generated_export_in_pr.sh")
FRONTEND_CI = os.path.join(ROOT, ".github", "workflows", "frontend-ci-eas-update.yml")
HARNESSES = os.path.join(ROOT, ".github", "workflows", "browser-harnesses.yml")


def workflow(path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


class Repo:
    def __init__(self, path):
        self.path = path
        self.git("init", "-q", "-b", "main")
        self.git("config", "user.email", "t@example.com")
        self.git("config", "user.name", "T")
        self.commit("README.md", "start")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.path, check=True,
                              capture_output=True, text=True).stdout.strip()

    def commit(self, relpath, text):
        full = os.path.join(self.path, relpath)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as fh:
            fh.write(text)
        self.git("add", "-A")
        self.git("commit", "-q", "-m", f"touch {relpath}")

    def guard(self, base="main"):
        return subprocess.run(["bash", GUARD, base], cwd=self.path,
                              capture_output=True, text=True)


class TheGuard(unittest.TestCase):
    def repo(self):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        return Repo(d.name)

    def test_a_clean_branch_passes(self):
        r = self.repo()
        r.git("checkout", "-q", "-b", "feature")
        r.commit("frontend/src/thing.ts", "export const x = 1;")
        out = r.guard()
        self.assertEqual(out.returncode, 0, out.stdout + out.stderr)

    def test_a_branch_carrying_the_export_is_refused(self):
        r = self.repo()
        r.git("checkout", "-q", "-b", "feature")
        r.commit("docs/app/index.html", "<!doctype html>")
        out = r.guard()
        self.assertEqual(out.returncode, 1)
        self.assertIn("docs/app", out.stdout)

    def test_it_says_how_to_fix_it(self):
        # A check that refuses a push without saying what to do next is a check
        # people learn to route around.
        r = self.repo()
        r.git("checkout", "-q", "-b", "feature")
        r.commit("docs/app/index.html", "<!doctype html>")
        self.assertIn("git checkout -- docs/app", r.guard().stdout)

    def test_the_export_on_main_is_left_alone(self):
        # The bot's own commits are on main, which is the base — never the diff.
        r = self.repo()
        r.commit("docs/app/index.html", "<!doctype html>")
        r.git("checkout", "-q", "-b", "feature")
        r.commit("backend/server.py", "x = 1")
        self.assertEqual(r.guard().returncode, 0)

    def test_it_refuses_to_guess_a_base(self):
        # Defaulting to something would make the check pass silently in a
        # context where it cannot actually compare anything.
        r = self.repo()
        out = subprocess.run(["bash", GUARD], cwd=r.path,
                             capture_output=True, text=True)
        self.assertEqual(out.returncode, 2)


class TheWiring(unittest.TestCase):
    def test_the_guard_runs_on_pull_requests(self):
        steps = workflow(FRONTEND_CI)["jobs"]["frontend-ci"]["steps"]
        step = next(s for s in steps
                    if "check_no_generated_export_in_pr.sh" in str(s.get("run", "")))
        self.assertIn("pull_request", step["if"])

    def test_the_checkout_fetches_enough_history_to_diff(self):
        # A shallow clone cannot reach the base commit, and the diff would come
        # back empty — a check that passes because it could not look.
        steps = workflow(FRONTEND_CI)["jobs"]["frontend-ci"]["steps"]
        checkout = next(s for s in steps if "actions/checkout" in str(s.get("uses", "")))
        self.assertEqual(checkout["with"]["fetch-depth"], 0)

    def test_the_prerender_check_runs_against_a_freshly_built_export(self):
        # It has always run in backend CI, against whatever export is in the
        # tree — so on a pull request it graded main's artefact, not the
        # branch's. Here the export is this commit's.
        steps = workflow(HARNESSES)["jobs"]["harnesses"]["steps"]
        names = [s.get("name") for s in steps]
        built = names.index("Export the web build")
        checked = names.index("The exported pages carry no build date")
        self.assertGreater(checked, built)


if __name__ == "__main__":
    unittest.main()
