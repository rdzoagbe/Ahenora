"""A share link survives the site's catch-all page.

Gift pot and Secret Santa links (/app/pot/<code>, /app/santa-match/<code>) have
no file on the host, so they land on docs/404.html. That page used to send
every unknown address to /app/ and drop the path, so a guest opening either
link met a sign-in screen. The browser harness e2e_sharelink.py proves the
whole round trip; these pin the two halves of it cheaply, on every backend run:

  * docs/404.html and frontend/app/+html.tsx must agree on what a share link
    looks like, or one of them forwards something the other refuses;
  * that shape must accept every code the backend actually mints, or some
    links work and some do not, at random.
"""
import os
import re
import secrets
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


CATCH_ALL = read("docs", "404.html")
HTML_ROOT = read("frontend", "app", "+html.tsx")


class TheTwoHalvesAgree(unittest.TestCase):
    def test_both_accept_the_same_two_screens(self):
        self.assertIn("(pot|santa-match)", CATCH_ALL)
        self.assertIn("(pot|santa-match)", HTML_ROOT)

    def test_both_accept_the_same_code_shape(self):
        shape = "[A-Za-z0-9_-]{8,128}"
        self.assertIn(shape, CATCH_ALL)
        self.assertIn(shape, HTML_ROOT)

    def test_the_catch_all_forwards_to_the_screens_own_page(self):
        """Forwarding to the front page made React report a mismatch on every
        guest visit: the app took over the front page's HTML as a gift pot."""
        self.assertIn("'/%5Btoken%5D.html?__share='", CATCH_ALL)
        self.assertTrue(os.path.exists(os.path.join(ROOT, "docs", "app", "pot", "[token].html")))
        self.assertTrue(os.path.exists(os.path.join(ROOT, "docs", "app", "santa-match", "[token].html")))

    def test_the_no_script_fallback_cannot_overtake_the_redirect(self):
        """A bare refresh tag after the script raced it: a share link already
        on its way to its own page could be overtaken by a jump to the front
        page. It is only for browsers with scripts off."""
        self.assertIn('<noscript><meta http-equiv="refresh"', CATCH_ALL)
        bare = CATCH_ALL.replace('<noscript><meta http-equiv="refresh"', "")
        self.assertNotIn('http-equiv="refresh"', bare)

    def test_the_restore_runs_before_the_app(self):
        """It has to sit in <head>: the app's bundle is loaded at the end of the
        page, and whatever address it sees first is the one it routes to."""
        head = HTML_ROOT.split("<head>", 1)[1].split("</head>", 1)[0]
        self.assertIn("__share", head)
        self.assertIn("history.replaceState", head)

    def test_the_restore_pattern_has_no_escaped_slash(self):
        """It lives in a template string, where a backslash-escaped slash
        silently becomes a bare one and ends the pattern early — a page that
        throws a syntax error and restores nothing."""
        block = HTML_ROOT[HTML_ROOT.index("__share"):]
        block = block[:block.index("replaceState")]
        self.assertNotIn("\\/", block)


class EveryRealCodeIsAccepted(unittest.TestCase):
    PATH = re.compile(r"^(?:/Ahenora)?/app/(pot|santa-match)/([A-Za-z0-9_-]{8,128})/?$")
    CARRIED = re.compile(r"^(pot|santa-match)[/][A-Za-z0-9_-]{8,128}$")

    def test_codes_minted_the_way_the_backend_mints_them(self):
        # server.py mints both with secrets.token_urlsafe(24).
        for _ in range(500):
            code = secrets.token_urlsafe(24)
            self.assertTrue(self.PATH.match(f"/app/pot/{code}"), code)
            self.assertTrue(self.PATH.match(f"/app/santa-match/{code}"), code)
            self.assertTrue(self.CARRIED.match(f"pot/{code}"), code)

    def test_the_backend_still_mints_them_that_way(self):
        server = read("backend", "server.py")
        self.assertIn('"share_token": token', server)
        self.assertGreaterEqual(server.count("secrets.token_urlsafe(24)"), 2)

    def test_nothing_else_is_carried(self):
        for bad in ("https://example.com", "settings", "pot/../settings",
                    "pot/abc", "pot/<script>alert(1)</script>", "vault/abcdefghij"):
            self.assertFalse(self.CARRIED.match(bad), bad)


if __name__ == "__main__":
    unittest.main()
