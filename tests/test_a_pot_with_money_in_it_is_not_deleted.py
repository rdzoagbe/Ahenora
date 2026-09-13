"""A gift pot people have chipped into is closed, not deleted.

Two halves of one hole.

The pot screen only offers "Mark the gift as sorted" once `total_pledged > 0`.
So a pot created by mistake — wrong name, wrong person, changed their mind —
had no exit at all: no close, and `deleteGiftPot` existed on both sides of the
wire with nothing calling it. It sat in the Feed and the Calendar for good.

Wiring the delete up fixes that, and opens a worse one if it is left where it
was found: `delete_gift_pot` deleted unconditionally. A pot people have pledged
against carries what each of them said they would put in, and deleting it
throws that away with no record — the person who pledged £20 has nothing to
show they did.

The screen offers delete only at `total_pledged === 0`, but the screen's copy
of that number can be seconds out of date: a pot is chipped into from a share
link, by somebody the organiser never sees. So the refusal has to live on the
server, where the pot actually is.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

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
        self.deleted = []

    async def find_one(self, q, *a, **k):
        for r in self.rows:
            if all(r.get(key) == val for key, val in q.items()):
                return dict(r)
        return None

    async def delete_one(self, q, *a, **k):
        self.deleted.append(q)
        before = len(self.rows)
        self.rows = [r for r in self.rows
                     if not all(r.get(k2) == v for k2, v in q.items())]

        class R:
            deleted_count = before - len(self.rows)
        return R()


class FakeDB:
    def __init__(self, **colls):
        self.colls = colls

    def __getitem__(self, name):
        return self.colls.setdefault(name, FakeColl())


POT_ID = "pot_1"
USER = {"user_id": "u1", "family_id": "fam_1", "email": "a@b.test"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class DeletingAGiftPot(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self._require_feature = server.require_feature

        async def allow(*a, **k):
            return None
        server.require_feature = allow

    def tearDown(self):
        server.get_db = self._get_db
        server.require_feature = self._require_feature

    def _run(self, pot):
        pots = FakeColl([pot])
        server.get_db = lambda: FakeDB(gift_pots=pots)
        try:
            result = asyncio.run(server.delete_gift_pot(POT_ID, user=USER))
            return result, None, pots
        except server.HTTPException as e:  # noqa: PERF203 - the outcome under test
            return None, e, pots

    def test_an_empty_pot_just_goes(self):
        result, err, pots = self._run(
            {"pot_id": POT_ID, "family_id": "fam_1", "title": "Nan's birthday",
             "contributions": []})
        self.assertIsNone(err)
        self.assertEqual(result, {"ok": True})
        self.assertEqual(pots.rows, [])

    def test_a_pot_with_no_contributions_key_at_all_just_goes(self):
        # A pot minted before contributions were stored, or one whose list was
        # never written. Absent is empty, not "unknown, better keep it".
        result, err, pots = self._run(
            {"pot_id": POT_ID, "family_id": "fam_1", "title": "Nan's birthday"})
        self.assertIsNone(err)
        self.assertEqual(result, {"ok": True})
        self.assertEqual(pots.rows, [])

    def test_a_pot_somebody_chipped_into_is_refused(self):
        result, err, pots = self._run(
            {"pot_id": POT_ID, "family_id": "fam_1", "title": "Nan's birthday",
             "contributions": [{"name": "Kemi", "amount": 20}]})
        self.assertIsNone(result)
        self.assertIsNotNone(err)
        self.assertEqual(err.status_code, 409)
        # And it says where the other door is, because there is one.
        self.assertIn("sorted", err.detail.lower())

    def test_the_refused_pot_is_still_there(self):
        # The half that matters: a refusal that deleted anyway would be worse
        # than no refusal, because the error message would say it was kept.
        _, _, pots = self._run(
            {"pot_id": POT_ID, "family_id": "fam_1", "title": "Nan's birthday",
             "contributions": [{"name": "Kemi", "amount": 20}]})
        self.assertEqual(len(pots.rows), 1)
        self.assertEqual(pots.deleted, [])

    def test_another_household_cannot_delete_this_pot(self):
        pots = FakeColl([{"pot_id": POT_ID, "family_id": "fam_1",
                          "title": "Nan's birthday", "contributions": []}])
        server.get_db = lambda: FakeDB(gift_pots=pots)
        other = dict(USER, family_id="fam_2")
        with self.assertRaises(server.HTTPException) as caught:
            asyncio.run(server.delete_gift_pot(POT_ID, user=other))
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(len(pots.rows), 1)


if __name__ == "__main__":
    unittest.main()
