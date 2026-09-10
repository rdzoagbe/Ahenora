"""Is the reminder loop alive? Answerable without an admin session.

The loop carries every card reminder, both daily digests, the push receipts
and the shopping flush. It is the single most consequential thing in the app
that can die quietly: when it stops, nothing errors anywhere — the app just
goes silent, which is indistinguishable from a quiet week. That is how nine
days of undelivered updates went unnoticed once already.

So /api/health says it in one word, and the twice-daily production smoke test
reads it. A verdict rather than a timestamp, because a timestamp needs
arithmetic before it means anything.

Run with:  python3 -m pytest tests/test_scheduler_verdict.py -q
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
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    from fake_mongo import FakeDatabase


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheVerdict(unittest.TestCase):
    def setUp(self):
        self._state = dict(server._scheduler_state)
        self._enabled = server.REMINDER_SCHEDULER_ENABLED

    def tearDown(self):
        server._scheduler_state.clear()
        server._scheduler_state.update(self._state)
        server.REMINDER_SCHEDULER_ENABLED = self._enabled

    def test_a_loop_that_just_ticked_is_alive(self):
        server.REMINDER_SCHEDULER_ENABLED = True
        server._scheduler_state["last_tick_at"] = server.utcnow()
        self.assertEqual(server._scheduler_verdict(), "alive")

    def test_a_loop_that_has_not_ticked_in_five_minutes_is_gone(self):
        # Not "slow". It ticks every 60 seconds; five minutes of silence is a
        # loop that is not running.
        server.REMINDER_SCHEDULER_ENABLED = True
        now = server.utcnow()
        server._scheduler_state["last_tick_at"] = now - timedelta(minutes=6)
        self.assertEqual(server._scheduler_verdict(now), "stalled")

    def test_a_loop_that_never_started_says_so(self):
        server.REMINDER_SCHEDULER_ENABLED = True
        server._scheduler_state["last_tick_at"] = None
        self.assertEqual(server._scheduler_verdict(), "never_ran")

    def test_switched_off_is_not_reported_as_broken(self):
        # There is an off switch on purpose; it must read as a choice rather
        # than a fault, or the alarm cries wolf every time it is used.
        server.REMINDER_SCHEDULER_ENABLED = False
        self.assertEqual(server._scheduler_verdict(), "disabled")

    def test_a_tick_just_inside_the_window_is_still_alive(self):
        server.REMINDER_SCHEDULER_ENABLED = True
        now = server.utcnow()
        server._scheduler_state["last_tick_at"] = now - timedelta(minutes=4)
        self.assertEqual(server._scheduler_verdict(now), "alive")


@unittest.skipUnless(HAVE, "backend deps not installed")
class HealthSaysIt(unittest.TestCase):
    def setUp(self):
        self._db = server.db
        server.db = FakeDatabase()
        self._state = dict(server._scheduler_state)
        self._enabled = server.REMINDER_SCHEDULER_ENABLED
        server.REMINDER_SCHEDULER_ENABLED = True

    def tearDown(self):
        server.db = self._db
        server._scheduler_state.clear()
        server._scheduler_state.update(self._state)
        server.REMINDER_SCHEDULER_ENABLED = self._enabled

    def test_the_public_health_check_carries_the_verdict(self):
        # Public on purpose: the smoke test has no admin session, and a check
        # nobody can run is not a check.
        server._scheduler_state["last_tick_at"] = server.utcnow()
        out = asyncio.run(server.health())
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["scheduler"], "alive")

    def test_it_reports_a_dead_loop_on_an_otherwise_healthy_server(self):
        # The whole point: the database is fine, the API answers, and the app
        # is nonetheless about to go silent.
        server._scheduler_state["last_tick_at"] = server.utcnow() - timedelta(hours=2)
        out = asyncio.run(server.health())
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["scheduler"], "stalled")


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheAdminPanelAgrees(unittest.TestCase):
    """Two read-outs of the same fact must not be able to disagree."""

    def test_health_push_uses_the_same_definition(self):
        import inspect
        source = inspect.getsource(server.health_push)
        self.assertIn("_scheduler_verdict(", source)
        # And no second copy of the rule left behind to drift.
        self.assertNotIn('verdict = "stalled"', source)


if __name__ == "__main__":
    unittest.main()
