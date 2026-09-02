"""Why a notification did or did not arrive.

The morning digest failed to land and there was no way to tell whether nobody
was due or nothing was running. The scheduler lives inside the web process, so
a container restart or a sleeping service takes it down silently and the local
slot simply passes — nothing logs "I was asleep at 07:30".

The rule these tests hold: the read-out must distinguish "quiet" from "dead".
An instrument that reports the same thing in both cases is the failure this was
built to end.

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

ADMIN = {"user_id": "a1", "family_id": "f1", "email": "boss@ahenora.com"}
PARENT = {"user_id": "p1", "family_id": "f1", "email": "p@example.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class PushHealth(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admins = server.ADMIN_EMAILS
        server.ADMIN_EMAILS = {ADMIN["email"]}
        self._state = dict(server._scheduler_state)
        self._enabled = server.REMINDER_SCHEDULER_ENABLED

        async def seed():
            for u in (ADMIN, PARENT):
                await self.db["users"].insert_one({**u, "language": "en"})
            await self.db["notification_tokens"].insert_one(
                {"user_id": ADMIN["user_id"], "token": "ExpoTok",
                 "active": True, "timezone": "Europe/Paris"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins
        server._scheduler_state.clear()
        server._scheduler_state.update(self._state)
        server.REMINDER_SCHEDULER_ENABLED = self._enabled

    def read(self, user=ADMIN):
        return asyncio.run(server.health_push(user=dict(user), database=self.db))

    def set_tick(self, seconds_ago):
        server._scheduler_state["booted_at"] = server.utcnow() - timedelta(hours=1)
        server._scheduler_state["last_tick_at"] = (
            server.utcnow() - timedelta(seconds=seconds_ago))
        server._scheduler_state["ticks"] = 42

    # --- the distinction the whole thing exists for -----------------------

    def test_a_recent_tick_reads_alive(self):
        self.set_tick(10)
        self.assertEqual(self.read()["scheduler"]["state"], "alive")

    def test_a_loop_that_stopped_reads_stalled_not_quiet(self):
        # This is the case that was invisible: the app up, the API answering,
        # and nothing sending.
        self.set_tick(3600)
        out = self.read()["scheduler"]
        self.assertEqual(out["state"], "stalled")
        self.assertGreater(out["seconds_since_tick"], 300)

    def test_a_process_that_never_started_the_loop_says_so(self):
        server._scheduler_state["last_tick_at"] = None
        self.assertEqual(self.read()["scheduler"]["state"], "never_ran")

    def test_the_off_switch_is_reported_as_a_choice(self):
        # Turned off deliberately is not the same as broken, and telling them
        # apart is the difference between a fix and a wild goose chase.
        self.set_tick(10)
        server.REMINDER_SCHEDULER_ENABLED = False
        self.assertEqual(self.read()["scheduler"]["state"], "disabled")

    def test_a_failing_tick_is_surfaced_not_swallowed(self):
        self.set_tick(10)
        server._scheduler_state["last_error"] = "RuntimeError: mongo gone"
        self.assertIn("mongo gone", self.read()["scheduler"]["last_error"])

    # --- who can actually be reached --------------------------------------

    def test_it_counts_both_rails(self):
        # send_push_to_user delivers to phones AND browsers; counting one would
        # under-report exactly the users who are hardest to debug.
        asyncio.run(self.db["web_push_subscriptions"].insert_one(
            {"user_id": PARENT["user_id"], "endpoint": "https://push/x",
             "active": True, "timezone": "Europe/Paris"}))
        self.set_tick(10)
        reach = self.read()["reach"]
        self.assertEqual(reach["active_phone_tokens"], 1)
        self.assertEqual(reach["active_web_subscriptions"], 1)
        self.assertEqual(reach["people_reachable"], 2)

    def test_someone_with_no_device_is_not_counted_as_reachable(self):
        self.set_tick(10)
        self.assertEqual(self.read()["reach"]["people_reachable"], 1)

    # --- per job, and per person ------------------------------------------

    def test_every_job_is_listed_with_its_slot(self):
        self.set_tick(10)
        jobs = {j["key"]: j for j in self.read()["jobs"]}
        self.assertEqual(len(jobs), len(server.DAILY_PUSH_JOBS))
        self.assertEqual(jobs["morning_digest"]["at"], "07:30 local")

    def test_a_served_person_shows_as_served_on_their_own_local_day(self):
        local_today = server._local_now("Europe/Paris", server.utcnow()).strftime("%Y-%m-%d")
        asyncio.run(self.db["users"].update_one(
            {"user_id": ADMIN["user_id"]}, {"$set": {"digest_sent_for": local_today}}))
        self.set_tick(10)
        digest = next(j for j in self.read()["jobs"] if j["key"] == "morning_digest")
        self.assertEqual(digest["served_today"], 1)

    def test_it_answers_did_I_get_it_for_the_caller(self):
        # The question actually being asked is personal, and a household-wide
        # count cannot answer it.
        self.set_tick(10)
        me = self.read()["you"]
        self.assertTrue(me["reachable"])
        self.assertEqual(me["timezone"], "Europe/Paris")
        self.assertIn("digest_sent_for", me["claims"])

    def test_only_an_admin_may_read_it(self):
        self.set_tick(10)
        with self.assertRaises(server.HTTPException) as caught:
            self.read(user=PARENT)
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
