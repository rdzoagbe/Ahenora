"""A handover with an owner, and a way to say you have it.

A handoff note used to be shouted at the whole household: everyone got the
push, so the note was everybody's and therefore nobody's. There was no way to
say who it was for, and no way for them to say they had it — so the one
question a handover exists to answer, "has someone actually taken this on?",
had no answer anywhere in the app.

Two things are held here. **Addressing**: a note names one person, and only
someone who could actually pick it up may be named. **Acknowledgement**: that
person, and nobody else, can say they have it — which is not the same as
having read it. Chat already reports Seen, and Seen is a fact about someone's
eyes; this is a fact about their intentions.

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
    from fastapi import HTTPException
    from fake_mongo import FakeDatabase

ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
ESI = {"user_id": "u_e", "family_id": "fam1", "name": "Esi", "email": "e@x.com"}
KEIGH = {"user_id": "u_k", "family_id": "fam1", "name": "Keigh", "email": "k@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AddressedNotes(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.pushes = []

        async def fake_push(database, user_id, title, body, data, **kw):
            self.pushes.append({"to": user_id, "title": title, "body": body, "data": data})
            return {"ok": True}
        self._push = server.send_push_to_user
        server.send_push_to_user = fake_push

        self.shouts = []

        async def fake_shout(family_id, title, body, data_type, **kw):
            self.shouts.append({"title": title, "body": body})
        self._shout = server.send_coparent_alert
        server.send_coparent_alert = fake_shout

        for u in (ROLAND, ESI, KEIGH):
            asyncio.run(self.db["users"].insert_one({**u, "language": "en"}))
        # A household as the app builds one: two parents, a carer with a login,
        # a teen behind their own screen, and a child with no account at all.
        members = [
            ("m_r", "Roland", "Parent", "u_r"),
            ("m_e", "Esi", "Nanny", "u_e"),
            ("m_k", "Keigh", "Parent", "u_k"),
            ("m_t", "Kojo", "teen", "u_t"),
            ("m_c", "Ama", "child", None),
        ]
        for mid, name, role, uid in members:
            asyncio.run(self.db["family_members"].insert_one({
                "member_id": mid, "family_id": "fam1", "name": name,
                "role": role, "user_id": uid, "stars": 0}))

    def tearDown(self):
        server.get_db = self._get_db
        server.send_push_to_user = self._push
        server.send_coparent_alert = self._shout

    def write(self, text="Ama has swimming Thursday", member_id=None, who=ROLAND):
        return asyncio.run(server.create_handoff_note(
            server.HandoffNoteIn(member_id=member_id, text=text), user=dict(who)))

    def ack(self, note_id, who=ESI):
        return asyncio.run(server.ack_handoff_note(note_id, user=dict(who)))

    def notes_for(self, who):
        return asyncio.run(server.list_handoff_notes(user=dict(who)))

    # --- addressing -------------------------------------------------------

    def test_an_addressed_note_reaches_that_person_and_nobody_else(self):
        # The whole point. A household-wide shout is what made a note
        # everybody's and therefore nobody's.
        self.write(member_id="m_e")
        self.assertEqual([p["to"] for p in self.pushes], ["u_e"])
        self.assertEqual(self.shouts, [])
        self.assertIn("Roland left you a note", self.pushes[0]["title"])

    def test_an_unaddressed_note_still_tells_the_household(self):
        # Everyone stays the default, so nothing changes for a household using
        # notes the way they already work.
        self.write()
        self.assertEqual(self.pushes, [])
        self.assertEqual(len(self.shouts), 1)

    def test_it_carries_who_it_is_for(self):
        note = self.write(member_id="m_e")
        self.assertEqual(note["member_name"], "Esi")
        self.assertEqual(note["for_user_id"], "u_e")
        self.assertIsNone(note["acked_at"])

    def test_writing_one_to_yourself_pushes_nobody(self):
        self.write(member_id="m_r", who=ROLAND)
        self.assertEqual(self.pushes, [])
        self.assertEqual(self.shouts, [])

    def test_a_child_cannot_be_given_one(self):
        # They have no account, so it could never be picked up — the sender
        # would be told "not yet" forever, which is indistinguishable from a
        # note someone is about to take on.
        with self.assertRaises(HTTPException) as caught:
            self.write(member_id="m_c")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("Ama", caught.exception.detail)

    def test_a_teen_can_be_given_one(self):
        # They were refused at first because require_user rejects a teen token
        # — but that gate is about the parent app, not about them. They have
        # their own screen, and now their own way to take a note on.
        note = self.write(member_id="m_t")
        self.assertEqual(note["member_name"], "Kojo")
        self.assertEqual(note["for_user_id"], "u_t")
        self.assertEqual([p["to"] for p in self.pushes], ["u_t"])

    def test_a_refused_note_is_not_written_at_all(self):
        # A half-created note nobody can act on is worse than an error.
        with self.assertRaises(HTTPException):
            self.write(member_id="m_c")
        self.assertEqual(self.notes_for(ROLAND), [])

    def test_a_member_from_another_household_is_not_found(self):
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_x", "family_id": "fam2", "name": "Stranger",
            "role": "Parent", "user_id": "u_x"}))
        with self.assertRaises(HTTPException) as caught:
            self.write(member_id="m_x")
        self.assertEqual(caught.exception.status_code, 404)

    # --- who sees what ----------------------------------------------------

    def test_only_the_named_person_is_told_it_is_theirs(self):
        # for_me drives the strip at the top of the Feed and the button on it.
        self.write(member_id="m_e")
        self.assertTrue(self.notes_for(ESI)[0]["for_me"])
        self.assertFalse(self.notes_for(KEIGH)[0]["for_me"])
        self.assertFalse(self.notes_for(ROLAND)[0]["for_me"])

    def test_the_author_knows_they_wrote_it(self):
        self.write(member_id="m_e")
        self.assertTrue(self.notes_for(ROLAND)[0]["i_wrote_it"])
        self.assertFalse(self.notes_for(ESI)[0]["i_wrote_it"])

    # --- acknowledgement --------------------------------------------------

    def test_the_named_person_can_say_they_have_it(self):
        note = self.write(member_id="m_e")
        out = self.ack(note["note_id"])
        self.assertIsNotNone(out["acked_at"])
        self.assertEqual(out["acked_by_name"], "Esi")

    def test_it_tells_the_person_who_wrote_it(self):
        note = self.write(member_id="m_e")
        self.pushes.clear()
        self.ack(note["note_id"])
        self.assertEqual([p["to"] for p in self.pushes], ["u_r"])
        self.assertIn("Esi noted your handover", self.pushes[0]["title"])

    def test_nobody_else_can_take_it_on_for_them(self):
        # Otherwise the sender is told their handover is in hand by someone
        # who is not doing it, which is worse than not knowing.
        note = self.write(member_id="m_e")
        for impostor in (KEIGH, ROLAND):
            with self.subTest(who=impostor["name"]):
                with self.assertRaises(HTTPException) as caught:
                    self.ack(note["note_id"], who=impostor)
                self.assertEqual(caught.exception.status_code, 403)

    def test_an_unaddressed_note_cannot_be_acknowledged(self):
        # Nobody owns it, so nobody can speak for it.
        note = self.write()
        with self.assertRaises(HTTPException) as caught:
            self.ack(note["note_id"], who=ESI)
        self.assertEqual(caught.exception.status_code, 403)

    def test_saying_it_twice_does_not_tell_them_twice(self):
        # A second tap, a retried request or a stale screen must not push the
        # author again — and must not move the time it was taken on.
        note = self.write(member_id="m_e")
        first = self.ack(note["note_id"])
        self.pushes.clear()
        again = self.ack(note["note_id"])
        self.assertEqual(self.pushes, [])
        self.assertEqual(again["acked_at"], first["acked_at"])

    def test_a_note_from_another_household_is_not_found(self):
        asyncio.run(self.db["handoff_notes"].insert_one({
            "note_id": "note_x", "family_id": "fam2", "text": "hi",
            "for_user_id": "u_e", "created_at": server.utcnow()}))
        with self.assertRaises(HTTPException) as caught:
            self.ack("note_x", who=ESI)
        self.assertEqual(caught.exception.status_code, 404)

    def test_everyone_can_see_it_was_taken_on(self):
        # Including the co-parent who did not write it: the household's whole
        # reason for the feature is that the state is shared.
        note = self.write(member_id="m_e")
        self.ack(note["note_id"])
        for who in (ROLAND, ESI, KEIGH):
            with self.subTest(who=who["name"]):
                self.assertEqual(self.notes_for(who)[0]["acked_by_name"], "Esi")

    def test_nothing_nags_an_unacknowledged_note(self):
        # Deliberate: a note that sits there is a note someone has not got to.
        # The sender can see it is still open; the app does not chase it.
        note = self.write(member_id="m_e")
        self.pushes.clear()
        self.assertEqual(self.notes_for(ROLAND)[0]["acked_at"], None)
        self.assertEqual(self.pushes, [])
        self.assertIsNotNone(note["note_id"])


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ATeenTakesOneOn(AddressedNotes):
    """The same handover, through the other door.

    A teen never touches /api/handoff-notes: require_user refuses their token
    by design, and require_teen refuses everyone else's. So a note addressed to
    a teen reaches them through their own screen and is taken on through their
    own route — and the thing that must NOT differ is what any of it means.

    Inherits the parent-side setUp: same household, same fakes, same teen.
    """

    def teen(self):
        return {"user": dict(self.db_user("u_t")), "member": {}, "family_id": "fam1"}

    def db_user(self, uid):
        return asyncio.run(self.db["users"].find_one({"user_id": uid})) or {
            "user_id": uid, "family_id": "fam1", "name": "Kojo", "is_teen": True}

    def teen_home(self):
        return asyncio.run(server.teen_home(teen=self.teen()))

    def teen_ack(self, note_id):
        return asyncio.run(server.teen_ack_handoff_note(note_id, teen=self.teen()))

    def setUp(self):
        super().setUp()
        asyncio.run(self.db["users"].insert_one({
            "user_id": "u_t", "family_id": "fam1", "name": "Kojo",
            "email": "t@x.com", "language": "en", "is_teen": True}))

    def test_it_reaches_their_own_screen(self):
        note = self.write(member_id="m_t")
        home = self.teen_home()
        self.assertEqual([n["note_id"] for n in home["notes"]], [note["note_id"]])
        self.assertTrue(home["notes"][0]["for_me"])

    def test_they_are_not_shown_the_households_other_notes(self):
        # The wall is the feature. A teen sees handovers with their name on
        # them and nothing else — not the co-parents' notes to each other, not
        # one addressed to the nanny.
        self.write()                       # for everyone
        self.write(member_id="m_e")        # for the nanny
        mine = self.write(member_id="m_t")
        self.assertEqual([n["note_id"] for n in self.teen_home()["notes"]],
                         [mine["note_id"]])

    def test_they_can_say_they_have_it(self):
        note = self.write(member_id="m_t")
        out = self.teen_ack(note["note_id"])
        self.assertIsNotNone(out["acked_at"])
        self.assertEqual(out["acked_by_name"], "Kojo")

    def test_the_person_who_wrote_it_is_told(self):
        note = self.write(member_id="m_t")
        self.pushes.clear()
        self.teen_ack(note["note_id"])
        self.assertEqual([p["to"] for p in self.pushes], ["u_r"])
        self.assertIn("Kojo noted your handover", self.pushes[0]["title"])

    def test_a_parent_sees_it_was_taken_on(self):
        note = self.write(member_id="m_t")
        self.teen_ack(note["note_id"])
        self.assertEqual(self.notes_for(ROLAND)[0]["acked_by_name"], "Kojo")

    def test_a_teen_cannot_take_on_somebody_elses(self):
        # Being thirteen does not make "I have this" mean something different,
        # and it does not let them answer for the nanny.
        note = self.write(member_id="m_e")
        with self.assertRaises(HTTPException) as caught:
            self.teen_ack(note["note_id"])
        self.assertEqual(caught.exception.status_code, 403)

    def test_saying_it_twice_does_not_tell_them_twice(self):
        note = self.write(member_id="m_t")
        first = self.teen_ack(note["note_id"])
        self.pushes.clear()
        again = self.teen_ack(note["note_id"])
        self.assertEqual(self.pushes, [])
        self.assertEqual(again["acked_at"], first["acked_at"])

    def test_both_doors_are_the_same_rule(self):
        # The parent route and the teen route run one implementation, so a
        # difference here would mean the word had drifted between surfaces.
        import inspect
        parent = inspect.getsource(server.ack_handoff_note)
        teen = inspect.getsource(server.teen_ack_handoff_note)
        self.assertIn("_take_on_note", parent)
        self.assertIn("_take_on_note", teen)
