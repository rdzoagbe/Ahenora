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
        server._gemini_state["errors"] = {}
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

    def test_per_model_quota_walks_the_chain(self):
        # The production case: the newest model 429s on a free-tier key, but an
        # older model still has quota. The chain must keep walking.
        fake = FakeModelFactory(
            dead={"gemini-2.5-flash"}, dead_error="429 You exceeded your current quota"
        )
        server.genai = type("G", (), {"GenerativeModel": fake})()
        status = self.probe()
        self.assertTrue(status["probe"]["ok"], status)
        self.assertEqual(status["model_resolved"], "gemini-2.0-flash")
        self.assertEqual(status["model_errors"], {"gemini-2.5-flash": "quota_exhausted"})

    def test_an_account_failure_is_reported_not_retried(self):
        # A bad key fails identically on every model — one call, fail fast.
        fake = FakeModelFactory()

        class _BadKey:
            def __init__(self, model_name, system_instruction=None):
                fake.calls.append(model_name)

            def generate_content(self, contents):
                raise RuntimeError("API key not valid. Please pass a valid API key.")

        server.genai = type("G", (), {"GenerativeModel": _BadKey})()
        status = self.probe()
        self.assertFalse(status["probe"]["ok"])
        self.assertEqual(status["probe"]["error"], "invalid_api_key")
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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class SuggestVariant(unittest.TestCase):
    """The review's confirmed bug: "different ideas" sent a byte-identical
    request on the AI path, so the variant never left the device and only
    Gemini sampling noise varied. Drive the real handler and prove the prompt
    (and temperature) now change per variant."""

    def setUp(self):
        server._gemini_state["model"] = None
        server._gemini_state["last_error"] = None
        server._gemini_state["errors"] = {}
        self._genai = server.genai
        self._key = server.GOOGLE_API_KEY
        server.GOOGLE_API_KEY = "test-key"

        self.captured = []

        # A fake genai whose model records the prompt + generation_config it
        # was handed, and returns a valid seven-meal week.
        captured = self.captured

        class _Model:
            def __init__(self, model_name, system_instruction=None):
                pass

            def generate_content(self, contents, generation_config=None):
                captured.append({"contents": contents, "config": generation_config})
                import json as _json
                days = ["monday", "tuesday", "wednesday", "thursday",
                        "friday", "saturday", "sunday"]
                meals = [{"day": d, "title": f"Dish {i}", "uses": ["rice"],
                          "need": [], "minutes": 20} for i, d in enumerate(days)]

                class _R:
                    text = _json.dumps({"meals": meals})
                return _R()

        server.genai = type("G", (), {"GenerativeModel": _Model})()

        # require_feature -> build_subscription -> get_db() needs a live Mongo;
        # stub the two DB-touching helpers so the test stays on the AI path.
        self._patched = {}
        for fn_name, impl in [
            ("require_feature", lambda user, feature: {"plan": "premium", "limits": {"ai_scans_per_month": 999}}),
            ("build_subscription", lambda fid: {"plan": "premium", "limits": {"ai_scans_per_month": 999}}),
            ("get_family_doc", lambda fid: {"ai_scans_used": 0}),
        ]:
            self._patched[fn_name] = getattr(server, fn_name)
            async def _mk(impl=impl):
                pass
            # wrap the sync lambda in a coroutine
            def make_async(impl):
                async def _f(*a, **k):
                    return impl(*a, **k)
                return _f
            setattr(server, fn_name, make_async(impl))

    def tearDown(self):
        server.genai = self._genai
        server.GOOGLE_API_KEY = self._key
        for name, orig in self._patched.items():
            setattr(server, name, orig)

    def _fake_db(self):
        # Minimal async-iterable Mongo stand-in: a shopping list of four items,
        # empty history and meals.
        class _Cursor:
            def __init__(self, rows):
                self._rows = rows

            def sort(self, *a, **k):
                return self

            def limit(self, *a, **k):
                return self

            def __aiter__(self):
                async def gen():
                    for r in self._rows:
                        yield r
                return gen()

        class _Coll:
            def __init__(self, rows):
                self._rows = rows

            def find(self, *a, **k):
                return _Cursor(self._rows)

            async def update_one(self, *a, **k):
                return None

        shopping = [{"name": n} for n in ["Rice", "Chicken", "Tomatoes", "Onion"]]

        class _DB:
            def __getitem__(self, name):
                if name == "shopping_list":
                    return _Coll(shopping)
                return _Coll([])

        return _DB()

    def _run(self, variant):
        user = {"family_id": "fam1", "role": "parent", "is_admin": True,
                "user_id": "u1", "name": "Parent"}
        # Admin bypasses feature gating and quota; build_subscription/get_family_doc
        # are only reached for non-admins, so admin keeps this test to the AI path.
        return asyncio.run(
            server.suggest_meals_ai(lang="en", variant=variant, user=user, database=self._fake_db())
        )

    def test_prompt_differs_per_variant(self):
        self._run(0)
        self._run(1)
        self._run(2)
        prompts = [c["contents"] for c in self.captured]
        self.assertEqual(len(prompts), 3)
        self.assertNotEqual(prompts[0], prompts[1])
        self.assertNotEqual(prompts[1], prompts[2])
        # variant 0 focused, later asks hotter
        self.assertEqual(self.captured[0]["config"]["temperature"], 0.4)
        self.assertEqual(self.captured[1]["config"]["temperature"], 1.0)

    def test_returns_seven_meals(self):
        result = self._run(0)
        self.assertEqual(len(result["meals"]), 7)


if __name__ == "__main__":
    unittest.main()
