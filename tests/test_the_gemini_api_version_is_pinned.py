"""The Gemini API version is the app's choice, not the SDK's default.

google-genai 3.0 (changelog, 2026-11-06) moved the Gemini Developer API
default from v1beta to v1. The scans (shopping list, receipts, recipes,
documents, voice) are built and tested against v1beta: the models they fall
back through and the Files API the voice path uploads to. Before the upgrade
the default happened to be v1beta; this holds it there on purpose, so a
library upgrade cannot quietly change which API every scan talks to.

Checked on 2026-11-12 by sending the scans' exact calls through 2.34.0 and
3.2.0 to a local stand-in for Google: with this pin the five requests were
identical; without it, 3.2.0 sent all five to /v1.

Run with:  python3 -m unittest discover -s tests -v
"""
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
    import server


@unittest.skipUnless(HAVE_DEPS and getattr(server, "genai", None), "google-genai not installed")
class TheApiVersionIsPinned(unittest.TestCase):
    def setUp(self):
        self._client = server._gemini_state["client"]
        self._key = server.GOOGLE_API_KEY
        self._cls = server.genai.Client
        server._gemini_state["client"] = None
        server.GOOGLE_API_KEY = "test-key"
        self.built = []
        test = self

        class Spy:
            def __init__(self, **kwargs):
                test.built.append(kwargs)
        server.genai.Client = Spy

    def tearDown(self):
        server._gemini_state["client"] = self._client
        server.GOOGLE_API_KEY = self._key
        server.genai.Client = self._cls

    def test_the_client_names_v1beta(self):
        server._gemini_client()
        (kwargs,) = self.built
        self.assertEqual(kwargs["api_key"], "test-key")
        self.assertEqual(kwargs["http_options"].api_version, "v1beta")
        self.assertEqual(server.GEMINI_API_VERSION, "v1beta")

    def test_the_sdk_is_the_major_version_it_was_checked_on(self):
        # A new major moves defaults; it gets the same request comparison
        # before it is let in.
        req = open(os.path.join(os.path.dirname(__file__), "..", "backend",
                                "requirements.txt")).read()
        self.assertIn("google-genai>=3.0.0,<4", req)


if __name__ == "__main__":
    unittest.main()
