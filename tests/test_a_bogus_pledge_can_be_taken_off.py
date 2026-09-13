"""A pledge that came in over a public link was permanent, and it counted.

A gift pot's share link is PUBLIC and unauthenticated: `POST /api/pot/{token}/join`
takes a name and an amount from anybody holding the URL. That is the point of
the feature — extended family and friends chip in without joining the
household — and it is also why the organiser has to be able to curate. A
duplicate, a typo, or a joke entry on a pot shared to a class group had no way
out.

It did not merely sit there. `total_pledged` is the number the organiser reads
to decide whether the gift is covered, and it counts every row, so a bogus
pledge made the pot look funded when it was not.

`removeContribution` and `unshareGiftPot` both existed with no caller. The
ledger's note against the first — "a contribution is corrected by the
contributor, not removed by the owner" — described something that does not
exist: a contributor over the link has no account, and the public screen
offers `getPublicPot` and `joinPublicPot` and nothing else.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server

from fake_mongo import FakeDatabase  # noqa: E402

USER = {"user_id": "u1", "family_id": "fam_1", "email": "a@b.test"}
POT_ID = "pot_1"


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class CuratingAPot(unittest.TestCase):
    def setUp(self):
        self._require_feature = server.require_feature
        self._get_db = server.get_db

        async def allow(*a, **k):
            return None
        server.require_feature = allow

        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        asyncio.run(self.db["gift_pots"].insert_one({
            "pot_id": POT_ID, "family_id": "fam_1", "title": "Nan's birthday",
            "occasion": "birthday", "per_head": 10, "target_total": 60,
            "status": "open", "note": None, "share_token": "tok_abc",
            "created_by_user_id": "u1", "created_by_name": "Roland",
            "created_at": server.utcnow(), "rev": 1,
            "contributions": [
                {"contrib_id": "c1", "user_id": "u1", "name": "Roland",
                 "amount": 20, "method": None, "paid": True, "source": "member"},
                {"contrib_id": "c2", "user_id": None, "name": "Definitely Not A Bot",
                 "amount": 500, "method": None, "paid": False, "source": "link"},
            ],
        }))

    def tearDown(self):
        server.require_feature = self._require_feature
        server.get_db = self._get_db

    def _pot(self):
        return asyncio.run(self.db["gift_pots"].find_one({"pot_id": POT_ID}))

    def test_a_bogus_pledge_comes_off(self):
        out = asyncio.run(server.remove_contribution(POT_ID, "c2", user=USER))
        names = [c["name"] for c in out["contributions"]]
        self.assertEqual(names, ["Roland"])
        self.assertEqual([c["contrib_id"] for c in self._pot()["contributions"]], ["c1"])

    def test_and_stops_counting_towards_the_total(self):
        # The half that matters. A row that is removed from the list but still
        # in the total leaves the pot looking funded when it is not.
        before = asyncio.run(server.remove_contribution(POT_ID, "nope", user=USER))
        self.assertEqual(before["total_pledged"], 520)
        after = asyncio.run(server.remove_contribution(POT_ID, "c2", user=USER))
        self.assertEqual(after["total_pledged"], 20)

    def test_removing_a_pledge_that_is_not_there_changes_nothing(self):
        out = asyncio.run(server.remove_contribution(POT_ID, "ghost", user=USER))
        self.assertEqual(len(out["contributions"]), 2)

    def test_another_household_cannot_curate_this_pot(self):
        other = dict(USER, family_id="fam_2")
        with self.assertRaises(server.HTTPException) as caught:
            asyncio.run(server.remove_contribution(POT_ID, "c2", user=other))
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(len(self._pot()["contributions"]), 2)

    def test_the_person_the_gift_is_for_cannot_see_or_touch_it(self):
        asyncio.run(self.db["gift_pots"].update_one(
            {"pot_id": POT_ID}, {"$set": {"for_user_id": "u1"}}))
        with self.assertRaises(server.HTTPException) as caught:
            asyncio.run(server.remove_contribution(POT_ID, "c2", user=USER))
        self.assertEqual(caught.exception.status_code, 404)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ClosingTheOuterCircle(CuratingAPot):
    def test_the_link_can_be_turned_off(self):
        out = asyncio.run(server.unshare_gift_pot(POT_ID, user=USER))
        self.assertIsNone(out["share_token"])
        self.assertFalse(out["shared"])
        self.assertIsNone(self._pot()["share_token"])

    def test_what_was_already_pledged_stays(self):
        # Revoking the door does not undo what came through it.
        out = asyncio.run(server.unshare_gift_pot(POT_ID, user=USER))
        self.assertEqual(len(out["contributions"]), 2)
        self.assertEqual(out["total_pledged"], 520)

    def test_the_old_link_stops_resolving(self):
        asyncio.run(server.unshare_gift_pot(POT_ID, user=USER))
        with self.assertRaises(server.HTTPException):
            asyncio.run(server._pot_by_token(self.db, "tok_abc"))

    def test_an_empty_token_never_matches_the_unshared_pot(self):
        # The pot now has share_token None. A blank token must not select it.
        asyncio.run(server.unshare_gift_pot(POT_ID, user=USER))
        for blank in ("", "   ", None):
            with self.assertRaises(server.HTTPException):
                asyncio.run(server._pot_by_token(self.db, blank))

    def test_another_household_cannot_revoke_this_link(self):
        other = dict(USER, family_id="fam_2")
        with self.assertRaises(server.HTTPException) as caught:
            asyncio.run(server.unshare_gift_pot(POT_ID, user=other))
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self._pot()["share_token"], "tok_abc")


if __name__ == "__main__":
    unittest.main()
