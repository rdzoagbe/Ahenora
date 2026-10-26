"""The server stops trusting a certificate authority the bundle has withdrawn.

eMudhra's emSign ECC Root CA - G3 was removed from certifi in 2026.10.19
after the eMudhra compromise; 2026.7.22, the release the server could still
be running, carries it (both wheels checked by hand on 2026-10-23 and again
on 2026-10-26). Any certificate issued under that root would have been
accepted by every outbound call the server makes through requests, httpx or
google-auth: Google sign-in, the AI calls, webhooks.

backend/requirements.txt did not name certifi at all, so which bundle a
deploy got depended on what pip resolved on the day — and the Dockerfile
installs requirements in their own layer, which a builder may reuse while
that file is unchanged. A floor in the file fixes both: it names the bundle,
and changing it changes the layer.

These hold that, in the file and in whatever is installed where the tests
run (CI installs from the same file):

  * requirements.txt sets a certifi floor at or above 2026.10.19;
  * the installed bundle does not contain the withdrawn root.

The database driver is deliberately not claimed here: pymongo reads certifi
only through PyOpenSSL, which this server does not install, and otherwise
uses the operating system's store in the image.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
WITHDRAWN = "emSign ECC Root CA - G3"
FLOOR = (2026, 10, 19)


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


class TheServerTrustsNoWithdrawnRoot(unittest.TestCase):

    def test_requirements_set_a_certifi_floor_past_the_withdrawal(self):
        lines = [line.split("#", 1)[0].strip() for line in read("backend", "requirements.txt").splitlines()]
        pins = [line for line in lines if re.match(r"^certifi\b", line, re.I)]
        self.assertEqual(len(pins), 1, "backend/requirements.txt must name certifi exactly once")
        match = re.match(r"^certifi\s*(>=|==)\s*(\d{4})\.(\d{1,2})\.(\d{1,2})$", pins[0], re.I)
        self.assertIsNotNone(match, f"expected certifi>=YYYY.M.D, got {pins[0]!r}")
        version = tuple(int(part) for part in match.groups()[1:])
        self.assertGreaterEqual(version, FLOOR)

    def test_the_installed_bundle_does_not_carry_the_withdrawn_root(self):
        import certifi

        with open(certifi.where(), encoding="utf-8") as handle:
            bundle = handle.read()
        self.assertGreater(bundle.count("BEGIN CERTIFICATE"), 100, "that is not a CA bundle")
        self.assertNotIn(WITHDRAWN, bundle)


if __name__ == "__main__":
    unittest.main()
