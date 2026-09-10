"""A store build may only come from a checkout, never a downloaded folder.

Build 56 (2026-09-08) was produced by running `eas build` inside the folder
GitHub's "Download ZIP" button makes. `eas build` uploads the directory it is
run in, so Google Play received the app as it stood six days earlier: the old
navigation, the microphone that had been deleted, and no Firebase — which is
why Android had never been able to receive a push. Nothing failed. Nothing
warned.

These run the guard the way Expo's build server runs it, by executing it with
the environment EAS sets, because the thing worth pinning is what it DOES.

Run with:  python3 -m pytest tests/test_release_source_guard.py -q
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
FRONTEND = os.path.join(ROOT, "frontend")
GUARD = os.path.join(FRONTEND, "scripts", "check-release-source.js")

HAVE_NODE = shutil.which("node") is not None


def run(env, cwd=None, script=GUARD):
    """Run the guard with EAS's environment. Returns (exit code, output)."""
    full = {"PATH": os.environ.get("PATH", "")}
    full.update(env)
    proc = subprocess.run(["node", script], env=full, cwd=cwd or FRONTEND,
                          capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


@unittest.skipUnless(HAVE_NODE, "node not installed")
class TheGuard(unittest.TestCase):
    def test_a_release_build_with_no_commit_is_refused(self):
        # The exact shape of the incident: a folder with no git history, so
        # EAS records no commit for it.
        code, out = run({"EAS_BUILD": "1", "EAS_BUILD_PROFILE": "production"})
        self.assertEqual(code, 1)
        self.assertIn("REFUSING TO BUILD", out)
        self.assertIn("EAS Build (Android)", out)

    def test_every_profile_that_reaches_a_person_is_covered(self):
        for profile in ("production", "preview", "preview-ios"):
            code, out = run({"EAS_BUILD": "1", "EAS_BUILD_PROFILE": profile})
            self.assertEqual(code, 1, f"{profile} was not guarded: {out}")

    def test_a_development_build_is_left_alone(self):
        # Building a dev client from a scratch directory is ordinary work and
        # reaches nobody; guarding it would only train people to work around
        # the guard.
        code, out = run({"EAS_BUILD": "1", "EAS_BUILD_PROFILE": "development"})
        self.assertEqual(code, 0, out)

    def test_a_real_checkout_passes(self):
        code, out = run({
            "EAS_BUILD": "1", "EAS_BUILD_PROFILE": "production",
            "EAS_BUILD_PLATFORM": "android",
            "EAS_BUILD_GIT_COMMIT_HASH": "274c86cf720d940017bfc61893383aeba45d42af",
        })
        self.assertEqual(code, 0, out)
        self.assertIn("274c86cf720d", out)

    def test_it_says_nothing_when_not_on_the_build_server(self):
        # A local `npm test` or a CI lint job uploads nothing, so there is
        # nothing to judge.
        code, out = run({})
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip(), "")

    def test_an_android_release_without_the_firebase_config_is_refused(self):
        # Gradle refuses too, but a Java stack trace does not say why it
        # matters. Built in a temporary tree so the real one is untouched.
        with tempfile.TemporaryDirectory() as tmp:
            os.makedirs(os.path.join(tmp, "scripts"))
            os.makedirs(os.path.join(tmp, "android", "app"))
            copy = os.path.join(tmp, "scripts", "check-release-source.js")
            shutil.copy(GUARD, copy)
            env = {
                "EAS_BUILD": "1", "EAS_BUILD_PROFILE": "production",
                "EAS_BUILD_PLATFORM": "android",
                "EAS_BUILD_GIT_COMMIT_HASH": "abc123def456",
            }
            code, out = run(env, cwd=tmp, script=copy)
            self.assertEqual(code, 1)
            self.assertIn("google-services.json", out)
            self.assertIn("silent", out)

            # And passes once the file is there.
            with open(os.path.join(tmp, "android", "app", "google-services.json"), "w") as fh:
                fh.write("{}")
            code, out = run(env, cwd=tmp, script=copy)
            self.assertEqual(code, 0, out)


class ItIsActuallyWiredUp(unittest.TestCase):
    """A guard nobody runs is a comment."""

    def test_eas_runs_it_before_every_build(self):
        with open(os.path.join(FRONTEND, "package.json")) as fh:
            scripts = json.load(fh)["scripts"]
        # EAS Build runs this npm lifecycle hook on its own servers, before
        # dependencies are installed — which is why the guard may only use
        # Node built-ins.
        self.assertIn("eas-build-pre-install", scripts)
        self.assertIn("check-release-source.js", scripts["eas-build-pre-install"])

    def test_the_guard_needs_no_dependencies(self):
        with open(GUARD) as fh:
            source = fh.read()
        for required in ("require('fs')", "require('path')"):
            self.assertIn(required, source)
        # Anything outside Node's standard library would not exist yet.
        for banned in ("require('node-fetch')", "require('axios')", "require('semver')"):
            self.assertNotIn(banned, source)

    def test_the_release_path_is_written_down(self):
        with open(os.path.join(ROOT, "docs", "RELEASING.md")) as fh:
            doc = fh.read()
        self.assertIn("EAS Build (Android)", doc)
        self.assertIn("Download ZIP", doc)


if __name__ == "__main__":
    unittest.main()
