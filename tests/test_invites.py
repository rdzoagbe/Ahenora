"""Tests for the invitation loop: links that open, logins that join,
and pushes in both directions.

The field bugs these pin down: invite links defaulted to a custom scheme
that does nothing on a phone without the app, and email login carried an
invite_token field the handler never read — an existing account clicking
an invite link could never join the family.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import unittest
from datetime import timedelta
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server


class FakeColl:
    def __init__(self, rows=None):
        self.rows = [dict(r) for r in (rows or [])]

    def _match(self, row, q):
        return all(row.get(k) == v for k, v in q.items() if not isinstance(v, dict))

    async def find_one(self, q, *a, **k):
        for r in self.rows:
            if self._match(r, q):
                return dict(r)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))

    async def update_one(self, q, u, upsert=False):
        for r in self.rows:
            if self._match(r, q):
                r.update(u.get("$set", {}))
                return SimpleNamespace(matched_count=1)
        if upsert:
            merged = {k: v for k, v in q.items() if not isinstance(v, dict)}
            merged.update(u.get("$set", {}))
            self.rows.append(merged)
        return SimpleNamespace(matched_count=0)

    def find(self, q=None, *a, **k):
        rows = [dict(r) for r in self.rows if self._match(r, q or {})]

        class _Cur:
            def __aiter__(self):
                async def gen():
                    for r in rows:
                        yield r
                return gen()

            def sort(self, *a, **k):
                return self

        return _Cur()


class FakeDB:
    def __init__(self, **colls):
        self.colls = colls

    def __getitem__(self, name):
        return self.colls.setdefault(name, FakeColl())


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class InviteUrl(unittest.TestCase):
    def test_default_link_opens_the_web_app(self):
        # A custom scheme is silence on a phone without the app; the web
        # companion handles ?invite= on every device.
        url = server.build_invite_url("tok123")
        self.assertTrue(url.startswith("https://"), url)
        self.assertIn("invite=tok123", url)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class LoginJoinsFamily(unittest.TestCase):
    def setUp(self):
        self.pushes = []
        self._push = server.send_expo_push_messages
        self._get_db = server.get_db
        self._add = server.add_user_to_family_if_needed

        async def fake_push(messages):
            self.pushes.extend(messages)
        server.send_expo_push_messages = fake_push

        self.added = []
        self.added_roles = []

        async def fake_add(database, user, family_id, role=None):
            self.added.append((user["user_id"], family_id))
            self.added_roles.append(role)
        server.add_user_to_family_if_needed = fake_add

    def tearDown(self):
        server.send_expo_push_messages = self._push
        server.get_db = self._get_db
        server.add_user_to_family_if_needed = self._add

    def _db(self, invite_status="pending"):
        pw = server.hash_password("password123")
        return FakeDB(
            users=FakeColl([
                {"user_id": "u_wife", "email": "wife@x.com", "name": "Ama",
                 "password_hash": pw, "family_id": "fam_solo", "language": "fr"},
                {"user_id": "u_roland", "email": "r@x.com", "name": "Roland",
                 "family_id": "fam_main", "language": "fr"},
            ]),
            family_invites=FakeColl([
                {"invite_id": "inv1", "family_id": "fam_main", "token": "tok1",
                 "status": invite_status, "email": "wife@x.com",
                 "created_by_user_id": "u_roland",
                 "expires_at": server.utcnow() + timedelta(days=5)},
            ]),
            notification_tokens=FakeColl([
                {"token": "ExponentPushToken[roland]", "user_id": "u_roland", "active": True},
            ]),
        )

    def _login(self, db, token="tok1"):
        server.get_db = lambda: db
        payload = server.EmailLoginIn(email="wife@x.com", password="password123",
                                      invite_token=token)
        return asyncio.run(server.login_email(payload))

    def test_login_with_invite_joins_the_inviting_family(self):
        db = self._db()
        res = self._login(db)
        self.assertEqual(res["user"]["family_id"], "fam_main")
        self.assertIn(("u_wife", "fam_main"), self.added)
        inv = db["family_invites"].rows[0]
        self.assertEqual(inv["status"], "accepted")
        self.assertEqual(inv["accepted_by_email"], "wife@x.com")

    def test_inviter_hears_about_the_acceptance_in_their_language(self):
        self._login(self._db())
        self.assertEqual(len(self.pushes), 1)
        push = self.pushes[0]
        self.assertEqual(push["to"], "ExponentPushToken[roland]")
        self.assertIn("Ama", push["title"])
        self.assertIn("accepté", push["title"])  # Roland's language is fr

    def test_login_without_token_changes_nothing(self):
        db = self._db()
        res = self._login(db, token=None)
        self.assertEqual(res["user"]["family_id"], "fam_solo")
        self.assertEqual(db["family_invites"].rows[0]["status"], "pending")
        self.assertEqual(self.pushes, [])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class SignedInAccept(LoginJoinsFamily):
    """A logged-in user who opens an invite link never sees the sign-in
    screen, so acceptance has its own endpoint."""

    def _accept(self, db, token="tok1"):
        server.get_db = lambda: db
        wife = {"user_id": "u_wife", "email": "wife@x.com", "name": "Ama",
                "family_id": "fam_solo", "language": "fr"}
        return asyncio.run(server.family_invite_accept(
            server.InviteAcceptIn(token=token), user=wife,
        ))

    def test_accepting_while_signed_in_joins_and_notifies(self):
        db = self._db()
        res = self._accept(db)
        self.assertTrue(res["joined"])
        self.assertEqual(res["user"]["family_id"], "fam_main")
        self.assertIn(("u_wife", "fam_main"), self.added)
        self.assertEqual(db["family_invites"].rows[0]["status"], "accepted")
        self.assertEqual(len(self.pushes), 1)
        self.assertEqual(self.pushes[0]["to"], "ExponentPushToken[roland]")

    def test_relationship_becomes_the_member_role(self):
        db = self._db()
        db["family_invites"].rows[0]["relationship"] = "Nanny"
        self._accept(db)
        self.assertEqual(self.added_roles, ["Nanny"])

    def test_no_relationship_keeps_the_parent_default(self):
        db = self._db()
        self._accept(db)
        self.assertEqual(self.added_roles, ["Parent"])

    def test_accepting_twice_is_harmless(self):
        db = self._db(invite_status="accepted")
        db["family_invites"].rows[0]["accepted_by_email"] = "wife@x.com"
        res = self._accept(db)
        self.assertTrue(res["ok"])
        self.assertEqual(self.pushes, [])

    # The three inherited login tests also run against this fixture set,
    # which is fine — they exercise the same shared join helper.


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class InvitesForMe(unittest.TestCase):
    """Signing in is enough to be told about a waiting invite — the link
    surviving the junk folder is not a requirement."""

    def test_pending_invite_for_my_email_is_returned(self):
        db = FakeDB(
            users=FakeColl([
                {"user_id": "u_roland", "email": "r@x.com", "name": "Roland",
                 "family_id": "fam_main"},
            ]),
            family_invites=FakeColl([
                {"invite_id": "inv1", "family_id": "fam_main", "token": "tok1",
                 "status": "pending", "email": "wife@x.com",
                 "relationship": "Co-parent",
                 "created_by_user_id": "u_roland",
                 "expires_at": server.utcnow() + timedelta(days=5)},
                # Expired: never surfaced.
                {"invite_id": "inv2", "family_id": "fam_main", "token": "tok2",
                 "status": "pending", "email": "wife@x.com",
                 "created_by_user_id": "u_roland",
                 "expires_at": server.utcnow() - timedelta(days=1)},
                # Already in this family: nothing to join.
                {"invite_id": "inv3", "family_id": "fam_solo", "token": "tok3",
                 "status": "pending", "email": "wife@x.com",
                 "created_by_user_id": "u_x",
                 "expires_at": server.utcnow() + timedelta(days=5)},
            ]),
        )
        _get_db = server.get_db
        server.get_db = lambda: db
        try:
            wife = {"user_id": "u_wife", "email": "wife@x.com",
                    "family_id": "fam_solo"}
            rows = asyncio.run(server.invites_for_me(user=wife))
        finally:
            server.get_db = _get_db
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["token"], "tok1")
        self.assertEqual(rows[0]["inviter_name"], "Roland")
        self.assertEqual(rows[0]["relationship"], "Co-parent")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class InvitedUserGetsPush(unittest.TestCase):
    def test_existing_account_is_told_in_app(self):
        pushes = []
        _push = server.send_expo_push_messages
        _slot = server._enforce_member_slot_limit
        _mail = server.send_invite_email
        _get_db = server.get_db

        async def fake_push(messages):
            pushes.extend(messages)

        async def fake_slot(db, user):
            return None

        async def fake_mail(*a, **k):
            return {"sent": True}

        db = FakeDB(
            users=FakeColl([
                {"user_id": "u_wife", "email": "wife@x.com", "name": "Ama",
                 "family_id": "fam_solo", "language": "fr"},
            ]),
            family_invites=FakeColl(),
            notification_tokens=FakeColl([
                {"token": "ExponentPushToken[wife]", "user_id": "u_wife", "active": True},
            ]),
        )
        server.send_expo_push_messages = fake_push
        server._enforce_member_slot_limit = fake_slot
        server.send_invite_email = fake_mail
        server.get_db = lambda: db
        try:
            payload = server.InviteIn(email="wife@x.com", relationship="  Grand   parent ")
            user = {"user_id": "u_roland", "family_id": "fam_main",
                    "name": "Roland", "email": "r@x.com"}
            result = asyncio.run(server.family_invite(payload, user=user))
        finally:
            server.send_expo_push_messages = _push
            server._enforce_member_slot_limit = _slot
            server.send_invite_email = _mail
            server.get_db = _get_db

        self.assertEqual(len(pushes), 1)
        self.assertEqual(pushes[0]["to"], "ExponentPushToken[wife]")
        self.assertIn("Roland", pushes[0]["title"])
        self.assertIn("invite", pushes[0]["title"])  # fr: "vous invite"
        self.assertEqual(pushes[0]["data"]["type"], "family_invite")
        # The free-text relationship is stored normalised and echoed back.
        self.assertEqual(result["invite"]["relationship"], "Grand parent")
        self.assertEqual(db["family_invites"].rows[0]["relationship"], "Grand parent")


if __name__ == "__main__":
    unittest.main()
