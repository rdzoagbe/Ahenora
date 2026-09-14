"""A device error that does not name its build cannot be acted on.

On 2026-09-14 the admin panel showed three Android phones failing to register
for push, the most recent that afternoon, and it read as a live outage. It was
not one. The Firebase config had been correct since 09-08, a push-capable
binary had been on the Play Store since 09-12, and every one of those phones
was simply running an older APK. One of the rows was stamped 08:03 on the very
morning the fix shipped at 08:40 — it predated its own fix by thirty-seven
minutes, and nothing on the screen said so.

The log had everything except the one field that decides what to do. An error
from a stale build needs a user to update; the identical error on current code
needs an engineer. Without the version they are the same row.

So every report carries the build that made it. The absence of one is itself
information — an install too old to send the field, which is served as ""
and shown as "unknown build" rather than as an empty column a reader's eye
slides over as though it were current.

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

USER = {"user_id": "u1", "family_id": "fam_1", "name": "Stéphanie", "email": "s@b.test"}
ADMIN = {"user_id": "u9", "family_id": "fam_1", "name": "Roland", "email": "admin@b.test"}


def run(coro):
    return asyncio.run(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatAReportCarries(unittest.TestCase):

    def setUp(self):
        self._get_db = server.get_db
        self._is_admin = server.is_admin_user
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        server.is_admin_user = lambda u: u.get("email") == "admin@b.test"

    def tearDown(self):
        server.get_db = self._get_db
        server.is_admin_user = self._is_admin

    def report(self, **kwargs):
        kwargs.setdefault("endpoint", "/push-register")
        kwargs.setdefault("method", "PUSH")
        kwargs.setdefault("message", "Unable to get Firebase Messaging instance.")
        kwargs.setdefault("platform", "android")
        return run(server.report_client_error(
            server.ClientErrorIn(**kwargs), user=USER))

    def rows(self):
        return run(server.list_client_errors(user=ADMIN))

    def test_the_build_is_recorded(self):
        self.report(app_version="1.1.0", runtime_version="2.0.0")
        row = self.rows()[0]
        self.assertEqual(row["app_version"], "1.1.0")
        self.assertEqual(row["runtime_version"], "2.0.0")

    def test_an_install_too_old_to_say_is_recorded_as_unknown_not_blank(self):
        """The absence IS the answer — it means a build old enough to predate
        the field, which is exactly the case this exists to make visible."""
        self.report()
        row = self.rows()[0]
        self.assertEqual(row["app_version"], "")
        self.assertEqual(row["runtime_version"], "")

    def test_a_row_written_before_the_field_existed_still_reads(self):
        # The two weeks of history already in the collection must not break
        # the screen that is now expected to show a version.
        run(self.db["client_errors"].insert_one({
            "error_id": "cerr_old", "user_id": "u1", "family_id": "fam_1",
            "name": "Stéphanie", "endpoint": "/push-register", "method": "PUSH",
            "message": "old row", "platform": "android",
            "created_at": server.utcnow(),
        }))
        row = self.rows()[0]
        self.assertEqual(row["app_version"], "")
        self.assertIn("message", row)

    def test_the_version_is_bounded_like_every_other_field(self):
        # It arrives from a device and is therefore untrusted input.
        self.report(app_version="9" * 200, runtime_version="8" * 200)
        row = self.rows()[0]
        self.assertLessEqual(len(row["app_version"]), 32)
        self.assertLessEqual(len(row["runtime_version"]), 32)

    def test_the_rest_of_the_report_is_unchanged(self):
        self.report(app_version="1.1.0", status=500)
        row = self.rows()[0]
        self.assertEqual(row["endpoint"], "/push-register")
        self.assertEqual(row["platform"], "android")
        self.assertEqual(row["status"], 500)
        self.assertEqual(row["name"], "Stéphanie")

    def test_only_an_admin_can_read_the_log(self):
        self.report()
        with self.assertRaises(server.HTTPException) as caught:
            run(server.list_client_errors(user=USER))
        self.assertEqual(caught.exception.status_code, 403)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheFieldIsOptionalOnPurpose(unittest.TestCase):
    """Every phone already out there is an old client by definition.

    A required field would make the whole report fail on exactly the installs
    whose age is the thing worth knowing — the log would go quiet about
    precisely the population it needs to describe.
    """

    def test_the_model_accepts_a_report_without_a_version(self):
        payload = server.ClientErrorIn(endpoint="/push-register")
        self.assertIsNone(payload.app_version)
        self.assertIsNone(payload.runtime_version)


class TheAdminScreenShowsIt(unittest.TestCase):
    """A field recorded and never displayed is a field nobody uses."""

    def settings(self):
        with open(os.path.join(ROOT, "frontend", "app", "(tabs)", "settings.tsx"),
                  encoding="utf-8") as handle:
            return handle.read()

    def test_the_build_is_on_the_row(self):
        self.assertIn("e.app_version", self.settings())

    def test_a_missing_build_reads_as_unknown_rather_than_empty(self):
        # An empty gap between two separators is a column the eye slides over
        # as though it were current.
        self.assertIn("'unknown build'", self.settings())

    def test_it_sits_on_the_first_line_beside_the_platform(self):
        """It decides whether the row needs acting on at all, so it belongs
        where the reader is already looking, not in the message below."""
        text = self.settings()
        first_line = text[text.index("{`${e.name || '?'}"):]
        self.assertLess(first_line.index("e.app_version"), first_line.index("</Text>"))


class TheClientSendsIt(unittest.TestCase):

    def api(self):
        with open(os.path.join(ROOT, "frontend", "src", "api.ts"),
                  encoding="utf-8") as handle:
            return handle.read()

    def test_the_stamp_goes_out_with_every_report(self):
        self.assertIn("buildStamp", self.api())
        self.assertIn("...stamp", self.api())

    def test_a_build_that_cannot_stamp_itself_still_reports(self):
        """The version is the nice-to-have; the error is the point. A phone
        that throws while reading its own version must not lose the report."""
        text = self.api()
        self.assertIn("try { stamp = await buildStamp(); } catch", text)

    def test_it_does_not_import_notifications_and_make_a_cycle(self):
        # notifications.ts imports from api.ts; reaching back for
        # appVersionInfo would be a circular import, and the duplication is
        # the cheaper of the two problems.
        self.assertNotIn("from './notifications'", self.api())


if __name__ == "__main__":
    unittest.main()
