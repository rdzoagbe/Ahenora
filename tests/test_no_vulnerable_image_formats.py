"""No asset in this repository is a format the bundler cannot safely read.

Metro — the React Native bundler — reads every image asset at BUILD time to
get its dimensions, using `image-size`. Two advisories are open against that
package (GHSA, "High"), and the important detail is that they cannot be fixed
by upgrading:

    latest published : 2.0.2
    vulnerable range : <= 2.0.2

Every version ever published is affected, so there is nothing to move to, and
forcing a major bump past what Metro asks for (^1.0.2) would risk the build
without fixing anything. It also never reaches a user: Metro is a build tool
and `image-size` is not in the shipped bundle.

What IS true is that the bug is in three specific parsers — ICNS, HEIF and
JXL — and this app uses none of those formats. So the only way the vulnerable
code could ever run is if such a file arrived in the repo. That is the thing
worth holding, and this holds it.

MAGIC BYTES, NOT EXTENSIONS. `image-size` dispatches on the file's leading
bytes, so a malicious JXL renamed to `.png` reaches the JXL parser exactly the
same way. A test that trusted the extension would be decoration.

Run with:  python3 -m unittest discover -s tests -v
"""

import os
import subprocess
import unittest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# Directories that are not ours to police: third-party code and build output
# that is regenerated from what we DO control.
SKIP_DIRS = {"node_modules", ".git", ".expo", "dist", "__pycache__", ".venv"}

# The HEIF-family brands image-size recognises, as ASCII in the ftyp box.
HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"heim", b"heis", b"hevm",
               b"hevs", b"mif1", b"msf1", b"heif"}

# JXL ships two ways: a bare codestream, and an ISOBMFF container.
JXL_CODESTREAM = b"\xff\x0a"
JXL_CONTAINER = b"\x00\x00\x00\x0cJXL \x0d\x0a\x87\x0a"


def sniff(head: bytes) -> str:
    """Which vulnerable parser these bytes would reach, or ''.

    Deliberately the same order of checks image-size uses, and deliberately
    reading only the leading bytes: what the parser sees is what matters.
    """
    if head[:4] == b"icns":
        return "ICNS"
    if head.startswith(JXL_CONTAINER) or head[:2] == JXL_CODESTREAM:
        return "JXL"
    if len(head) >= 12 and head[4:8] == b"ftyp" and head[8:12] in HEIF_BRANDS:
        return "HEIF"
    return ""


def tracked_files():
    """Every file the repository actually carries.

    `git ls-files` rather than a walk, because it is exactly the set that
    reaches a checkout — and it excludes what .gitignore already excludes,
    which is most of the noise. Falls back to a walk where git is unavailable.
    """
    try:
        out = subprocess.run(
            ["git", "-C", ROOT, "ls-files", "-z"],
            capture_output=True, check=True, timeout=60).stdout
        names = [n.decode("utf-8", "replace") for n in out.split(b"\0") if n]
        if names:
            return [os.path.join(ROOT, n) for n in names]
    except Exception:
        pass
    found = []
    for base, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        found.extend(os.path.join(base, f) for f in files)
    return found


def head_of(path, n=16):
    try:
        with open(path, "rb") as fh:
            return fh.read(n)
    except (OSError, IsADirectoryError):
        return b""


class VulnerableImageFormats(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.files = [f for f in tracked_files()
                     if not any(part in SKIP_DIRS
                                for part in f.replace(ROOT, "").split(os.sep))]

    def test_there_is_actually_something_to_check(self):
        """A file list that came back empty would make the check below pass
        while looking at nothing at all."""
        self.assertGreater(len(self.files), 200,
                           "the repository file list looks wrong")
        images = [f for f in self.files
                  if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))]
        self.assertGreater(len(images), 50,
                           "no images found — the walk is not reaching assets")

    def test_the_sniffer_actually_recognises_these_formats(self):
        """Otherwise the whole file passes by detecting nothing.

        Real leading bytes for each of the three, so a future 'fix' cannot be
        to weaken the detector.
        """
        self.assertEqual(sniff(b"icns\x00\x00\x01\x00"), "ICNS")
        self.assertEqual(sniff(b"\xff\x0a\x00\x00"), "JXL")
        self.assertEqual(sniff(JXL_CONTAINER + b"\x00\x00"), "JXL")
        self.assertEqual(sniff(b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00"), "HEIF")
        self.assertEqual(sniff(b"\x00\x00\x00\x18ftypmif1\x00\x00\x00\x00"), "HEIF")
        # And does not cry wolf on what the app does ship.
        self.assertEqual(sniff(b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0d"), "")
        self.assertEqual(sniff(b"\xff\xd8\xff\xe0\x00\x10JFIF"), "")
        self.assertEqual(sniff(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "")
        self.assertEqual(sniff(b"<svg xmlns=\\"), "")
        # An mp4 is also an ftyp box, and is not one of these.
        self.assertEqual(sniff(b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00"), "")

    def test_no_file_would_reach_a_vulnerable_parser(self):
        """The thing itself.

        Checked by CONTENT: image-size dispatches on leading bytes, so a JXL
        renamed to .png reaches the JXL parser exactly the same way. Every
        tracked file is sniffed, whatever it claims to be.
        """
        bad = []
        for path in self.files:
            kind = sniff(head_of(path))
            if kind:
                bad.append(f"{os.path.relpath(path, ROOT)} is {kind}")
        self.assertEqual(
            bad, [],
            "these reach an image-size parser with an open advisory and no "
            "patched version: " + "; ".join(bad[:10]))


if __name__ == "__main__":
    unittest.main()
