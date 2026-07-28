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
    def test_defaults_run_newest_first(self):
        self.assertEqual(model_candidates(), DEFAULT_CANDIDATES)
        self.assertEqual(DEFAULT_CANDIDATES[0], "gemini-2.5-flash")

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
        # Falling through to another model must not happen for quota, safety
        # or network errors — that would triple the pain for no benefit.
        for msg in [
            "429 Resource has been exhausted",
            "quota exceeded for quota metric",
            "safety settings blocked this response",
            "deadline exceeded",
            "connection reset by peer",
            "",
            None,
        ]:
            self.assertFalse(is_model_not_found(msg), repr(msg))


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

    def test_never_echoes_the_input(self):
        # The whole point: whatever the exception says, it must not come back.
        from ai_models import summarize_ai_error
        secret = "Traceback: /app/secret_path/server.py line 42, key=AIzaSyFAKE"
        self.assertNotIn("AIza", summarize_ai_error(secret))
        self.assertLess(len(summarize_ai_error(secret)), 30)
