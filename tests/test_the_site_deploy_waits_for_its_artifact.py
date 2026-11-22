"""The website deploy waits until GitHub lists what it just uploaded.

Twice in two days (2026-11-21 11:58 and 2026-11-22 04:02 UTC) "Deploy docs to
Pages" went red with:

    Artifact github-pages successfully finalized.
    Fetching artifact metadata for "github-pages" in this workflow run
    Found 0 artifact(s)

The deploy step asks GitHub for the run's artifacts once, 0.3 seconds after
the upload returns, and gives up on an empty list. The site was fine and so
was the artifact; ahenora.com simply stayed one deploy behind until somebody
re-ran the job. A step now asks until the artifact is listed.
"""
import os
import unittest

import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, ".github", "workflows", "pages-deploy.yml")


class TheSiteDeployWaitsForItsArtifact(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(PATH, encoding="utf-8") as fh:
            cls.workflow = yaml.safe_load(fh)
        cls.steps = cls.workflow["jobs"]["deploy"]["steps"]

    def _index(self, predicate):
        found = [i for i, step in enumerate(self.steps) if predicate(step)]
        self.assertEqual(len(found), 1, found)
        return found[0]

    def test_it_waits_between_the_upload_and_the_deploy(self):
        upload = self._index(lambda s: str(s.get("uses", "")).startswith("actions/upload-pages-artifact@"))
        wait = self._index(lambda s: "actions/runs/$GITHUB_RUN_ID/artifacts" in str(s.get("run", "")))
        deploy = self._index(lambda s: str(s.get("uses", "")).startswith("actions/deploy-pages@"))
        self.assertLess(upload, wait)
        self.assertLess(wait, deploy)

    def test_it_asks_about_the_artifact_the_deploy_will_look_for(self):
        wait = self.steps[self._index(lambda s: "actions/runs/$GITHUB_RUN_ID/artifacts" in str(s.get("run", "")))]
        # deploy-pages looks for "github-pages" unless told otherwise, and
        # nothing here tells it otherwise.
        self.assertIn("name=github-pages", wait["run"])
        deploy = self.steps[self._index(lambda s: str(s.get("uses", "")).startswith("actions/deploy-pages@"))]
        self.assertNotIn("artifact_name", deploy.get("with") or {})

    def test_it_gives_up_loudly_rather_than_deploying_blind(self):
        wait = self.steps[self._index(lambda s: "actions/runs/$GITHUB_RUN_ID/artifacts" in str(s.get("run", "")))]
        self.assertIn("exit 1", wait["run"])
        self.assertIn("sleep", wait["run"])
        self.assertNotIn("continue-on-error", wait)

    def test_the_token_may_read_the_runs_artifacts(self):
        self.assertEqual(self.workflow["permissions"].get("actions"), "read")
        # And nothing wider came with it.
        self.assertEqual(self.workflow["permissions"],
                         {"contents": "read", "pages": "write", "id-token": "write", "actions": "read"})


if __name__ == "__main__":
    unittest.main()
