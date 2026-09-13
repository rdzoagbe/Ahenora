"""A clash warning that fires on ordinary tasks is worth nothing.

`GET /api/cards/conflicts` finds everything within two hours of a card's
due_date. It has never had a screen, and the unreachable-API ledger said so —
"no screen designed yet" — which turned out to be an honest entry rather than
an oversight.

The reason: EVERY dated card carries a clock time, because it has to sit
somewhere. A typed "dentist tomorrow" is parsed to 09:00 by dateParse; the
calendar's add button and the global capture sheet both default to 12:00.
Nothing recorded whether that time was chosen or supplied. So a window drawn
around any card with a date put "book the dentist" and "buy milk" inside each
other's, and a household adding two tasks on one evening would be warned they
clash. By the end of the week the warning would mean nothing, and it would
take the app's real alerts down with it — a person who has learned to dismiss
one banner dismisses the next.

So a card now records `time_set`: whether a person picked the time. Both sides
of the comparison need one. An unchosen time asks nothing, and a card with an
unchosen time answers nothing.

The backfill direction is the safe one. Cards written before this existed have
no flag, `bool(None)` is False, and they stay out of it — silence rather than
a false alarm on every card a household already owns.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest
from datetime import timedelta

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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatCountsAsAClash(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        self.when = server.utcnow() + timedelta(days=1)

    def tearDown(self):
        server.get_db = self._get_db

    def _card(self, card_id, *, offset_hours=0.0, time_set=True,
              status="OPEN", shared=True, title=None):
        asyncio.run(self.db["cards"].insert_one({
            "card_id": card_id, "family_id": "fam_1", "type": "APPOINTMENT",
            "title": title or card_id, "due_date": self.when + timedelta(hours=offset_hours),
            "status": status, "source": "MANUAL", "shared": shared,
            "recurrence": "none", "reminder_minutes": 60,
            "created_by_user_id": "u1", "created_at": server.utcnow(),
            "time_set": time_set,
        }))

    def _ask(self, *, time_set=True, exclude_id=None):
        return asyncio.run(server.card_conflicts(
            due_date=server.iso(self.when), exclude_id=exclude_id,
            time_set=time_set, user=USER))

    def test_a_chosen_time_finds_another_chosen_time(self):
        self._card("c1", offset_hours=1, title="Swimming lesson")
        found = self._ask()
        self.assertEqual([c["title"] for c in found], ["Swimming lesson"])

    def test_an_unchosen_time_asks_nothing(self):
        # The card being edited is sitting on a default hour, so it is not
        # evidence that anything clashes.
        self._card("c1", offset_hours=1)
        self.assertEqual(self._ask(time_set=False), [])

    def test_a_card_with_an_unchosen_time_answers_nothing(self):
        # The other half. A household's ordinary tasks all land on the same
        # default hour; if they answered, every one would clash with the rest.
        self._card("c1", offset_hours=1, time_set=False)
        self.assertEqual(self._ask(), [])

    def test_a_card_written_before_the_flag_existed_stays_out_of_it(self):
        asyncio.run(self.db["cards"].insert_one({
            "card_id": "old", "family_id": "fam_1", "type": "APPOINTMENT",
            "title": "From before", "due_date": self.when,
            "status": "OPEN", "source": "MANUAL", "shared": True,
            "recurrence": "none", "reminder_minutes": 60,
            "created_by_user_id": "u1", "created_at": server.utcnow(),
            # no time_set at all
        }))
        self.assertEqual(self._ask(), [])

    def test_something_finished_does_not_clash(self):
        self._card("c1", offset_hours=1, status="DONE")
        self.assertEqual(self._ask(), [])

    def test_the_card_being_edited_is_not_its_own_conflict(self):
        self._card("c1", offset_hours=0, title="This one")
        self.assertEqual(self._ask(exclude_id="c1"), [])

    def test_the_window_is_two_hours_either_side(self):
        self._card("before", offset_hours=-1.9, title="Just before")
        self._card("after", offset_hours=1.9, title="Just after")
        self._card("early", offset_hours=-3, title="Long before")
        self._card("late", offset_hours=3, title="Long after")
        titles = sorted(c["title"] for c in self._ask())
        self.assertEqual(titles, ["Just after", "Just before"])

    def test_an_empty_date_asks_nothing(self):
        # parse_dt returns None only for a falsy value, which is the one case
        # the handler's `if not target` guard actually catches.
        self._card("c1", offset_hours=1)
        out = asyncio.run(server.card_conflicts(
            due_date="", exclude_id=None, time_set=True, user=USER))
        self.assertEqual(out, [])

    def test_a_malformed_date_is_a_400_rather_than_a_silent_empty_answer(self):
        # Not the same thing as the case above, and worth pinning apart:
        # parse_dt RAISES for anything it cannot read. A warning endpoint that
        # answered "nothing clashes" to a date it could not parse would be
        # reassuring about a question it never asked.
        self._card("c1", offset_hours=1)
        with self.assertRaises(server.HTTPException) as caught:
            asyncio.run(server.card_conflicts(
                due_date="whenever", exclude_id=None, time_set=True, user=USER))
        self.assertEqual(caught.exception.status_code, 400)

    def test_another_household_is_never_the_answer(self):
        self._card("c1", offset_hours=1)
        asyncio.run(self.db["cards"].update_one(
            {"card_id": "c1"}, {"$set": {"family_id": "fam_2"}}))
        self.assertEqual(self._ask(), [])

    def test_a_private_item_somebody_else_owns_is_not_shown(self):
        # The visibility predicate is shared with the rest of the app on
        # purpose — re-implementing it here is how it drifts.
        self._card("c1", offset_hours=1, shared=False)
        asyncio.run(self.db["cards"].update_one(
            {"card_id": "c1"}, {"$set": {"created_by_user_id": "someone_else"}}))
        self.assertEqual(self._ask(), [])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheFlagSurvivesTheRoundTrip(unittest.TestCase):
    """A field that is stored but not served, or served but not stored, is a
    field the edit sheet silently resets."""

    def test_the_model_defaults_to_not_chosen(self):
        self.assertIs(server.CardIn(title="x").time_set, False)

    def test_a_patch_that_does_not_mention_it_leaves_it_alone(self):
        # None means "the client did not mention it" — the same rule as room.
        self.assertIsNone(server.CardPatchIn().time_set)

    def test_the_serialiser_reads_absent_as_not_chosen(self):
        card = {"card_id": "c", "family_id": "f", "type": "TASK", "title": "t",
                "status": "OPEN", "source": "MANUAL", "recurrence": "none",
                "reminder_minutes": 60, "created_at": server.utcnow()}
        self.assertIs(server.public_card(card)["time_set"], False)

    def test_the_serialiser_carries_a_chosen_time_back_out(self):
        card = {"card_id": "c", "family_id": "f", "type": "TASK", "title": "t",
                "status": "OPEN", "source": "MANUAL", "recurrence": "none",
                "reminder_minutes": 60, "created_at": server.utcnow(),
                "time_set": True}
        self.assertIs(server.public_card(card)["time_set"], True)


if __name__ == "__main__":
    unittest.main()
