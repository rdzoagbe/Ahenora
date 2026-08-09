"""Daily-active tracking, split by platform.

"Lots of visits, no subscribers" hinges on where those visits happen: store
purchases only work in the native app, so web traffic can never convert. Every
authenticated request carries an X-Client-Platform header, and the once-a-day
active-user write is now mirrored into a per-platform counter so the split is
answerable. Pinned here: the platform bump rides along with the active_users
bump, only once per user per day, and an unknown platform is bucketed as other.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import unittest
from datetime import timedelta

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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class DailyActiveByPlatform(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        self.token = "raw-token"

        async def seed():
            await self.db["user_sessions"].insert_one({
                "user_id": "u1", "token_hash": server.sha256(self.token),
                "expires_at": server.utcnow() + timedelta(days=7)})
            await self.db["users"].insert_one({
                "user_id": "u1", "family_id": "fam1", "email": "a@x.com", "name": "A"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db

    def _call(self, platform=""):
        return asyncio.run(server.require_user(
            authorization=f"Bearer {self.token}", x_client_platform=platform))

    def _metric(self, name):
        today = server.utcnow().strftime("%Y-%m-%d")
        row = asyncio.run(self.db["metrics_daily"].find_one({"date": today, "name": name}))
        return row["count"] if row else 0

    def test_web_active_is_counted_under_web(self):
        self._call(platform="web")
        self.assertEqual(self._metric("active_users"), 1)
        self.assertEqual(self._metric("active_web"), 1)
        self.assertEqual(self._metric("active_android"), 0)

    def test_android_active_is_counted_under_android(self):
        self._call(platform="android")
        self.assertEqual(self._metric("active_android"), 1)
        self.assertEqual(self._metric("active_web"), 0)

    def test_unknown_platform_falls_to_other(self):
        self._call(platform="toaster")
        self.assertEqual(self._metric("active_other"), 1)

    def test_missing_platform_falls_to_other(self):
        self._call(platform="")
        self.assertEqual(self._metric("active_other"), 1)

    def test_counted_once_per_user_per_day(self):
        self._call(platform="web")
        self._call(platform="web")  # same user, same day
        self.assertEqual(self._metric("active_users"), 1)
        self.assertEqual(self._metric("active_web"), 1)


if __name__ == "__main__":
    unittest.main()
