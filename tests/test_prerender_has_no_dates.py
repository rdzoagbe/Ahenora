"""The exported web pages must not carry a date.

`docs/app` is what ahenora.com serves, and `npx expo export` PRERENDERS each
route to HTML at build time. Any screen built out of today's date therefore
bakes the BUILD day into that HTML — and every visitor on every later day
hydrates against a different date, so React finds the text does not match,
throws #418 and throws the tree away.

That shipped. The calendar carried "September 11" while clients computed the
12th, and the only reason anybody noticed is that five browser harnesses went
red at midnight during a backend-only change. A production error findable only
by the clock rolling over is a production error nobody finds.

This is the cheap, permanent version of that check: it reads the exported HTML
and fails if a date is in it, today, without waiting for midnight.

Run with:  python3 -m unittest discover -s tests -v
"""

import os
import re
import unittest

APP = os.path.join(os.path.dirname(__file__), "..", "docs", "app")

# Routes whose screens are built out of "today". Listed rather than globbed so
# that adding a date-driven screen is a deliberate act: a new page that shows
# the date has to be added here, and is then held to the same rule.
DATE_DRIVEN_PAGES = ["calendar.html", os.path.join("(tabs)", "calendar.html")]

ISO_DATE = re.compile(r"\b20\d{2}-\d{2}-\d{2}\b")
MONTH_DAY = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|"
    r"October|November|December)\s+\d{1,2}\b")
# A weekday name followed by a day number: the week strip.
#
# Matched against the page's VISIBLE TEXT rather than its markup. The first
# version of this counted tags between the two — it assumed one, the real page
# has several, and it failed its own self-check below. Markup shape is not the
# thing being tested; what a reader sees is.
WEEKDAY_NUM = re.compile(
    r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b\W{0,4}\d{1,2}\b")

TAGS = re.compile(r"<[^>]*>")
SCRIPTS = re.compile(r"<(script|style)\b.*?</\1>", re.S | re.I)


def page(name):
    with open(os.path.join(APP, name), encoding="utf-8") as fh:
        return fh.read()


def visible(name):
    """What a reader would see: markup, scripts and styles removed.

    Scripts first — the bundle is full of strings that look like anything, and
    a date inside JavaScript is not a date the server rendered."""
    html = SCRIPTS.sub(" ", page(name))
    return TAGS.sub(" ", html)


class PrerenderedPages(unittest.TestCase):
    def test_the_export_is_actually_there(self):
        """A missing file would make every check below pass by finding nothing."""
        for name in DATE_DRIVEN_PAGES:
            with self.subTest(page=name):
                path = os.path.join(APP, name)
                self.assertTrue(os.path.exists(path), f"{name} is not exported")
                self.assertGreater(len(page(name)), 2000,
                                   f"{name} is too small to be a real page")

    def test_no_iso_date_is_baked_in(self):
        for name in DATE_DRIVEN_PAGES:
            with self.subTest(page=name):
                found = sorted(set(ISO_DATE.findall(visible(name))))
                self.assertEqual(
                    found, [],
                    f"{name} carries {found[:5]} — the build day is in the HTML, "
                    "so every visitor after today hydrates against a different "
                    "date and React discards the tree")

    def test_no_month_and_day_is_baked_in(self):
        for name in DATE_DRIVEN_PAGES:
            with self.subTest(page=name):
                found = sorted(set(MONTH_DAY.findall(visible(name))))
                self.assertEqual(found, [], f"{name} names a month and day")

    def test_no_week_strip_is_baked_in(self):
        for name in DATE_DRIVEN_PAGES:
            with self.subTest(page=name):
                self.assertIsNone(
                    WEEKDAY_NUM.search(visible(name)),
                    f"{name} carries a rendered week strip")

    def test_the_patterns_can_actually_match_something(self):
        """A regex matching nothing would make all of this pass silently.

        The exact shapes the calendar used to ship are the fixture, so a
        failure cannot be 'fixed' by loosening a pattern.
        """
        sample = TAGS.sub(" ", '<div>September 11</div><span>2026-09-11</span>'
                               '<div>Fri</div><div class="x">11</div>')
        self.assertTrue(ISO_DATE.search(sample))
        self.assertTrue(MONTH_DAY.search(sample))
        self.assertTrue(WEEKDAY_NUM.search(sample))
        # And the stripper must not simply empty everything, which would make
        # the three checks above pass on any page at all.
        self.assertIn("September", sample)


if __name__ == "__main__":
    unittest.main()
