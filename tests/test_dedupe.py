"""Tests for the duplicate-account cleanup script (backend/scripts/dedupe_accounts.py).
Uses a tiny in-memory async collection that supports the plain-equality queries,
updates and deletes the script issues."""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend", "scripts"))
import dedupe_accounts as dd


class Coll:
    def __init__(self, rows=None):
        self.rows = [dict(r) for r in (rows or [])]

    def _match(self, r, q):
        for k, v in q.items():
            if isinstance(v, dict):  # the script issues only plain-equality queries
                return False
            if r.get(k) != v:
                return False
        return True

    def find(self, q=None):
        rows = [dict(r) for r in self.rows if self._match(r, q or {})]

        async def gen():
            for r in rows:
                yield r
        return gen()

    async def find_one(self, q, *a, **k):
        for r in self.rows:
            if self._match(r, q):
                return dict(r)
        return None

    async def update_one(self, q, u, upsert=False):
        for r in self.rows:
            if self._match(r, q):
                r.update(u.get("$set", {}))
                return

    async def delete_one(self, q):
        for i, r in enumerate(self.rows):
            if self._match(r, q):
                del self.rows[i]
                return

    async def delete_many(self, q):
        self.rows = [r for r in self.rows if not self._match(r, q)]


class DB:
    def __init__(self, **colls):
        self.colls = {k: Coll(v) for k, v in colls.items()}

    def __getitem__(self, name):
        return self.colls.setdefault(name, Coll())


class DedupeTests(unittest.TestCase):
    def _emails(self, db):
        return sorted(r["email"] for r in db["users"].rows)

    def _base(self):
        # A real password account (fam_A, with a kid + a card) and a passwordless
        # Google duplicate under the same inbox in its own empty family (fam_B).
        return DB(
            users=[
                {"user_id": "u_pw", "email": "wife@x.com", "password_hash": "h", "family_id": "fam_A"},
                {"user_id": "u_g", "email": "WIFE@x.com", "google_sub": "g1", "family_id": "fam_B"},
            ],
            family_members=[
                {"family_id": "fam_A", "user_id": "u_pw", "role": "parent"},
                {"family_id": "fam_A", "role": "child", "name": "Kid"},
                {"family_id": "fam_B", "user_id": "u_g", "role": "parent"},
            ],
            families=[{"family_id": "fam_A"}, {"family_id": "fam_B"}],
            cards=[{"family_id": "fam_A", "title": "Dentist"}],
            user_sessions=[{"user_id": "u_g"}, {"user_id": "u_pw"}],
        )

    def test_folds_empty_google_duplicate_into_the_password_account(self):
        db = self._base()
        summary = asyncio.run(dd.run(db, apply=True, log=lambda *a: None))
        self.assertEqual(summary["removed"], 1)
        self.assertEqual(summary["linked"], 1)
        self.assertEqual(summary["manual"], 0)
        # Only the real account survives, now carrying the linked google_sub.
        self.assertEqual([r["user_id"] for r in db["users"].rows], ["u_pw"])
        self.assertEqual(db["users"].rows[0]["google_sub"], "g1")
        self.assertEqual(db["users"].rows[0]["email"], "wife@x.com")
        # The empty shell family is gone; the real family and its members remain.
        self.assertEqual([r["family_id"] for r in db["families"].rows], ["fam_A"])
        self.assertEqual(len(db["family_members"].rows), 2)
        self.assertTrue(all(m["family_id"] == "fam_A" for m in db["family_members"].rows))
        # The duplicate's session is cleared.
        self.assertEqual([s["user_id"] for s in db["user_sessions"].rows], ["u_pw"])

    def test_dry_run_changes_nothing(self):
        db = self._base()
        asyncio.run(dd.run(db, apply=False, log=lambda *a: None))
        self.assertEqual(len(db["users"].rows), 2)
        self.assertEqual(len(db["families"].rows), 2)

    def test_duplicate_with_real_data_is_left_for_manual_review(self):
        db = self._base()
        db["cards"].rows.append({"family_id": "fam_B", "title": "Real event in the dup family"})
        summary = asyncio.run(dd.run(db, apply=True, log=lambda *a: None))
        self.assertEqual(summary["removed"], 0)
        self.assertEqual(summary["manual"], 1)
        # Both accounts still exist — nothing destructive happened.
        self.assertEqual(len(db["users"].rows), 2)

    def test_a_paying_family_is_never_treated_as_an_empty_shell(self):
        # The subscription lives on the family document, so "no chores in it"
        # is not the same as "safe to delete" — that would be deleting the
        # record of somebody's money.
        db = self._base()
        for fam in db["families"].rows:
            if fam["family_id"] == "fam_B":
                fam["plan"] = "executive"
                fam["rc_last_event"] = "INITIAL_PURCHASE"
        summary = asyncio.run(dd.run(db, apply=True, log=lambda *a: None))
        self.assertEqual(summary["removed"], 0)
        self.assertEqual(summary["manual"], 1)
        self.assertEqual(len(db["users"].rows), 2)
        self.assertEqual(len(db["families"].rows), 2)

    def test_a_conflicting_google_sub_is_left_for_manual_review(self):
        # Two different Google identities under one inbox is a fact we cannot
        # merge away: dropping the duplicate would silently lose one of them.
        db = self._base()
        db["users"].rows[0]["google_sub"] = "g_other"
        summary = asyncio.run(dd.run(db, apply=True, log=lambda *a: None))
        self.assertEqual(summary["removed"], 0)
        self.assertEqual(summary["linked"], 0)
        self.assertEqual(summary["manual"], 1)
        self.assertEqual(len(db["users"].rows), 2)

    def test_the_duplicates_push_tokens_go_with_it(self):
        # A notification_token left behind keeps pushing to a real phone for an
        # account that no longer exists.
        db = self._base()
        db["notification_tokens"].rows.extend([
            {"user_id": "u_g", "token": "dead"}, {"user_id": "u_pw", "token": "live"}])
        db["notification_settings"].rows.append({"user_id": "u_g"})
        asyncio.run(dd.run(db, apply=True, log=lambda *a: None))
        self.assertEqual([t["token"] for t in db["notification_tokens"].rows], ["live"])
        self.assertEqual(db["notification_settings"].rows, [])

    def test_idempotent_second_run_is_a_noop(self):
        db = self._base()
        asyncio.run(dd.run(db, apply=True, log=lambda *a: None))
        summary2 = asyncio.run(dd.run(db, apply=True, log=lambda *a: None))
        self.assertEqual(summary2["removed"], 0)
        self.assertEqual(summary2["manual"], 0)


if __name__ == "__main__":
    unittest.main()
