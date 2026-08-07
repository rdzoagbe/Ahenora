"""OTA adoption: who is actually on the runtime that can receive updates.

An over-the-air update only lands on devices whose runtime matches what was
published. After every OTA the same question comes up — "did it reach
everyone?" — and until now the backend could not answer it, because it never
recorded what each device was running. This pins the readout: coverage is
counted by runtime, deduped to distinct users, and it is admin-only because it
reads across the whole install base rather than one household.
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
    from fastapi import HTTPException

ADMIN = {"user_id": "u_admin", "family_id": "fam1", "email": "admin@x.com"}
PLAIN = {"user_id": "u_plain", "family_id": "fam1", "email": "someone@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AdoptionReadout(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self._admins = server.ADMIN_EMAILS
        server.ADMIN_EMAILS = {"admin@x.com"}
        self.db = FakeDatabase()
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins

    def _token(self, user_id, runtime=None, app=None, active=True):
        asyncio.run(self.db["notification_tokens"].insert_one({
            "token": f"tok_{user_id}_{runtime}_{app}", "user_id": user_id,
            "runtime_version": runtime, "app_version": app, "active": active,
        }))

    def _run(self, user=ADMIN):
        return asyncio.run(server.version_adoption(user=user))

    def test_only_an_admin_may_read_the_fleet(self):
        with self.assertRaises(HTTPException) as e:
            self._run(user=PLAIN)
        self.assertEqual(e.exception.status_code, 403)

    def test_coverage_is_the_share_on_the_current_runtime(self):
        # Three users on 2.0.0 (can receive the OTA), one still on 1.0.0.
        self._token("a", "2.0.0", "1.0.3")
        self._token("b", "2.0.0", "1.0.3")
        self._token("c", "2.0.0", "1.0.3")
        self._token("d", "1.0.0", "1.0.2")
        out = self._run()
        self.assertEqual(out["current_runtime"], "2.0.0")
        self.assertEqual(out["users_on_current_runtime"], 3)
        self.assertEqual(out["total_users_with_a_device"], 4)
        self.assertEqual(out["pct_on_current_runtime"], 75.0)
        self.assertEqual(out["by_runtime"], {"2.0.0": 3, "1.0.0": 1})

    def test_a_person_with_two_devices_counts_once(self):
        self._token("a", "2.0.0", "1.0.3")
        self._token("a", "2.0.0", "1.0.3")  # same user, second device
        out = self._run()
        self.assertEqual(out["users_on_current_runtime"], 1)
        self.assertEqual(out["by_runtime"], {"2.0.0": 1})
        self.assertEqual(out["devices_seen"], 2)

    def test_a_legacy_token_with_no_version_reads_as_unknown(self):
        self._token("a", "2.0.0", "1.0.3")
        self._token("old", None, None)
        out = self._run()
        self.assertEqual(out["by_runtime"], {"2.0.0": 1, "unknown": 1})
        self.assertEqual(out["devices_reporting_version"], 1)
        self.assertEqual(out["devices_seen"], 2)

    def test_inactive_tokens_are_left_out(self):
        self._token("a", "2.0.0", "1.0.3")
        self._token("gone", "2.0.0", "1.0.3", active=False)
        out = self._run()
        self.assertEqual(out["devices_seen"], 1)
        self.assertEqual(out["users_on_current_runtime"], 1)

    def test_no_devices_is_zero_not_a_crash(self):
        out = self._run()
        self.assertEqual(out["pct_on_current_runtime"], 0.0)
        self.assertEqual(out["total_users_with_a_device"], 0)


if __name__ == "__main__":
    unittest.main()
