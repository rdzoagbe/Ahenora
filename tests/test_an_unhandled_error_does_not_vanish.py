"""An unhandled error has to leave a trace something can look at.

Before this, an exception nobody planned for returned a bare 500 and left a
stack trace in the platform's stdout — which ages out, cannot be searched, and
which nobody reads unless they already know something is wrong. So the way the
app's owner found out it was broken was a user writing in, and the quiet
failures that nobody bothers to report were never found at all.

The two things this has to get right, and they pull against each other:

**Group, or it is noise.** One bug hit a thousand times must be one row with a
count. A tracker that reports a thousand lines gets muted, and a muted alert is
worse than none — it is an alert everyone believes is working.

**Record nothing personal.** This app holds children's names, medical records
and documents. An error store is the classic place they leak, because it is the
one collection nobody thinks of as containing personal data, so it is the one
nobody protects. No bodies, no query strings, no headers, no user ids, and the
route TEMPLATE rather than the path — "/api/cards/{card_id}", never
"/api/cards/the-real-id".

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server

from fake_mongo import FakeDatabase  # noqa: E402


class FakeRequest:
    """Just enough of a Starlette request for the recorder."""

    def __init__(self, path="/api/cards/abc123", template="/api/cards/{card_id}",
                 method="GET"):
        route = type("R", (), {"path": template})() if template else None
        self.scope = {"route": route}
        self.method = method
        self.url = type("U", (), {"path": path})()


def boom(kind=ValueError, message="nope"):
    """A raised-and-caught exception, so it carries a real traceback."""
    try:
        raise kind(message)
    except Exception as exc:      # noqa: BLE001 — we want the object
        return exc


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Grouping(unittest.TestCase):

    def test_the_same_bug_twice_is_one_group(self):
        request = FakeRequest()
        first = server.error_fingerprint(boom(), server.route_template(request))
        second = server.error_fingerprint(boom(), server.route_template(request))
        self.assertEqual(first, second)

    def test_a_different_exception_type_is_a_different_group(self):
        request = FakeRequest()
        route = server.route_template(request)
        self.assertNotEqual(
            server.error_fingerprint(boom(ValueError), route),
            server.error_fingerprint(boom(KeyError), route))

    def test_the_same_exception_on_a_different_route_is_a_different_group(self):
        self.assertNotEqual(
            server.error_fingerprint(boom(), "/api/cards/{card_id}"),
            server.error_fingerprint(boom(), "/api/vault/{doc_id}"))

    def test_a_fingerprint_is_short_enough_to_paste_into_a_bug_report(self):
        ref = server.error_fingerprint(boom(), "/api/cards")
        self.assertEqual(len(ref), 16)
        self.assertTrue(ref.isalnum())


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatIsRecorded(unittest.TestCase):

    def setUp(self):
        self._get_db = server.get_db
        self.db = FakeDatabase()
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def _record(self, request=None, exc=None):
        return asyncio.run(server.record_error(exc or boom(), request or FakeRequest()))

    def _rows(self):
        return asyncio.run(self.db[server.ERROR_LOG].find({}).to_list(None))

    def test_an_error_is_written_once_with_a_count(self):
        ref = self._record()
        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["_id"], ref)
        self.assertEqual(rows[0]["count"], 1)
        self.assertEqual(rows[0]["kind"], "ValueError")

    def test_the_same_error_again_increments_rather_than_duplicates(self):
        self._record()
        self._record()
        self._record()
        rows = self._rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["count"], 3)

    def test_the_route_template_is_stored_and_the_real_path_is_not(self):
        """The single most important line in this file.

        "/api/cards/abc123" carries an id belonging to a household. The
        template does not, and it groups better.
        """
        self._record(FakeRequest(path="/api/cards/abc123",
                                 template="/api/cards/{card_id}"))
        row = self._rows()[0]
        self.assertEqual(row["route"], "/api/cards/{card_id}")
        self.assertNotIn("abc123", repr(row))

    def test_nothing_personal_is_stored_anywhere_in_the_row(self):
        # Belt and braces: whatever else changes, these must never appear.
        self._record(FakeRequest(path="/api/family/members/member-7"),
                     exc=boom(ValueError, "email=ama@example.test token=abc.def.ghi"))
        blob = repr(self._rows()[0])
        for leak in ("ama@example.test", "abc.def.ghi", "member-7", "Authorization"):
            self.assertNotIn(leak, blob, f"{leak!r} reached the error store")

    def test_the_exception_message_is_not_stored(self):
        """A message is the easiest place for personal data to ride along —
        "no such member: Ama Dzoagbé" is a perfectly ordinary thing to raise.
        The type, route and code location identify the bug well enough."""
        self._record(exc=boom(ValueError, "no such child: Ama"))
        self.assertNotIn("Ama", repr(self._rows()[0]))

    def test_where_it_happened_is_our_code_not_the_library_stack(self):
        row = self._record() and self._rows()[0]
        self.assertTrue(row["where"], "no code location recorded at all")
        for frame in row["where"]:
            self.assertNotIn("site-packages", frame)

    def test_recording_survives_a_database_that_is_down(self):
        """The error path must not be able to create a worse error.

        If the database is what broke, every request now raises — and a
        recorder that raises too would turn a 500 into an unhandled loop.
        """
        def dead():
            raise RuntimeError("no database")
        server.get_db = dead
        ref = self._record()          # must not raise
        self.assertEqual(len(ref), 16)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheAlertEndpoint(unittest.TestCase):
    """Token-authenticated, because the caller is a scheduled job with no
    account — the same shape as the billing webhooks."""

    def setUp(self):
        self._get_db = server.get_db
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        self._token = os.environ.get("OPS_ALERT_TOKEN")
        os.environ["OPS_ALERT_TOKEN"] = "a-long-random-string"

    def tearDown(self):
        server.get_db = self._get_db
        if self._token is None:
            os.environ.pop("OPS_ALERT_TOKEN", None)
        else:
            os.environ["OPS_ALERT_TOKEN"] = self._token

    def _ask(self, authorization="a-long-random-string", minutes=60):
        return asyncio.run(server.ops_error_budget(
            authorization=authorization, minutes=minutes))

    def test_a_quiet_hour_reports_nothing(self):
        self.assertEqual(self._ask(), {"window_minutes": 60, "groups": 0, "occurrences": 0})

    def test_it_counts_groups_and_occurrences_separately(self):
        # One bug seen twice and another seen once: two groups, three hits.
        asyncio.run(server.record_error(boom(ValueError), FakeRequest()))
        asyncio.run(server.record_error(boom(ValueError), FakeRequest()))
        asyncio.run(server.record_error(boom(KeyError), FakeRequest()))
        answer = self._ask()
        self.assertEqual(answer["groups"], 2)
        self.assertEqual(answer["occurrences"], 3)

    def test_a_wrong_token_is_refused(self):
        with self.assertRaises(server.HTTPException) as caught:
            self._ask(authorization="wrong")
        self.assertEqual(caught.exception.status_code, 403)

    def test_a_missing_header_is_refused(self):
        with self.assertRaises(server.HTTPException) as caught:
            self._ask(authorization=None)
        self.assertEqual(caught.exception.status_code, 403)

    def test_it_refuses_rather_than_opening_up_when_the_token_is_unset(self):
        """Fail CLOSED. An unset secret must never mean "no auth required" —
        that is how a misconfigured deploy quietly publishes an endpoint."""
        os.environ.pop("OPS_ALERT_TOKEN", None)
        with self.assertRaises(server.HTTPException) as caught:
            self._ask(authorization="anything")
        self.assertEqual(caught.exception.status_code, 503)

    def test_it_answers_with_counts_only(self):
        """A stranger who guessed both the URL and the token should learn
        whether something is broken, not what or where."""
        asyncio.run(server.record_error(boom(), FakeRequest()))
        self.assertEqual(set(self._ask()), {"window_minutes", "groups", "occurrences"})


class TheAlertIsWiredToAHuman(unittest.TestCase):
    """A tracker nobody is told about is a database, not an alert."""

    def workflow(self):
        with open(os.path.join(ROOT, ".github", "workflows", "error-watch.yml"),
                  encoding="utf-8") as handle:
            return handle.read()

    def test_it_runs_on_a_schedule_rather_than_only_on_demand(self):
        self.assertIn("schedule:", self.workflow())
        self.assertIn("cron:", self.workflow())

    def test_it_fails_the_job_when_something_threw(self):
        # Failing the job IS the alert: GitHub emails the owner. A job that
        # printed a warning and passed would notify nobody.
        self.assertIn("exit 1", self.workflow())

    def test_an_unreachable_backend_also_raises_the_alarm(self):
        # Either the app is down or the alert is broken. Both need a person,
        # and a watcher that goes quiet when it cannot see is the worst case.
        self.assertIn("Could not reach", self.workflow())

    def test_it_skips_rather_than_failing_when_it_is_not_set_up_yet(self):
        """A half-finished setup that fails hourly gets muted, and a muted
        alert is worse than none — everybody believes it is still working."""
        text = self.workflow()
        self.assertIn("skipping", text)
        self.assertIn("exit 0", text)


if __name__ == "__main__":
    unittest.main()
