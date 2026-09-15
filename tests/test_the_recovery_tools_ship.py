"""The runbook said "run it in a Railway shell". The image had no such file.

docs/runbooks/restore-drill.md told anyone recovering this database to run
scripts/mongo_backup.py in a shell on the backend service. The Dockerfile
copies `backend/` and nothing else, so neither that file nor the drill that
wraps it was ever in the deployed image. The instruction had been wrong since
it was written.

Nothing found out, because the drill had never been run — which is the whole
argument for running it. A recovery procedure is not correct because it reads
correctly; it is correct when somebody has followed it.

These hold the three things that have to stay true together, because each of
them fails silently on its own:

  * the tools are in the image;
  * their dependencies are in the image;
  * the runbook still names the place they actually are.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")

# Deliberately only these. The rest of scripts/ is browser harnesses and test
# doubles, which have no business in a production image.
SHIPPED = ("scripts/mongo_backup.py", "scripts/restore_drill.py")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


class TheImageCarriesTheRecoveryTools(unittest.TestCase):

    def setUp(self):
        self.dockerfile = read("backend", "Dockerfile")
        # Comments explain WHY the line is there and would otherwise satisfy
        # every assertion below on their own.
        self.code = "\n".join(line for line in self.dockerfile.splitlines()
                              if not line.lstrip().startswith("#"))

    def test_both_tools_are_copied_in(self):
        for path in SHIPPED:
            self.assertIn(path, self.code,
                          f"{path} is not copied into the image, so the runbook's "
                          f"instruction to run it on the service is false")

    def test_they_land_somewhere_the_runbook_can_name(self):
        # WORKDIR is /app and backend/ is copied to '.', so server.py sits at
        # /app/server.py. The tools go to /app/scripts/ so that the command in
        # the runbook — python scripts/restore_drill.py — works as written.
        self.assertRegex(self.code, r"COPY\s+scripts/[^\n]*\s+\./scripts/")

    def test_the_whole_of_scripts_is_not_shipped(self):
        """Browser harnesses, fake_mongo and the e2e backend do not belong in
        a production image, and a blanket copy is how they get there."""
        self.assertNotRegex(self.code, r"COPY\s+scripts/\s")
        self.assertNotRegex(self.code, r"COPY\s+scripts\s")

    def test_the_copy_happens_before_ownership_is_handed_over(self):
        # chown -R runs once. A COPY after it leaves files owned by root in a
        # container running as appuser — readable, but a trap for anything
        # that writes.
        self.assertLess(self.code.index("COPY scripts/"),
                        self.code.index("chown -R appuser"))


class TheToolsCanActuallyRunThere(unittest.TestCase):
    """Copying the files in is half of it. A tool that imports something the
    image does not have fails at the one moment nobody can debug it."""

    def test_their_dependencies_are_installed_in_the_image(self):
        requirements = read("backend", "requirements.txt").lower()
        for package in ("pymongo", "motor"):
            self.assertIn(package, requirements)

    def test_the_drill_imports_nothing_from_backend(self):
        """backend/ and scripts/ are siblings in the image. An import reaching
        across would work here and fail there."""
        source = read("scripts", "restore_drill.py")
        self.assertNotIn("import server", source)
        self.assertNotIn("from server", source)

    def test_the_drill_only_imports_its_sibling_out_of_scripts(self):
        # Anything else it pulled in would have to ship too, and the Dockerfile
        # names exactly two files.
        source = read("scripts", "restore_drill.py")
        local = set(re.findall(r"^import (\w+)", source, re.M))
        stdlib = {"argparse", "asyncio", "os", "shutil", "sys", "tempfile",
                  "time", "io", "re", "json"}
        self.assertEqual(local - stdlib, {"mongo_backup"})


class TheRunbookAndTheImageAgree(unittest.TestCase):
    """The failure that started this: the instruction and the image drifted,
    and only a person following the instruction could have noticed."""

    def test_the_runbook_gives_the_command_the_image_supports(self):
        self.assertIn("python3 scripts/restore_drill.py",
                      read("docs", "runbooks", "restore-drill.md"))

    def test_the_runbook_no_longer_claims_nothing_needs_installing_elsewhere(self):
        # It is true ON THE SERVICE, because the image has pymongo and motor.
        # Pinned so the claim stays attached to the place it is true.
        runbook = read("docs", "runbooks", "restore-drill.md")
        self.assertIn("Railway", runbook)


if __name__ == "__main__":
    unittest.main()
