"""Every read path that prints card TITLES obeys the same visibility rule.

The rule already existed and was already written down — `_card_visible_to` for
adults, `_teen_can_see` for teens. What this file protects is that each place
which reads cards actually CALLS it, rather than carrying its own weaker copy.

Found in review of the daily-push change and in the privacy sweep after it,
all four the same shape:

  * the morning digest applied the teen rule and let every adult through, so a
    co-parent's private card title arrived in the other parent's 07:30 push;
  * the weekly brief filtered nothing at all, and posted those titles to an
    external model on the way;
  * the conflict check and the weekly report matched `shared: True` in the
    query — but an ASSIGNED card is shared AND narrowed by visible_to, which no
    $or expressed.

The search endpoint's own comment is the lesson: "re-implementing them in a
query language is exactly how a search box leaks a co-parent's private
documents". These are the places that had not followed it.

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

# Two co-parents and a helper — three adult accounts in one household, which is
# the shape every leak below needed.
ROLAND = {"user_id": "u1", "family_id": "fam1", "name": "Roland"}
KIM = {"user_id": "u2", "family_id": "fam1", "name": "Kim"}
HELPER = {"user_id": "u3", "family_id": "fam1", "name": "Sam"}

SECRET = "Divorce lawyer 14:00"


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ReadPathBase(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.now = server.utcnow()

        async def seed():
            for u, role in ((ROLAND, "Parent"), (KIM, "Parent"), (HELPER, "Helper")):
                await self.db["users"].insert_one({**u, "language": "en"})
                await self.db["family_members"].insert_one({
                    "member_id": "m" + u["user_id"], "family_id": "fam1",
                    "user_id": u["user_id"], "name": u["name"], "role": role})
            # Roland's PRIVATE card. Kim must never see this one.
            await self.db["cards"].insert_one({
                "card_id": "secret", "family_id": "fam1", "type": "TASK",
                "status": "OPEN", "title": SECRET, "shared": False,
                "created_by_user_id": ROLAND["user_id"],
                "due_date": self.now + timedelta(hours=3),
                "created_at": self.now, "source": "app"})
            # A task Roland assigned to Kim: shared, but SCOPED to the two of
            # them. Sam is an adult in the same family and is not on it.
            await self.db["cards"].insert_one({
                "card_id": "scoped", "family_id": "fam1", "type": "TASK",
                "status": "OPEN", "title": "Kim's therapy appointment",
                "shared": True, "assignee": "kim",
                "visible_to": [ROLAND["user_id"], KIM["user_id"]],
                "created_by_user_id": ROLAND["user_id"],
                "due_date": self.now + timedelta(hours=3),
                "created_at": self.now, "source": "app"})
            # An ordinary household item everyone should see.
            await self.db["cards"].insert_one({
                "card_id": "open", "family_id": "fam1", "type": "TASK",
                "status": "OPEN", "title": "Bins out", "shared": True,
                "created_by_user_id": ROLAND["user_id"],
                "due_date": self.now + timedelta(hours=3),
                "created_at": self.now, "source": "app"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheWeeklyBrief(ReadPathBase):
    def brief_for(self, user):
        # No GOOGLE_API_KEY in tests, so it takes the local wording path — which
        # still prints titles, and is the one a self-hosted deploy uses.
        key, server.GOOGLE_API_KEY = server.GOOGLE_API_KEY, ""
        try:
            return asyncio.run(server.weekly_brief(user=dict(user)))["brief"]
        finally:
            server.GOOGLE_API_KEY = key

    def test_a_co_parents_private_card_is_not_in_the_other_parents_brief(self):
        """It filtered nothing whatsoever."""
        self.assertNotIn(SECRET, self.brief_for(KIM))

    def test_the_owner_still_sees_their_own(self):
        self.assertIn(SECRET, self.brief_for(ROLAND))

    def test_a_scoped_task_does_not_reach_an_adult_outside_it(self):
        self.assertNotIn("therapy", self.brief_for(HELPER).lower())

    def test_the_household_item_still_reaches_everyone(self):
        for who in (ROLAND, KIM, HELPER):
            self.assertIn("Bins out", self.brief_for(who))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheConflictCheck(ReadPathBase):
    def clashes_for(self, user):
        at = server.iso(self.now + timedelta(hours=3))
        rows = asyncio.run(server.card_conflicts(due_date=at, user=dict(user)))
        return [r["title"] for r in rows]

    def test_a_private_card_is_not_offered_as_a_clash(self):
        self.assertNotIn(SECRET, self.clashes_for(KIM))

    def test_a_scoped_task_is_not_offered_to_an_adult_outside_it(self):
        """The $or matched `shared: True`, and a scoped card IS shared."""
        titles = self.clashes_for(HELPER)
        self.assertNotIn("Kim's therapy appointment", titles)

    def test_but_the_assignee_still_sees_their_own_clash(self):
        self.assertIn("Kim's therapy appointment", self.clashes_for(KIM))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheWeeklyReport(ReadPathBase):
    def upcoming_for(self, user):
        rep = asyncio.run(server.weekly_report(user=dict(user), database=self.db))
        rows = rep["upcoming_deadlines"]   # keyed, not .get: a wrong key here
        return [c["title"] for c in rows]  # would make every assertion vacuous

    def test_a_private_title_is_not_printed_in_a_co_parents_report(self):
        self.assertNotIn(SECRET, self.upcoming_for(KIM))

    def test_a_scoped_task_is_not_printed_for_an_adult_outside_it(self):
        self.assertNotIn("Kim's therapy appointment", self.upcoming_for(HELPER))

    def test_a_hidden_card_does_not_silently_eat_a_slot(self):
        """Filtering after the limit would have let a private item consume one
        of the ten places and push a real one off the end."""
        self.assertIn("Bins out", self.upcoming_for(HELPER))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheMorningDigest(ReadPathBase):
    """The push half of the same rule — this one reaches a LOCK SCREEN, where
    the title is readable without unlocking the phone."""

    def setUp(self):
        super().setUp()
        self.sent = []

        async def fake_push(database, user_id, title, body, data, **kw):
            self.sent.append({"user_id": user_id, "body": body})
        self._push = server.send_push_to_user
        server.send_push_to_user = fake_push

    def tearDown(self):
        server.send_push_to_user = self._push
        super().tearDown()

    def digest_for(self, user):
        self.sent = []
        user_doc = asyncio.run(self.db["users"].find_one(
            {"user_id": user["user_id"]}, {"_id": 0}))
        local = server._local_now("Europe/Paris", self.now)
        built = asyncio.run(server._build_morning_digest(
            self.db, user_doc, local, server.PUSH_I18N["en"]))
        return built[1] if built else ""

    def test_a_co_parents_private_card_never_reaches_the_other_lock_screen(self):
        """The first fix applied the teen rule and returned True for every
        adult, which left exactly this standing."""
        self.assertNotIn(SECRET, self.digest_for(KIM))

    def test_the_owner_is_still_reminded_of_their_own(self):
        self.assertIn(SECRET, self.digest_for(ROLAND))

    def test_a_scoped_task_stays_off_an_uninvolved_adults_phone(self):
        self.assertNotIn("therapy", self.digest_for(HELPER).lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
