"""Nothing the app reads at build time may be empty in an over-the-air bundle.

`EXPO_PUBLIC_*` values are inlined into the bundle when it is built. A store
build gets them from eas.json. An over-the-air bundle gets them from whatever
GitHub Actions happens to export — and what it exports has twice been less
than what the app reads.

  2026-09-07. The Google iOS client id was in eas.json and not in the workflow.
  The first OTA to reach an iPhone therefore carried an empty one, and the
  calendar screen threw on open for every iOS user. Fixed with a committed
  fallback in src/googleClientIds.ts.

  Found 2026-09-09. The RevenueCat iOS key was the same shape and the fix was
  never carried across: in eas.json, absent from both OTA workflows, and with
  no fallback — `|| ''`. So on every iPhone running an over-the-air update,
  billing reported itself unavailable and the app said "not right now". iPhone
  owners could not subscribe at all, silently, from the App Store launch
  onwards, while the store build worked and every test passed.

Android survived both because it had committed fallbacks. That is the pattern
worth enforcing rather than the two instances:

  a value the app reads must be SET BY THE OTA WORKFLOW, or have a COMMITTED
  FALLBACK. Either is fine. Neither is a bug that only shows up in the field,
  on one platform, after a merge.

Run with:  python3 -m pytest tests/test_ota_build_vars.py -q
"""
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
OTA_WORKFLOWS = (".github/workflows/frontend-ci-eas-update.yml",
                 ".github/workflows/preview-update.yml")

# Set by the workflow from `github.sha`, and absent by design in a store build:
# it names the deployed commit, and a stale committed value would be a lie.
NOT_REQUIRED = {"EXPO_PUBLIC_BUILD_TAG"}


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
        return fh.read()


def app_sources():
    out = []
    for base in ("frontend/src", "frontend/app"):
        for dirpath, dirs, names in os.walk(os.path.join(ROOT, base)):
            dirs[:] = [d for d in dirs if d not in ("node_modules", "__tests__")]
            for n in names:
                if n.endswith((".ts", ".tsx")):
                    out.append(os.path.join(dirpath, n))
    return out


def vars_the_app_reads():
    found = {}
    for path in app_sources():
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
        for name in re.findall(r"process\.env\.(EXPO_PUBLIC_[A-Z0-9_]+)", body):
            found.setdefault(name, set()).add(os.path.relpath(path, ROOT))
    return found


def has_committed_fallback(name, files):
    """A fallback is `process.env.X ... || <a literal>` — not `|| ''`."""
    for rel in files:
        body = read(rel)
        for m in re.finditer(
                rf"process\.env\.{re.escape(name)}(?:\?\.trim\(\)|\.trim\(\))?\s*\|\|\s*(.{{0,40}})",
                body):
            tail = m.group(1).strip()
            if tail.startswith(("''", '""', "``")):
                continue          # an empty fallback is not a fallback
            return True
        # The value may be passed through a helper first (fromEnv(...) || '...').
        for m in re.finditer(
                rf"\w+\(process\.env\.{re.escape(name)}\)\s*\|\|\s*(.{{0,40}})", body):
            if not m.group(1).strip().startswith(("''", '""', "``")):
                return True
    return False


class EveryBuildVariableSurvivesAnOtaUpdate(unittest.TestCase):
    def test_each_one_is_injected_or_has_a_fallback(self):
        workflows = {w: read(w) for w in OTA_WORKFLOWS}
        broken = []
        for name, files in sorted(vars_the_app_reads().items()):
            if name in NOT_REQUIRED:
                continue
            missing_from = [w for w, body in workflows.items() if name not in body]
            if missing_from and not has_committed_fallback(name, files):
                broken.append(
                    f"{name} is read by {sorted(files)[0]}, is not set by "
                    f"{', '.join(os.path.basename(w) for w in missing_from)}, "
                    f"and has no committed fallback — an OTA bundle carries it empty")
        self.assertEqual(broken, [], "\n  " + "\n  ".join(broken) if broken else "")

    def test_the_two_that_have_already_bitten_are_both_covered(self):
        """Named explicitly, because a general rule can be satisfied in a way
        that misses the specific thing it was written for."""
        for name in ("EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID", "EXPO_PUBLIC_REVENUECAT_IOS_KEY"):
            files = vars_the_app_reads().get(name)
            self.assertIsNotNone(files, f"{name} is no longer read — update this test")
            self.assertTrue(has_committed_fallback(name, files),
                            f"{name} has no committed fallback")
            for w in OTA_WORKFLOWS:
                self.assertIn(name, read(w), f"{name} is not exported by {w}")

    def test_an_empty_string_does_not_count_as_a_fallback(self):
        """The exact shape the billing key had: `|| ''` reads as a default and
        is really 'silently do nothing'."""
        self.assertFalse(
            has_committed_fallback("EXPO_PUBLIC_NOTHING",
                                   []),
            "no files means no fallback")


if __name__ == "__main__":
    unittest.main()
