"""Every event the app reports must be one the server records.

log_metric_event answers {"ok": False} for a name outside ALLOWED_EVENTS, and
logEvent() on the client is fire-and-forget — it does not read the response.
So an unlisted name is dropped in total silence, and the Metrics screen shows
zero for it. Zero from "this never happened" and zero from "this was never
recorded" look identical, which is the whole problem.

That is not hypothetical: `onboarding_skipped` was sent by the app and missing
from the allowlist for as long as it had existed. The screen reported that
nobody skipped onboarding, when in fact nobody's skip had ever been counted —
and skipping onboarding is one of the stronger activation signals there is.

This test reads both sides and holds them in step.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    import server
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FRONTEND = os.path.join(ROOT, "frontend")
CALL = re.compile(r"""logEvent\(\s*['"]([a-zA-Z0-9_]+)['"]""")

# Bumped server-side from the Gemini path, never reported by a client.
SERVER_ONLY = {"ai_call_ok", "ai_call_error"}


def names_the_app_sends() -> set:
    found = set()
    for base in (os.path.join(FRONTEND, "app"), os.path.join(FRONTEND, "src")):
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d != "node_modules"]
            for name in filenames:
                if not name.endswith((".ts", ".tsx")):
                    continue
                with open(os.path.join(dirpath, name), encoding="utf-8") as fh:
                    found.update(CALL.findall(fh.read()))
    return found


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class MetricEventNames(unittest.TestCase):
    def test_the_scan_finds_the_call_sites_at_all(self):
        """A regex that matched nothing would make every assertion below pass
        vacuously — which is the same failure mode this file exists to catch."""
        self.assertGreaterEqual(len(names_the_app_sends()), 5)

    def test_every_name_the_app_sends_is_recorded(self):
        sent = names_the_app_sends()
        dropped = sorted(sent - server.ALLOWED_EVENTS)
        self.assertEqual(
            dropped, [],
            f"the app reports these and the server silently discards them: {dropped}. "
            "Add them to ALLOWED_EVENTS, or stop sending them.")

    def test_no_allowlisted_name_is_dead_weight(self):
        """A name nobody sends is a column that will always read zero — someone
        will eventually read that as a fact about users."""
        sent = names_the_app_sends()
        unused = sorted(server.ALLOWED_EVENTS - sent - SERVER_ONLY)
        self.assertEqual(
            unused, [],
            f"allowlisted but sent by nobody: {unused}. Either wire it up, or "
            "remove it so the screen cannot show a number that means nothing.")


if __name__ == "__main__":
    unittest.main(verbosity=2)
