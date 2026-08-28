"""Why invitations do not become co-parents — the two causes told apart."""
import asyncio
import os
import sys
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fastapi import HTTPException


class FakeColl:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def find(self, q=None, *a, **k):
        rows = list(self.rows)

        class Cursor:
            def __aiter__(self):
                async def gen():
                    for r in rows:
                        yield r
                return gen()
        return Cursor()


class FakeDB:
    def __init__(self, **colls):
        self.colls = colls

    def __getitem__(self, name):
        return self.colls.setdefault(name, FakeColl())


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class InviteMetrics(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self.now = server.utcnow()
        server.ADMIN_EMAILS.add("boss@ahenora.test")

    def tearDown(self):
        server.get_db = self._get_db

    def _run(self, invites, users, days=30):
        db = FakeDB(family_invites=FakeColl(invites), users=FakeColl(users))
        server.get_db = lambda: db
        return asyncio.run(server.metrics_invites(
            days=days, user={"user_id": "u_admin", "email": "boss@ahenora.test"}, database=db))

    def _inv(self, email, fam="famA", status="pending", age_days=1, expires_in=7):
        return {"email": email, "family_id": fam, "status": status,
                "created_at": self.now - timedelta(days=age_days),
                "expires_at": self.now + timedelta(days=expires_in)}

    def test_only_an_admin_may_read_it(self):
        db = FakeDB(family_invites=FakeColl([]), users=FakeColl([]))
        server.get_db = lambda: db
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.metrics_invites(
                user={"user_id": "u1", "email": "someone@example.com"}, database=db))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_never_signed_up_is_a_delivery_problem(self):
        """Nobody with that address exists — the link or mail never landed."""
        res = self._run([self._inv("ghost@x.test")], users=[])
        self.assertEqual(res["outcome"]["never_signed_up"], 1)
        self.assertEqual(res["outcome"]["signed_up_but_not_joined"], 0)

    def test_signed_up_but_not_joined_is_a_technical_problem(self):
        """They made an account and are sitting in a household of their own —
        they tried and the join did not take. This is the alarm."""
        res = self._run(
            [self._inv("tried@x.test", fam="famA")],
            users=[{"user_id": "u2", "email": "tried@x.test", "family_id": "famOWN"}])
        self.assertEqual(res["outcome"]["signed_up_but_not_joined"], 1)
        self.assertEqual(res["outcome"]["never_signed_up"], 0)

    def test_in_the_household_counts_as_success(self):
        res = self._run(
            [self._inv("in@x.test", fam="famA", status="accepted")],
            users=[{"user_id": "u2", "email": "in@x.test", "family_id": "famA"}])
        self.assertEqual(res["outcome"]["in_the_household"], 1)
        self.assertEqual(res["status"]["accepted"], 1)

    def test_a_join_that_worked_while_the_record_lagged_is_named(self):
        """In the family but the invite still reads pending: real success the
        funnel would count as a failure."""
        res = self._run(
            [self._inv("in@x.test", fam="famA", status="pending")],
            users=[{"user_id": "u2", "email": "in@x.test", "family_id": "famA"}])
        self.assertEqual(res["outcome"]["in_the_household"], 1)
        self.assertEqual(res["outcome"]["joined_while_invite_still_pending"], 1)
        self.assertEqual(res["status"]["pending"], 1)

    def test_expired_is_separated_from_still_live(self):
        res = self._run([
            # Inside the window, but its expiry has passed.
            self._inv("a@x.test", age_days=20, expires_in=-5),
            self._inv("b@x.test", age_days=2, expires_in=7),
        ], users=[])
        self.assertEqual(res["status"]["expired"], 1)
        self.assertEqual(res["status"]["pending"], 1)

    def test_oldest_pending_is_reported(self):
        res = self._run([
            self._inv("a@x.test", age_days=12, expires_in=9),
            self._inv("b@x.test", age_days=3, expires_in=9),
        ], users=[])
        self.assertEqual(res["status"]["oldest_pending_days"], 12)

    def test_invites_outside_the_window_are_excluded(self):
        res = self._run([self._inv("old@x.test", age_days=90)], users=[], days=30)
        self.assertEqual(res["status"]["sent"], 0)

    def test_matching_is_case_insensitive(self):
        """A person who signs up with different capitalisation still joined."""
        res = self._run(
            [self._inv("Mixed@X.test", fam="famA", status="accepted")],
            users=[{"user_id": "u2", "email": "mixed@x.test", "family_id": "famA"}])
        self.assertEqual(res["outcome"]["in_the_household"], 1)


if __name__ == "__main__":
    unittest.main()
