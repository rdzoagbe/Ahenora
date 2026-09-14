"""Two places where the AI failing looked exactly like the AI working.

Roland: "are you sure all the AI features do exactly what we say they do?"

Eight of the ten refuse honestly — an unreadable photo gets a 422 and costs
nothing, and the code records why the old behaviour went: "a guess presented
as an answer is worse than an honest blank", written after a gas bill was
filed with the permission slips. These two were the exceptions.

1. The weekly brief substituted a template and said nothing
------------------------------------------------------------
When the model could not answer, the server composed "This week's household
priorities are: <five card titles>. Focus first on items with dates..." and
returned it as the brief, with no flag. A sentence assembled by string
concatenation was being read as the model's take on a family's week.

The telling part: the app ALREADY had `brief_unable` for this, and it could
never fire, because the backend reported success either way. Somebody wrote
the honest path and the server routed around it.

2. A scan that read nothing still cost a scan
----------------------------------------------
/api/vision/extract charged whether or not anything was understood, reasoning
that the request cost what it cost. True of the API bill, and beside the point
for the person holding the phone: when nothing is read they get a blank card
they could have made in three taps, and on the free plan that is a tenth of
their month.

Every other scan route already declined to charge for a failure. This one was
the odd one out, and the inconsistency was invisible because each route counts
for itself.

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

USER = {"user_id": "u1", "family_id": "fam_1", "email": "a@b.test", "name": "Roland"}


def run(coro):
    return asyncio.run(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheBriefSaysWhoWroteIt(unittest.TestCase):

    def setUp(self):
        self._get_db, self._text = server.get_db, server._gemini_text
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        self._key = server.GOOGLE_API_KEY
        server.GOOGLE_API_KEY = "test-key"   # or the endpoint bails first
        run(self.db["families"].insert_one({
            "family_id": "fam_1", "name": "Test", "plan": "household",
            "billing_cycle": "monthly", "created_at": server.utcnow()}))
        run(self.db["cards"].insert_one({
            "card_id": "c1", "family_id": "fam_1", "title": "Dentist",
            "type": "APPOINTMENT", "status": "OPEN", "shared": True,
            "source": "MANUAL", "recurrence": "none", "reminder_minutes": 60,
            "created_by_user_id": "u1", "created_at": server.utcnow()}))

    def tearDown(self):
        server.get_db, server._gemini_text = self._get_db, self._text
        server.GOOGLE_API_KEY = self._key

    def ask(self):
        return run(server.weekly_brief(user=USER))

    def test_a_real_answer_is_marked_as_one(self):
        async def wrote(*a, **k):
            return "A calm week. One appointment, nothing overdue."
        server._gemini_text = wrote
        out = self.ask()
        self.assertTrue(out["written_by_ai"])
        self.assertIn("calm week", out["brief"])

    def test_a_fallback_says_it_is_a_fallback(self):
        """The whole finding. Without this flag the template is indis-
        tinguishable from the model's own words."""
        async def failed(*a, **k):
            raise RuntimeError("model unavailable")
        server._gemini_text = failed
        out = self.ask()
        self.assertFalse(out["written_by_ai"])

    def test_a_household_with_nothing_due_is_also_flagged(self):
        # A fixed sentence about a clear week is not a reading of anyone's
        # week either. My first version of this fix flagged only the
        # exception path and left two earlier returns unflagged; this test
        # is what found them.
        run(self.db["cards"].delete_many({}))
        self.assertFalse(self.ask()["written_by_ai"])

    def test_no_key_configured_is_flagged(self):
        server.GOOGLE_API_KEY = ""
        self.assertFalse(self.ask()["written_by_ai"])

    def test_the_fallback_is_still_useful_rather_than_an_error(self):
        # Degrading to a plain list of what is due is right; passing it off
        # as the brief was the problem, not the list.
        async def failed(*a, **k):
            raise RuntimeError("model unavailable")
        server._gemini_text = failed
        out = self.ask()
        self.assertIn("Dentist", out["brief"])
        self.assertTrue(out["generated_at"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AScanThatReadNothingCostsNothing(unittest.TestCase):

    def setUp(self):
        self._get_db = server.get_db
        self._vision = server._gemini_vision
        self._admin = server.is_admin_user
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        server.is_admin_user = lambda u: False
        self._key = server.GOOGLE_API_KEY
        server.GOOGLE_API_KEY = "test-key"   # or the endpoint bails first
        run(self.db["families"].insert_one({
            "family_id": "fam_1", "name": "Test", "plan": "village",
            "billing_cycle": "monthly", "ai_scans_used": 0,
            "created_at": server.utcnow()}))

    def tearDown(self):
        server.get_db = self._get_db
        server._gemini_vision = self._vision
        server.is_admin_user = self._admin
        server.GOOGLE_API_KEY = self._key

    def used(self):
        fam = run(self.db["families"].find_one({"family_id": "fam_1"}))
        return fam.get("ai_scans_used", 0)

    def scan(self):
        return run(server.vision_extract(
            server.VisionIn(image_base64="data:image/jpeg;base64,abc"), user=USER))

    def test_a_scan_that_read_something_is_charged(self):
        async def read(*a, **k):
            return ('{"kind":"document","type":"TASK","title":"School letter",'
                    '"description":"Sign and return.","assignee":"",'
                    '"due_date":null,"vault_category":"School",'
                    '"save_to_vault":true,"expires_on":null,"amount":null}')
        server._gemini_vision = read
        out = self.scan()
        self.assertTrue(out["understood"])
        self.assertEqual(self.used(), 1)

    def test_a_scan_that_read_nothing_is_not_charged(self):
        """The finding. A blank card the parent could have made in three taps
        must not cost a tenth of their month."""
        async def failed(*a, **k):
            raise RuntimeError("model unavailable")
        server._gemini_vision = failed
        out = self.scan()
        self.assertFalse(out.get("understood"))
        self.assertEqual(self.used(), 0)

    def test_an_unparseable_answer_is_not_charged_either(self):
        # Reaching the model and getting nonsense back is the same outcome
        # for the person holding the phone as not reaching it at all.
        async def nonsense(*a, **k):
            return "I'm afraid I can't help with that."
        server._gemini_vision = nonsense
        out = self.scan()
        self.assertFalse(out.get("understood"))
        self.assertEqual(self.used(), 0)

    def test_the_photograph_still_comes_back_so_the_scan_is_not_wasted(self):
        # Not charging must not mean not helping: the fallback card is still
        # returned, editable, so the parent carries on by hand.
        async def failed(*a, **k):
            raise RuntimeError("model unavailable")
        server._gemini_vision = failed
        out = self.scan()
        self.assertEqual(out["kind"], "document")
        self.assertTrue(out.get("title"))

    def test_it_now_matches_every_other_scan_route(self):
        """The inconsistency was invisible because each route counts for
        itself. Pinned so it cannot drift apart again."""
        src = open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8").read()
        self.assertIn("if extracted is not None and not is_admin_user(user):", src)


class TheAppShowsTheDifference(unittest.TestCase):
    """A flag the server sets and the app ignores is not a fix."""

    def modal(self):
        with open(os.path.join(ROOT, "frontend", "src", "components",
                               "SundayBriefModal.tsx"), encoding="utf-8") as handle:
            return handle.read()

    def test_it_reads_the_flag(self):
        self.assertIn("res.written_by_ai !== false", self.modal())

    def test_an_older_backend_is_not_accused_of_falling_back(self):
        # Absent means a server that predates the field, not a failure.
        self.assertIn("!== false", self.modal())

    def test_the_note_is_shown_before_the_text_not_after_it(self):
        """Someone who reads the whole brief and is told afterwards has
        already taken it as the model's read of their week."""
        text = self.modal()
        self.assertLess(text.index('testID="brief-not-ai"'),
                        text.index("styles.briefText"))

    def test_the_words_exist_in_every_language(self):
        with open(os.path.join(ROOT, "frontend", "src", "i18n.ts"),
                  encoding="utf-8") as handle:
            i18n = handle.read()
        self.assertEqual(i18n.count("  brief_fallback_note:"), 4)


if __name__ == "__main__":
    unittest.main()
