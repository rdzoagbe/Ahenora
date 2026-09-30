"""A shared invitation opens a page of its own, in the sender's language.

Roland, 2026-09-30: an invitation reached his partner on WhatsApp as the
website's own preview, in English, opening the browser version of the app.
These hold the pages that replaced that: generated from one script, one per
language the app speaks, each with an invitation preview small enough for
WhatsApp to show, and each sending the phone to the store and the invitation
to the app.

Run with:  python3 -m unittest tests.test_join_pages -v
"""
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
import build_join_pages  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
DOCS = os.path.join(ROOT, "docs")


def read(path):
    with open(os.path.join(DOCS, path, "index.html"), encoding="utf-8") as fh:
        return fh.read()


class TheInvitationPage(unittest.TestCase):
    def test_the_committed_pages_match_the_script(self):
        for code, copy in build_join_pages.LANGS.items():
            self.assertEqual(read(copy["path"]), build_join_pages.page(code, copy),
                             f"docs/{copy['path']} was edited by hand; change "
                             "scripts/build_join_pages.py and rebuild instead")

    def test_one_page_per_app_language_where_the_app_shares_them(self):
        # frontend/src/inviteShare.ts joinUrl: /join for English, /fr/join etc.
        self.assertEqual(
            {c: v["path"] for c, v in build_join_pages.LANGS.items()},
            {"en": "join", "fr": "fr/join", "es": "es/join", "de": "de/join"})
        with open(os.path.join(ROOT, "frontend", "src", "inviteShare.ts"), encoding="utf-8") as fh:
            share = fh.read()
        self.assertIn("https://ahenora.com/${prefix}join/?invite=", share)

    def test_the_preview_is_an_invitation_whatsapp_will_show(self):
        for code, copy in build_join_pages.LANGS.items():
            html = read(copy["path"])
            m = re.search(r'og:image" content="https://ahenora.com/assets/([^"]+)"', html)
            self.assertIsNotNone(m, code)
            image = os.path.join(DOCS, "assets", m.group(1))
            self.assertTrue(os.path.exists(image), image)
            # WhatsApp drops a preview image much over 300 KB.
            self.assertLess(os.path.getsize(image), 300 * 1024, image)
            self.assertIn(f'og:title" content="{copy["og_title"]}"'.replace("'", "&#x27;"), html)

    def test_it_sends_the_phone_to_the_store_and_the_invitation_to_the_app(self):
        for copy in build_join_pages.LANGS.values():
            html = read(copy["path"])
            self.assertIn(build_join_pages.APP_STORE, html)
            self.assertIn(build_join_pages.GOOGLE_PLAY, html)
            self.assertIn("householdcoo://?invite=", html)
            # The app's own scheme, as registered in app.json.
            self.assertIn('"scheme": "householdcoo"', open(
                os.path.join(ROOT, "frontend", "app.json"), encoding="utf-8").read())

    def test_it_is_kept_out_of_search_and_checks_the_invitation(self):
        for copy in build_join_pages.LANGS.values():
            html = read(copy["path"])
            self.assertIn('<meta name="robots" content="noindex">', html)
            # Only a token-shaped value is ever sent to the server.
            self.assertIn("/^[A-Za-z0-9_-]{8,200}$/", html)
            self.assertIn("/api/family/invite/", html)


if __name__ == "__main__":
    unittest.main()
