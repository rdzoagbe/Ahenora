"""What the website claims about where you can get the app.

For months the site told iPhone visitors "No iPhone app yet" and routed every
one of them to the browser. That was true the day it was written. It stopped
being true the day iOS shipped, and nothing anywhere failed — a marketing page
has no tests, so a page actively telling people a product does not exist can
sit there indefinitely while the product sells on the store it denies.

And the TikTok link still pointed at @thehouseholdcoo, the name the app had
before it was Ahenora. A dead social link in the footer of a homepage is small,
but it is the same class of thing: a fact that was true once, written down in
a place nothing checks.

So this checks the handful of claims that go stale: the store links, the
absence of the old ones, and that the two language versions say the same thing.

Run with:  python3 -m pytest tests/test_website_stores.py -q
"""
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
PAGES = ("docs/index.html", "docs/fr.html")

IOS = "https://apps.apple.com/app/id6806811163"
PLAY = "https://play.google.com/store/apps/details?id=com.householdcoo.app"
TIKTOK = "https://www.tiktok.com/@ahenoraapp"


def read(page):
    with open(os.path.join(ROOT, page), encoding="utf-8") as fh:
        return fh.read()


class BothStores(unittest.TestCase):
    def test_every_page_links_to_the_app_store(self):
        for page in PAGES:
            self.assertIn(IOS, read(page), f"{page} never mentions the App Store")

    def test_every_page_still_links_to_google_play(self):
        for page in PAGES:
            self.assertIn(PLAY, read(page))

    def test_no_page_still_says_there_is_no_iphone_app(self):
        """The specific sentence that was wrong, and its translations."""
        stale = ("No iPhone app yet", "no iOS app yet", "Pas encore d'app iPhone",
                 "pas encore d'app iOS", "there is no iOS app")
        for page in PAGES:
            body = read(page)
            for phrase in stale:
                self.assertNotIn(phrase, body,
                                 f"{page} still tells visitors the iPhone app does not exist")

    def test_an_iphone_visitor_is_sent_to_the_app_store(self):
        # The user-agent branch used to point iPhones at /app/. A store link
        # further down the page is not the same as the button they press.
        for page in PAGES:
            body = read(page)
            self.assertIn("isApple", body, f"{page} does not detect an Apple device")
            apple_branch = body[body.index("var isApple"):]
            head = apple_branch[:900]
            self.assertIn(IOS, head,
                          f"{page} detects an iPhone but does not send it to the App Store")


class TheSocialLinks(unittest.TestCase):
    def test_tiktok_points_at_the_account_that_exists(self):
        for page in PAGES:
            self.assertIn(TIKTOK, read(page))

    def test_nothing_still_points_at_the_old_name(self):
        # The app was The Household COO before it was Ahenora; the handle moved
        # with it and the link did not.
        for page in PAGES:
            self.assertNotIn("tiktok.com/@thehouseholdcoo", read(page))

    def test_no_share_tracking_left_in_a_published_link(self):
        # A TikTok share URL carries _r/_t session parameters that expire and
        # look like tracking to a visitor. The canonical profile URL does not.
        for page in PAGES:
            for url in re.findall(r'https://www\.tiktok\.com/[^"\']+', read(page)):
                self.assertNotIn("_t=", url)
                self.assertNotIn("?_r=", url)


class TheTwoLanguagesAgree(unittest.TestCase):
    """A fact fixed in English and left stale in French is the same bug, half
    fixed — and French is a language this app actually ships in."""

    def test_both_pages_carry_the_same_set_of_destinations(self):
        for url in (IOS, PLAY, TIKTOK):
            for page in PAGES:
                self.assertIn(url, read(page), f"{url} missing from {page}")

    def test_the_french_footer_is_in_french(self):
        body = read("docs/fr.html")
        self.assertNotIn("Follow on TikTok", body)
        self.assertNotIn("Follow on Instagram", body)


if __name__ == "__main__":
    unittest.main()
