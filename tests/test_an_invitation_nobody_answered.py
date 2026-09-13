"""An invitation nobody answered used to go unmentioned for two months.

The recovery prompt exists so the inviter — the only person who CAN send it
again — hears that an invitation did not land. It spoke about exactly two
cases: they signed up and are elsewhere, or the invitation expired. Anything
still pending and in date fell through a `continue` commented "give it time".

That was fair when the window was a fortnight. INVITE_DAYS is 60. Widening the
window to stop invitations dying of the clock quietly moved the only prompt
that chases one from two weeks out to two months — and by then the link is
already dead, so re-sending is the only move left rather than a nudge on the
channel it went out on.

And a second, larger hole in the same function: `if not addr: continue` threw
away every invitation with no email. That is a SHARED LINK — what the share
sheet sends, which is what the Feed's nudge opens, which is how people actually
invite. The app's main invitation route was invisible to the prompt built to
chase invitations. There is nobody to look up for a link, but the inviter can
still be told nothing happened, and re-sharing is the same tap it was the
first time.

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

ME = {"user_id": "u1", "family_id": "famA", "email": "roland@x.test"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ChasingAnInvitation(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db

    def add(self, **kw):
        row = {"invite_id": kw.pop("invite_id", "inv1"), "family_id": "famA",
               "email": None, "status": "pending",
               "created_at": self.now - timedelta(days=kw.pop("age_days", 1)),
               "expires_at": self.now + timedelta(days=kw.pop("expires_in", 30))}
        row.update(kw)
        asyncio.run(self.db["family_invites"].insert_one(row))

    def account(self, email, family_id):
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u9", "email": email, "family_id": family_id}))

    def rows(self):
        return asyncio.run(server.stranded_invites(user=dict(ME)))

    # --- the shared link, previously invisible -------------------------

    def test_a_shared_link_nobody_used_is_surfaced(self):
        self.add(age_days=13)
        out = self.rows()
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["reason"], "waiting")
        self.assertIsNone(out[0]["email"])

    def test_it_carries_what_the_inviter_called_them(self):
        # There is no address to show, so the label is the only way the prompt
        # can name who it is about.
        self.add(age_days=13, label="Kim")
        self.assertEqual(self.rows()[0]["label"], "Kim")

    def test_it_says_how_long_it_has_been(self):
        # "13 days ago" is the fact that makes silence read as silence rather
        # than as an invitation that might still be new.
        self.add(age_days=13)
        self.assertEqual(self.rows()[0]["days_ago"], 13)

    # --- the window ----------------------------------------------------

    def test_a_new_invitation_is_left_alone(self):
        # "It may simply be new" is still true for a day-old invitation.
        self.add(age_days=1)
        self.assertEqual(self.rows(), [])

    def test_it_speaks_up_at_the_threshold_rather_than_at_expiry(self):
        self.add(age_days=server.INVITE_NUDGE_DAYS)
        self.assertEqual(self.rows()[0]["reason"], "waiting")

    def test_the_day_before_the_threshold_it_stays_quiet(self):
        self.add(age_days=server.INVITE_NUDGE_DAYS - 1)
        self.assertEqual(self.rows(), [])

    def test_the_threshold_is_well_inside_the_window(self):
        # The bug in one line: a prompt that only fires at expiry fires when
        # the link is already dead. If these ever meet again, it is back.
        self.assertLess(server.INVITE_NUDGE_DAYS, server.INVITE_DAYS)

    # --- what must not change ------------------------------------------

    def test_someone_who_signed_up_elsewhere_still_outranks_the_rest(self):
        # The strongest case: they tried. It must stay at the top.
        self.add(invite_id="inv1", email=None, age_days=30)
        self.add(invite_id="inv2", email="kim@x.test", age_days=2)
        self.account("kim@x.test", "famB")
        self.assertEqual([r["reason"] for r in self.rows()], ["signed_up", "waiting"])

    def test_an_invitation_that_worked_is_never_chased(self):
        self.add(email="kim@x.test", age_days=30)
        self.account("kim@x.test", "famA")
        self.assertEqual(self.rows(), [])

    def test_an_accepted_link_is_never_chased(self):
        # No address to look the person up by, so the status is the only
        # evidence it landed — and chasing somebody who already joined is the
        # prompt at its most annoying.
        self.add(status="accepted", age_days=30)
        self.assertEqual(self.rows(), [])

    def test_an_expired_invitation_still_says_expired(self):
        self.add(email="kim@x.test", age_days=90, expires_in=-1)
        self.assertEqual(self.rows()[0]["reason"], "expired")

    def test_another_household_sees_none_of_it(self):
        self.add(age_days=30)
        other = {"user_id": "u2", "family_id": "famZ", "email": "s@x.test"}
        self.assertEqual(asyncio.run(server.stranded_invites(user=other)), [])


if __name__ == "__main__":
    unittest.main()
