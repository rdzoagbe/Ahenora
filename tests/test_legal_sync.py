"""The privacy policy shown in the app and the one on ahenora.com must say the
same thing. They drifted once — the site described email/password accounts and
the in-app copy still described a Google-only sign-in — and a user reading a
policy that does not match the app is a problem no amount of good intent fixes.

Both copies are generated from legal/privacy.json; this fails if either was
edited by hand or left stale."""
import os
import subprocess
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


class LegalSyncTests(unittest.TestCase):
    def test_generated_copies_are_up_to_date(self):
        result = subprocess.run(
            [sys.executable, os.path.join(ROOT, "scripts", "build_legal.py"), "--check"],
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_the_policy_covers_what_the_app_now_does(self):
        # Each of these is a thing the app collects or enforces. If a feature
        # lands without the policy following it, this is where that shows up.
        text = open(os.path.join(ROOT, "legal", "privacy.json"), encoding="utf-8").read().lower()
        for promise in ("under 13", "hash", "messages", "age", "gemini",
                        "kid mode", "teen", "delete"):
            self.assertIn(promise, text, f"privacy policy never mentions {promise!r}")


if __name__ == "__main__":
    unittest.main()
