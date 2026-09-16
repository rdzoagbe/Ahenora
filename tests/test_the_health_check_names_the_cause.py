"""503 said "unreachable" whatever went wrong, and it cost an afternoon.

2026-09-16: a rotated Atlas password left /health answering
`{"status": "error", "database": "unreachable"}` for four hours. That word
was a catch-all around every exception, so it was equally true of:

  * a wrong password (fix: the credential in Railway),
  * a user without rights on the database (fix: the grant in Atlas),
  * an IP access list that no longer admits Railway (fix: the access list),
  * a cluster that is merely slow (fix: nothing, wait),
  * a network that is genuinely down (fix: nothing, wait).

Five causes, five different fixes, one word between them. The afternoon went
on a guess — code was reverted on a hunch before the log was read, and the log
named the cause immediately. Same failure as the scheduler read-out next door:
an instrument reporting the same thing in every case is not an instrument.

The rule these hold: the answer must distinguish being REFUSED from being
IGNORED, and it must never name a host, a user or a credential.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    from pymongo.errors import (AutoReconnect, NetworkTimeout, OperationFailure,
                                ServerSelectionTimeoutError)
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server


class FailingDB:
    def __init__(self, exc):
        self.exc = exc

    async def command(self, _name):
        raise self.exc


@unittest.skipUnless(HAVE_DEPS, "fastapi/pymongo not installed")
class TheHealthCheckSaysWhichFailureItHit(unittest.TestCase):

    def answer(self, exc):
        original = server.db
        server.db = FailingDB(exc)
        try:
            response = asyncio.run(server.health())
        finally:
            server.db = original
        self.assertEqual(response.status_code, 503)
        return json.loads(response.body.decode())

    def test_a_wrong_password_is_reported_as_auth(self):
        """AuthenticationFailed, code 18 — exactly this afternoon's failure."""
        body = self.answer(OperationFailure("Authentication failed.", 18))
        self.assertEqual(body["database"], "auth")

    def test_a_user_without_rights_is_reported_as_auth(self):
        """Unauthorized, code 13. The restore drill will hit this the moment
        the app runs as ahenora_app: readWrite on household_coo cannot create
        or drop a drill database."""
        body = self.answer(OperationFailure("not authorized", 13))
        self.assertEqual(body["database"], "auth")

    def test_an_access_list_that_no_longer_admits_us_is_a_timeout(self):
        """Atlas does not refuse a blocked IP, it ignores it: the driver spins
        until server selection gives up. Indistinguishable from a wrong
        password under the old catch-all, and a completely different fix."""
        body = self.answer(ServerSelectionTimeoutError("no servers"))
        self.assertEqual(body["database"], "timeout")

    def test_our_own_five_second_ceiling_is_a_timeout(self):
        """asyncio.wait_for fires before the driver's own selection timeout,
        so this is the shape the caller most often sees."""
        body = self.answer(asyncio.TimeoutError())
        self.assertEqual(body["database"], "timeout")

    def test_a_slow_cluster_is_a_timeout_not_a_credential_problem(self):
        body = self.answer(NetworkTimeout("socket timed out"))
        self.assertEqual(body["database"], "timeout")

    def test_a_dropped_connection_is_still_unreachable(self):
        body = self.answer(AutoReconnect("connection closed"))
        self.assertEqual(body["database"], "unreachable")

    def test_anything_else_is_named_rather_than_guessed_at(self):
        body = self.answer(ValueError("something nobody predicted"))
        self.assertEqual(body["database"], "error")
        self.assertEqual(body["detail"], "ValueError")

    def test_refused_and_ignored_do_not_share_a_word(self):
        """The whole point, asserted as one thing so it cannot be half-kept."""
        refused = self.answer(OperationFailure("Authentication failed.", 18))
        ignored = self.answer(ServerSelectionTimeoutError("no servers"))
        self.assertNotEqual(refused["database"], ignored["database"])

    def test_the_answer_never_carries_the_connection_string(self):
        """A 503 body is public: no monitor, no screenshot and no support
        thread may ever be handed a host, a user or a password by it. The
        exception's own message is exactly where those leak from, so the body
        carries a category and a type name and nothing the driver wrote."""
        leaky = OperationFailure(
            "Authentication failed on mongodb+srv://someone:hunter2@cluster0."
            "abcde.mongodb.net/household_coo", 18)
        body = self.answer(leaky)
        served = json.dumps(body)
        for secret in ("hunter2", "someone", "mongodb+srv", "cluster0",
                       "mongodb.net", "household_coo"):
            self.assertNotIn(secret, served,
                             f"the 503 body leaked {secret!r}")

    def test_an_unconfigured_database_is_still_its_own_answer(self):
        original = server.db
        server.db = None
        try:
            response = asyncio.run(server.health())
        finally:
            server.db = original
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.body.decode())["database"],
                         "unconfigured")


@unittest.skipUnless(HAVE_DEPS, "fastapi/pymongo not installed")
class TheLogLineDoesNotCarryThePassword(unittest.TestCase):
    """Railway's log is read on a screen, screenshotted and pasted into chat —
    a MONGO_URL was exposed exactly that way this morning. A driver message
    can carry the whole connection string, so the credentials come out of it
    before it is written anywhere.
    """

    def test_a_connection_string_loses_its_credentials(self):
        cleaned = server._without_credentials(
            "Authentication failed on mongodb+srv://ahenora_app:hunter2@"
            "cluster0.abcde.mongodb.net/household_coo")
        self.assertNotIn("hunter2", cleaned)
        self.assertNotIn("ahenora_app", cleaned)
        # The host survives, because that is the half worth reading.
        self.assertIn("cluster0.abcde.mongodb.net", cleaned)

    def test_a_password_full_of_uri_punctuation_still_goes(self):
        """Atlas autogenerates passwords containing @ / : # %, which is what
        makes them awkward in a URI in the first place."""
        cleaned = server._without_credentials(
            "mongodb://user:p%40ss%2Fw%23rd@host:27017/db timed out")
        self.assertNotIn("p%40ss", cleaned)
        self.assertIn("host:27017", cleaned)

    def test_an_ordinary_message_is_left_alone(self):
        plain = "Authentication failed."
        self.assertEqual(server._without_credentials(plain), plain)
