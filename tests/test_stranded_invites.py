"""Who this household invited and never got — the list behind the re-send nudge.

Six of nine real invitees ended up holding an account in a household of their
own. The join is fixed, but nothing reaches back for the people already
stranded, and only the household that invited them can invite them again.
"""
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


class FakeColl:
    def __init__(self, rows=None):
        self.rows = list(rows or [])

    def find(self, q=None, *a, **k):
        rows = [r for r in self.rows
                if not q or all(r.get(k2) == v for k2, v in q.items())]

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
class StrandedInvites(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self.now = server.utcnow()
        self.me = {"user_id": "u_me", "family_id": "famA", "email": "me@x.test"}

    def tearDown(self):
        server.get_db = self._get_db

    def _run(self, invites, users):
        db = FakeDB(family_invites=FakeColl(invites), users=FakeColl(users))
        server.get_db = lambda: db
        return asyncio.run(server.stranded_invites(user=self.me))

    def _inv(self, email, fam="famA", status="pending", expires_in=7):
        return {"email": email, "family_id": fam, "status": status,
                "created_at": self.now - timedelta(days=3),
                "expires_at": self.now + timedelta(days=expires_in)}

    def test_signed_up_but_elsewhere_is_the_strong_case(self):
        res = self._run([self._inv("tried@x.test")],
                        [{"email": "tried@x.test", "family_id": "famOWN"}])
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0]["reason"], "signed_up")

    def test_someone_already_in_the_household_is_not_listed(self):
        """It worked. Asking the inviter to send it again would be nonsense."""
        res = self._run([self._inv("in@x.test")],
                        [{"email": "in@x.test", "family_id": "famA"}])
        self.assertEqual(res, [])

    def test_a_live_invite_is_left_alone(self):
        """Still pending and in date — it may simply be new."""
        res = self._run([self._inv("waiting@x.test", expires_in=5)], [])
        self.assertEqual(res, [])

    def test_an_expired_invite_is_worth_sending_again(self):
        res = self._run([self._inv("gone@x.test", expires_in=-2)], [])
        self.assertEqual([r["reason"] for r in res], ["expired"])

    def test_another_household_s_invites_are_never_returned(self):
        """The inviter sees their own invitations and nobody else's."""
        res = self._run([self._inv("theirs@x.test", fam="famOTHER", expires_in=-2)], [])
        self.assertEqual(res, [])

    def test_the_ones_who_tried_come_first(self):
        res = self._run([
            self._inv("expired@x.test", expires_in=-2),
            self._inv("tried@x.test"),
        ], [{"email": "tried@x.test", "family_id": "famOWN"}])
        self.assertEqual([r["reason"] for r in res], ["signed_up", "expired"])

    def test_a_user_with_no_household_gets_an_empty_list(self):
        server.get_db = lambda: FakeDB(family_invites=FakeColl([]), users=FakeColl([]))
        res = asyncio.run(server.stranded_invites(user={"user_id": "u", "family_id": None}))
        self.assertEqual(res, [])


if __name__ == "__main__":
    unittest.main()
