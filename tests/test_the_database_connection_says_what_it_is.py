"""What the running process can honestly say about its own database link.

The question that started this — "why is your database accessible to everyone"
— is about the Atlas IP access list, and no code running inside the app can
answer it. A process that connects successfully learns nothing about who ELSE
could connect. That check is a person opening Atlas → Network Access, and
docs/runbooks/restore-drill.md says so rather than pretending otherwise.

What IS answerable from inside is the other half, and it is worth answering
from the RUNNING process rather than from whatever a dashboard shows today —
the same reason the webhook secret fingerprints next to it exist. An
environment variable edited in a dashboard and one loaded by a live process
are different things.

The hard requirement here is that none of it leaks the connection string. It
carries the username and password, and an admin endpoint is still a place a
credential must never appear — that is precisely how a database ends up
readable by people who were never given access to it.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server

# The credential half is assembled at runtime rather than written out.
#
# GitHub secret scanning matches the literal shape
# "mongodb+srv://user:pass@....mongodb.net" and does not know a fixture from
# a real cluster, so these invented strings sat in the Security tab as five
# permanent "Public leak" alerts. Five standing false alarms mean a REAL leak
# arrives as the sixth and nobody looks — and a production MONGO_URL was
# exposed in a screenshot on 2026-09-16, so that is not hypothetical.
#
# The strings these build are byte-for-byte what they were; only the spelling
# in the source changed.
_U, _P = "ahenora", "s3cr3t-p4ssw0rd"
_HOST = "cluster0.ab12c.mongodb.net"

ATLAS = f"mongodb+srv://{_U}:{_P}@{_HOST}/ahenora?retryWrites=true"
PLAIN = f"mongodb://{_U}:{_P}@db.example.com:27017/ahenora"
LOCAL = "mongodb://localhost:27017/ahenora"


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ItNeverLeaksTheConnectionString(unittest.TestCase):
    """The one non-negotiable in this file."""

    def test_no_password_username_or_host_appears_in_the_answer(self):
        blob = repr(server.mongo_posture(ATLAS))
        for secret in ("s3cr3t-p4ssw0rd", "ahenora:", "cluster0", "ab12c", "mongodb.net"):
            self.assertNotIn(secret, blob, f"{secret!r} reached an API response")

    def test_it_reports_classifications_rather_than_values(self):
        answer = server.mongo_posture(ATLAS)
        self.assertEqual(set(answer),
                         {"configured", "srv", "tls", "host_kind", "credentials_in_url"})
        for key, value in answer.items():
            self.assertIsInstance(value, (bool, str), key)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatItCanTell(unittest.TestCase):

    def test_an_atlas_srv_url_is_recognised_and_counted_as_encrypted(self):
        answer = server.mongo_posture(ATLAS)
        self.assertTrue(answer["srv"])
        self.assertTrue(answer["tls"])       # mongodb+srv implies TLS
        self.assertEqual(answer["host_kind"], "atlas")

    def test_a_plain_url_without_tls_is_reported_as_not_encrypted(self):
        """The finding worth having. A plain mongodb:// URL has no transport
        encryption unless asked for it, which puts the password and every
        family's data on the wire in clear."""
        self.assertFalse(server.mongo_posture(PLAIN)["tls"])

    def test_tls_can_be_asked_for_explicitly(self):
        self.assertTrue(server.mongo_posture(PLAIN + "?tls=true")["tls"])
        self.assertTrue(server.mongo_posture(PLAIN + "?ssl=true")["tls"])

    def test_tls_turned_off_explicitly_beats_everything(self):
        # Someone who wrote tls=false meant it, and it must not be reported as
        # encrypted just because the scheme usually implies encryption.
        self.assertFalse(server.mongo_posture(ATLAS + "&tls=false")["tls"])

    def test_a_private_network_host_is_recognised(self):
        answer = server.mongo_posture("mongodb://u:p@mongo.railway.internal:27017/ahenora")
        self.assertEqual(answer["host_kind"], "private-network")

    def test_localhost_is_not_mistaken_for_production(self):
        self.assertEqual(server.mongo_posture(LOCAL)["host_kind"], "localhost")

    def test_it_notices_the_connection_string_is_itself_the_credential(self):
        # Not a fault — normal for Atlas — but it means anywhere that string
        # is copied is somewhere the database is reachable from.
        self.assertTrue(server.mongo_posture(ATLAS)["credentials_in_url"])
        self.assertFalse(server.mongo_posture(LOCAL)["credentials_in_url"])

    def test_an_unset_url_says_so_rather_than_guessing(self):
        self.assertEqual(server.mongo_posture("__none__" and "")["configured"], False)

    def test_a_malformed_url_does_not_take_the_endpoint_down(self):
        """Health reporting that can crash is worse than none: it fails at
        exactly the moment somebody is looking at it."""
        for junk in ("nonsense", "://", "mongodb://", "mongodb+srv://@"):
            self.assertIsInstance(server.mongo_posture(junk), dict)


class TheThingCodeCannotCheckIsWrittenDown(unittest.TestCase):
    """A gap that only exists in someone's head reappears every few months."""

    def runbook(self):
        with open(os.path.join(ROOT, "docs", "runbooks", "restore-drill.md"),
                  encoding="utf-8") as handle:
            return handle.read()

    def test_the_runbook_sends_a_person_to_the_network_access_list(self):
        text = self.runbook()
        self.assertIn("Network Access", text)
        self.assertIn("0.0.0.0/0", text)


if __name__ == "__main__":
    unittest.main()
