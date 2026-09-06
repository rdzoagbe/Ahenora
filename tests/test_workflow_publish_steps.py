"""The OTA publish steps: do they actually run, and do they agree with each other?

Two failures this file exists to prevent, both of which happened.

A `#` comment placed inside a `\\` line continuation does not comment out the
flag beneath it. The continuation joins the lines, the `#` ends the command
early, and every following line is left to execute as its own command — so
`--platform` is run as a program and the step exits 127. A step written that
way looks perfectly reasonable in review and is dead on arrival.

Note what does NOT catch that: the broken step is valid shell, so `bash -n`
passes it, and it contains the string "--platform", so grepping the source
passes it too. Only running it and reading the arguments the command actually
receives tells the truth — which is why the flag check below executes the step
with the binary swapped for echo instead of searching its text.

And preview must cover at least what production ships to. The danger is
shipping to a device nobody previewed on — so production's platforms have to be
a SUBSET of preview's. The reverse is fine and is the situation today:
production is pinned to android while App Review runs a build on that channel,
and preview publishes to `all` so the iPhone tester receives fixes at all.

This started as an equality check, which is a different claim and a wrong one.
It broke the moment that deliberate, documented split was made — and nothing
noticed, because backend CI only watched its own workflow file, not the two
files this test actually reads. Both halves are fixed: the assertion says what
it means, and the path filter now covers every workflow.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import re
import subprocess
import unittest

try:
    import yaml
    HAVE_YAML = True
except ImportError:
    HAVE_YAML = False

ROOT = os.path.join(os.path.dirname(__file__), "..")
WORKFLOWS = (
    os.path.join(ROOT, ".github", "workflows", "frontend-ci-eas-update.yml"),
    os.path.join(ROOT, ".github", "workflows", "preview-update.yml"),
)


def publish_steps():
    for path in WORKFLOWS:
        with open(path) as fh:
            doc = yaml.safe_load(fh)
        for job in doc["jobs"].values():
            for step in job.get("steps", []) or []:
                run = step.get("run") or ""
                if "eas-cli" in run and " update " in run:
                    yield os.path.basename(path), step.get("name", "?"), run


@unittest.skipUnless(HAVE_YAML, "pyyaml not installed")
class PublishSteps(unittest.TestCase):
    def test_there_is_exactly_one_publish_step_per_workflow(self):
        names = [w for w, _, _ in publish_steps()]
        self.assertEqual(sorted(names),
                         ["frontend-ci-eas-update.yml", "preview-update.yml"])

    def test_every_publish_step_is_valid_shell(self):
        for wf, name, run in publish_steps():
            proc = subprocess.run(["bash", "-n"], input=run, text=True,
                                  capture_output=True)
            self.assertEqual(proc.returncode, 0,
                             f"{wf} / {name} is not valid shell:\n{proc.stderr}")

    def test_no_comment_hides_inside_a_line_continuation(self):
        # The exact shape that broke it: a line ending in a backslash followed
        # by a line whose first non-space character is a hash.
        for wf, name, run in publish_steps():
            lines = run.splitlines()
            for i, line in enumerate(lines[:-1]):
                if line.rstrip().endswith("\\"):
                    nxt = lines[i + 1].strip()
                    self.assertFalse(
                        nxt.startswith("#"),
                        f"{wf} / {name}: comment on line {i + 2} sits inside a "
                        f"continuation and will end the command early")

    def test_every_publish_step_actually_passes_its_flags(self):
        """Run the step with eas-cli swapped for echo, and read the arguments.

        Grepping the source for "--platform" is the tempting version of this
        check and it is worthless: the broken step CONTAINED every flag as
        text. `bash -n` is no better — the broken step parses cleanly, it just
        does the wrong thing. The only honest question is what the shell
        actually hands the command, so ask the shell.
        """
        for wf, name, run in publish_steps():
            # GitHub substitutes ${{ ... }} before the shell ever sees it.
            script = re.sub(r"\$\{\{.*?\}\}", "x", run, flags=re.S)
            script = script.replace("npx eas-cli@latest update", "echo ARGS:")
            proc = subprocess.run(["bash"], input=script, text=True,
                                  capture_output=True,
                                  env={**os.environ, "GITHUB_SHA": "sha"})
            self.assertEqual(proc.returncode, 0,
                             f"{wf} / {name} does not run:\n{proc.stderr}")
            args = proc.stdout.strip()
            self.assertTrue(args.startswith("ARGS:"),
                            f"{wf} / {name} produced no argument line: {args!r}")
            for flag in ("--platform", "--branch", "--non-interactive"):
                self.assertIn(flag, args,
                              f"{wf} / {name}: {flag} never reaches the command. "
                              f"It got: {args!r}")

    def test_preview_covers_everything_production_ships_to(self):
        """Never ship to a device nobody previewed on."""
        found = {}
        for wf, _, run in publish_steps():
            match = re.search(r"--platform\s+(\S+)", run)
            self.assertIsNotNone(match, f"{wf} names no platform")
            found[wf] = match.group(1)

        def devices(flag):
            return {"android", "ios"} if flag == "all" else {flag}

        production = devices(found["frontend-ci-eas-update.yml"])
        preview = devices(found["preview-update.yml"])
        self.assertTrue(
            production <= preview,
            "production ships to devices preview never reaches: "
            f"production={sorted(production)} preview={sorted(preview)}")

    def test_production_is_never_wider_than_the_binaries_allow(self):
        """A guard on the pin itself, so it is a decision rather than a
        leftover. Production is android-only ONLY while iOS is in App Review —
        an update on that channel can change the app under a reviewer. When
        iOS is approved this flips to `all`, and this test is the reminder:
        it fails if production names a platform that is neither.
        """
        found = {wf: re.search(r"--platform\s+(\S+)", run).group(1)
                 for wf, _, run in publish_steps()}
        self.assertIn(found["frontend-ci-eas-update.yml"], ("android", "all"))

    def test_a_narrowed_platform_says_why_and_when_it_goes_back(self):
        # `all` is the steady state. Anything narrower is a temporary measure,
        # and a temporary measure with no written expiry becomes permanent.
        #
        # Read the flag from the PUBLISH STEP, not from the file. Searching the
        # whole file found `--platform web` from the web-export job first, so
        # this check was reading a different flag than the one it names — and
        # would have gone red the moment someone did the flip-back it exists to
        # encourage. A guard that fires on the correct action is worse than no
        # guard, so it reuses the same step parser as every other test here.
        for wf, _, run in publish_steps():
            path = next(p for p in WORKFLOWS if os.path.basename(p) == wf)
            with open(path) as fh:
                text = fh.read()
            match = re.search(r"--platform\s+(\S+)", run)
            if match and match.group(1) != "all":
                self.assertIn("temporar", text.lower(),
                              f"{wf} narrows the platform without saying it "
                              f"is temporary")
                self.assertIn("back to", text.lower(),
                              f"{wf} narrows the platform without saying when "
                              f"it goes back to all")


if __name__ == "__main__":
    unittest.main()
