"""Passports and vaccinations: dates that need you before they arrive.

Two of these had already shipped and neither could reach anybody.

`/api/vault/expiry-alerts` has computed "your passport expires in 10 days"
since it was written, and its only caller is the Vault screen — so the reminder
fired exactly when a parent went looking, and the Vault is the least-opened
screen in the app. A vaccination's `next_due` had the same shape: a chip on a
page nobody is on.

What these tests are really about is the OPPOSITE failure. The fix for silence
is notification, and the fix for notification going wrong is nagging — the
morning digest already carries a `DIGEST_OVERDUE_DAYS` floor because reading
the same three items out every morning was a real, reported bug. A passport
expiring in thirty days must not produce thirty notifications.

So: told once per stage, per date. A changed date is a new conversation; an
unchanged one is not.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

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

PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Roland",
          "email": "r@x.com", "language": "en"}
NANNY = {"user_id": "u_n", "family_id": "fam1", "name": "Esi",
         "email": "e@x.com", "language": "en", "is_helper": True}


def run(coro):
    return asyncio.run(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class DueDates(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.now = datetime(2026, 9, 11, 10, 0, tzinfo=timezone.utc)
        for u in (PARENT, NANNY):
            run(self.db["users"].insert_one(dict(u)))
        run(self.db["family_members"].insert_one({
            "member_id": "m_ama", "family_id": "fam1", "name": "Ama",
            "role": "child", "stars": 0}))

    def tearDown(self):
        server.get_db = self._get_db

    # --- helpers ----------------------------------------------------------

    def day(self, offset):
        return (self.now + timedelta(days=offset)).strftime("%Y-%m-%d")

    def add_vax(self, name="Tetanus", due_in=10, vax_id="v1"):
        run(self.db["family_members"].update_one(
            {"member_id": "m_ama"},
            {"$push": {"record.vaccinations": {
                "vax_id": vax_id, "name": name, "given_on": "",
                "next_due": self.day(due_in), "note": ""}}}))

    def add_doc(self, title="Ama's passport", expires_in=10, doc_id="d1",
                visibility="shared", owner=None):
        run(self.db["vault"].insert_one({
            "doc_id": doc_id, "family_id": "fam1", "title": title,
            "visibility": visibility, "owner_user_id": owner,
            "expiry_date": self.now + timedelta(days=expires_in)}))

    def build(self, who=PARENT):
        L = server.PUSH_I18N["en"]
        return run(server._build_due_dates(self.db, dict(who), self.now, L))

    # --- the thing itself -------------------------------------------------

    def test_nothing_to_say_is_silence(self):
        self.assertIsNone(self.build())

    def test_a_date_far_off_is_nobody_s_problem_yet(self):
        self.add_vax(due_in=365)
        self.add_doc(expires_in=200)
        self.assertIsNone(self.build())

    def test_a_vaccination_coming_up_is_named(self):
        self.add_vax(name="Tetanus", due_in=10)
        title, body = self.build()
        self.assertEqual(title, server.PUSH_I18N["en"]["due_title"])
        self.assertIn("Tetanus", body)
        # The child, not just the vaccine: a household with three children
        # needs to know whose appointment to book.
        self.assertIn("Ama", body)

    def test_a_document_expiring_is_named(self):
        self.add_doc(title="Ama's passport", expires_in=10)
        _, body = self.build()
        self.assertIn("passport", body)

    def test_an_overdue_item_reads_differently_from_an_upcoming_one(self):
        self.add_vax(due_in=-5)
        _, overdue = self.build()
        self.setUp()
        self.add_vax(due_in=10)
        _, upcoming = self.build()
        self.assertNotEqual(overdue, upcoming)

    # --- told once, which is the whole point ------------------------------

    def test_it_does_not_say_the_same_thing_tomorrow(self):
        # The failure this test exists for: thirty days' notice becoming
        # thirty notifications.
        self.add_vax(due_in=20)
        self.assertIsNotNone(self.build())
        self.assertIsNone(self.build())
        self.assertIsNone(self.build())

    def test_a_document_is_told_once_too(self):
        self.add_doc(expires_in=20)
        self.assertIsNotNone(self.build())
        self.assertIsNone(self.build())

    def test_the_heads_up_does_not_swallow_the_day_itself(self):
        # Two stages, so an item that was flagged weeks ago still speaks up
        # when it actually arrives.
        self.add_vax(due_in=20)
        self.assertIsNotNone(self.build())   # 'soon'
        self.assertIsNone(self.build())
        self.now += timedelta(days=21)       # now overdue
        again = self.build()
        self.assertIsNotNone(again)
        self.assertIsNone(self.build())      # and only once

    def test_and_never_more_than_twice_for_one_date(self):
        self.add_vax(due_in=20)
        said = 0
        for offset in range(0, 60, 3):
            self.now = datetime(2026, 9, 11, 10, 0, tzinfo=timezone.utc) + timedelta(days=offset)
            if self.build():
                said += 1
        self.assertEqual(said, 2, "one heads-up and one it-is-here, no more")

    def test_a_changed_date_is_a_new_conversation(self):
        # A renewed passport has a new expiry. Staying quiet about it because
        # we spoke about the OLD date is how a renewal quietly lapses.
        self.add_doc(expires_in=10)
        self.assertIsNotNone(self.build())
        self.assertIsNone(self.build())
        run(self.db["vault"].update_one(
            {"doc_id": "d1"},
            {"$set": {"expiry_date": self.now + timedelta(days=20)}}))
        self.assertIsNotNone(self.build())

    # --- who hears which half ---------------------------------------------

    def test_a_helper_hears_about_a_vaccination(self):
        # Care tier: a nanny at a clinic desk is exactly who needs this.
        self.add_vax(due_in=10)
        _, body = self.build(NANNY)
        self.assertIn("Tetanus", body)

    def test_a_helper_never_hears_about_a_document(self):
        # list_vault is require_full_member — a helper cannot open the Vault,
        # so naming a document to them is the same leak arriving by push.
        self.add_doc(title="Insurance policy", expires_in=10)
        self.assertIsNone(self.build(NANNY))

    def test_a_private_document_stays_with_its_owner(self):
        self.add_doc(title="Roland's will", expires_in=10,
                     visibility="private", owner="u_other")
        self.assertIsNone(self.build())

    def test_a_private_document_reaches_its_own_owner(self):
        self.add_doc(title="Roland's will", expires_in=10,
                     visibility="private", owner="u_p")
        _, body = self.build()
        self.assertIn("will", body)

    # --- bad data does not produce a bad reminder -------------------------

    def test_an_unreadable_date_is_skipped_not_guessed(self):
        run(self.db["family_members"].update_one(
            {"member_id": "m_ama"},
            {"$push": {"record.vaccinations": {
                "vax_id": "bad", "name": "Tetanus", "next_due": "someday"}}}))
        self.assertIsNone(self.build())

    def test_a_nameless_item_is_skipped(self):
        # "and 1 more" is useless; an unnamed row cannot be acted on.
        run(self.db["vault"].insert_one({
            "doc_id": "d9", "family_id": "fam1", "title": "",
            "visibility": "shared",
            "expiry_date": self.now + timedelta(days=5)}))
        self.assertIsNone(self.build())

    def test_another_household_is_never_mentioned(self):
        run(self.db["vault"].insert_one({
            "doc_id": "dx", "family_id": "fam2", "title": "Someone else",
            "visibility": "shared",
            "expiry_date": self.now + timedelta(days=5)}))
        self.assertIsNone(self.build())

    # --- the job is actually wired ----------------------------------------

    def test_the_job_is_registered_and_not_on_top_of_the_digest(self):
        job = next((j for j in server.DAILY_PUSH_JOBS if j["key"] == "due_dates"), None)
        self.assertIsNotNone(job, "the builder exists but nothing runs it")
        self.assertIs(job["build"], server._build_due_dates)
        self.assertTrue(job.get("adults_only"))
        # Its own claim field, or it would fight the digest for the day.
        claims = [j["claim"] for j in server.DAILY_PUSH_JOBS]
        self.assertEqual(len(claims), len(set(claims)))
        # Not in the same minute as another job: two pushes at once get both
        # swiped away.
        slots = [(j["hour"], j["minute"]) for j in server.DAILY_PUSH_JOBS]
        self.assertEqual(len(slots), len(set(slots)))

    def test_every_language_can_say_it(self):
        keys = ("due_title", "due_one_soon", "due_one_now",
                "due_many_soon", "due_many_now")
        for lang, table in server.PUSH_I18N.items():
            for key in keys:
                with self.subTest(lang=lang, key=key):
                    self.assertIn(key, table)
                    self.assertTrue(table[key].strip())


if __name__ == "__main__":
    unittest.main()
