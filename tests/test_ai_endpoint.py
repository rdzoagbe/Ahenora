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
    # Import order must not decide whether the key looks configured. This file
    # used to rely on being the first module to import server: the env var is
    # read at import time, so a test file sorting earlier in the alphabet left
    # server.GOOGLE_API_KEY empty and failed the "key is configured" check.
    if not server.GOOGLE_API_KEY:
        server.GOOGLE_API_KEY = "test-key-not-real"
    from ai_models import DEFAULT_CANDIDATES

    # These tests are about the fallback mechanism, not about which models
    # happen to be current. Naming models literally meant every routine change
    # to the candidate list broke tests that were not testing the list.
    FIRST, SECOND, THIRD = DEFAULT_CANDIDATES[0], DEFAULT_CANDIDATES[1], DEFAULT_CANDIDATES[2]


class FakeResponse:
    def __init__(self, text):
        self.text = text


class FakeClient:
    """Stands in for a google-genai Client.

    Mirrors the surface the server actually uses — `aio.models.generate_content`
    for generation and `models.list` for discovery — so the tests exercise the
    real call shape rather than a convenient one. Models named in `dead` raise a
    retirement-shaped error; everything else answers OK.
    """

    def __init__(self, dead=(), error="quota exceeded",
                 dead_error="404 NOT_FOUND. model is not found", listed=()):
        self.dead = set(dead)
        self.error = error
        self.dead_error = dead_error
        self.listed = list(listed)
        self.calls = []
        self.captured = []
        self.aio = _FakeAio(self)
        self.models = _FakeModelsSync(self)

    def _generate(self, model, contents, config):
        self.calls.append(model)
        self.captured.append({"model": model, "contents": contents, "config": config})
        if model in self.dead:
            raise RuntimeError(self.dead_error)
        if model == "always-broken":
            raise RuntimeError(self.error)
        return FakeResponse(self.reply_for(model, contents, config))

    def reply_for(self, model, contents, config):
        return "OK"


class _FakeAio:
    def __init__(self, client):
        self.models = _FakeModelsAsync(client)


class _FakeModelsAsync:
    def __init__(self, client):
        self._client = client

    async def generate_content(self, *, model, contents, config=None):
        return self._client._generate(model, contents, config)


class _FakeModelsSync:
    def __init__(self, client):
        self._client = client

    def list(self, *, config=None):
        return list(self._client.listed)


class FakeModel:
    """A google-genai types.Model as discovery sees it."""

    def __init__(self, name, supported_actions=("generateContent",)):
        self.name = name
        self.supported_actions = list(supported_actions) if supported_actions is not None else None


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class HealthAiProbe(unittest.TestCase):
    def setUp(self):
        server._gemini_state["model"] = None
        server._gemini_state["last_error"] = None
        server._gemini_state["errors"] = {}
        server._gemini_state["discovered"] = None
        server._AI_PROBE["last"] = None
        self._client = server._gemini_state["client"]

    def tearDown(self):
        server._gemini_state["client"] = self._client

    def install(self, fake):
        """Put a fake client where the lazy builder would have put a real one."""
        server._gemini_state["client"] = fake
        return fake

    def probe(self):
        # The endpoint is admin-gated now (it names models, key state and
        # errors); the tests call the handler directly, so they present an
        # admin identity the same way the harness does.
        admin = {"email": "probe-admin@sim.test"}
        server.ADMIN_EMAILS = set(server.ADMIN_EMAILS) | {admin["email"]}
        return asyncio.run(server.health_ai(probe=1, user=admin))

    def test_walks_past_retired_models_to_one_that_answers(self):
        # The production incident: the first candidates are retired. The loop
        # must reach a live one and remember it.
        fake = self.install(FakeClient(dead={FIRST, SECOND}))
        status = self.probe()
        self.assertTrue(status["probe"]["ok"], status)
        self.assertEqual(status["model_resolved"], THIRD)
        self.assertEqual(fake.calls, [FIRST, SECOND, THIRD])

    def test_remembers_the_proven_model_across_calls(self):
        fake = self.install(FakeClient(dead={FIRST}))
        self.probe()
        server._AI_PROBE["last"] = None  # step around the rate limiter
        self.probe()
        # Second probe goes straight to the model that worked — one call.
        self.assertEqual(fake.calls[-1], SECOND)
        self.assertEqual(fake.calls.count(FIRST), 1)

    def test_per_model_quota_walks_the_chain(self):
        # The production case: the newest model 429s on a free-tier key, but an
        # older model still has quota. The chain must keep walking.
        self.install(FakeClient(
            dead={FIRST},
            dead_error="429 RESOURCE_EXHAUSTED. You exceeded your current quota",
        ))
        status = self.probe()
        self.assertTrue(status["probe"]["ok"], status)
        self.assertEqual(status["model_resolved"], SECOND)
        self.assertEqual(status["model_errors"], {FIRST: "quota_exhausted"})

    def test_an_account_failure_is_reported_not_retried(self):
        # A bad key fails identically on every model — one call, fail fast.
        class _BadKey(FakeClient):
            def _generate(self, model, contents, config):
                self.calls.append(model)
                raise RuntimeError("API key not valid. Please pass a valid API key.")

        fake = self.install(_BadKey())
        status = self.probe()
        self.assertFalse(status["probe"]["ok"])
        self.assertEqual(status["probe"]["error"], "invalid_api_key")
        self.assertEqual(len(fake.calls), 1)

    def test_probe_is_rate_limited(self):
        self.install(FakeClient())
        self.probe()
        second = self.probe()
        self.assertIn("skipped", second["probe"])

    def test_status_without_probe_is_free(self):
        fake = self.install(FakeClient())
        admin = {"email": "probe-admin@sim.test"}
        server.ADMIN_EMAILS = set(server.ADMIN_EMAILS) | {admin["email"]}
        status = asyncio.run(server.health_ai(probe=0, user=admin))
        self.assertNotIn("probe", status)
        self.assertEqual(fake.calls, [])
        self.assertTrue(status["key_configured"])

    def test_the_system_instruction_travels_on_the_config(self):
        # google-genai moved system_instruction from the model constructor onto
        # the per-call config. Dropping it in the move would have quietly
        # unprompted every AI feature while every call still succeeded.
        fake = self.install(FakeClient())
        asyncio.run(server._gemini_generate("hi", system="You are a teapot"))
        self.assertEqual(fake.captured[0]["config"]["system_instruction"], "You are a teapot")

    def test_no_config_is_sent_when_there_is_nothing_to_configure(self):
        fake = self.install(FakeClient())
        asyncio.run(server._gemini_generate("hi"))
        self.assertIsNone(fake.captured[0]["config"])

    def test_a_missing_client_fails_loudly_rather_than_silently(self):
        server._gemini_state["client"] = None
        key = server.GOOGLE_API_KEY
        server.GOOGLE_API_KEY = ""
        try:
            with self.assertRaises(RuntimeError):
                asyncio.run(server._gemini_generate("hi"))
        finally:
            server.GOOGLE_API_KEY = key


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class DiscoverModels(unittest.TestCase):
    """Discovery is what keeps the app alive when Google renames a model, so it
    has to read the shapes google-genai actually returns — not the ones the
    retired package did."""

    def setUp(self):
        self._client = server._gemini_state["client"]
        server._gemini_state["last_error"] = None

    def tearDown(self):
        server._gemini_state["client"] = self._client

    def discover(self, listed):
        server._gemini_state["client"] = FakeClient(listed=listed)
        return server._discover_models()

    def test_strips_the_models_prefix(self):
        # google-genai returns "models/gemini-2.5-flash"; callers need the bare
        # name. Vertex-style "publishers/google/models/x" must also reduce to x.
        found = self.discover([
            FakeModel("models/gemini-2.5-flash"),
            FakeModel("publishers/google/models/gemini-2.0-flash"),
        ])
        self.assertEqual(sorted(found), ["gemini-2.0-flash", "gemini-2.5-flash"])

    def test_reads_the_renamed_actions_field(self):
        # supported_generation_methods -> supported_actions.
        found = self.discover([
            FakeModel("models/gemini-2.5-flash", supported_actions=["generateContent"]),
            FakeModel("models/text-embedding-004", supported_actions=["embedContent"]),
        ])
        self.assertEqual(found, ["gemini-2.5-flash"])

    def test_a_model_reporting_no_actions_is_kept(self):
        # The trap: if a future SDK stops reporting actions, a strict filter
        # would empty the list and silently disable the self-healing that
        # discovery exists to provide. Keep it and let the call decide.
        found = self.discover([FakeModel("models/gemini-9-flash", supported_actions=None)])
        self.assertEqual(found, ["gemini-9-flash"])

    def test_text_models_outrank_image_and_tts(self):
        # A real incident: discovery picked gemini-2.5-flash-image and every
        # feature got pictures instead of words.
        found = self.discover([
            FakeModel("models/gemini-2.5-flash-image"),
            FakeModel("models/gemini-2.5-flash"),
            FakeModel("models/gemini-2.5-pro"),
        ])
        self.assertEqual(found[0], "gemini-2.5-flash")
        self.assertEqual(found[-1], "gemini-2.5-flash-image",
                         "non-text is demoted, never dropped")

    def test_a_listing_failure_is_reported_not_raised(self):
        class _Broken(FakeClient):
            pass
        broken = _Broken()
        broken.models.list = lambda **k: (_ for _ in ()).throw(RuntimeError("403 permission denied"))
        server._gemini_state["client"] = broken
        self.assertEqual(server._discover_models(), [])
        self.assertEqual(server.summarize_ai_error(server._gemini_state["last_error"]),
                         "permission_denied")

    def test_no_client_means_no_models(self):
        server._gemini_state["client"] = None
        key = server.GOOGLE_API_KEY
        server.GOOGLE_API_KEY = ""
        try:
            self.assertEqual(server._discover_models(), [])
        finally:
            server.GOOGLE_API_KEY = key


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class FastRouting(unittest.TestCase):
    """Simple jobs go to the lite model first; nothing else changes.

    The subtle rule under test: a fast success must NOT be remembered as the
    proven model, or one chef answer would quietly downgrade every recipe
    generated after it."""

    def setUp(self):
        self._client = server._gemini_state["client"]
        self._model = server._gemini_state["model"]
        server._gemini_state["model"] = None
        server._gemini_state["last_error"] = None
        server._gemini_state["errors"] = {}
        server._gemini_state["discovered"] = []
        self.fake = FakeClient()
        server._gemini_state["client"] = self.fake

    def tearDown(self):
        server._gemini_state["client"] = self._client
        server._gemini_state["model"] = self._model
        server._gemini_state["discovered"] = None

    def test_fast_calls_try_the_lite_model_first(self):
        asyncio.run(server._gemini_generate("hi", fast=True))
        self.assertEqual(self.fake.captured[0]["model"], server.FAST_MODEL)

    def test_normal_calls_are_unchanged(self):
        asyncio.run(server._gemini_generate("hi"))
        self.assertEqual(self.fake.captured[0]["model"], FIRST)

    def test_a_fast_success_is_not_remembered_as_the_proven_model(self):
        asyncio.run(server._gemini_generate("hi", fast=True))
        self.assertIsNone(server._gemini_state["model"])
        # ...so the next quality call still leads with the strong chain.
        asyncio.run(server._gemini_generate("hi"))
        self.assertEqual(self.fake.captured[-1]["model"], FIRST)

    def test_fast_falls_back_when_the_lite_model_is_gone(self):
        class _NoLite(FakeClient):
            def reply_for(self, model, contents, config):
                if model == server.FAST_MODEL:
                    raise RuntimeError("404 NOT_FOUND: model not found")
                return "OK"
        fake = _NoLite()
        server._gemini_state["client"] = fake
        out = asyncio.run(server._gemini_generate("hi", fast=True))
        self.assertEqual(out, "OK")
        self.assertEqual(fake.captured[0]["model"], server.FAST_MODEL)
        self.assertNotEqual(fake.captured[1]["model"], server.FAST_MODEL)


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
        self._client = server._gemini_state["client"]
        self._key = server.GOOGLE_API_KEY
        server.GOOGLE_API_KEY = "test-key"

        # A fake client that records the contents + config it was handed and
        # returns a valid seven-meal week.
        class _Week(FakeClient):
            def reply_for(self, model, contents, config):
                import json as _json
                days = ["monday", "tuesday", "wednesday", "thursday",
                        "friday", "saturday", "sunday"]
                meals = [{"day": d, "title": f"Dish {i}", "uses": ["rice"],
                          "need": [], "minutes": 20} for i, d in enumerate(days)]
                return _json.dumps({"meals": meals})

        self.fake = _Week()
        server._gemini_state["client"] = self.fake
        self.captured = self.fake.captured

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
        server._gemini_state["client"] = self._client
        server.GOOGLE_API_KEY = self._key
        for name, orig in self._patched.items():
            setattr(server, name, orig)

    def _fake_db(self, shopping_names=("Rice", "Chicken", "Tomatoes", "Onion"), history_items=(), last_suggested=()):
        # Minimal async-iterable Mongo stand-in.
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
                self.updates = []

            def find(self, *a, **k):
                return _Cursor(self._rows)

            async def find_one(self, *a, **k):
                return self._rows[0] if self._rows else None

            async def update_one(self, *a, **k):
                self.updates.append((a, k))
                return None

        shopping = [{"name": n} for n in shopping_names]
        history = [{"items": list(history_items)}] if history_items else []
        families = _Coll(
            [{"last_meal_suggestions": list(last_suggested)}] if last_suggested else []
        )

        class _DB:
            families_coll = families

            def __getitem__(self, name):
                if name == "shopping_list":
                    return _Coll(shopping)
                if name == "shopping_history":
                    return _Coll(history)
                if name == "families":
                    return families
                return _Coll([])

        return _DB()

    def _run(self, variant, db=None):
        user = {"family_id": "fam1", "role": "parent", "is_admin": True,
                "user_id": "u1", "name": "Parent"}
        # Admin bypasses feature gating and quota; build_subscription/get_family_doc
        # are only reached for non-admins, so admin keeps this test to the AI path.
        return asyncio.run(
            server.suggest_meals_ai(lang="en", variant=variant, user=user,
                                    database=db if db is not None else self._fake_db())
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

    def test_empty_list_refuses_even_with_history(self):
        # The field bug: with nothing on the shopping list, old trips were
        # topping the list up past the minimum, so an empty list still produced
        # a week of meals. No list, no meals — history only enriches a real one.
        from fastapi import HTTPException
        db = self._fake_db(shopping_names=(),
                           history_items=("Rice", "Chicken", "Tomatoes", "Onion", "Yam"))
        with self.assertRaises(HTTPException) as ctx:
            self._run(0, db=db)
        self.assertEqual(ctx.exception.status_code, 422)

    def test_a_reopened_sheet_avoids_last_weeks_ideas(self):
        # The field bug: the client resets its variant every open, so without
        # server-side memory every open sent an identical low-temperature
        # prompt and the family saw the same week forever.
        db = self._fake_db(last_suggested=("Beef Tacos", "Okra Stew"))
        self._run(0, db=db)
        prompt = self.captured[0]["contents"]
        self.assertIn("already seen", prompt)
        self.assertIn("Beef Tacos", prompt)
        self.assertIn("Okra Stew", prompt)

    def test_remembers_what_it_proposed_for_next_time(self):
        db = self._fake_db(last_suggested=("Beef Tacos",))
        self._run(0, db=db)
        stored = None
        for a, k in db.families_coll.updates:
            update = a[1] if len(a) > 1 else k.get("update")
            if update and "last_meal_suggestions" in update.get("$set", {}):
                stored = update["$set"]["last_meal_suggestions"]
        self.assertIsNotNone(stored, "nothing stored on the family")
        # The old week stays in memory alongside the new seven dishes.
        self.assertIn("Beef Tacos", stored)
        for i in range(7):
            self.assertIn(f"Dish {i}", stored)

    def test_two_items_is_still_too_few(self):
        from fastapi import HTTPException
        db = self._fake_db(shopping_names=("Rice", "Chicken"), history_items=("Yam",) * 10)
        with self.assertRaises(HTTPException) as ctx:
            self._run(0, db=db)
        self.assertEqual(ctx.exception.status_code, 422)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class RecipeDietGeneration(unittest.TestCase):
    """Vegetarian genuinely rewrites the recipe and caches in its own slot; a
    vegetarian household gets it by default; a "different recipe" runs hotter
    and skips the cache."""

    def setUp(self):
        server._gemini_state["model"] = None
        server._gemini_state["last_error"] = None
        server._gemini_state["errors"] = {}
        self._client = server._gemini_state["client"]
        self._key = server.GOOGLE_API_KEY
        server.GOOGLE_API_KEY = "test-key"

        import json as _json

        class _Recipe(FakeClient):
            def reply_for(self, model, contents, config):
                return _json.dumps({
                    "minutes": 25, "servings": 4,
                    "ingredients": [{"name": "tofu", "qty": 400, "unit": "g"}],
                    "steps": ["Press the tofu well.", "Fry it until golden.",
                              "Simmer in the sauce for ten minutes."],
                })

        self.fake = _Recipe()
        server._gemini_state["client"] = self.fake
        self.captured = self.fake.captured

        self._patched = {}
        for name, impl in [
            ("require_feature", lambda user, feature: {"plan": "premium"}),
            ("build_subscription", lambda fid: {"plan": "premium", "limits": {"ai_scans_per_month": 999}}),
        ]:
            self._patched[name] = getattr(server, name)

            def make_async(impl):
                async def _f(*a, **k):
                    return impl(*a, **k)
                return _f
            setattr(server, name, make_async(impl))
        self._get_family = server.get_family_doc

    def tearDown(self):
        server._gemini_state["client"] = self._client
        server.GOOGLE_API_KEY = self._key
        server.get_family_doc = self._get_family
        for name, orig in self._patched.items():
            setattr(server, name, orig)

    def _run(self, meal, diet="", variant=0, family_diet=""):
        updates = []

        class _Coll:
            def __init__(self, doc):
                self._doc = doc

            async def find_one(self, *a, **k):
                return dict(self._doc) if self._doc else None

            async def update_one(self, *a, **k):
                updates.append(a)
                return None

        class _DB:
            def __getitem__(self, name):
                return _Coll(meal if name == "meals" else None)

        async def _fam(fid):
            return {"ai_scans_used": 0, "diet": family_diet}
        server.get_family_doc = _fam

        user = {"family_id": "fam1", "role": "parent", "is_admin": True,
                "user_id": "u1", "name": "Parent"}
        result = asyncio.run(server.generate_meal_recipe(
            meal_id="m1", lang="en", diet=diet, variant=variant, user=user, database=_DB()))
        self.last_updates = updates
        return result

    def _set_keys(self):
        """Every field written by any update_one during the last run."""
        return [k for a in self.last_updates for k in (a[1].get("$set") or {})]

    def _base_meal(self, **extra):
        meal = {"meal_id": "m1", "family_id": "fam1", "title": "Chicken curry",
                "ingredients": []}
        meal.update(extra)
        return meal

    def test_vegetarian_rewrites_and_caches_in_its_own_slot(self):
        result = self._run(self._base_meal(), diet="vegetarian")
        self.assertEqual(result["diet"], "vegetarian")
        # The prompt actually asked for a rewrite, not advice.
        self.assertIn("vegetarian", self.captured[-1]["contents"].lower())
        # And it cached under the vegetarian slot, not the omnivore one.
        self.assertIn("ai_recipe_vegetarian.en", self._set_keys())
        self.assertNotIn("ai_recipe.en", self._set_keys())

    def test_plain_cook_it_uses_the_omnivore_slot(self):
        result = self._run(self._base_meal(), diet="")
        self.assertEqual(result["diet"], "")
        self.assertNotIn("vegetarian", self.captured[-1]["contents"].lower())
        self.assertIn("ai_recipe.en", self._set_keys())

    def test_a_vegetarian_household_gets_veg_by_default(self):
        result = self._run(self._base_meal(), diet="", family_diet="vegetarian")
        self.assertEqual(result["diet"], "vegetarian")
        self.assertIn("vegetarian", self.captured[-1]["contents"].lower())

    def test_a_cached_vegetarian_recipe_returns_free_without_the_model(self):
        cached = {"minutes": 20, "steps": ["a", "b", "c"]}
        meal = self._base_meal(ai_recipe_vegetarian={"en": cached})
        result = self._run(meal, diet="vegetarian")
        self.assertTrue(result["cached"])
        self.assertEqual(result["recipe"], cached)
        self.assertEqual(len(self.captured), 0)   # model was never called

    def test_different_recipe_skips_the_cache_and_runs_hotter(self):
        meal = self._base_meal(ai_recipe={"en": {"minutes": 20, "steps": ["a", "b", "c"]}})
        result = self._run(meal, diet="", variant=1)
        self.assertFalse(result["cached"])        # regenerated despite the cache
        self.assertIn("different take", self.captured[-1]["contents"].lower())
        self.assertEqual(self.captured[-1]["config"]["temperature"], 0.9)


if __name__ == "__main__":
    unittest.main()
