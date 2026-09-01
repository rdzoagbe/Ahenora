"""The site's discoverability, checked rather than assumed.

Ahenora cannot afford paid acquisition, so organic search is the channel. Three
things decide whether a crawler can work with the site at all, and every one of
them fails silently: a sitemap listing pages that do not exist teaches Google
the site is unreliable, malformed JSON-LD is ignored without a word, and a
missing canonical splits ranking between ahenora.com and www.ahenora.com.

Silent failure is the reason these are tests and not a checklist.

Run with:  python3 -m unittest discover -s tests -v
"""
import json
import os
import re
import unittest
import xml.etree.ElementTree as ET

try:
    import yaml  # noqa: F401
    HAVE_YAML = True
except ImportError:
    HAVE_YAML = False

ROOT = os.path.join(os.path.dirname(__file__), "..")
DOCS = os.path.join(ROOT, "docs")
SITE = "https://ahenora.com"


def read(name):
    with open(os.path.join(DOCS, name), encoding="utf-8") as fh:
        return fh.read()


class Sitemap(unittest.TestCase):
    def urls(self):
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        tree = ET.parse(os.path.join(DOCS, "sitemap.xml"))
        return [e.text for e in tree.getroot().findall(".//s:loc", ns)]

    def test_it_is_valid_xml(self):
        self.assertGreater(len(self.urls()), 0)

    def test_every_listed_page_actually_exists(self):
        # A 404 in a sitemap is worse than an absent sitemap: it is a claim
        # the site makes about itself and then fails to honour.
        for url in self.urls():
            self.assertTrue(
                os.path.exists(os.path.join(DOCS, self._filename(url))),
                "sitemap promises %s, which does not exist" % url)

    @staticmethod
    def _filename(url):
        # The root URL is "https://ahenora.com/", whose last path segment is
        # empty — not the host. Getting this wrong makes the check compare
        # "ahenora.com" against filenames and quietly pass or fail for the
        # wrong reason.
        path = url[len(SITE):].strip("/")
        return path or "index.html"

    def test_every_real_page_is_listed(self):
        # The other direction: a page nobody links to and the sitemap omits is
        # a page that does not get crawled.
        listed = {self._filename(u) for u in self.urls()}
        for name in os.listdir(DOCS):
            if not name.endswith(".html") or name in ("404.html",):
                continue
            self.assertIn(name, listed, "%s is not in the sitemap" % name)

    def test_it_does_not_advertise_the_signed_in_app(self):
        # /app is the exported React build: screens behind a sign-in, not pages
        # a search result should land on.
        self.assertFalse([u for u in self.urls() if "/app" in u])


class Robots(unittest.TestCase):
    def test_it_points_at_the_sitemap(self):
        self.assertIn("Sitemap: %s/sitemap.xml" % SITE, read("robots.txt"))

    def test_it_keeps_crawlers_out_of_the_web_app(self):
        self.assertIn("Disallow: /app/", read("robots.txt"))

    def test_it_does_not_accidentally_block_the_site(self):
        # One stray "Disallow: /" removes the entire site from search, and
        # nothing tells you.
        body = read("robots.txt")
        self.assertNotIn("\nDisallow: /\n", body)
        self.assertIn("Allow: /", body)


class StructuredData(unittest.TestCase):
    def blocks(self):
        html = read("index.html")
        return re.findall(
            r'<script type="application/ld\+json">(.*?)</script>', html, re.S)

    def test_there_is_exactly_one_and_it_parses(self):
        # Invalid JSON-LD is discarded silently by every crawler, so "we added
        # structured data" is not a claim anyone should make untested.
        blocks = self.blocks()
        self.assertEqual(len(blocks), 1)
        json.loads(blocks[0])

    def test_it_describes_an_application(self):
        data = json.loads(self.blocks()[0])
        self.assertEqual(data["@type"], "MobileApplication")
        self.assertEqual(data["name"], "Ahenora")
        self.assertTrue(data["featureList"])

    def test_its_install_link_matches_the_one_on_the_page(self):
        # Markup that contradicts the page is a trust signal in the wrong
        # direction, and the bundle id has changed once already.
        data = json.loads(self.blocks()[0])
        self.assertIn(data["installUrl"], read("index.html"))

    def test_the_page_declares_a_canonical(self):
        self.assertIn('<link rel="canonical" href="%s/">' % SITE, read("index.html"))


class Metadata(unittest.TestCase):
    def test_the_title_fits_in_a_search_result(self):
        # Google truncates around 60 characters; past that the tail is unread.
        title = re.search(r"<title>(.*?)</title>", read("index.html")).group(1)
        self.assertLessEqual(len(title), 60, "title will be cut off: %r" % title)

    def test_the_description_fits_too(self):
        desc = re.search(r'name="description" content="(.*?)"',
                         read("index.html")).group(1)
        self.assertLessEqual(len(desc), 160, "description will be cut off")
        self.assertGreater(len(desc), 70, "too short to say anything useful")


if __name__ == "__main__":
    unittest.main()
