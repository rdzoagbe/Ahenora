"""Nobody borrows a sign-in, and nobody edits what they cannot see.

Roland, 2026-10-28: "attack my app code like a hacker and find any
vulnerabilities to fix." The attack that survived the review, and the fixes:

  * Google sign-in refuses to LINK an unverified email into an existing
    account (a token bearing someone else's address could otherwise take it
    over), and mints a separate row instead. The duplicate-account cleanup
    then merged rows by address alone and copied that row's google_sub onto
    the real account — finishing the attack the handler had stopped, on an
    admin's "APPLY". Now the minted row is stamped with whether Google vouched
    for the address, and the cleanup copies an identity only from a row it
    vouched for; anything else is left for a person.
  * Sign-up checked for an existing address by exact lowercase match while
    login looks it up case-insensitively, so a legacy row stored as
    "Wife@x.com" did not stop a second sign-up for wife@x.com — and the
    cleanup would then have chosen the newer, password-carrying row as the
    keeper. Sign-up now looks the address up the way login does.
  * The cleanup's report line printed the raw address; through the CLI that
    reaches a terminal, so it is repr'd like the line beside it.

Run with:  python3 -m pytest tests/test_a_duplicate_cannot_borrow_a_sign_in.py -q
"""
import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    import dedupe_core
    from fake_mongo import FakeDatabase
    from fastapi import HTTPException


class _StubGoogle:
    """Stands in for google.oauth2.id_token: returns the claims we choose."""
    def __init__(self, claims):
        self.claims = claims

    def verify_oauth2_token(self, token, request, client_id):
        return dict(self.claims)


@unittest.skipUnless(HAVE, "backend deps not installed")
class AGoogleRowSaysWhetherGoogleVouchedForIt(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db, server.get_db = server.get_db, lambda: self.db
        self._ids, server.GOOGLE_CLIENT_IDS = server.GOOGLE_CLIENT_IDS, ["cid"]
        self._google = server.google_id_token

    def tearDown(self):
        server.get_db = self._get_db
        server.GOOGLE_CLIENT_IDS = self._ids
        server.google_id_token = self._google

    def sign_in(self, **claims):
        server.google_id_token = _StubGoogle({"sub": "g_attacker", "email": "victim@x.com",
                                              "name": "Someone", **claims})
        return asyncio.run(server.exchange_session(server.SessionIn(session_id="tok")))

    def test_an_unverified_email_mints_a_row_stamped_unverified(self):
        self.sign_in(email_verified=False)
        row = asyncio.run(self.db["users"].find_one({"google_sub": "g_attacker"}))
        self.assertIsNotNone(row)
        self.assertIs(row["email_verified"], False)

    def test_a_verified_email_is_stamped_verified(self):
        self.sign_in(email_verified=True)
        row = asyncio.run(self.db["users"].find_one({"google_sub": "g_attacker"}))
        self.assertIs(row["email_verified"], True)

    def test_an_unverified_email_still_does_not_link_into_an_existing_account(self):
        # The guard that already existed, pinned beside the new one.
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u_victim", "email": "victim@x.com", "password_hash": "h",
             "family_id": "fam_v", "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc)}))
        self.sign_in(email_verified=False)
        victim = asyncio.run(self.db["users"].find_one({"user_id": "u_victim"}))
        self.assertNotIn("google_sub", victim)


@unittest.skipUnless(HAVE, "backend deps not installed")
class TheCleanupCopiesAnIdentityOnlyFromARowGoogleVouchedFor(unittest.TestCase):
    """The attack end to end, on the cleanup: the victim's password account
    and an attacker's Google row minted from an unverified claim of the
    victim's address, in its own empty family."""

    def base(self, **dup_extra):
        db = FakeDatabase()
        rows = [
            {"user_id": "u_victim", "email": "victim@x.com", "password_hash": "h", "family_id": "fam_v",
             "created_at": "2026-01-01"},
            {"user_id": "u_attacker", "email": "victim@x.com", "google_sub": "g_attacker",
             "family_id": "fam_a", "created_at": "2026-10-01", **dup_extra},
        ]
        for r in rows:
            asyncio.run(db["users"].insert_one(r))
        asyncio.run(db["families"].insert_one({"family_id": "fam_v"}))
        asyncio.run(db["families"].insert_one({"family_id": "fam_a"}))
        asyncio.run(db["family_members"].insert_one({"family_id": "fam_v", "user_id": "u_victim", "role": "parent"}))
        asyncio.run(db["family_members"].insert_one({"family_id": "fam_a", "user_id": "u_attacker", "role": "parent"}))
        asyncio.run(db["cards"].insert_one({"family_id": "fam_v", "card_id": "c1", "title": "Dentist"}))
        return db

    def run_cleanup(self, db):
        lines = []
        summary = asyncio.run(dedupe_core.run(db, apply=True, log=lambda *a: lines.append(" ".join(map(str, a)))))
        return summary, lines

    def victim(self, db):
        return asyncio.run(db["users"].find_one({"user_id": "u_victim"}))

    def test_an_unverified_duplicate_never_hands_its_identity_to_the_keeper(self):
        db = self.base(email_verified=False)
        summary, lines = self.run_cleanup(db)
        self.assertNotIn("google_sub", self.victim(db))
        self.assertEqual(summary["linked"], 0)
        self.assertTrue(any("did not vouch" in line for line in lines), lines)

    def test_a_row_with_no_stamp_is_not_vouched_for_either(self):
        db = self.base()
        summary, _ = self.run_cleanup(db)
        self.assertNotIn("google_sub", self.victim(db))
        self.assertEqual(summary["linked"], 0)

    def test_the_unvouched_empty_duplicate_is_still_removed(self):
        # Deleting the foothold is right either way: a real person on an
        # unverified address simply signs in again and gets a fresh row.
        db = self.base(email_verified=False)
        summary, _ = self.run_cleanup(db)
        self.assertEqual(summary["removed"], 1)
        self.assertIsNone(asyncio.run(db["users"].find_one({"user_id": "u_attacker"})))

    def test_a_vouched_duplicate_still_links_which_is_the_cleanups_whole_point(self):
        db = self.base(email_verified=True)
        summary, _ = self.run_cleanup(db)
        self.assertEqual(self.victim(db)["google_sub"], "g_attacker")
        self.assertEqual(summary["linked"], 1)

    def test_the_report_line_cannot_carry_a_terminal_escape(self):
        db = self.base(email_verified=True)
        asyncio.run(db["users"].update_one({"user_id": "u_attacker"},
                                           {"$set": {"email": "victim@x.com\x1b[2J"}}))
        asyncio.run(db["users"].update_one({"user_id": "u_victim"},
                                           {"$set": {"email": "victim@x.com\x1b[2J"}}))
        _, lines = self.run_cleanup(db)
        self.assertTrue(all("\x1b" not in line for line in lines))
        self.assertTrue(any("\\x1b" in line for line in lines))


@unittest.skipUnless(HAVE, "backend deps not installed")
class SignUpSeesALegacyRowWhateverItsCasing(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db, server.get_db = server.get_db, lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def test_a_second_sign_up_for_a_mixed_case_inbox_is_refused(self):
        asyncio.run(self.db["users"].insert_one(
            {"user_id": "u_legacy", "email": "Wife@X.com", "google_sub": "g1", "family_id": "fam_l",
             "created_at": "2025-01-01"}))
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(server.register_email(server.EmailRegisterIn(
                name="Mallory", email="wife@x.com", password="password123")))
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(asyncio.run(self.db["users"].count_documents({})), 1)


@unittest.skipUnless(HAVE, "backend deps not installed")
class PasswordsCostMoreToGuessOffline(unittest.TestCase):
    def test_new_hashes_use_at_least_the_recommended_rounds(self):
        # OWASP's 2023 figure for PBKDF2-HMAC-SHA256. The stored string carries
        # its own round count, so older hashes keep verifying unchanged.
        self.assertGreaterEqual(server.PASSWORD_ITERATIONS, 600_000)
        stored = server.hash_password("correct horse")
        self.assertTrue(server.verify_password("correct horse", stored))
        self.assertFalse(server.verify_password("wrong", stored))

    def test_an_older_hash_still_verifies(self):
        old = "pbkdf2_sha256$200000$" + "ab" * 16 + "$" + __import__("hashlib").pbkdf2_hmac(
            "sha256", b"correct horse", ("ab" * 16).encode(), 200000).hex()
        self.assertTrue(server.verify_password("correct horse", old))


if __name__ == "__main__":
    unittest.main()
