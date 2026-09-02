"""How the app feels, as a number instead of an impression.

Nothing measured cold start or how long a tab took to appear, so a performance
regression would have arrived as a one-star review rather than as a chart. This
is the smallest honest instrument: bucketed counts, because storing a row per
sample grows without limit and needs an aggregate to read — and because a mean
on its own hides exactly the tail that makes an app feel broken.

The rule these tests hold: the read-out must never claim more precision than
the data has, and telemetry must never be the reason a screen fails.

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

ADMIN = {"user_id": "a1", "family_id": "f1", "email": "boss@ahenora.com"}
PARENT = {"user_id": "p1", "family_id": "f1", "email": "parent@example.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class RecordingATiming(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admins = server.ADMIN_EMAILS
        server.ADMIN_EMAILS = {ADMIN["email"]}

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins

    def send(self, name, ms, user=PARENT):
        return asyncio.run(server.log_timing(
            server.TimingIn(name=name, ms=ms), user=dict(user)))

    def rows(self):
        async def go():
            return [r async for r in self.db["metrics_timings"].find({}, {"_id": 0})]
        return asyncio.run(go())

    def test_a_sample_is_counted_and_bucketed(self):
        self.send("cold_start", 1500)
        row = self.rows()[0]
        self.assertEqual(row["count"], 1)
        self.assertEqual(row["total_ms"], 1500)
        # 1500 falls in 1000-2000, the second bucket.
        self.assertEqual(row["b1"], 1)

    def test_samples_accumulate_rather_than_replace(self):
        for ms in (500, 1500, 1500):
            self.send("cold_start", ms)
        row = self.rows()[0]
        self.assertEqual(row["count"], 3)
        self.assertEqual(row["b0"], 1)
        self.assertEqual(row["b1"], 2)

    def test_the_tail_lands_in_the_slowest_bucket(self):
        self.send("cold_start", 9000)
        self.assertEqual(self.rows()[0]["b4"], 1)

    def test_an_unknown_name_is_ignored_not_an_error(self):
        # An app build ahead of the server will send names this one has never
        # heard of. That must not surface as a failure on the device.
        out = self.send("teleportation", 10)
        self.assertEqual(out, {"ok": False})
        self.assertEqual(self.rows(), [])

    def test_a_negative_sample_is_refused(self):
        # Means a clock moved backwards; it does not describe the app.
        self.assertEqual(self.send("cold_start", -5), {"ok": False})
        self.assertEqual(self.rows(), [])

    def test_an_absurd_sample_is_refused(self):
        # The phone slept mid-measurement. Keeping it would poison the mean
        # for the whole day.
        self.assertEqual(self.send("cold_start", 999_999), {"ok": False})
        self.assertEqual(self.rows(), [])

    def test_recording_never_raises_even_when_the_write_fails(self):
        async def boom(*a, **k):
            raise RuntimeError("db down")
        self.db["metrics_timings"].update_one = boom
        # Telemetry must never be the reason a screen fails.
        self.assertEqual(self.send("cold_start", 900), {"ok": True})


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ReadingTheTimings(RecordingATiming):
    def read(self, user=ADMIN, days=14):
        return asyncio.run(server.metrics_timings(days=days, user=dict(user)))

    def only(self, name="cold_start"):
        return next(t for t in self.read()["timings"] if t["name"] == name)

    def test_only_an_admin_may_read_it(self):
        with self.assertRaises(server.HTTPException) as caught:
            self.read(user=PARENT)
        self.assertEqual(caught.exception.status_code, 403)

    def test_it_reports_the_mean_and_the_sample_count(self):
        for ms in (1000, 2000):
            self.send("cold_start", ms)
        row = self.only()
        self.assertEqual(row["samples"], 2)
        self.assertEqual(row["mean_ms"], 1500)

    def test_the_median_is_a_range_not_an_invented_number(self):
        # Interpolating a millisecond out of buckets would claim precision the
        # data does not have.
        for ms in (1200, 1300, 1400):
            self.send("cold_start", ms)
        self.assertEqual(self.only()["median_bucket"], "1000-2000ms")

    def test_the_median_follows_the_bulk_not_the_outlier(self):
        for _ in range(9):
            self.send("cold_start", 500)
        self.send("cold_start", 9000)
        row = self.only()
        self.assertEqual(row["median_bucket"], "<1000ms")
        # ...and the outlier is still visible rather than averaged away.
        self.assertEqual(row["pct_in_slowest"], 10.0)

    def test_the_slow_share_is_the_headline_number(self):
        for _ in range(3):
            self.send("tab_switch", 50)
        self.send("tab_switch", 5000)
        row = self.only("tab_switch")
        self.assertEqual(row["pct_in_slowest"], 25.0)

    def test_labels_describe_the_buckets_they_belong_to(self):
        self.send("tab_switch", 10)
        row = self.only("tab_switch")
        self.assertEqual(row["labels"][0], "<100ms")
        self.assertEqual(row["labels"][-1], ">1000ms")
        self.assertEqual(len(row["labels"]), len(row["buckets"]))

    def test_nothing_recorded_means_nothing_claimed(self):
        # A zero here would read as "instant", which is a lie about silence.
        self.assertEqual(self.read()["timings"], [])


if __name__ == "__main__":
    unittest.main()
