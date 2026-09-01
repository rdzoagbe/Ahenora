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

And the two workflows must publish to the same platforms. The production and
preview channels drifting apart means a change is tested on one set of devices
and shipped to another.

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

    def test_production_and_preview_publish_to_the_same_platforms(self):
        found = {}
        for wf, _, run in publish_steps():
            match = re.search(r"--platform\s+(\S+)", run)
            self.assertIsNotNone(match, f"{wf} names no platform")
            found[wf] = match.group(1)
        self.assertEqual(len(set(found.values())), 1,
                         f"production and preview have drifted apart: {found}")

    def test_a_narrowed_platform_says_why_and_when_it_goes_back(self):
        # `all` is the steady state. Anything narrower is a temporary measure,
        # and a temporary measure with no written expiry becomes permanent.
        for path in WORKFLOWS:
            with open(path) as fh:
                text = fh.read()
            match = re.search(r"--platform\s+(\S+)", text)
            if match and match.group(1) != "all":
                self.assertIn("temporar", text.lower(),
                              f"{os.path.basename(path)} narrows the platform "
                              f"without saying it is temporary")
                self.assertIn("back to", text.lower(),
                              f"{os.path.basename(path)} narrows the platform "
                              f"without saying when it goes back to all")


if __name__ == "__main__":
    unittest.main()
