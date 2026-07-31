"""Tests for client-error telemetry and smoke-account self-cleanup.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fastapi import HTTPException


class FakeColl:
    def __init__(self, rows=None):
        self.rows = [dict(r) for r in (rows or [])]

    def _match(self, row, q):
        return all(row.get(k) == v for k, v in (q or {}).items()
                   if not isinstance(v, dict))

    async def insert_one(self, doc):
        self.rows.append(dict(doc))

    async def find_one(self, q, *a, **k):
        for r in self.rows:
            if self._match(r, q):
                return dict(r)
        return None

    async def delete_many(self, q):
        # Supports the two shapes used here: exact match and {$lt} on a field.
        def gone(row):
            for k, v in (q or {}).items():
                if isinstance(v, dict) and "$lt" in v:
                    if not (row.get(k) and row[k] < v["$lt"]):
                        return False
                elif row.get(k) != v:
                    return False
            return True
        self.rows = [r for r in self.rows if not gone(r)]

    def find(self, q=None, *a, **k):
        rows = [dict(r) for r in self.rows if self._match(r, q)]

        class _Cur:
            def sort(self, *a, **k):
                return self

            def limit(self, *a, **k):
                return self

            def __aiter__(self):
                async def gen():
                    for r in rows:
                        yield r
                return gen()

        return _Cur()


class FakeDB:
    def __init__(self, **colls):
        self.colls = colls

    def __getitem__(self, name):
        return self.colls.setdefault(name, FakeColl())


ADMIN = {"user_id": "u1", "family_id": "fam1", "name": "Roland",
         "email": "roland@x.com", "is_admin": True}
PARENT = {"user_id": "u2", "family_id": "fam1", "name": "Ama",
          "email": "ama@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ClientErrorTelemetry(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._admin = server.is_admin_user
        server.is_admin_user = lambda u: bool(u.get("is_admin"))

    def tearDown(self):
        server.get_db = self._get_db
        server.is_admin_user = self._admin

    def test_report_is_stored_and_truncated(self):
        payload = server.ClientErrorIn(
            endpoint="/family/invite/accept", method="POST",
            status=None, message="x" * 999, platform="ios",
        )
        res = asyncio.run(server.report_client_error(payload, user=dict(PARENT)))
        self.assertTrue(res["ok"])
        row = self.db["client_errors"].rows[0]
        self.assertEqual(row["name"], "Ama")
        self.assertEqual(len(row["message"]), 300)
        self.assertEqual(row["endpoint"], "/family/invite/accept")

    def test_admin_sees_the_list_others_do_not(self):
        payload = server.ClientErrorIn(endpoint="/x", message="boom")
        asyncio.run(server.report_client_error(payload, user=dict(PARENT)))
        rows = asyncio.run(server.list_client_errors(user=dict(ADMIN)))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["message"], "boom")
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.list_client_errors(user=dict(PARENT)))
        self.assertEqual(ctx.exception.status_code, 403)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class SmokeCleanup(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db

    def tearDown(self):
        server.get_db = self._get_db

    def test_real_accounts_cannot_self_destruct(self):
        server.get_db = lambda: FakeDB()
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.smoke_cleanup(user=dict(PARENT)))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_smoke_account_removes_all_its_traces(self):
        smoke = {"user_id": "u_s", "family_id": "fam1", "name": "Smoke",
                 "email": "smoke-abc123@household-coo.smoke"}
        db = FakeDB(
            users=FakeColl([{"user_id": "u_s"}]),
            family_members=FakeColl([{"user_id": "u_s", "member_id": "m1"},
                                     {"user_id": "u1", "member_id": "m2", "family_id": "fam1"}]),
            family_invites=FakeColl([{"email": smoke["email"], "invite_id": "i1"}]),
            user_sessions=FakeColl([{"user_id": "u_s"}]),
            notification_tokens=FakeColl([{"user_id": "u_s"}]),
            families=FakeColl([{"family_id": "fam_solo"}, {"family_id": "fam1"}]),
        )
        server.get_db = lambda: db
        payload = server.SmokeCleanupIn(family_ids=["fam_solo", "fam1"])
        res = asyncio.run(server.smoke_cleanup(payload, user=smoke))
        self.assertTrue(res["ok"])
        self.assertEqual(db["users"].rows, [])
        self.assertEqual([m["member_id"] for m in db["family_members"].rows], ["m2"])
        self.assertEqual(db["family_invites"].rows, [])
        self.assertEqual(db["user_sessions"].rows, [])
        self.assertEqual(db["notification_tokens"].rows, [])
        # The abandoned solo family goes; the still-populated one is refused.
        self.assertEqual([f["family_id"] for f in db["families"].rows], ["fam1"])


if __name__ == "__main__":
    unittest.main()
