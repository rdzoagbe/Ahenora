"""Integration test for the AI health probe and the model-fallback loop.

Imports the real server module with a fake Gemini client, then drives
/api/health/ai the way production would. Skipped automatically where the
backend dependencies are not installed (Backend CI runs stdlib-only); it runs
wherever `pip install -r backend/requirements.txt` has happened.
"""

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    os.environ.setdefault("GOOGLE_API_KEY", "test-key-not-real")
    import server


class FakeResponse:
    def __init__(self, text):
        self.text = text


class FakeModelFactory:
    """Stands in for genai.GenerativeModel. Scripted per test: models in
    `dead` raise a retirement-shaped error, everything else answers OK."""

    def __init__(self, dead=(), error="quota exceeded", dead_error="404 model is not found"):
        self.dead = set(dead)
        self.error = error
        self.dead_error = dead_error
        self.calls = []

    def __call__(self, model_name, system_instruction=None):
        factory = self

        class _Model:
            def generate_content(self, contents):
                factory.calls.append(model_name)
                if model_name in factory.dead:
                    raise RuntimeError(factory.dead_error)
                if model_name == "always-broken":
                    raise RuntimeError(factory.error)
                return FakeResponse("OK")

        return _Model()


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class HealthAiProbe(unittest.TestCase):
    def setUp(self):
        server._gemini_state["model"] = None
        server._gemini_state["last_error"] = None
        server._AI_PROBE["last"] = None
        self._genai = server.genai

    def tearDown(self):
        server.genai = self._genai

    def probe(self):
        return asyncio.run(server.health_ai(probe=1))

    def test_walks_past_retired_models_to_one_that_answers(self):
        # The production incident: the first candidates are retired. The loop
        # must reach a live one and remember it.
        fake = FakeModelFactory(dead={"gemini-2.5-flash", "gemini-2.0-flash"})
        server.genai = type("G", (), {"GenerativeModel": fake})()
        status = self.probe()
        self.assertTrue(status["probe"]["ok"], status)
        self.assertEqual(status["model_resolved"], "gemini-1.5-flash")
        self.assertEqual(
            fake.calls, ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]
        )

    def test_remembers_the_proven_model_across_calls(self):
        fake = FakeModelFactory(dead={"gemini-2.5-flash"})
        server.genai = type("G", (), {"GenerativeModel": fake})()
        self.probe()
        server._AI_PROBE["last"] = None  # step around the rate limiter
        self.probe()
        # Second probe goes straight to the model that worked — one call.
        self.assertEqual(fake.calls[-1], "gemini-2.0-flash")
        self.assertEqual(fake.calls.count("gemini-2.5-flash"), 1)

    def test_a_real_failure_is_reported_not_retried(self):
        # A quota error against model one must NOT cascade to models two and
        # three — that would triple the cost of every outage.
        fake = FakeModelFactory()
        fake.dead = set()

        class _Quota:
            def __init__(self, model_name, system_instruction=None):
                fake.calls.append(model_name)

            def generate_content(self, contents):
                raise RuntimeError("429 quota exceeded")

        server.genai = type("G", (), {"GenerativeModel": _Quota})()
        status = self.probe()
        self.assertFalse(status["probe"]["ok"])
        self.assertIn("quota", status["probe"]["error"])
        self.assertEqual(len(fake.calls), 1)

    def test_probe_is_rate_limited(self):
        fake = FakeModelFactory()
        server.genai = type("G", (), {"GenerativeModel": fake})()
        self.probe()
        second = self.probe()
        self.assertIn("skipped", second["probe"])

    def test_status_without_probe_is_free(self):
        fake = FakeModelFactory()
        server.genai = type("G", (), {"GenerativeModel": fake})()
        status = asyncio.run(server.health_ai(probe=0))
        self.assertNotIn("probe", status)
        self.assertEqual(fake.calls, [])
        self.assertTrue(status["key_configured"])


if __name__ == "__main__":
    unittest.main()
