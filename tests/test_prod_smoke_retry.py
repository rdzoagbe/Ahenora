"""The production smoke check must survive a deploy, and never hide a real fault.

Every merge to main redeploys the Railway backend, even a frontend-only one.
During the swap the edge answers 502/503/504 or refuses the connection, and the
check kept reporting that as a production failure: whole journey green, then a
bare 502 on the last call.

The line these tests hold: a GATEWAY answer is the deploy, and is retried. An
answer from the APPLICATION is the product, and is reported as-is.
"""
import io
import os
import sys
import types
import unittest
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

import prod_smoke  # noqa: E402


class _Res:
    def __init__(self, status=200, body=b'{"ok": true}'):
        self.status = status
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _http_error(code, body=b'{"detail": "nope"}'):
    return urllib.error.HTTPError("u", code, "err", {}, io.BytesIO(body))


class SmokeRetry(unittest.TestCase):
    def setUp(self):
        self._urlopen = prod_smoke.urllib.request.urlopen
        self._sleep = prod_smoke.time.sleep
        prod_smoke.time.sleep = lambda *_: None  # no real waiting in tests

    def tearDown(self):
        prod_smoke.urllib.request.urlopen = self._urlopen
        prod_smoke.time.sleep = self._sleep

    def _serve(self, sequence):
        """Answer each call with the next item; raise it if it is an exception."""
        seq = list(sequence)
        calls = {"n": 0}

        def fake(req, timeout=None):
            calls["n"] += 1
            item = seq.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        prod_smoke.urllib.request.urlopen = fake
        return calls

    def test_a_502_during_cutover_is_retried_and_then_succeeds(self):
        calls = self._serve([_http_error(502), _http_error(502), _Res(200, b'{"ok": true}')])
        status, body = prod_smoke.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True})
        self.assertEqual(calls["n"], 3)

    def test_a_call_that_declares_itself_safe_is_retried_even_though_it_posts(self):
        """Cleanup deletes; doing it twice is doing it once."""
        calls = self._serve([_http_error(502), _Res(200, b'{"ok": true}')])
        status, _ = prod_smoke.call("POST", "/auth/smoke-cleanup", retry_safe=True)
        self.assertEqual(status, 200)
        self.assertEqual(calls["n"], 2)

    def test_a_refused_connection_is_retried_too(self):
        """The old container going away. Previously uncaught, so a restart
        mid-journey ended the run in a traceback instead of a readable line."""
        calls = self._serve([urllib.error.URLError("connection refused"), _Res(200)])
        status, _ = prod_smoke.call("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(calls["n"], 2)

    def test_a_persistent_gateway_failure_still_fails(self):
        """Retrying must not turn a genuine outage green."""
        self._serve([_http_error(502)] * 9)
        status, body = prod_smoke.call("GET", "/health")
        self.assertEqual(status, 502)
        self.assertIn("detail", body)

    def test_a_persistent_connection_failure_reports_instead_of_raising(self):
        self._serve([urllib.error.URLError("boom")] * 9)
        status, body = prod_smoke.call("GET", "/health")
        self.assertEqual(status, 0)
        self.assertIn("connection failed", body["detail"])

    def test_an_application_500_is_reported_immediately(self):
        """A 500 is OUR bug. Retrying it would hide the thing this check exists
        to catch, so it must come back on the first answer."""
        calls = self._serve([_http_error(500, b'{"detail": "Join failed"}')])
        status, body = prod_smoke.call("POST", "/family/invite/accept")
        self.assertEqual(status, 500)
        self.assertEqual(body["detail"], "Join failed")
        self.assertEqual(calls["n"], 1)

    def test_a_4xx_is_reported_immediately(self):
        for code in (400, 401, 403, 404, 409, 410):
            with self.subTest(code=code):
                calls = self._serve([_http_error(code)])
                status, _ = prod_smoke.call("GET", "/x")
                self.assertEqual(status, code)
                self.assertEqual(calls["n"], 1)



class SmokeRetryIsNotBlind(unittest.TestCase):
    """A retry is only free when the call can be made twice.

    The version before this one retried every gateway answer on every method.
    A 502 is the edge reporting that it DID reach a container and got a bad
    answer back — the register or the invite-accept may already have run. So
    the retry could register the invitee twice, or accept an invitation twice,
    and the check would then report a failure that it had caused itself.
    """

    def setUp(self):
        self._urlopen = prod_smoke.urllib.request.urlopen
        self._sleep = prod_smoke.time.sleep
        prod_smoke.time.sleep = lambda *_: None

    def tearDown(self):
        prod_smoke.urllib.request.urlopen = self._urlopen
        prod_smoke.time.sleep = self._sleep

    def _serve(self, sequence):
        seq = list(sequence)
        calls = {"n": 0}

        def fake(req, timeout=None):
            calls["n"] += 1
            item = seq.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        prod_smoke.urllib.request.urlopen = fake
        return calls

    def test_a_post_is_not_repeated_after_a_502(self):
        calls = self._serve([_http_error(502), _Res(200)])
        status, _ = prod_smoke.call("POST", "/auth/register", {"email": "a@b.c"})
        self.assertEqual(status, 502)
        self.assertEqual(calls["n"], 1)

    def test_a_post_is_not_repeated_after_a_504(self):
        """A timeout is the worst case of all: the work very likely happened."""
        calls = self._serve([_http_error(504), _Res(200)])
        status, _ = prod_smoke.call("POST", "/family/invite/accept", {"token": "t"})
        self.assertEqual(status, 504)
        self.assertEqual(calls["n"], 1)

    def test_a_post_is_repeated_after_a_503_because_nothing_was_listening(self):
        """The edge with no container behind it. The request never arrived, so
        sending it again cannot duplicate anything — and this is the common
        shape of a Railway cutover, so it is worth keeping."""
        calls = self._serve([_http_error(503), _Res(200, b'{"ok": true}')])
        status, _ = prod_smoke.call("POST", "/family/invite", {"email": "a@b.c"})
        self.assertEqual(status, 200)
        self.assertEqual(calls["n"], 2)

    def test_a_post_is_repeated_when_the_connection_was_refused(self):
        calls = self._serve([
            urllib.error.URLError(ConnectionRefusedError(111, "Connection refused")),
            _Res(200),
        ])
        status, _ = prod_smoke.call("POST", "/family/invite", {"email": "a@b.c"})
        self.assertEqual(status, 200)
        self.assertEqual(calls["n"], 2)

    def test_a_post_is_not_repeated_when_the_connection_broke_mid_call(self):
        """A reset means the socket was open — the request went out."""
        calls = self._serve([urllib.error.URLError("Connection reset by peer"), _Res(200)])
        status, body = prod_smoke.call("POST", "/auth/register", {"email": "a@b.c"})
        self.assertEqual(status, 0)
        self.assertIn("mid-call", body["detail"])
        self.assertEqual(calls["n"], 1)

    def test_a_get_is_still_retried_on_anything_gateway_shaped(self):
        for item in (_http_error(502), _http_error(504),
                     urllib.error.URLError("Connection reset by peer")):
            with self.subTest(item=item):
                calls = self._serve([item, _Res(200)])
                status, _ = prod_smoke.call("GET", "/health")
                self.assertEqual(status, 200)
                self.assertEqual(calls["n"], 2)


if __name__ == "__main__":
    unittest.main()
