"""CI runs Node 22, and the newest 22, not whichever copy the runner cached.

Every workflow set `node-version: 20`, a line that no longer receives
security fixes. Moving them to 22 was not enough on its own: on the first
run of that change, setup-node took the copy already on GitHub's runner,
22.23.3 ("Found in cache @ /opt/hostedtoolcache/node/22.23.3/x64"), while
Node's own release list (nodejs.org/dist/index.json) marks 22.23.4, dated
2026-10-20, as the security release. `check-latest: true` makes setup-node
ask for the newest 22.x instead of trusting the cache.

These steps build the web export and publish the over-the-air update that
reaches every phone, so they are where an unpatched Node matters most.

Run with:  python3 -m unittest discover -s tests -v
"""
import glob
import os
import unittest

import yaml

ROOT = os.path.join(os.path.dirname(__file__), "..")


def setup_node_steps():
    for path in sorted(glob.glob(os.path.join(ROOT, ".github", "workflows", "*.yml"))):
        with open(path, encoding="utf-8") as handle:
            workflow = yaml.safe_load(handle)
        for job_name, job in (workflow.get("jobs") or {}).items():
            for step in job.get("steps") or []:
                if str(step.get("uses", "")).startswith("actions/setup-node"):
                    yield os.path.basename(path), job_name, step.get("with") or {}


class CiRunsAPatchedNode(unittest.TestCase):

    def test_there_are_node_steps_to_check(self):
        self.assertGreaterEqual(len(list(setup_node_steps())), 11)

    def test_every_node_step_asks_for_the_newest_22(self):
        for workflow, job, options in setup_node_steps():
            with self.subTest(workflow=workflow, job=job):
                self.assertEqual(str(options.get("node-version")), "22")
                self.assertIs(options.get("check-latest"), True)


if __name__ == "__main__":
    unittest.main()
