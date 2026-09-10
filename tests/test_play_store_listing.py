"""The Google Play listing, held to Google's limits — and to the brand we ship.

Two things this catches, both of which cost installs silently.

**Overflow.** Google truncates a field that runs long rather than rejecting it,
so the tail simply never ranks and nothing tells you. The App Store listing has
been guarded this way since it was written (tests/test_store_listing.py); the
Play listing was not, although the short description is the second-heaviest
ranking field Google has.

**A stale brand.** docs/aso-listing.md sat in this repo carrying ready-to-paste
copy that put "Household COO" — the product's name before the Ahenora rename —
into the app title. Nothing referenced it except the rename plan's own to-do
list, which is exactly how it survived: it was superseded by
docs/PLAY_STORE_LISTING.md and nobody deleted it. Anyone reaching for the file
whose name says ASO would have pasted the wrong name into the field that ranks
hardest. It is gone, and this stops the next one.

Run with:  python3 -m unittest discover -s tests -v
"""

import os
import re
import unittest

DOCS = os.path.join(os.path.dirname(__file__), "..", "docs")
DOC = os.path.join(DOCS, "PLAY_STORE_LISTING.md")

# Google's limits, in characters.
LIMITS = {
    "App name": 30,
    "Short description": 80,
    "Full description": 4000,
}

# What the app is called. Anything else in a paste-ready block is a listing
# that has drifted from the product.
BRAND = "Ahenora"
RETIRED_BRANDS = ("Household COO", "Casira")


def fields():
    """Parse the doc into {field: value}, reading the same file a person edits.

    A second copy of the strings here would be a second thing to keep in step,
    which is the failure this file exists to catch.
    """
    with open(DOC, encoding="utf-8") as fh:
        text = fh.read()
    out = {}
    for match in re.finditer(
        r"\*\*(App name|Short description|Full description)\*\*.*?```\n(.*?)```",
        text, re.S,
    ):
        out.setdefault(match.group(1), match.group(2).strip())
    return out


class PlayListing(unittest.TestCase):
    def test_the_fields_are_actually_found(self):
        # Guards the parser: an empty dict would pass every length check below
        # by having nothing to measure.
        found = fields()
        self.assertEqual(sorted(found), sorted(LIMITS))
        for name, value in found.items():
            self.assertGreater(len(value), 10, name)

    def test_nothing_overflows_and_gets_silently_cut(self):
        for name, value in fields().items():
            with self.subTest(field=name):
                self.assertLessEqual(
                    len(value), LIMITS[name],
                    f"{name} is {len(value)} chars; Google truncates at {LIMITS[name]}")

    def test_the_title_carries_the_brand_and_a_search_term(self):
        # The brand alone ranks for nothing, and a head term alone is not ours.
        name = fields()["App name"]
        self.assertIn(BRAND, name)
        self.assertGreater(len(name.split()), 1, "title is the brand and nothing else")

    def test_no_listing_still_carries_a_retired_brand(self):
        # Across every listing doc, not just this one: the file that shipped
        # the wrong name was a different file that nobody was looking at.
        for entry in sorted(os.listdir(DOCS)):
            if not entry.endswith(".md"):
                continue
            if "LISTING" not in entry.upper() and "ASO" not in entry.upper():
                continue
            path = os.path.join(DOCS, entry)
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            for retired in RETIRED_BRANDS:
                with self.subTest(doc=entry, brand=retired):
                    self.assertNotIn(
                        retired, text,
                        f"{entry} still offers paste-ready copy naming {retired}")


if __name__ == "__main__":
    unittest.main()
