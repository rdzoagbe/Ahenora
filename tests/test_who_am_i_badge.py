"""What the app is allowed to say you are.

The account screen carried a hard-coded "OWNER" badge under the signed-in
person's name — every signed-in person, in every household. A grandmother
invited as a carer opened her own profile and was told she owned the
household; so was a co-parent, and so was a teen.

It is not a cosmetic slip. The badge is the only place in the app that tells
you your standing, and the household's real permission model — who can remove
whom, who reaches the vault, who is billed — turns on exactly that distinction.
Saying it wrong is worse than saying nothing.

So the standing is computed once, server-side, by the same code that owns
`_is_parent_role`, and handed to the client. These tests pin what each kind of
member is told, through the real /family/members route.

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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class MemberStanding(unittest.TestCase):
    """The rule itself, over every role the app can create."""

    def test_the_founder_is_the_owner_whatever_their_role_says(self):
        self.assertEqual(server.member_standing({"role": "Parent"}, True), "owner")

    def test_a_coparent_is_a_parent_not_an_owner(self):
        # The distinction the old badge erased. A co-parent runs the household
        # with you; they did not create it, and cannot remove the founder.
        self.assertEqual(server.member_standing({"role": "Parent"}, False), "parent")
        self.assertEqual(server.member_standing({"role": "co-parent"}, False), "parent")

    def test_carers_children_and_teens_are_told_what_they_are(self):
        for role, expected in (("helper", "helper"), ("Helper", "helper"),
                               ("teen", "teen"), ("child", "child"), ("Child", "child")):
            with self.subTest(role=role):
                self.assertEqual(server.member_standing({"role": role}, False), expected)

    def test_an_adult_invited_by_relationship_is_a_member(self):
        # "Grandma", "Uncle", "Nanny" — a full member of the household who is
        # not one of its parents. We have no better word than the family's own,
        # so the client shows their role instead of a label we invented.
        for role in ("Grandma", "Uncle", "Nanny", "Wife's sister"):
            with self.subTest(role=role):
                self.assertEqual(server.member_standing({"role": role}, False), "member")

    def test_a_missing_role_never_claims_ownership(self):
        # Legacy rows exist with no role at all. Defaulting such a row to owner
        # is exactly the bug this replaces, so the fallback must be the
        # smallest claim available, not the largest.
        for role in (None, "", "   "):
            with self.subTest(role=role):
                self.assertEqual(server.member_standing({"role": role}, False), "member")

    def test_every_answer_is_one_the_client_knows(self):
        # The client renders a label per standing; a value it has never heard of
        # would render as nothing under someone's name.
        roles = ["Parent", "co-parent", "helper", "teen", "child", "Grandma", None]
        for role in roles:
            for founder in (True, False):
                self.assertIn(server.member_standing({"role": role}, founder),
                              server.MEMBER_STANDINGS)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class StandingOverTheRoute(unittest.TestCase):
    """And what /family/members actually sends, which is what the app reads."""

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        server._auth_fail.clear()
        # A household as the app builds one: a founder, a co-parent, a carer,
        # a grandmother invited by relationship, a teen and a child. created_at
        # decides the founder, so the co-parent is deliberately later.
        base = server.utcnow()
        people = [
            ("u_p", "m_p", "Roland", "Parent", base),
            ("u_c", "m_c", "Keigh", "Parent", base + timedelta(days=30)),
            ("u_h", "m_h", "Nanny", "helper", base + timedelta(days=40)),
            ("u_g", "m_g", "Ama", "Grandma", base + timedelta(days=41)),
            ("u_t", "m_t", "Kojo", "teen", base + timedelta(days=42)),
            (None, "m_k", "Esi", "child", base + timedelta(days=43)),
        ]
        for uid, mid, name, role, created in people:
            if uid:
                asyncio.run(self.db["users"].insert_one({
                    "user_id": uid, "family_id": "fam1", "name": name,
                    "email": f"{mid}@x.com", "language": "en"}))
            asyncio.run(self.db["family_members"].insert_one({
                "member_id": mid, "family_id": "fam1", "user_id": uid, "name": name,
                "email": f"{mid}@x.com", "role": role, "stars": 0, "created_at": created}))

    def tearDown(self):
        server.get_db = self._get_db

    def _standings(self, user_id):
        user = asyncio.run(self.db["users"].find_one({"user_id": user_id}))
        rows = asyncio.run(server.family_members(user=user))
        return {r["name"]: r["standing"] for r in rows}

    def test_the_household_reads_the_way_the_family_would_describe_it(self):
        self.assertEqual(self._standings("u_p"), {
            "Roland": "owner", "Keigh": "parent", "Nanny": "helper",
            "Ama": "member", "Kojo": "teen", "Esi": "child"})

    def test_it_does_not_depend_on_who_is_asking(self):
        # The carer must not see herself promoted, and must not see the founder
        # demoted, simply because the request came from her session. Standing is
        # a fact about the household, not about the viewer.
        self.assertEqual(self._standings("u_h"), self._standings("u_p"))

    def test_the_carer_is_told_she_is_a_carer_on_her_own_row(self):
        mine = [r for r in asyncio.run(server.family_members(
            user=asyncio.run(self.db["users"].find_one({"user_id": "u_h"}))))
            if r["is_me"]]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["standing"], "helper")
        self.assertFalse(mine[0]["is_founder"])

    def test_exactly_one_owner(self):
        # Two owners is as wrong as none: the founder is the one member a
        # co-parent cannot remove, and that has to be a single row.
        owners = [n for n, s in self._standings("u_p").items() if s == "owner"]
        self.assertEqual(owners, ["Roland"])


if __name__ == "__main__":
    unittest.main()
