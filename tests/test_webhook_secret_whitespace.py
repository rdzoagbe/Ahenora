"""A trailing newline on a webhook secret must not look like a wrong secret.

The RevenueCat webhook stripped the incoming Authorization header but NOT the
environment variable it compared against. A value stored as "abc123\\n" — which
is what a paste into a dashboard field routinely produces, and which no
dashboard renders visibly — therefore never matched "abc123", and every event
came back 401 "Bad webhook signature".

That is the worst way for a whitespace bug to present: it is indistinguishable
from having the wrong secret, so the obvious response is to re-copy the value,
which cannot fix it. It cost real subscriptions — purchases reached nobody and
were reconciled hours later by the sweep instead.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase

SECRET = "s3cr3t-webhook-value"


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheSecretComparison(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._env = os.environ.get("RC_WEBHOOK_SECRET")

    def tearDown(self):
        server.get_db = self._get_db
        if self._env is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._env

    def deliver(self, stored, sent):
        os.environ["RC_WEBHOOK_SECRET"] = stored
        payload = {"event": {"type": "TEST", "app_user_id": "nobody"}}
        return asyncio.run(server.revenuecat_webhook(payload, authorization=sent))

    def refused(self, stored, sent):
        with self.assertRaises(server.HTTPException) as caught:
            self.deliver(stored, sent)
        return caught.exception.status_code

    def test_the_plain_matching_case_still_works(self):
        self.assertTrue(self.deliver(SECRET, SECRET))

    def test_a_trailing_newline_on_the_stored_secret_is_tolerated(self):
        """The actual bug: invisible in every dashboard, and it looks exactly
        like a wrong secret, so re-copying the value can never fix it."""
        self.assertTrue(self.deliver(SECRET + "\n", SECRET))

    def test_so_is_trailing_whitespace_on_either_side(self):
        self.assertTrue(self.deliver(SECRET + "  ", SECRET))
        self.assertTrue(self.deliver(SECRET, SECRET + "\n"))

    def test_a_bearer_prefix_with_padding_still_resolves(self):
        self.assertTrue(self.deliver(SECRET, f"Bearer  {SECRET} "))

    def test_but_a_genuinely_wrong_secret_is_still_refused(self):
        """Tolerating whitespace must not tolerate anything else."""
        self.assertEqual(self.refused(SECRET, "not-the-secret"), 401)

    def test_and_a_secret_that_differs_inside_is_still_refused(self):
        self.assertEqual(self.refused(SECRET, "s3cr3t-webhook-valu3"), 401)

    def test_an_unset_secret_is_503_not_401(self):
        """Different cause, different code — 401 would send someone hunting for
        a mismatch that does not exist."""
        self.assertEqual(self.refused("   ", SECRET), 503)


if __name__ == "__main__":
    unittest.main(verbosity=2)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class MismatchLoggingIsBounded(unittest.TestCase):
    """The diagnostic line is reachable by anyone who can send a POST.

    The RevenueCat webhook takes unauthenticated requests, and its mismatch
    branch logs the LIVE secret's length and SHA-256 prefix. That is the right
    thing to log once while debugging a misconfiguration and the wrong thing to
    let a stranger replay indefinitely: it is both a lever on log volume and an
    endlessly repeated hint about a secret we hold.
    """

    def setUp(self):
        self._secret = os.environ.get("RC_WEBHOOK_SECRET")
        os.environ["RC_WEBHOOK_SECRET"] = "the-real-secret"
        server._rc_mismatch_log["count"] = 0
        server._rc_mismatch_log["window_started"] = None

    def tearDown(self):
        if self._secret is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._secret
        server._rc_mismatch_log["count"] = 0
        server._rc_mismatch_log["window_started"] = None

    def _attempt(self):
        with self.assertRaises(server.HTTPException) as caught:
            asyncio.run(server.revenuecat_webhook(
                payload={"event": {"type": "TEST"}},
                authorization="Bearer wrong"))
        return caught.exception.status_code

    def test_every_attempt_is_still_rejected(self):
        # Rate limiting the LOG must never rate limit the AUTH: a flood must
        # not become a way to slip a request through.
        for _ in range(40):
            self.assertEqual(self._attempt(), 401)

    def test_the_fingerprint_stops_being_printed_after_a_few_attempts(self):
        import logging
        records = []

        class Capture(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage())

        handler = Capture()
        server.log.addHandler(handler)
        try:
            for _ in range(40):
                self._attempt()
        finally:
            server.log.removeHandler(handler)

        detailed = [r for r in records if "expected_sha" in r]
        self.assertGreater(len(detailed), 0, "no diagnostics at all is too far")
        self.assertLessEqual(
            len(detailed), 10,
            "the live secret's fingerprint was printed %d times by an "
            "unauthenticated caller" % len(detailed))
