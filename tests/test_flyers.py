"""The printed flyers.

Print is unforgiving in a way the web is not: a poster that overflows onto a
second sheet, or whose QR does not scan, is discovered at the copy shop or on
the school gate — after the money is spent. Neither failure announces itself in
a browser.

The committed HTML is generated, so the risk is that someone edits the output
and the next build silently reverts it. These tests rebuild from the script and
compare, which makes the script the single source and the files its artefact.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import qrcode  # noqa: F401
    HAVE_QR = True
except ImportError:
    HAVE_QR = False

if HAVE_QR:
    import build_flyers

ROOT = os.path.join(os.path.dirname(__file__), "..")
PRINT_DIR = os.path.join(ROOT, "docs", "print")
LANGS = ("fr", "en")
SIZES = ("a3", "a5")


def flyer(code, size="a3"):
    with open(os.path.join(PRINT_DIR, f"flyer-{size}-{code}.html"), encoding="utf-8") as fh:
        return fh.read()


@unittest.skipUnless(HAVE_QR, "qrcode not installed")
class TheFlyers(unittest.TestCase):
    def test_the_committed_files_match_the_script(self):
        # Regenerate into memory and compare. If someone hand-edits the HTML,
        # the next `python3 scripts/build_flyers.py` would throw the edit away
        # without a word; this turns that into a failing test instead.
        for code, copy in build_flyers.COPY.items():
            cards = "".join(
                f'<div class="card"><h3>{h}</h3><p>{p}</p></div>'
                for h, p in copy["bullets"])
            for size, dims in build_flyers.SIZES.items():
                expected = build_flyers.TEMPLATE.format(
                    qr=build_flyers.qr_svg(build_flyers.URL, 62), cards=cards,
                    **dims, **copy)
                self.assertEqual(
                    flyer(code, size), expected,
                    f"docs/print/flyer-{size}-{code}.html was edited by hand; "
                    f"change scripts/build_flyers.py and rebuild instead")

    def test_each_sheet_declares_its_own_page_size(self):
        # Both sizes exist and each asks the printer for the right sheet. An A5
        # that still says A3 prints one corner of the design, very large.
        for code in LANGS:
            self.assertIn("size: A3 portrait", flyer(code, "a3"))
            self.assertIn("size: A5 portrait", flyer(code, "a5"))

    def test_nothing_can_overflow_onto_a_second_sheet(self):
        # The A5 scales an A3 composition, and a transform scales what is
        # painted without shrinking the space it claims. That overflowed the
        # page by 0.08mm and Chrome emitted a second, blank sheet — which on a
        # print run is double the paper for nothing. Both boxes stay clipped.
        for code in LANGS:
            for size in SIZES:
                html = flyer(code, size)
                self.assertIn("html, body {", html)
                self.assertIn("overflow: hidden;", html)
                self.assertIn("position: absolute; top: 0; left: 0;", html)

    def test_the_sheet_puts_ink_on_the_paper(self):
        # The first print run came back looking like a photocopy: a cream a
        # hair off white, white cards, and orange only in hairlines. These are
        # the fields that fixed it, and losing them again should fail here
        # rather than at a print shop.
        for code in LANGS:
            for size in SIZES:
                html = flyer(code, size)
                self.assertIn("background: #D2540E", html)   # the orange banner
                self.assertIn("background: #16181D", html)   # the dark footer
                self.assertIn("background: #FFE3D2", html)   # a tinted card
                # Backgrounds are dropped by browsers when printing unless this
                # is set, which would undo every colour above.
                self.assertIn("print-color-adjust: exact", html)

    def test_the_qr_is_vector_not_a_bitmap(self):
        # A raster QR blurs when a copier scales the sheet, and being scaled is
        # the normal case for a poster.
        for code in LANGS:
            html = flyer(code)
            self.assertIn("<svg", html)
            self.assertNotIn("data:image/png", html)

    def test_the_qr_points_at_the_site_and_says_so_in_text(self):
        # The URL is printed as words too: plenty of people will not scan, and
        # a poster with only a QR is a poster half of them cannot act on.
        for code in LANGS:
            html = flyer(code)
            self.assertIn(f'aria-label="QR code to {build_flyers.URL}"', html)
            self.assertIn("ahenora.com", html)

    def test_the_qr_carries_high_error_correction(self):
        # A drawing pin through a corner, or rain on a school gate, must not
        # kill the code. H recovers 30%.
        q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,
                          box_size=1, border=2)
        q.add_data(build_flyers.URL)
        q.make(fit=True)
        expected_modules = len(q.get_matrix())
        for code in LANGS:
            box = re.search(r'viewBox="0 0 (\d+) \1"', flyer(code))
            self.assertIsNotNone(box, "QR viewBox missing or not square")
            self.assertEqual(int(box.group(1)), expected_modules)

    def test_both_flyers_say_iOS_is_coming(self):
        # The whole point of printing now rather than waiting: an iPhone owner
        # must not read this, search the App Store, find nothing, and conclude
        # the app does not exist.
        self.assertIn("Bientôt sur iPhone", flyer("fr"))
        self.assertIn("Coming soon to iPhone", flyer("en"))

    def test_both_flyers_tell_an_iPhone_owner_what_to_do_today(self):
        # "Coming soon" on its own is a dead end.
        self.assertIn("navigateur", flyer("fr"))
        self.assertIn("browser", flyer("en"))

    def test_the_two_languages_carry_the_same_offer(self):
        # A poster that promises four things in one language and three in the
        # other is a poster nobody proofread.
        counts = {code: flyer(code).count('<div class="card">') for code in LANGS}
        self.assertEqual(len(set(counts.values())), 1, counts)
        self.assertEqual(counts["fr"], len(build_flyers.COPY["fr"]["bullets"]))

    def test_no_tracking_parameters_in_the_printed_url(self):
        # There is no web analytics to receive one, so a utm tag would only
        # make the printed address longer and harder to type.
        self.assertNotIn("utm_", build_flyers.URL)

    def test_print_artefacts_are_kept_out_of_search(self):
        with open(os.path.join(ROOT, "docs", "robots.txt"), encoding="utf-8") as fh:
            self.assertIn("Disallow: /print/", fh.read())


if __name__ == "__main__":
    unittest.main()
