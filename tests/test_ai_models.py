"""Tests for Gemini model selection and retirement fallback.

The model name was hardcoded to a retired model, which silently broke every
AI feature at once — each one fell back gracefully, so nothing ever said why.
These tests pin the selection rules so that cannot recur unnoticed.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from ai_models import (  # noqa: E402
    DEFAULT_CANDIDATES,
    is_model_not_found,
    model_candidates,
)


class ModelCandidates(unittest.TestCase):
    def test_defaults_are_used_in_order(self):
        self.assertEqual(model_candidates(), DEFAULT_CANDIDATES)

    def test_the_first_default_is_an_alias_not_a_pinned_version(self):
        """The rule this module exists to enforce.

        A pinned version at the front goes stale the moment Google retires it,
        and every process then burns a failed API call before the chain finds a
        live model — which is exactly what production was doing with three
        pinned names at the front. An alias like "gemini-flash-latest" is moved
        by Google to whatever the current model is, so it does not rot.
        """
        self.assertTrue(
            DEFAULT_CANDIDATES[0].endswith("-latest"),
            f"first candidate {DEFAULT_CANDIDATES[0]!r} should be a -latest alias",
        )

    def test_operator_override_goes_before_defaults(self):
        self.assertEqual(model_candidates("my-model")[0], "my-model")

    def test_proven_model_beats_everything(self):
        # If a model already answered this process, keep using it — proven
        # beats preferred, including the operator's own override.
        order = model_candidates("my-model", remembered="gemini-2.0-flash")
        self.assertEqual(order[0], "gemini-2.0-flash")
        self.assertEqual(order[1], "my-model")

    def test_no_duplicates(self):
        order = model_candidates("gemini-2.5-flash", remembered="gemini-2.5-flash")
        self.assertEqual(len(order), len(set(order)))

    def test_blank_and_whitespace_ignored(self):
        self.assertEqual(model_candidates("", "  "), DEFAULT_CANDIDATES)


class IsModelNotFound(unittest.TestCase):
    def test_recognises_retirement_shapes(self):
        # Real shapes seen from the Gemini API when a model is gone.
        for msg in [
            "404 models/gemini-1.5-flash is not found for API version v1beta",
            "NOT_FOUND: model does not exist",
            "models/gemini-1.5-flash has been deprecated",
            "model gemini-1.5-flash is not supported for generateContent",
        ]:
            self.assertTrue(is_model_not_found(msg), msg)

    def test_real_failures_are_not_retryable(self):
        for msg in [
            "429 Resource has been exhausted",
            "safety settings blocked this response",
            "deadline exceeded",
            "",
            None,
        ]:
            self.assertFalse(is_model_not_found(msg), repr(msg))


class ShouldTryNextModel(unittest.TestCase):
    def test_retirement_and_quota_advance_the_chain(self):
        from ai_models import should_try_next_model
        # Quota is the non-obvious one: Gemini quotas are per model, so a key
        # with zero quota for the newest model may still have plenty for an
        # older one — seen in production as a 429 on the first call ever made.
        self.assertTrue(should_try_next_model("404 model is not found"))
        self.assertTrue(should_try_next_model("429 You exceeded your current quota"))

    def test_account_and_content_failures_fail_fast(self):
        from ai_models import should_try_next_model
        # These are account- or content-wide; other models fail identically.
        for msg in [
            "API key not valid. Please pass a valid API key.",
            "403 permission denied",
            "response blocked by safety settings",
            "deadline exceeded",
        ]:
            self.assertFalse(should_try_next_model(msg), msg)


if __name__ == "__main__":
    unittest.main()


class SummarizeAiError(unittest.TestCase):
    def test_categorises_the_failures_an_operator_must_tell_apart(self):
        from ai_models import summarize_ai_error
        cases = [
            ("404 models/gemini-1.5-flash is not found", "model_not_found"),
            ("API key not valid. Please pass a valid API key.", "invalid_api_key"),
            ("403 permission denied on resource project", "permission_denied"),
            ("429 Resource has been exhausted", "quota_exhausted"),
            ("response blocked by safety settings", "blocked_by_safety"),
            ("Deadline exceeded while waiting", "network_error"),
            ("", "none"),
            (None, "none"),
            ("something entirely novel", "error"),
        ]
        for raw, expected in cases:
            self.assertEqual(summarize_ai_error(raw), expected, repr(raw))

    def test_classifies_the_google_genai_error_format(self):
        """The strings google-genai actually raises.

        Classification is done on error text, so swapping SDKs could have
        silently broken it — a NOT_FOUND that stopped reading as
        model_not_found would end the fallback chain and take every AI feature
        down with the first retired model. These are real
        `google.genai.errors.APIError` renderings, captured from the installed
        SDK; they are literals here so Backend CI covers them without needing
        the package.
        """
        from ai_models import summarize_ai_error, should_try_next_model
        cases = [
            ("404 NOT_FOUND. {'error': {'code': 404, 'status': 'NOT_FOUND', "
             "'message': 'models/gemini-1.5-flash is not found'}}", "model_not_found"),
            ("429 RESOURCE_EXHAUSTED. {'error': {'code': 429, 'status': "
             "'RESOURCE_EXHAUSTED', 'message': 'You exceeded your current quota'}}",
             "quota_exhausted"),
            ("403 PERMISSION_DENIED. {'error': {'code': 403, 'status': "
             "'PERMISSION_DENIED', 'message': 'denied'}}", "permission_denied"),
            ("400 INVALID_ARGUMENT. {'error': {'code': 400, 'status': "
             "'INVALID_ARGUMENT', 'message': 'API key not valid. Please pass a "
             "valid API key.'}}", "invalid_api_key"),
        ]
        for raw, expected in cases:
            self.assertEqual(summarize_ai_error(raw), expected, raw[:40])

        # And the two that must keep walking the candidate list still do.
        self.assertTrue(should_try_next_model(cases[0][0]))
        self.assertTrue(should_try_next_model(cases[1][0]))
        self.assertFalse(should_try_next_model(cases[2][0]))

    def test_never_echoes_the_input(self):
        # The whole point: whatever the exception says, it must not come back.
        from ai_models import summarize_ai_error
        secret = "Traceback: /app/secret_path/server.py line 42, key=AIzaSyFAKE"
        self.assertNotIn("AIza", summarize_ai_error(secret))
        self.assertLess(len(summarize_ai_error(secret)), 30)
