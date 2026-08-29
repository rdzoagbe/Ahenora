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
        self.queries = []   # every filter this collection was asked for

    def _match(self, q):
        return [r for r in self.rows
                if not q or all(r.get(k2) == v for k2, v in q.items())]

    def find(self, q=None, *a, **k):
        self.queries.append(dict(q or {}))
        rows = self._match(q)

        class Cursor:
            def __aiter__(self):
                async def gen():
                    for r in rows:
                        yield r
                return gen()
        return Cursor()

    async def find_one(self, q=None, *a, **k):
        self.queries.append(dict(q or {}))
        found = self._match(q)
        return found[0] if found else None


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
        self.db = FakeDB(family_invites=FakeColl(invites), users=FakeColl(users))
        server.get_db = lambda: self.db
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


    def test_it_never_reads_the_whole_users_collection(self):
        """This runs on every Feed load. The first version built its index by
        reading EVERY account in the database — invisible at seventy
        households, a full collection scan per Feed load at seventy thousand.
        The work must be bounded by the caller's own invitations."""
        strangers = [{"email": f"nobody{i}@x.test", "family_id": f"fam{i}"}
                     for i in range(50)]
        self._run(
            [self._inv("one@x.test"), self._inv("two@x.test")],
            [{"email": "one@x.test", "family_id": "famB"}] + strangers,
        )
        asked = self.db.colls["users"].queries
        self.assertTrue(asked, "the accounts were never consulted at all")
        for q in asked:
            self.assertIn("email", q,
                          f"accounts read without narrowing to an address: {q}")
            self.assertIn(q["email"], {"one@x.test", "two@x.test"})
        # Two distinct addresses were invited, so at most two lookups.
        self.assertLessEqual(len(asked), 2)

    def test_the_same_address_invited_twice_is_looked_up_once(self):
        rows = self._run(
            [self._inv("again@x.test"), self._inv("again@x.test", expires_in=30)],
            [{"email": "again@x.test", "family_id": "famB"}],
        )
        self.assertEqual(len(self.db.colls["users"].queries), 1)
        self.assertTrue(all(r["reason"] == "signed_up" for r in rows))

    def test_a_user_with_no_household_gets_an_empty_list(self):
        server.get_db = lambda: FakeDB(family_invites=FakeColl([]), users=FakeColl([]))
        res = asyncio.run(server.stranded_invites(user={"user_id": "u", "family_id": None}))
        self.assertEqual(res, [])



@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class LookupIndexes(unittest.TestCase):
    """The point lookups above are only cheaper than a scan if they are indexed.

    Nothing in this app ever created an index, so every lookup by address, by
    session token or by household was a full collection read. Narrowing the
    stranded-invite check to per-address lookups would have made it WORSE
    without these — two scans instead of one.
    """

    def test_every_field_the_hot_paths_look_up_by_is_indexed(self):
        for collection, field in (
            # require_user runs this on every single authenticated request.
            ("user_sessions", "token_hash"),
            # Login, registration, and the stranded-invite check.
            ("users", "email"),
            ("users", "user_id"),
            ("family_members", "family_id"),
            ("family_invites", "family_id"),
            ("family_invites", "email"),
            ("cards", "family_id"),
        ):
            with self.subTest(collection=collection, field=field):
                self.assertIn(field, server.INDEXES.get(collection, []))

    def test_a_broken_index_does_not_stop_the_app_from_booting(self):
        """A slow app beats one that will not start."""
        class Boom:
            async def create_index(self, *a, **k):
                raise RuntimeError("no permission to build indexes")

        class DB:
            def __getitem__(self, _name):
                return Boom()

        real_db = server.db
        server.db = DB()
        try:
            asyncio.run(server.ensure_indexes())  # must not raise
        finally:
            server.db = real_db

    def test_it_does_nothing_at_all_without_a_database(self):
        real_db = server.db
        server.db = None
        try:
            asyncio.run(server.ensure_indexes())
        finally:
            server.db = real_db


if __name__ == "__main__":
    unittest.main()
