"""Any workflow that runs eas-cli must install node_modules first.

Three workflows were written to promote, roll back and watch a production
update. All three were checked into main and none of them worked. The first
time one was run in anger — to unjam a blocked pipeline — it failed in
twenty-five seconds:

    Failed to resolve plugin for module "expo-router" relative to
    ".../frontend". Do you have node modules installed?

eas-cli reads the Expo app config before it does anything, and resolving that
config loads config plugins from node_modules. Checkout and setup-node are not
enough; the publish workflow had always installed dependencies and the three
new ones simply did not.

So the emergency rollback did not work, and nothing said so until somebody
needed it. That is the exact failure these workflows exist to prevent, built
into the workflows themselves — a guard that reads as protection and is not.

Named checks would not have caught it either: each file contained the right
eas command. What was missing was a step somewhere above it. So this asserts
the RULE across every workflow, including ones not yet written.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import unittest

try:
    import yaml
    HAVE_YAML = True
except ImportError:
    HAVE_YAML = False

WORKFLOW_DIR = os.path.join(os.path.dirname(__file__), "..", ".github", "workflows")


def jobs_running_eas():
    """(workflow, job name, steps) for every job that invokes eas-cli."""
    for fname in sorted(os.listdir(WORKFLOW_DIR)):
        if not fname.endswith((".yml", ".yaml")):
            continue
        with open(os.path.join(WORKFLOW_DIR, fname)) as fh:
            doc = yaml.safe_load(fh) or {}
        for job_name, job in (doc.get("jobs") or {}).items():
            steps = job.get("steps") or []
            if any("eas-cli" in (s.get("run") or "") for s in steps):
                yield fname, job_name, steps


@unittest.skipUnless(HAVE_YAML, "pyyaml not installed")
class EveryEasJobInstallsFirst(unittest.TestCase):
    def test_dependencies_are_installed_before_the_first_eas_command(self):
        seen = 0
        for wf, job_name, steps in jobs_running_eas():
            seen += 1
            first_eas = next(i for i, s in enumerate(steps)
                             if "eas-cli" in (s.get("run") or ""))
            installs_before = any(
                "npm install" in (s.get("run") or "") or "npm ci" in (s.get("run") or "")
                for s in steps[:first_eas])
            self.assertTrue(
                installs_before,
                f"{wf} / {job_name} runs eas-cli without installing node_modules "
                f"first. eas-cli resolves the Expo app config through config "
                f"plugins in node_modules and fails with 'Failed to resolve "
                f"plugin for module expo-router' before reaching the network.")
        # If the discovery stops finding anything, the assertion above becomes
        # vacuous and this file quietly protects nothing.
        self.assertGreater(seen, 0, "no workflow job invokes eas-cli any more — "
                                    "has this check stopped finding them?")

    def test_the_install_runs_where_package_json_is(self):
        """Installing in the repository root installs nothing useful: the app
        lives in frontend/."""
        for wf, job_name, steps in jobs_running_eas():
            for step in steps:
                run = step.get("run") or ""
                if "npm install" in run or "npm ci" in run:
                    self.assertEqual(
                        step.get("working-directory"), "frontend",
                        f"{wf} / {job_name} installs outside frontend/, where "
                        f"package.json is")


if __name__ == "__main__":
    unittest.main()
