"""A confident percentage over a handful of devices is not coverage.

/api/admin/version-adoption answers "did the OTA reach everyone", and every
number in it is computed over accounts that have a REGISTERED PUSH TOKEN. A
token exists only where someone granted notification permission — which, until
the permission prompt shipped, was almost nobody.

So "78% on the current runtime" could mean 7 people out of 9 with tokens, while
200 accounts exist. The percentage was never wrong; it answered a narrower
question than its name suggested, and there was nothing on the screen to say so.

These tests hold the denominator visible.

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

ADMIN = {"user_id": "u1", "family_id": "fam1", "email": "boss@ahenora.test"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheAdoptionDenominator(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admins = server.ADMIN_EMAILS
        server.ADMIN_EMAILS = {ADMIN["email"]}
        server._ADMIN_FAMILY_CACHE.clear()

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins
        server._ADMIN_FAMILY_CACHE.clear()

    def seed(self, accounts: int, with_tokens: int):
        async def go():
            for i in range(accounts):
                await self.db["users"].insert_one(
                    {"user_id": f"u{i}", "family_id": f"fam{i}",
                     "email": f"u{i}@x.test"})
            for i in range(with_tokens):
                await self.db["notification_tokens"].insert_one(
                    {"token": f"t{i}", "user_id": f"u{i}", "active": True,
                     "runtime_version": server.MIN_SUPPORTED_RUNTIME,
                     "app_version": "1.1.0"})
        asyncio.run(go())

    def run_it(self):
        return asyncio.run(server.version_adoption(user=dict(ADMIN)))

    def test_it_reports_the_whole_account_total(self):
        self.seed(accounts=200, with_tokens=9)
        out = self.run_it()
        self.assertEqual(out["total_accounts"], 200)
        self.assertEqual(out["total_users_with_a_device"], 9)

    def test_a_flattering_percentage_carries_its_own_caveat(self):
        """9 of 9 devices on the current runtime is 100% — over 4.5% of accounts.
        Both numbers have to be present, or the first one misleads."""
        self.seed(accounts=200, with_tokens=9)
        out = self.run_it()
        self.assertEqual(out["pct_on_current_runtime"], 100.0)
        self.assertEqual(out["pct_of_accounts_visible"], 4.5)

    def test_full_visibility_reads_as_full_visibility(self):
        self.seed(accounts=10, with_tokens=10)
        out = self.run_it()
        self.assertEqual(out["pct_of_accounts_visible"], 100.0)

    def test_no_devices_at_all_does_not_divide_by_zero(self):
        """The state the app was actually in before the permission prompt."""
        self.seed(accounts=50, with_tokens=0)
        out = self.run_it()
        self.assertEqual(out["pct_of_accounts_visible"], 0.0)
        self.assertEqual(out["pct_on_current_runtime"], 0.0)

    def test_an_empty_install_base_is_not_an_error(self):
        self.seed(accounts=0, with_tokens=0)
        out = self.run_it()
        self.assertEqual(out["total_accounts"], 0)
        self.assertEqual(out["pct_of_accounts_visible"], 0.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
