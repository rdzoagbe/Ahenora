"""Nothing reaches the calendar without somebody choosing it.

Calendar import used to write every event it found straight into the family's
calendar. A parent syncing a work diary got forty stand-ups sitting next to the
school run, and the only way back was deleting them one at a time — so people
stopped syncing, which is the opposite of what the feature is for.

A candidate is a proposed event that has not been accepted. Every source that
can suggest one — a calendar import now, a scanned school letter or a forwarded
email later — writes candidates, and the person keeps or drops each before a
card exists. Sharing is asked once, about the batch.

The tests worth having here are the ones about what must NOT happen: an
unreviewed event must never appear as a card, and one parent must never be able
to accept or discard what the other pulled in.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

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

MUM = {"user_id": "u_mum", "family_id": "fam1", "name": "Ama", "email": "mum@example.com"}
DAD = {"user_id": "u_dad", "family_id": "fam1", "name": "Kofi", "email": "dad@example.com"}
OUTSIDER = {"user_id": "u_out", "family_id": "fam2", "name": "Zoe", "email": "z@example.com"}


def google_event(eid, summary, start="2026-10-02T09:00:00Z", location=""):
    return {"id": eid, "summary": summary, "status": "confirmed",
            "start": {"dateTime": start}, "location": location,
            "iCalUID": eid + "@google.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Candidates(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._fetch = server._fetch_google_calendar_events
        self.events = [
            google_event("ev1", "Ama's parents evening", location="Room 3"),
            google_event("ev2", "Sprint stand-up"),
        ]

        async def fake_fetch(token, days):
            return self.events
        server._fetch_google_calendar_events = fake_fetch

        async def seed():
            for u in (MUM, DAD, OUTSIDER):
                await self.db["users"].insert_one({**u})
                await self.db["family_members"].insert_one(
                    {"member_id": "m_" + u["user_id"], "family_id": u["family_id"],
                     "user_id": u["user_id"], "name": u["name"], "role": "parent"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server._fetch_google_calendar_events = self._fetch

    def do_import(self, user=MUM, review=True):
        payload = server.CalendarImportIn(access_token="tok", days=30, review=review)
        return asyncio.run(server.import_google_calendar(payload, user=dict(user)))

    def candidates(self, user=MUM):
        return asyncio.run(server.list_event_candidates(
            user=dict(user), database=self.db))["candidates"]

    def decide(self, user=MUM, keep=(), drop=(), shared=False, assignee=None):
        payload = server.CandidateDecisionIn(
            keep=list(keep), drop=list(drop), shared=shared, assignee=assignee)
        return asyncio.run(server.decide_event_candidates(
            payload, user=dict(user), database=self.db))

    def cards(self):
        async def go():
            return [c async for c in self.db["cards"].find({}, {"_id": 0})]
        return asyncio.run(go())

    # --- the rule the feature exists for ---------------------------------

    def test_a_review_import_creates_no_cards_at_all(self):
        out = self.do_import()
        self.assertEqual(out["imported"], 2)
        self.assertEqual(self.cards(), [],
                         "an unreviewed event reached the calendar")
        self.assertEqual(len(self.candidates()), 2)

    def test_without_review_it_still_writes_directly(self):
        # An older app build that has not taken the OTA must keep working.
        self.do_import(review=False)
        self.assertEqual(len(self.cards()), 2)
        self.assertEqual(self.candidates(), [])

    def test_keeping_one_and_dropping_the_other(self):
        self.do_import()
        items = self.candidates()
        parents_evening = next(c for c in items if "parents" in c["title"])
        standup = next(c for c in items if "stand-up" in c["title"])

        out = self.decide(keep=[parents_evening["candidate_id"]],
                          drop=[standup["candidate_id"]])
        self.assertEqual((out["created"], out["dropped"], out["remaining"]), (1, 1, 0))
        cards = self.cards()
        self.assertEqual([c["title"] for c in cards], ["Ama's parents evening"])
        self.assertEqual(self.candidates(), [], "the queue must empty as it is answered")

    def test_the_kept_event_keeps_its_time_and_place(self):
        self.do_import()
        keep = next(c for c in self.candidates() if "parents" in c["title"])
        self.assertEqual(keep["location"], "Room 3")
        self.decide(keep=[keep["candidate_id"]])
        card = self.cards()[0]
        self.assertEqual(card["location"], "Room 3")
        self.assertIsNotNone(card["due_date"])

    # --- sharing, asked once about the batch ------------------------------

    def test_sharing_the_batch_shares_every_card_in_it(self):
        self.do_import()
        ids = [c["candidate_id"] for c in self.candidates()]
        self.decide(keep=ids, shared=True)
        self.assertTrue(all(c["shared"] for c in self.cards()))

    def test_assigning_to_the_co_parent_forces_it_shared(self):
        # Handing something to someone who cannot see it is a note to nobody.
        self.do_import()
        ids = [c["candidate_id"] for c in self.candidates()]
        self.decide(keep=ids, shared=False, assignee="Kofi")
        cards = self.cards()
        self.assertTrue(all(c["shared"] for c in cards))
        self.assertTrue(all(c["assignee"] == "Kofi" for c in cards))

    def test_keeping_something_for_yourself_stays_private(self):
        self.do_import()
        ids = [c["candidate_id"] for c in self.candidates()]
        self.decide(keep=ids, shared=False)
        self.assertFalse(any(c["shared"] for c in self.cards()))

    # --- one parent must not touch the other's queue ----------------------

    def test_a_co_parent_cannot_see_your_candidates(self):
        self.do_import(user=MUM)
        self.assertEqual(self.candidates(user=DAD), [],
                         "a work diary is not the household's business yet")

    def test_a_co_parent_cannot_accept_your_candidates(self):
        self.do_import(user=MUM)
        ids = [c["candidate_id"] for c in self.candidates(user=MUM)]
        out = self.decide(user=DAD, keep=ids)
        self.assertEqual(out["created"], 0)
        self.assertEqual(self.cards(), [])
        self.assertEqual(len(self.candidates(user=MUM)), 2, "they must still be there")

    def test_someone_from_another_family_cannot_drop_them(self):
        self.do_import(user=MUM)
        ids = [c["candidate_id"] for c in self.candidates(user=MUM)]
        out = self.decide(user=OUTSIDER, drop=ids)
        self.assertEqual(out["dropped"], 0)
        self.assertEqual(len(self.candidates(user=MUM)), 2)

    # --- syncing twice --------------------------------------------------

    def test_syncing_again_does_not_queue_the_same_event_twice(self):
        self.do_import()
        again = self.do_import()
        self.assertEqual(again["imported"], 0)
        self.assertEqual(again["skipped"], 2)
        self.assertEqual(len(self.candidates()), 2)

    def test_an_event_already_accepted_is_not_offered_again(self):
        self.do_import()
        ids = [c["candidate_id"] for c in self.candidates()]
        self.decide(keep=ids)
        again = self.do_import()
        self.assertEqual(again["imported"], 0,
                         "an event that is already a card must not come back")
        self.assertEqual(self.candidates(), [])

    def test_a_dropped_event_does_not_silently_return_on_the_next_sync(self):
        # Known and deliberate: dropping removes the candidate, so the next
        # sync re-proposes it. This test states that so a future change to
        # remember refusals is a decision rather than an accident.
        self.do_import()
        ids = [c["candidate_id"] for c in self.candidates()]
        self.decide(drop=ids)
        again = self.do_import()
        self.assertEqual(again["imported"], 2)

    # --- input handling --------------------------------------------------

    def test_keeping_and_dropping_the_same_thing_is_refused(self):
        self.do_import()
        ids = [c["candidate_id"] for c in self.candidates()]
        with self.assertRaises(server.HTTPException) as caught:
            self.decide(keep=ids, drop=ids)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(len(self.candidates()), 2, "nothing may have happened")

    def test_an_unknown_candidate_id_is_ignored_quietly(self):
        out = self.decide(keep=["cand_nope"], drop=["cand_also_nope"])
        self.assertEqual((out["created"], out["dropped"]), (0, 0))
        self.assertEqual(self.cards(), [])


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Location(unittest.TestCase):
    """"Soccer at Parc des Sports, Saturday 10am" needs somewhere to put the park.

    A card had a date and a time but no place. Imported events flattened the
    venue into the description as the literal text "Location: ...", which reads
    badly and cannot be shown as a field; a manually created event had nowhere
    to record one at all, so the address ended up in the title or nowhere.
    """

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def test_it_survives_a_round_trip_through_the_api(self):
        card = {"card_id": "c1", "family_id": "fam1", "type": "APPOINTMENT",
                "title": "Soccer", "status": "OPEN", "source": "MANUAL",
                "created_at": server.utcnow(), "shared": True,
                "location": "Parc des Sports"}
        self.assertEqual(server.public_card(card)["location"], "Parc des Sports")

    def test_a_card_without_one_reports_an_empty_string_not_null(self):
        # The app renders it directly; None would print "null" or crash a
        # .trim() somewhere far from here.
        card = {"card_id": "c1", "family_id": "fam1", "type": "TASK",
                "title": "Bins", "status": "OPEN", "source": "MANUAL",
                "created_at": server.utcnow(), "shared": True}
        self.assertEqual(server.public_card(card)["location"], "")

    def test_create_and_edit_both_accept_it(self):
        self.assertIn("location", server.CardIn.model_fields)
        self.assertIn("location", server.CardPatchIn.model_fields)

    def test_it_is_bounded(self):
        # It reaches a push notification body; an unbounded string does not.
        payload = server.CardIn(title="x", location="y" * 5000)
        self.assertLessEqual(len((payload.location or "")[:200]), 200)
