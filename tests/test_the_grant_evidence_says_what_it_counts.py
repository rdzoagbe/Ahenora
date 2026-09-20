"""Every figure in the grant appendix travels with the sentence that defines it.

The grant strategy (20 September 2026): "the application should contain
reproducible tables with definitions and date ranges", and a list of what not
to claim — registered households are not active customers, three purchases
are not a conversion benchmark. This endpoint is the appendix, regenerable
the week before filing, and these tests pin each definition to what the
count actually does.
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

ADMIN = {"user_id": "u_admin", "email": "boss@ahenora.test"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheGrantEvidence(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        server.ADMIN_EMAILS.add("boss@ahenora.test")
        self.now = server.utcnow()

        def user(uid, fam, days_ago, active_days_ago=None, onboarded=True, role="parent", email=None):
            return {"user_id": uid, "family_id": fam, "email": email or f"{uid}@x.com", "role": role,
                    "created_at": self.now - timedelta(days=days_ago),
                    "last_active_at": (self.now - timedelta(days=active_days_ago))
                    if active_days_ago is not None else None,
                    "onboarding_completed": onboarded}

        async def seed():
            users = self.db["users"]
            # famA: two adults, one paying, active this week. Signed up 40 days
            # ago and used the app 3 days ago: retained at D7 and D30.
            await users.insert_one(user("u1", "famA", 40, 3))
            await users.insert_one(user("u2", "famA", 20, 1))
            # famB: solo, signed up 10 days ago, never came back: in the D7
            # cohort and not retained.
            await users.insert_one(user("u3", "famB", 10, 10, onboarded=False))
            # famC: solo, signed up 2 days ago, too young for any cohort.
            await users.insert_one(user("u4", "famC", 2, 0))
            # A teen account and a child profile never count as adults.
            await users.insert_one(user("t1", "famA", 5, 0, role="teen"))
            await self.db["family_members"].insert_one({"member_id": "m_kid", "family_id": "famA", "name": "Ama", "role": "child"})
            # The admin's own household is never a paying household.
            await users.insert_one(user("u_admin", "famAdmin", 200, 0, email="boss@ahenora.test"))

            fams = self.db["families"]
            await fams.insert_one({"family_id": "famA", "plan": "household", "grandfathered": False, "ai_scans_used": 4})
            await fams.insert_one({"family_id": "famB", "plan": "village", "ai_scans_used": 1})
            await fams.insert_one({"family_id": "famC", "plan": "executive", "grandfathered": True})
            await fams.insert_one({"family_id": "famAdmin", "plan": "executive", "grandfathered": False})

            cards = self.db["cards"]
            await cards.insert_one({"card_id": "c1", "family_id": "famA", "status": "DONE", "shared": True})
            await cards.insert_one({"card_id": "c2", "family_id": "famA", "status": "OPEN", "shared": False})
            await cards.insert_one({"card_id": "c3", "family_id": "famB", "status": "OPEN", "shared": False})
            await self.db["vault"].insert_one({"doc_id": "d1", "family_id": "famA"})
            await self.db["meals"].insert_one({"meal_id": "m1", "family_id": "famA"})
            await self.db["shopping_list"].insert_one({"item_id": "s1", "family_id": "famA"})

            inv = self.db["family_invites"]
            await inv.insert_one({"family_id": "famA", "status": "accepted",
                                  "created_at": self.now - timedelta(days=21),
                                  "accepted_at": self.now - timedelta(days=20)})
            await inv.insert_one({"family_id": "famB", "status": "pending",
                                  "created_at": self.now - timedelta(days=5)})
            await inv.insert_one({"family_id": "famB", "status": "pending",
                                  "created_at": self.now - timedelta(days=60)})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db

    def evidence(self, **kw):
        return asyncio.run(server.metrics_grant_evidence(user=dict(ADMIN), database=self.db, **kw))

    def test_only_an_admin_may_read_it(self):
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.metrics_grant_evidence(
                user={"user_id": "u1", "email": "u1@x.com"}, database=self.db))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_every_figure_has_a_definition_and_every_definition_a_figure(self):
        out = self.evidence()
        self.assertEqual(set(out["figures"]), set(out["definitions"]))
        for key, text in out["definitions"].items():
            self.assertTrue(text.strip().endswith("."), f"{key} definition is not a sentence")

    def test_households_are_counted_by_adult_accounts_not_member_rows(self):
        f = self.evidence()["figures"]
        self.assertEqual(f["registered_households"], 4)   # A, B, C, admin
        self.assertEqual(f["adult_accounts"], 5)          # the teen is not an adult
        self.assertEqual(f["two_plus_adult_households"], 1)  # famA; the teen does not make famB shared

    def test_activated_means_one_useful_thing_was_done(self):
        f = self.evidence()["figures"]
        self.assertEqual(f["activated_households"], 2)    # famA (cards…) and famB (a card); famC nothing

    def test_paying_excludes_grandfathered_and_the_admin(self):
        f = self.evidence()["figures"]
        self.assertEqual(f["paying_households"], 1)       # famA; famC is a gift, famAdmin is the founder

    def test_sharing_and_usage_counts(self):
        f = self.evidence()["figures"]
        self.assertEqual(f["sharing_households"], 1)
        self.assertEqual(f["cards_created"], 3)
        self.assertEqual(f["cards_completed"], 1)
        self.assertEqual(f["cards_shared"], 1)
        self.assertEqual(f["documents_filed"], 1)
        self.assertEqual(f["ai_scans_used"], 5)

    def test_the_window_and_all_time_are_kept_apart(self):
        f = self.evidence(days=30)["figures"]
        self.assertEqual(f["signups_in_window"], 3)               # u2 (20d), u3 (10d), u4 (2d); the teen is not an adult
        self.assertEqual(f["onboarding_completed_in_window"], 2)  # u3 did not finish
        self.assertEqual(f["invites_sent_in_window"], 2)
        self.assertEqual(f["invites_accepted_in_window"], 1)
        self.assertEqual(f["invites_sent_all_time"], 3)
        self.assertEqual(f["invites_accepted_all_time"], 1)

    def test_retention_cohorts_give_each_account_time_to_return(self):
        f = self.evidence(days=30)["figures"]
        # D7 cohort: created between 30 and 7 days ago → u2 (20d), u3 (10d).
        # u2 came back after its 7th day; u3 never did.
        self.assertEqual(f["d7_cohort_size"], 2)
        self.assertEqual(f["d7_retained"], 1)
        # D30 cohort: created between 60 and 30 days ago → u1 (40d), retained.
        self.assertEqual(f["d30_cohort_size"], 1)
        self.assertEqual(f["d30_retained"], 1)
        self.assertEqual(f["active_accounts_7d"], 4)   # u1, u2, u4, admin (u3 fell silent 10 days ago)

    def test_weekly_signups_are_monday_dated_and_newest_first(self):
        weeks = self.evidence(days=30)["figures"]["weekly_signups"]
        self.assertEqual(sum(w["signups"] for w in weeks), 3)
        self.assertEqual([w["week"] for w in weeks], sorted((w["week"] for w in weeks), reverse=True))
        for w in weeks:
            self.assertEqual(server._coerce_dt(w["week"] + "T00:00:00Z").weekday(), 0)

    def test_the_csv_is_one_row_per_figure_with_its_definition(self):
        res = self.evidence(format="csv")
        body = res.body.decode()
        lines = body.strip().split("\n")
        self.assertEqual(lines[0], "metric,value,window,definition")
        self.assertTrue(any(l.startswith("paying_households,1,") for l in lines))
        self.assertTrue(any(l.startswith("signups_week_") for l in lines))
        self.assertIn("Not an active-user base", body)
        self.assertEqual(res.media_type, "text/csv")

    def test_the_caveats_repeat_what_the_strategy_says_not_to_claim(self):
        text = " ".join(self.evidence()["caveats"])
        self.assertIn("not active customers", text)
        self.assertIn("not a conversion benchmark", text)


if __name__ == "__main__":
    unittest.main()
