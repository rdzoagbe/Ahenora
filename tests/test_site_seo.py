"""The site's discoverability, checked rather than assumed.

Ahenora cannot afford paid acquisition, so organic search is the channel. Three
things decide whether a crawler can work with the site at all, and every one of
them fails silently: a sitemap listing pages that do not exist teaches Google
the site is unreliable, malformed JSON-LD is ignored without a word, and a
missing canonical splits ranking between ahenora.com and www.ahenora.com.

Silent failure is the reason these are tests and not a checklist.

Run with:  python3 -m unittest discover -s tests -v
"""
import html as html_mod
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


def _strip_markup(html: str) -> str:
    """Remove scripts, styles and comments before reading a page as copy.

    Case-insensitive on purpose. HTML tag names are case-insensitive, so a
    filter written only for lowercase <script> silently passes <SCRIPT> through
    — which is what CodeQL means by a bad HTML filtering regexp. Kept in one
    place so the next check that needs it cannot reintroduce the flaw.
    """
    flags = re.S | re.I
    for pattern in (r"<script\b.*?</script\s*>", r"<style\b.*?</style\s*>", r"<!--.*?-->"):
        html = re.sub(pattern, "", html, flags=flags)
    return html


class MarkupStripping(unittest.TestCase):
    """The filter that decides what counts as page copy.

    CodeQL flagged the original as a bad HTML filtering regexp: written only
    for lowercase <script>, it let <SCRIPT> through. That is not academic here
    — script source is full of English, so the "no English on the French page"
    check would have failed on JavaScript and sent someone hunting for copy
    that was already correct.
    """

    SAMPLE = (
        "<p>Bonjour</p>"
        "<SCRIPT>var leak = 'the your and with';</SCRIPT>"
        "<Style>.x { color: red }</Style>"
        "<!-- Monthly / yearly -->"
        "<p>Au revoir</p>"
    )

    def test_it_strips_tags_whatever_their_case(self):
        out = _strip_markup(self.SAMPLE)
        self.assertNotIn("leak", out)
        self.assertNotIn("color: red", out)
        self.assertNotIn("Monthly", out)

    def test_it_keeps_the_actual_copy(self):
        out = _strip_markup(self.SAMPLE)
        self.assertIn("Bonjour", out)
        self.assertIn("Au revoir", out)

    def test_it_would_fail_without_case_insensitivity(self):
        """The guard against someone "simplifying" the flags away.

        Deliberately does NOT demonstrate the broken expression by writing it
        out: a lowercase-only tag filter is itself the thing CodeQL flags, and
        committing one to prove a point re-raises the alert — which is exactly
        what happened on the first attempt at this file. The behaviour is
        asserted instead, which is the part that matters.
        """
        self.assertNotIn("leak", _strip_markup("<SCRIPT>var leak;</SCRIPT>"))
        self.assertNotIn("leak", _strip_markup("<Script>var leak;</Script>"))
        self.assertNotIn("leak", _strip_markup("<script >var leak;</script >"))


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


def ld_blocks(page="index.html"):
    """Every JSON-LD block on a page, parsed."""
    return [json.loads(b) for b in re.findall(
        r'<script type="application/ld\+json">(.*?)</script>', read(page), re.S)]


def ld_of(kind, page="index.html"):
    found = [b for b in ld_blocks(page) if b.get("@type") == kind]
    assert len(found) == 1, f"{page}: expected one {kind}, found {len(found)}"
    return found[0]


class StructuredData(unittest.TestCase):
    def blocks(self):
        html = read("index.html")
        return re.findall(
            r'<script type="application/ld\+json">(.*?)</script>', html, re.S)

    def test_every_block_parses(self):
        # Invalid JSON-LD is discarded silently by every crawler, so "we added
        # structured data" is not a claim anyone should make untested.
        blocks = self.blocks()
        self.assertTrue(blocks)
        for block in blocks:
            json.loads(block)

    def test_each_kind_appears_once(self):
        # Two blocks of the same @type is how a page ends up describing itself
        # twice and disagreeing with itself.
        kinds = [json.loads(b).get("@type") for b in self.blocks()]
        self.assertEqual(sorted(kinds), sorted(set(kinds)))

    def test_it_describes_an_application(self):
        data = ld_of("MobileApplication")
        self.assertEqual(data["@type"], "MobileApplication")
        self.assertEqual(data["name"], "Ahenora")
        self.assertTrue(data["featureList"])

    def test_its_install_link_matches_the_one_on_the_page(self):
        # Markup that contradicts the page is a trust signal in the wrong
        # direction, and the bundle id has changed once already.
        data = ld_of("MobileApplication")
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


class FrenchPage(unittest.TestCase):
    """The market is France and the site was English-only.

    A translated page that Google treats as a duplicate of the English one is
    worse than no translation: it exists, costs upkeep, and is never served to
    the people it was written for. hreflang is what prevents that, and it only
    works when BOTH pages declare the pair — a one-sided declaration is
    ignored.
    """

    def test_it_exists_and_declares_french(self):
        self.assertIn('<html lang="fr">', read("fr.html"))

    def test_each_page_is_its_own_canonical(self):
        # Pointing the French page at the English canonical would ask Google to
        # drop it, which is the exact failure this is meant to avoid.
        self.assertIn('rel="canonical" href="%s/fr.html"' % SITE, read("fr.html"))
        self.assertIn('rel="canonical" href="%s/"' % SITE, read("index.html"))

    def test_both_pages_declare_the_same_pair(self):
        for name in ("index.html", "fr.html"):
            html = read(name)
            self.assertIn('hreflang="en" href="%s/"' % SITE, html, name)
            self.assertIn('hreflang="fr" href="%s/fr.html"' % SITE, html, name)
            self.assertIn('hreflang="x-default"', html, name)

    def test_a_reader_can_get_from_one_to_the_other(self):
        # A page reachable only by a crawler is a page no person will find.
        self.assertIn('href="/fr.html" hreflang="fr"', read("index.html"))
        self.assertIn('href="/" hreflang="en"', read("fr.html"))

    def test_no_english_marketing_copy_survives_on_it(self):
        # A half-translated page reads as abandoned. Checked by looking for
        # English function words in the rendered text, which cannot appear in
        # French copy.
        html = read("fr.html")
        body = html[html.index("<body"):]
        # re.I matters: HTML tag names are case-insensitive, so <SCRIPT> is a
        # script and this filter did not strip it. CodeQL flagged it as a bad
        # HTML filtering regexp and it was right — a filter that misses half
        # the tags it names would have let script source through as "copy" and
        # failed the English check for a reason that is not about English.
        body = _strip_markup(body)
        texts = [t.strip() for t in re.split(r"<[^>]+>", body) if t.strip()]
        tells = re.compile(r"\b(the|your|and|with|for|that|every|without|you)\b", re.I)
        leftovers = [t for t in texts if len(t) > 2 and tells.search(t)]
        self.assertEqual(leftovers, [], "untranslated copy: %s" % leftovers[:3])

    def test_the_prices_still_say_the_same_numbers(self):
        # Translated marketing that quietly restates a price is a promise the
        # billing code will not keep. Same figures, French separators.
        fr = read("fr.html")
        for figure in ("6,99", "49,99", "14,99", "149,99", "33,89", "29,89"):
            self.assertIn(figure, fr, "missing price %s" % figure)
        for figure in ("6.99", "49.99", "33.89"):
            self.assertIn(figure, read("index.html"))

    def test_no_english_price_format_survives(self):
        # The prices live in data-* attributes as well as in the visible
        # markup, and attributes are not text nodes — so the copy scan passed
        # while the page still rendered "€49.99 / year · €4.17 a month" the
        # moment someone touched the yearly toggle. Caught by driving the
        # toggle in a browser; guarded here by shape.
        html = read("fr.html")
        # Developer comments are not copy — "Monthly / yearly" describes the
        # toggle to whoever edits this file and is never shown to anyone.
        html = re.sub(r"<!--.*?-->", "", html, flags=re.S | re.I)
        html = re.sub(r"^\s*//.*$", "", html, flags=re.M)
        self.assertNotRegex(
            html, r"&euro;\d",
            "English price format (symbol first, decimal point) on the French page")
        for phrase in ("/ year", "a month", "/ month"):
            self.assertNotIn(phrase, html,
                             "untranslated price note: %s" % phrase)

    def test_the_labels_javascript_writes_are_translated_too(self):
        """The CTAs are rewritten at runtime by the platform-detect script.

        A scan of the static markup misses them entirely — it strips <script>
        — so the French page rendered with "Open the app" and "Open Ahenora in
        your browser" while every static string was correct. Found by opening
        the page in a browser, which is the only source that tells the truth
        about what a visitor reads.
        """
        script = read("fr.html")
        script = script[script.index("<script"):]
        assigned = re.findall(r"textContent = ([^;]+);", script)
        self.assertTrue(assigned, "the CTA script changed shape; re-check it")
        for expression in assigned:
            for word in ("Open", "your browser", "On Android"):
                self.assertNotIn(
                    word, expression,
                    "untranslated runtime label on the French page: %s" % expression)

    def test_it_is_in_the_sitemap_with_its_alternates(self):
        xml = read("sitemap.xml")
        self.assertIn("%s/fr.html" % SITE, xml)
        self.assertIn('hreflang="fr"', xml)


if __name__ == "__main__":
    unittest.main()


class TheFaq(unittest.TestCase):
    """The questions people ask before installing, and the markup for them.

    Two separate things, and the second is worth less than it sounds. Google
    restricted FAQ rich results in 2023 to government and health sites, so
    this markup will NOT put questions under the search result for an app.

    The CONTENT is the point. These are the things that stop somebody
    downloading — what it costs, whether it works across two homes, what the
    other parent can see, what happens to the data — and they are also, in
    that order, what a person types into a search box or asks an assistant.
    A page that answers them is more findable than one that does not, with or
    without the schema.

    What these tests actually guard is the failure the file already warns
    about one class up: "markup that contradicts the page is a trust signal in
    the wrong direction". The JSON-LD is generated from the visible section,
    so the two can only drift if somebody edits one by hand.
    """

    def questions_on(self, page):
        block = read(page)
        block = block[block.index('id="faq"'):block.index('<section class="final">')]
        return re.findall(r"<summary>(.*?)</summary>", block, re.S)

    def strip(self, markup):
        return re.sub(r"\s+", " ", html_mod.unescape(
            re.sub(r"<[^>]+>", " ", markup))).strip()

    def test_both_pages_have_one(self):
        for page in ("index.html", "fr.html"):
            self.assertGreaterEqual(len(self.questions_on(page)), 6, page)

    def test_the_schema_says_exactly_what_the_page_says(self):
        for page in ("index.html", "fr.html"):
            faq = ld_of("FAQPage", page)
            asked = [self.strip(q) for q in self.questions_on(page)]
            marked = [q["name"] for q in faq["mainEntity"]]
            self.assertEqual(marked, asked, page)

    def test_every_question_has_a_real_answer(self):
        for page in ("index.html", "fr.html"):
            for entry in ld_of("FAQPage", page)["mainEntity"]:
                answer = entry["acceptedAnswer"]["text"]
                self.assertEqual(entry["acceptedAnswer"]["@type"], "Answer")
                # A one-line answer is the shape of a page written for a
                # crawler rather than for a person.
                self.assertGreater(len(answer), 120, entry["name"])

    def test_the_answers_are_in_the_html_without_javascript(self):
        # <details> keeps the answer in the markup whether or not it is open.
        # Behind a click handler it would be invisible to a crawler and to
        # anyone reading with scripting off.
        for page in ("index.html", "fr.html"):
            self.assertIn("<details>", read(page))
            self.assertNotIn("faq-toggle", read(page))

    def test_the_french_questions_are_actually_french(self):
        # The sibling test for the marketing copy exists because an English
        # string survived a translation pass once already.
        english = self.questions_on("index.html")
        french = self.questions_on("fr.html")
        self.assertEqual(len(english), len(french))
        self.assertFalse(set(english) & set(french))

    def test_it_does_not_sell_the_member_safety_cap_as_the_offer(self):
        """max_members is a ceiling, not a feature.

        The first version of this FAQ said the free plan "covers a household
        of up to ten people with two children", read straight off
        PLAN_CATALOG. But the catalogue's own comment says max_members "stays
        as a generous total safety cap" — the metered thing is max_children,
        and helper accounts are off on free, so nobody reaches ten.

        Advertising the backstop misdescribes the offer AND sets up a
        disappointment: somebody plans a ten-person household, then meets the
        real limit at the second child and concludes the page lied. Roland
        caught it; this keeps it caught.
        """
        for page in ("index.html", "fr.html"):
            free = ld_of("FAQPage", page)["mainEntity"][0]["acceptedAnswer"]["text"]
            for ceiling in ("ten people", "10 people", "dix personnes", "10 personnes"):
                self.assertNotIn(ceiling, free, page)

    def test_the_free_plan_answer_names_the_limit_that_actually_bites(self):
        # Two children is the number a household meets. If the copy stops
        # saying so, the answer has stopped answering the question.
        for page, phrase in (("index.html", "two children"),
                             ("fr.html", "deux enfants")):
            free = ld_of("FAQPage", page)["mainEntity"][0]["acceptedAnswer"]["text"]
            self.assertIn(phrase, free, page)

    def test_it_does_not_promise_a_rich_result_it_will_not_get(self):
        # The comment above the block has to keep saying this. Somebody
        # measuring this change by looking for questions under the search
        # result will conclude it failed, and remove it.
        self.assertIn("restricted FAQ rich results", read("index.html"))
