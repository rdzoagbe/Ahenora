"""A link invite is not somebody who never signed up.

The invite outcome split exists to separate two causes with opposite fixes:
the person never made an account (delivery and wording), or they made one and
the join failed (a bug). It decided which by matching the INVITED EMAIL against
the accounts table.

A link invite has no email. `POST /api/family/invite/link` mints a token with
`email=None` — it is what the share sheet sends, which is what the Feed's
co-parent nudge opens, which is the app's main way of inviting anybody.

So every one of those fell to the final `else` and was counted as "never signed
up at all", whatever actually happened — including the ones where somebody did
join. The number that exists to tell a delivery problem from a bug was
reporting the primary invitation route as nobody, and pointing at the wrong
fix. Roland's screen showed 3 accepted and 2 in the household, and the missing
one was sitting in "never signed up".

Two things follow, and the second matters more:

  * acceptance records `accepted_by_user_id`, so an accepted link invite CAN
    be resolved. Ask that before the address.
  * a pending link invite still cannot be. Nobody accepted it and we never
    knew where it went, so the outcome is not known — and "not known" must not
    be filed under "never signed up", which is a claim about a person we
    cannot identify. Inventing evidence for a conclusion is worse than having
    none.

Run with:  python3 -m unittest discover -s tests -v
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
class LinkInvites(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self.now = server.utcnow()
        server.ADMIN_EMAILS.add("boss@ahenora.test")

    def tearDown(self):
        server.get_db = self._get_db

    def outcome(self, invites, users):
        db = FakeDB(family_invites=FakeColl(invites), users=FakeColl(users))
        server.get_db = lambda: db
        out = asyncio.run(server.metrics_invites(
            days=30, user={"user_id": "u_admin", "email": "boss@ahenora.test"},
            database=db))
        return out["outcome"]

    def link(self, **kw):
        """What POST /family/invite/link stores: no email at all."""
        row = {"email": None, "family_id": "famA", "status": "pending",
               "created_at": self.now - timedelta(days=1),
               "expires_at": self.now + timedelta(days=7)}
        row.update(kw)
        return row

    # --- the bug -------------------------------------------------------

    def test_an_accepted_link_invite_counts_as_joined(self):
        # The row that went missing from Roland's screen: accepted, the person
        # is in the household, and the split said nobody ever signed up.
        out = self.outcome(
            [self.link(status="accepted", accepted_by_user_id="u2")],
            [{"user_id": "u2", "family_id": "famA", "email": "kim@x.test"}])
        self.assertEqual(out["in_the_household"], 1)
        self.assertEqual(out["never_signed_up"], 0)

    def test_a_link_invite_accepted_by_someone_who_landed_elsewhere_shows_as_that(self):
        # The technical failure the split exists to surface, previously
        # invisible on the share-sheet route.
        out = self.outcome(
            [self.link(status="accepted", accepted_by_user_id="u2")],
            [{"user_id": "u2", "family_id": "famB", "email": "kim@x.test"}])
        self.assertEqual(out["signed_up_but_not_joined"], 1)
        self.assertEqual(out["never_signed_up"], 0)

    def test_a_pending_link_invite_is_not_called_never_signed_up(self):
        # The one that matters. Nobody accepted it and no address was ever
        # attached, so there is no account to look for.
        out = self.outcome([self.link()], [])
        self.assertEqual(out["never_signed_up"], 0)
        self.assertEqual(out["outcome_not_known"], 1)

    def test_the_accepting_account_wins_over_a_stale_address(self):
        # An emailed invite accepted from a DIFFERENT account — someone
        # forwarded it, or signs in with another address. The account that
        # actually accepted is the truth; the invited address is a guess.
        out = self.outcome(
            [{"email": "old@x.test", "family_id": "famA", "status": "accepted",
              "accepted_by_user_id": "u2",
              "created_at": self.now - timedelta(days=1),
              "expires_at": self.now + timedelta(days=7)}],
            [{"user_id": "u2", "family_id": "famA", "email": "new@x.test"},
             {"user_id": "u9", "family_id": "famZ", "email": "old@x.test"}])
        self.assertEqual(out["in_the_household"], 1)

    # --- what must not change -----------------------------------------

    def test_an_emailed_invite_to_a_stranger_is_still_never_signed_up(self):
        # The real finding the split is for, and the one this change must not
        # dilute: we knew the address, and no account carries it.
        out = self.outcome(
            [{"email": "nobody@x.test", "family_id": "famA", "status": "pending",
              "created_at": self.now - timedelta(days=1),
              "expires_at": self.now + timedelta(days=7)}], [])
        self.assertEqual(out["never_signed_up"], 1)
        self.assertEqual(out["outcome_not_known"], 0)

    def test_an_emailed_invite_that_joined_still_reads_as_joined(self):
        out = self.outcome(
            [{"email": "kim@x.test", "family_id": "famA", "status": "accepted",
              "created_at": self.now - timedelta(days=1),
              "expires_at": self.now + timedelta(days=7)}],
            [{"user_id": "u2", "family_id": "famA", "email": "kim@x.test"}])
        self.assertEqual(out["in_the_household"], 1)

    def test_every_invitation_lands_in_exactly_one_bucket(self):
        # A split that does not add up to the number sent is a split nobody can
        # reason from — and adding a fourth bucket is exactly how that breaks.
        invites = [
            self.link(status="accepted", accepted_by_user_id="u2"),
            self.link(),
            {"email": "nobody@x.test", "family_id": "famA", "status": "pending",
             "created_at": self.now - timedelta(days=1),
             "expires_at": self.now + timedelta(days=7)},
            {"email": "kim@x.test", "family_id": "famA", "status": "accepted",
             "created_at": self.now - timedelta(days=1),
             "expires_at": self.now + timedelta(days=7)},
        ]
        users = [{"user_id": "u2", "family_id": "famA", "email": "kim@x.test"}]
        out = self.outcome(invites, users)
        total = (out["in_the_household"] + out["signed_up_but_not_joined"]
                 + out["never_signed_up"] + out["outcome_not_known"])
        self.assertEqual(total, len(invites))


if __name__ == "__main__":
    unittest.main()
