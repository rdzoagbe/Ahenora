"""Second-member activation is measurable, rung by rung.

The grant checklist (section 2) names the product's biggest validation gap
and asks for nine rungs: invitation sent, opened, accepted, second adult
joined, onboarded, first action, household multi-user, retained at 7 and
30 days. Two were recorded; these tests pin the rest.
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

ADMIN = {"user_id": "u_admin", "email": "boss@ahenora.test"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheRungsAreStamped(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._send = server.send_expo_push_messages

        async def quiet(messages, database=None):
            return {"sent": len(messages)}
        server.send_expo_push_messages = quiet
        self.now = server.utcnow()
        self.founder = {"user_id": "u_f", "family_id": "fam1", "name": "Roland", "email": "r@x.com",
                        "created_at": self.now - timedelta(days=30)}

        async def seed():
            await self.db["users"].insert_one(dict(self.founder))
            await self.db["family_members"].insert_one({"member_id": "m_f", "family_id": "fam1", "user_id": "u_f",
                                                        "name": "Roland", "role": "parent", "email": "r@x.com"})
            await self.db["families"].insert_one({"family_id": "fam1", "plan": "village", "billing_cycle": "monthly",
                                                  "grandfathered": False, "updated_at": self.now, "ai_scans_used": 0,
                                                  "ai_scans_period_start": self.now, "vault_bytes_used": 0})
            self.invite = server._new_invite_doc(self.founder, email="k@x.com")
            await self.db["family_invites"].insert_one(dict(self.invite))
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_expo_push_messages = self._send

    def stored_invite(self):
        return asyncio.run(self.db["family_invites"].find_one({"invite_id": self.invite["invite_id"]}))

    def test_a_new_invitation_starts_unopened(self):
        self.assertIsNone(self.stored_invite()["opened_at"])

    def test_following_the_link_marks_it_opened_once(self):
        asyncio.run(server.family_invite_lookup(self.invite["token"]))
        first = self.stored_invite()["opened_at"]
        self.assertIsNotNone(first)
        asyncio.run(server.family_invite_lookup(self.invite["token"]))
        self.assertEqual(self.stored_invite()["opened_at"], first, "the first sight is the one that counts")

    def test_seeing_the_join_card_in_the_app_marks_it_opened(self):
        keigh = {"user_id": "u_k", "family_id": "fam_other", "name": "Keigh", "email": "k@x.com"}
        asyncio.run(server.invites_for_me(user=keigh))
        self.assertIsNotNone(self.stored_invite()["opened_at"])

    def test_finishing_onboarding_is_timestamped(self):
        asyncio.run(server.complete_onboarding(user=dict(self.founder)))
        row = asyncio.run(self.db["users"].find_one({"user_id": "u_f"}))
        self.assertTrue(row["onboarding_completed"])
        self.assertIsNotNone(row["onboarding_completed_at"])

    def test_the_second_adult_joining_stamps_the_household(self):
        keigh = {"user_id": "u_k", "family_id": "fam_other", "name": "Keigh", "email": "k@x.com",
                 "created_at": self.now}
        asyncio.run(self.db["users"].insert_one(dict(keigh)))
        asyncio.run(server._accept_invite_for_user(self.db, keigh, self.invite, "fam1"))
        fam = asyncio.run(self.db["families"].find_one({"family_id": "fam1"}))
        self.assertIsNotNone(fam.get("second_adult_at"))
        self.assertEqual(fam.get("second_adult_user_id"), "u_k")

    def test_a_teen_joining_is_not_a_second_adult(self):
        teen_invite = server._new_invite_doc(self.founder, email="t@x.com", relationship="child", is_teen=True, age=15)
        asyncio.run(self.db["family_invites"].insert_one(dict(teen_invite)))
        teen = {"user_id": "u_t", "family_id": "fam_t", "name": "Tia", "email": "t@x.com", "created_at": self.now}
        asyncio.run(self.db["users"].insert_one(dict(teen)))
        asyncio.run(server._accept_invite_for_user(self.db, teen, teen_invite, "fam1"))
        fam = asyncio.run(self.db["families"].find_one({"family_id": "fam1"}))
        self.assertIsNone(fam.get("second_adult_at"))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheLadderInTheEvidence(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        server.ADMIN_EMAILS.add("boss@ahenora.test")
        now = server.utcnow()
        self.now = now

        def user(uid, fam, days_ago, active_days_ago, onboarded=True, teen=False):
            return {"user_id": uid, "family_id": fam, "email": f"{uid}@x.com", "is_teen": teen,
                    "created_at": now - timedelta(days=days_ago),
                    "last_active_at": now - timedelta(days=active_days_ago), "onboarding_completed": onboarded}

        async def seed():
            users = self.db["users"]
            fams = self.db["families"]
            # famA became multi-user 10 days ago (stamped); the joiner onboarded,
            # acted, and the household was active 2 days ago → D7 retained.
            await users.insert_one(user("a1", "famA", 40, 2))
            await users.insert_one(user("a2", "famA", 12, 2))
            await fams.insert_one({"family_id": "famA", "plan": "village", "second_adult_at": now - timedelta(days=10),
                                   "second_adult_user_id": "a2"})
            await self.db["cards"].insert_one({"card_id": "c1", "family_id": "famA", "created_by_user_id": "a2"})
            # famB became multi-user 9 days ago; the joiner never onboarded, never
            # acted, and nobody has been back since → in the D7 cohort, not retained.
            await users.insert_one(user("b1", "famB", 20, 9))
            await users.insert_one(user("b2", "famB", 9, 9, onboarded=False))
            await fams.insert_one({"family_id": "famB", "plan": "village", "second_adult_at": now - timedelta(days=9),
                                   "second_adult_user_id": "b2"})
            # famC: multi-user before the stamp existed. The later adult's account
            # date (45 days ago) stands in: in the D30 cohort, retained.
            await users.insert_one(user("c1", "famC", 60, 1))
            await users.insert_one(user("c2", "famC", 45, 1))
            await fams.insert_one({"family_id": "famC", "plan": "village"})
            # famD: one adult and a teen: never multi-user.
            await users.insert_one(user("d1", "famD", 5, 0))
            await users.insert_one(user("d2", "famD", 3, 0, teen=True))
            await fams.insert_one({"family_id": "famD", "plan": "village"})
            # famE: solo, became nothing.
            await users.insert_one(user("e1", "famE", 2, 0))
            await fams.insert_one({"family_id": "famE", "plan": "village"})

            inv = self.db["family_invites"]
            await inv.insert_one({"family_id": "famA", "status": "accepted", "created_at": now - timedelta(days=11),
                                  "opened_at": now - timedelta(days=11), "accepted_at": now - timedelta(days=10)})
            await inv.insert_one({"family_id": "famB", "status": "accepted", "created_at": now - timedelta(days=9),
                                  "opened_at": now - timedelta(days=9), "accepted_at": now - timedelta(days=9)})
            await inv.insert_one({"family_id": "famD", "status": "pending", "created_at": now - timedelta(days=4),
                                  "opened_at": now - timedelta(days=4)})
            await inv.insert_one({"family_id": "famE", "status": "pending", "created_at": now - timedelta(days=2),
                                  "opened_at": None})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db

    def evidence(self, **kw):
        return asyncio.run(server.metrics_grant_evidence(user=dict(ADMIN), database=self.db, **kw))

    def test_every_rung_has_a_definition(self):
        out = self.evidence()
        self.assertEqual(set(out["activation_ladder"]), set(out["activation_ladder_definitions"]))

    def test_invitations_sent_opened_accepted(self):
        l = self.evidence(days=30)["activation_ladder"]
        self.assertEqual(l["invitations_sent"], 4)
        self.assertEqual(l["invitations_opened"], 3)
        self.assertEqual(l["invitations_accepted"], 2)

    def test_second_adults_joined_onboarded_and_acted(self):
        l = self.evidence(days=30)["activation_ladder"]
        self.assertEqual(l["second_adults_joined"], 2)        # famA, famB (famC is older than the window)
        self.assertEqual(l["second_adults_onboarded"], 1)     # a2
        self.assertEqual(l["second_adults_first_action"], 1)  # a2 made a card

    def test_multi_user_households_and_retention(self):
        l = self.evidence(days=30)["activation_ladder"]
        self.assertEqual(l["multi_user_households"], 3)       # A, B, C; D has a teen, not an adult
        self.assertEqual(l["multi_user_d7_cohort"], 2)        # A (10d), B (9d)
        self.assertEqual(l["multi_user_retained_d7"], 1)      # A came back; B fell silent
        self.assertEqual(l["multi_user_d30_cohort"], 1)       # C (45d, estimated)
        self.assertEqual(l["multi_user_retained_d30"], 1)

    def test_time_to_second_adult_is_a_median_in_days(self):
        l = self.evidence(days=30)["activation_ladder"]
        # famA: first adult 40 days ago, stamped multi-user 10 days ago = 30 days.
        # famB: 20 days ago → 9 days ago = 11 days. Median of [11, 30] → 30 (upper middle).
        self.assertEqual(l["median_days_to_second_adult"], 30.0)

    def test_the_csv_carries_the_ladder_too(self):
        body = self.evidence(days=30, format="csv").body.decode()
        self.assertIn("ladder_second_adults_joined,2,", body)
        self.assertIn("ladder_multi_user_retained_d7,1,", body)
        self.assertNotIn("ladder_note", body)


if __name__ == "__main__":
    unittest.main()
