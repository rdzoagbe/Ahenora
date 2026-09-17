"""A card carries an icon that says what it is about.

Roland: "a birthday has a cake, cleaning a broom, bed laying, car pool a car,
and these show at the left side of each event or task." The server guesses
the icon from the title when the card is written, in the four languages the
app speaks, so every phone and every source agree; a person can override it;
and everything written before this existed is filled in once at boot.
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from card_icons import ICONS, guess_icon, normalize_icon, UnknownIcon  # noqa: E402

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fastapi import HTTPException
    from fake_mongo import FakeDatabase


class TheGuess(unittest.TestCase):
    def test_rolands_four_examples(self):
        self.assertEqual(guess_icon("Ama's birthday party"), "birthday")
        self.assertEqual(guess_icon("Tidy your room"), "cleaning")
        self.assertEqual(guess_icon("Make your bed"), "bed")
        self.assertEqual(guess_icon("Carpool to school"), "car")

    def test_every_language_the_app_speaks(self):
        for title in ("Anniversaire de Léo", "Cumpleaños de Ama", "Geburtstag von Leo"):
            self.assertEqual(guess_icon(title), "birthday", title)
        for title in ("Faire le lit", "Hacer la cama", "Ins Bett"):
            self.assertEqual(guess_icon(title), "bed", title)
        for title in ("Sortir les poubelles", "Sacar la basura", "Müll rausbringen"):
            self.assertEqual(guess_icon(title), "bins", title)
        for title in ("Devoirs de maths", "Deberes", "Hausaufgaben machen"):
            self.assertEqual(guess_icon(title), "homework", title)

    def test_accents_and_case_do_not_matter(self):
        self.assertEqual(guess_icon("FUSSBALL"), "sport")
        self.assertEqual(guess_icon("Fußball"), "sport")
        self.assertEqual(guess_icon("zähne putzen"), "bath")

    def test_a_word_inside_another_word_is_not_a_match(self):
        """"carrot" is not a car. "Il lit" is reading, not a bed."""
        self.assertEqual(guess_icon("Buy carrots"), "shopping")
        self.assertIsNone(guess_icon("Il lit un livre"))

    def test_the_french_conjunction_car_is_not_a_car(self):
        self.assertEqual(guess_icon("Appelle le médecin car il est malade"), "doctor")

    def test_the_specific_beats_the_general(self):
        self.assertEqual(guess_icon("Dentist appointment for Ama"), "dentist")
        self.assertEqual(guess_icon("Doctor's checkup"), "doctor")
        self.assertEqual(guess_icon("Brush teeth"), "bath")
        self.assertEqual(guess_icon("Pick up Leo from school"), "car")
        self.assertEqual(guess_icon("School play"), "school")

    def test_nothing_sure_means_no_icon(self):
        self.assertIsNone(guess_icon("Something"))
        self.assertIsNone(guess_icon(""))
        self.assertIsNone(guess_icon(None))

    def test_the_type_answers_when_the_words_do_not(self):
        self.assertEqual(guess_icon("Something", "BIRTHDAY"), "birthday")
        self.assertEqual(guess_icon("Something", "VACATION"), "travel")
        self.assertIsNone(guess_icon("Something", "TASK"))
        # But the words win over the type when they say something.
        self.assertEqual(guess_icon("Dentist", "BIRTHDAY"), "dentist")

    def test_every_key_has_a_glyph_and_words(self):
        from card_icons import _KEYWORDS
        keyed = {k for k, _ in _KEYWORDS}
        self.assertEqual(keyed, set(ICONS))
        for key, glyph in ICONS.items():
            self.assertTrue(glyph, key)

    def test_a_choice_is_a_key_or_its_glyph(self):
        self.assertEqual(normalize_icon("birthday"), "birthday")
        self.assertEqual(normalize_icon("Birthday "), "birthday")
        self.assertEqual(normalize_icon("🎂"), "birthday")
        self.assertIsNone(normalize_icon(""))
        self.assertIsNone(normalize_icon(None))
        with self.assertRaises(UnknownIcon):
            normalize_icon("bithday")
        with self.assertRaises(UnknownIcon):
            normalize_icon("🍕")


ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com", "role": "parent"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class OnACard(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._send = server.send_expo_push_messages

        async def quiet(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = quiet

        async def seed():
            await self.db["families"].insert_one({
                "family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
                "grandfathered": False, "updated_at": server.utcnow(),
                "ai_scans_used": 0, "ai_scans_period_start": server.utcnow(), "vault_bytes_used": 0,
            })
            await self.db["users"].insert_one({**ROLAND})
            await self.db["family_members"].insert_one({
                "member_id": "m_r", "family_id": "fam1", "user_id": "u_r",
                "name": "Roland", "role": "parent", "email": "r@x.com"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._send

    def create(self, **kw):
        body = {"type": "TASK", "title": "Dentist letter", **kw}
        return asyncio.run(server.create_card(server.CardIn(**body), user=dict(ROLAND)))

    def patch(self, card_id, **kw):
        return asyncio.run(server.update_card(card_id, server.CardPatchIn(**kw), user=dict(ROLAND)))

    def stored(self, card_id):
        return asyncio.run(self.db["cards"].find_one({"card_id": card_id}))

    def test_the_server_guesses_when_nobody_chose(self):
        card = self.create(title="Ama's birthday party")
        self.assertEqual(card["icon"], "birthday")
        self.assertTrue(self.stored(card["card_id"])["icon_auto"])

    def test_a_choice_wins_over_the_guess(self):
        card = self.create(title="Ama's birthday party", icon="gift")
        self.assertEqual(card["icon"], "gift")
        self.assertFalse(self.stored(card["card_id"])["icon_auto"])

    def test_the_glyph_is_accepted_as_the_choice(self):
        self.assertEqual(self.create(title="x", icon="🧹")["icon"], "cleaning")

    def test_an_empty_choice_means_no_icon_and_no_guessing(self):
        card = self.create(title="Ama's birthday party", icon="")
        self.assertIsNone(card["icon"])
        self.assertFalse(self.stored(card["card_id"])["icon_auto"])

    def test_a_made_up_icon_is_refused_not_stored(self):
        with self.assertRaises(HTTPException) as ctx:
            self.create(title="x", icon="bithday")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_a_retitled_guessed_card_is_guessed_again(self):
        card = self.create(title="Dentist for Ama")
        self.assertEqual(card["icon"], "dentist")
        after = self.patch(card["card_id"], title="Football for Ama")
        self.assertEqual(after["icon"], "sport")

    def test_a_retitled_card_with_a_chosen_icon_keeps_it(self):
        card = self.create(title="Dentist for Ama", icon="gift")
        after = self.patch(card["card_id"], title="Football for Ama")
        self.assertEqual(after["icon"], "gift")

    def test_a_retitle_can_take_the_icon_away(self):
        card = self.create(title="Dentist for Ama")
        after = self.patch(card["card_id"], title="Something else")
        self.assertIsNone(after["icon"])

    def test_a_person_can_change_or_clear_it_on_edit(self):
        card = self.create(title="Dentist for Ama")
        self.assertEqual(self.patch(card["card_id"], icon="doctor")["icon"], "doctor")
        self.assertIsNone(self.patch(card["card_id"], icon="")["icon"])
        # And once cleared it stays cleared through a retitle.
        self.assertIsNone(self.patch(card["card_id"], title="Dentist again")["icon"])

    def test_a_made_up_icon_is_refused_on_edit_too(self):
        card = self.create(title="x")
        with self.assertRaises(HTTPException) as ctx:
            self.patch(card["card_id"], icon="🍕")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_a_card_written_before_icons_existed_is_guessed_on_retitle(self):
        asyncio.run(self.db["cards"].insert_one({
            "card_id": "old", "family_id": "fam1", "type": "TASK", "title": "Old",
            "status": "OPEN", "source": "MANUAL", "created_at": server.utcnow(),
            "shared": True, "created_by_user_id": "u_r"}))
        self.assertEqual(self.patch("old", title="Walk the dog")["icon"], "pet")

    def test_the_feed_reads_it_back(self):
        self.create(title="Walk the dog")
        rows = asyncio.run(server.list_cards(status=None, user=dict(ROLAND)))
        self.assertEqual([r["icon"] for r in rows], ["pet"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class OnEverythingElseThatIsBorn(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._send = server.send_expo_push_messages

        async def quiet(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = quiet
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_r", "family_id": "fam1", "user_id": "u_r",
            "name": "Roland", "role": "parent", "email": "r@x.com"}))

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._send

    def test_a_chore(self):
        chore = asyncio.run(server.create_chore(
            server.ChoreIn(title="Sortir les poubelles"), user=dict(ROLAND), database=self.db))
        self.assertEqual(chore["icon"], "bins")
        chosen = asyncio.run(server.create_chore(
            server.ChoreIn(title="Sortir les poubelles", icon="pet"), user=dict(ROLAND), database=self.db))
        self.assertEqual(chosen["icon"], "pet")
        with self.assertRaises(HTTPException):
            asyncio.run(server.create_chore(
                server.ChoreIn(title="x", icon="nope"), user=dict(ROLAND), database=self.db))

    def test_a_routine_and_its_edit(self):
        routine = asyncio.run(server.create_routine(
            server.RoutineIn(name="Bedtime routine", steps=[]), user=dict(ROLAND), database=self.db))
        self.assertEqual(routine["icon"], "bed")
        renamed = asyncio.run(server.update_routine(
            routine["routine_id"], server.RoutinePatchIn(name="Morning teeth"),
            user=dict(ROLAND), database=self.db))
        self.assertEqual(renamed["icon"], "dentist")
        chosen = asyncio.run(server.update_routine(
            routine["routine_id"], server.RoutinePatchIn(icon="bath"),
            user=dict(ROLAND), database=self.db))
        self.assertEqual(chosen["icon"], "bath")
        kept = asyncio.run(server.update_routine(
            routine["routine_id"], server.RoutinePatchIn(name="Evening"),
            user=dict(ROLAND), database=self.db))
        self.assertEqual(kept["icon"], "bath")

    def test_a_scanned_appointment_carries_it_into_the_card(self):
        staged = asyncio.run(server.stage_scanned_event(
            server.ScanEventIn(title="Dentist appointment", due_date="2026-10-01T09:00:00Z"),
            user=dict(ROLAND), database=self.db))
        cand = asyncio.run(self.db["event_candidates"].find_one({"candidate_id": staged["candidate_id"]}))
        self.assertEqual(cand["icon"], "dentist")
        self.assertEqual(server.public_candidate(cand)["icon"], "dentist")
        asyncio.run(server.decide_event_candidates(
            server.CandidateDecisionIn(keep=[staged["candidate_id"]], drop=[]),
            user=dict(ROLAND), database=self.db))
        card = asyncio.run(self.db["cards"].find_one({"title": "Dentist appointment"}))
        self.assertEqual(card["icon"], "dentist")
        self.assertTrue(card["icon_auto"])

    def test_a_voice_draft_carries_it(self):
        draft = server._safe_voice_draft({"title": "Walk the dog", "type": "TASK"})
        self.assertEqual(draft["icon"], "pet")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheFirstMorning(unittest.TestCase):
    """Everything written before icons existed is filled in once at boot."""

    def setUp(self):
        self.db = FakeDatabase()

        async def seed():
            await self.db["cards"].insert_one({"card_id": "c1", "title": "Walk the dog", "type": "TASK"})
            await self.db["cards"].insert_one({"card_id": "c2", "title": "Something", "type": "BIRTHDAY"})
            await self.db["cards"].insert_one({"card_id": "c3", "title": "Nothing here", "type": "TASK"})
            # Already decided by a person: must not be touched.
            await self.db["cards"].insert_one({"card_id": "c4", "title": "Walk the dog",
                                               "icon": "gift", "icon_auto": False})
            await self.db["chores"].insert_one({"chore_id": "h1", "title": "Tidy your room"})
            await self.db["routines"].insert_one({"routine_id": "r1", "name": "Bedtime"})
        asyncio.run(seed())

    def test_legacy_rows_get_an_icon_and_are_visited_once(self):
        counts = asyncio.run(server.backfill_icons(self.db))
        self.assertEqual(counts, {"cards": 3, "chores": 1, "routines": 1})
        rows = {r["card_id"]: r for r in asyncio.run(self.db["cards"].find({}).to_list(None))}
        self.assertEqual(rows["c1"]["icon"], "pet")
        self.assertEqual(rows["c2"]["icon"], "birthday")
        self.assertIsNone(rows["c3"]["icon"])
        self.assertTrue(rows["c3"]["icon_auto"], "a row nothing matched is still a row looked at")
        self.assertEqual(rows["c4"]["icon"], "gift")
        self.assertFalse(rows["c4"]["icon_auto"])
        chore = asyncio.run(self.db["chores"].find_one({"chore_id": "h1"}))
        self.assertEqual(chore["icon"], "cleaning")
        routine = asyncio.run(self.db["routines"].find_one({"routine_id": "r1"}))
        self.assertEqual(routine["icon"], "bed")
        # Second boot: nothing left to do.
        self.assertEqual(asyncio.run(server.backfill_icons(self.db)),
                         {"cards": 0, "chores": 0, "routines": 0})

    def test_no_database_is_not_an_error(self):
        self.assertEqual(asyncio.run(server.backfill_icons(None)) if server.db is None else {}, {})


if __name__ == "__main__":
    unittest.main()
