"""What a family IS, and who is allowed to read it.

A member row held a name, a picture, an age, a star target and a PIN. So the
app could say what was on today and nothing about the child it was on for —
and everything a parent is asked for in a hurry, usually BY somebody else, had
nowhere to live. The meal planner said the quiet part out loud: "check every
dish against any allergies in your family", an app admitting it knows allergies
matter and does not know yours.

This is a child's health information, so the tests that matter most are the
ones about who can read it and where it must never turn up.

Two tiers:
  * CARE facts — allergies, medicines, the doctor, the school — are for anyone
    trusted with the child. A nanny who cannot see the allergy is a nanny who
    cannot do the job.
  * PRIVATE identifiers — a health-service or insurance number — identify a
    person for life, are useless in an emergency, and should not spread one
    account further than they must. Full members only.

Both are written by full members only: a helper reads an allergy, they do not
get to change one.

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
    from fastapi import HTTPException
    from fake_mongo import FakeDatabase

PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
NANNY = {"user_id": "u_n", "family_id": "fam1", "name": "Esi", "email": "e@x.com",
         "is_helper": True}
OUTSIDER = {"user_id": "u_o", "family_id": "fam2", "name": "Stranger", "email": "s@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ChildRecord(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        for u in (PARENT, NANNY, OUTSIDER):
            asyncio.run(self.db["users"].insert_one({**u, "language": "en"}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_ama", "family_id": "fam1", "name": "Ama",
            "role": "child", "stars": 0}))
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_other", "family_id": "fam2", "name": "Elsewhere",
            "role": "child", "stars": 0}))

    def tearDown(self):
        server.get_db = self._get_db

    def read(self, who=PARENT, member="m_ama"):
        return asyncio.run(server.get_member_record(member, user=dict(who)))

    def write(self, who=PARENT, member="m_ama", **fields):
        return asyncio.run(server.update_member_record(
            member, server.MemberRecordIn(**fields), user=dict(who)))

    def member(self, member_id="m_ama"):
        return asyncio.run(self.db["family_members"].find_one({"member_id": member_id}))

    # --- the thing itself -------------------------------------------------

    def test_a_parent_can_write_and_read_it_back(self):
        self.write(allergies="Peanuts — EpiPen in the blue bag", shoe_size="12C")
        got = self.read()
        self.assertEqual(got["allergies"], "Peanuts — EpiPen in the blue bag")
        self.assertEqual(got["shoe_size"], "12C")

    def test_an_empty_record_reads_as_blanks_not_as_missing(self):
        # Every field present and empty, so the screen renders a form rather
        # than having to guess at a shape.
        got = self.read()
        for field in server.CARE_FIELDS:
            with self.subTest(field=field):
                self.assertEqual(got[field], "")

    def test_a_patch_touches_only_what_it_sends(self):
        # Two parents editing different halves from two phones must not
        # overwrite each other.
        self.write(allergies="Peanuts")
        self.write(school_name="St Mary's")
        got = self.read()
        self.assertEqual(got["allergies"], "Peanuts")
        self.assertEqual(got["school_name"], "St Mary's")

    def test_a_field_can_be_emptied(self):
        # A record that can be filled and never cleared ends up holding a stale
        # allergy, which is more dangerous than an absent one.
        self.write(allergies="Peanuts")
        self.write(allergies="")
        self.assertEqual(self.read()["allergies"], "")

    def test_whitespace_is_not_a_value(self):
        self.write(allergies="   ")
        self.assertEqual(self.read()["allergies"], "")

    # --- who may read it --------------------------------------------------

    def test_the_nanny_can_read_the_allergy(self):
        # The whole point of the care tier. A helper who cannot see this
        # cannot do the job they were invited to do.
        self.write(allergies="Peanuts", medications="Blue inhaler, before PE",
                   doctor_name="Dr Owusu", emergency_name="Grandma Efua")
        got = self.read(who=NANNY)
        self.assertEqual(got["allergies"], "Peanuts")
        self.assertEqual(got["medications"], "Blue inhaler, before PE")
        self.assertEqual(got["doctor_name"], "Dr Owusu")
        self.assertEqual(got["emergency_name"], "Grandma Efua")

    def test_the_nanny_is_not_given_the_identifiers(self):
        # Useless in an emergency, permanent, and not theirs to hold.
        self.write(medical_number="NHS 123 456 7890", insurance_policy="POL-9921")
        got = self.read(who=NANNY)
        for field in server.PRIVATE_FIELDS:
            with self.subTest(field=field):
                self.assertNotIn(field, got)
        self.assertNotIn("123 456 7890", repr(got))

    def test_the_nanny_is_told_something_is_hidden(self):
        # Silence is worse than a locked door: they would go asking a parent
        # for a number that is already recorded.
        self.assertTrue(self.read(who=NANNY)["private_hidden"])
        self.assertFalse(self.read(who=PARENT)["private_hidden"])

    def test_a_parent_sees_everything(self):
        self.write(medical_number="NHS 123")
        got = self.read()
        self.assertEqual(got["medical_number"], "NHS 123")
        self.assertFalse(got["private_hidden"])

    # --- who may change it ------------------------------------------------

    def test_the_nanny_cannot_change_an_allergy(self):
        self.write(allergies="Peanuts")
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.update_member_record(
                "m_ama", server.MemberRecordIn(allergies="None"),
                user=asyncio.run(server.require_full_member(user=dict(NANNY)))))
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(self.read()["allergies"], "Peanuts")

    def test_the_screen_is_told_whether_it_may_edit(self):
        self.assertTrue(self.read(who=PARENT)["can_edit"])
        self.assertFalse(self.read(who=NANNY)["can_edit"])

    # --- the household boundary -------------------------------------------

    def test_another_household_cannot_read_it(self):
        self.write(allergies="Peanuts")
        with self.assertRaises(HTTPException) as caught:
            self.read(who=OUTSIDER)
        self.assertEqual(caught.exception.status_code, 404)

    def test_another_household_cannot_write_it(self):
        with self.assertRaises(HTTPException) as caught:
            self.write(who=OUTSIDER, allergies="Wrong child")
        self.assertEqual(caught.exception.status_code, 404)
        self.assertIsNone((self.member("m_other") or {}).get("record"))

    def test_a_member_id_from_another_household_is_refused(self):
        # The id is real; it is simply not theirs.
        with self.assertRaises(HTTPException) as caught:
            self.read(member="m_other")
        self.assertEqual(caught.exception.status_code, 404)

    # --- where it must never turn up --------------------------------------

    def test_the_record_is_not_in_the_family_members_list(self):
        # public_member is an explicit allowlist, and this is why. That list is
        # fetched constantly, by helpers too, and every screen in the app.
        self.write(allergies="Peanuts", medical_number="NHS 123")
        rows = asyncio.run(server.family_members(user=dict(PARENT)))
        self.assertTrue(rows)
        for row in rows:
            with self.subTest(member=row["name"]):
                self.assertNotIn("record", row)
                for field in server.RECORD_FIELDS:
                    self.assertNotIn(field, row)
        self.assertNotIn("Peanuts", repr(rows))
        self.assertNotIn("NHS 123", repr(rows))

    def test_the_serialiser_never_invents_a_field(self):
        # A typo'd key in RECORD_FIELDS would silently create a field the
        # screen cannot show and nobody can clear.
        self.assertEqual(set(server.RECORD_FIELDS),
                         set(server.CARE_FIELDS) | set(server.PRIVATE_FIELDS))
        self.assertFalse(set(server.CARE_FIELDS) & set(server.PRIVATE_FIELDS))
        sent = set(server.MemberRecordIn().model_dump().keys())
        self.assertEqual(sent, set(server.RECORD_FIELDS))

    def test_a_long_value_is_refused_rather_than_truncated(self):
        # Silently cutting a medication instruction in half is worse than
        # refusing it.
        import pydantic
        with self.assertRaises(pydantic.ValidationError):
            server.MemberRecordIn(allergies="x" * (server.RECORD_MAX_LEN + 1))


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheTestDoubleTellsTheTruth(unittest.TestCase):
    """fake_mongo must nest a dotted $set, because Mongo does.

    It did not, and nothing noticed until this feature: the write appeared to
    succeed and the read came back empty. That is the worst way for a double to
    be wrong — quietly, and only for the thing you are trying to prove.
    """

    def setUp(self):
        self.db = FakeDatabase()

    def test_a_dotted_set_creates_the_parent(self):
        asyncio.run(self.db["t"].insert_one({"id": 1}))
        asyncio.run(self.db["t"].update_one({"id": 1}, {"$set": {"a.b": "x"}}))
        row = asyncio.run(self.db["t"].find_one({"id": 1}))
        self.assertEqual(row["a"], {"b": "x"})
        self.assertNotIn("a.b", row)

    def test_it_merges_rather_than_replaces_the_parent(self):
        # The property the record depends on: two parents editing different
        # fields must not overwrite each other.
        asyncio.run(self.db["t"].insert_one({"id": 1, "a": {"keep": "me"}}))
        asyncio.run(self.db["t"].update_one({"id": 1}, {"$set": {"a.b": "x"}}))
        row = asyncio.run(self.db["t"].find_one({"id": 1}))
        self.assertEqual(row["a"], {"keep": "me", "b": "x"})

    def test_it_goes_deeper_than_one_level(self):
        asyncio.run(self.db["t"].insert_one({"id": 1}))
        asyncio.run(self.db["t"].update_one({"id": 1}, {"$set": {"a.b.c": 3}}))
        self.assertEqual(asyncio.run(self.db["t"].find_one({"id": 1}))["a"], {"b": {"c": 3}})

    def test_a_plain_key_still_works(self):
        asyncio.run(self.db["t"].insert_one({"id": 1}))
        asyncio.run(self.db["t"].update_one({"id": 1}, {"$set": {"plain": 1}}))
        self.assertEqual(asyncio.run(self.db["t"].find_one({"id": 1}))["plain"], 1)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhoCannotEatWhat(ChildRecord):
    """The allergy line, where a kitchen can reach it.

    The meal planner has always said "check every dish against any allergies in
    your family" — an app telling you it knows allergies matter and does not
    know yours. This is the one care fact that has to travel to a different
    screen, and it travels ALONE: the rest of a child's health information has
    no business in a recipe.
    """

    def allergies(self, who=PARENT):
        return asyncio.run(server.family_allergies(user=dict(who)))

    def test_it_names_who_cannot_eat_what(self):
        self.write(allergies="Peanuts")
        self.assertEqual(self.allergies(), [
            {"member_id": "m_ama", "name": "Ama", "allergies": "Peanuts"}])

    def test_a_child_with_none_recorded_is_not_listed(self):
        # A row saying "Ama: nothing" is worse than no row: it reads as a
        # cleared allergy rather than an unasked question.
        self.assertEqual(self.allergies(), [])
        self.write(conditions="Asthma")
        self.assertEqual(self.allergies(), [])

    def test_whitespace_is_not_an_allergy(self):
        self.write(allergies="   ")
        self.assertEqual(self.allergies(), [])

    def test_the_carer_cooking_can_see_them(self):
        # The person at the stove is often not the parent who planned the week,
        # and a carer told to check against allergies they cannot see has been
        # told nothing.
        self.write(allergies="Peanuts")
        self.assertEqual(self.allergies(who=NANNY)[0]["allergies"], "Peanuts")

    def test_nothing_else_from_the_record_travels_with_it(self):
        # A recipe screen has no business holding a health-service number.
        self.write(allergies="Peanuts", medical_number="NHS 123",
                   doctor_name="Dr Owusu", medications="Blue inhaler")
        rows = self.allergies()
        self.assertEqual(sorted(rows[0]), ["allergies", "member_id", "name"])
        blob = repr(rows)
        for leak in ("NHS 123", "Dr Owusu", "Blue inhaler"):
            with self.subTest(leak=leak):
                self.assertNotIn(leak, blob)

    def test_another_household_is_not_included(self):
        asyncio.run(self.db["family_members"].update_one(
            {"member_id": "m_other"}, {"$set": {"record.allergies": "Shellfish"}}))
        self.write(allergies="Peanuts")
        self.assertEqual([r["name"] for r in self.allergies()], ["Ama"])

    def test_several_children_come_back_in_a_stable_order(self):
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "m_kojo", "family_id": "fam1", "name": "Kojo",
            "role": "child", "stars": 0}))
        self.write(allergies="Peanuts")
        self.write(member="m_kojo", allergies="Dairy")
        self.assertEqual([r["name"] for r in self.allergies()], ["Ama", "Kojo"])
