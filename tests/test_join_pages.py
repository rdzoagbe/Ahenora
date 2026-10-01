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


class InvitationLinksOpenTheApp(unittest.TestCase):
    """From 1.2.1, tapping an invitation opens Ahenora when it is installed.

    Four things must name the same paths, the same app and the same signing
    key, or the phone silently opens the browser instead: the site's two
    association files, the Android manifest that actually builds, and the
    app.json the iPhone build reads. A mismatch fails nothing at build time,
    so it fails here.
    """
    JOIN_PATHS = ["/join", "/fr/join", "/es/join", "/de/join"]

    def setUp(self):
        import json
        self.json = json
        wk = os.path.join(DOCS, ".well-known")
        with open(os.path.join(wk, "assetlinks.json"), encoding="utf-8") as fh:
            self.assetlinks = json.load(fh)
        with open(os.path.join(wk, "apple-app-site-association"), encoding="utf-8") as fh:
            self.aasa = json.load(fh)
        with open(os.path.join(ROOT, "frontend", "app.json"), encoding="utf-8") as fh:
            self.app = json.load(fh)["expo"]
        with open(os.path.join(ROOT, "frontend", "eas.json"), encoding="utf-8") as fh:
            self.eas = fh.read()
        with open(os.path.join(ROOT, "frontend", "android", "app", "src", "main",
                               "AndroidManifest.xml"), encoding="utf-8") as fh:
            self.manifest = fh.read()

    def test_the_pages_the_links_open_are_the_invitation_pages(self):
        self.assertEqual(
            sorted("/" + v["path"] for v in build_join_pages.LANGS.values()),
            sorted(self.JOIN_PATHS))

    def test_android_trusts_the_play_signed_app(self):
        target = self.assetlinks[0]["target"]
        self.assertEqual(target["package_name"], self.app["android"]["package"])
        self.assertIn("delegate_permission/common.handle_all_urls", self.assetlinks[0]["relation"])
        # Google Play's app signing key, as shown in Play Console.
        self.assertEqual(target["sha256_cert_fingerprints"], [
            "6D:30:9D:1D:B5:3C:D7:26:80:B2:C9:E7:0C:A8:E6:7A:80:2D:8E:B9:A4:9C:2B:57:A3:CD:CF:00:2C:E4:53:1C"])

    def test_the_android_build_claims_exactly_the_invitation_paths(self):
        # The committed manifest is what builds; app.json is its mirror.
        block = re.search(r'<intent-filter android:autoVerify="true">(.*?)</intent-filter>',
                          self.manifest, re.S)
        self.assertIsNotNone(block, "no verified intent filter in AndroidManifest.xml")
        found = re.findall(r'android:host="ahenora.com" android:pathPrefix="([^"]+)"', block.group(1))
        self.assertEqual(sorted(found), sorted(self.JOIN_PATHS))
        mirror = [f for f in self.app["android"]["intentFilters"] if f.get("autoVerify")]
        self.assertEqual(sorted(d["pathPrefix"] for d in mirror[0]["data"]), sorted(self.JOIN_PATHS))
        self.assertTrue(all(d["host"] == "ahenora.com" for d in mirror[0]["data"]))

    def test_the_iphone_build_and_the_site_name_the_same_app(self):
        self.assertIn("applinks:ahenora.com", self.app["ios"]["associatedDomains"])
        team = re.search(r'"appleTeamId":\s*"([A-Z0-9]{10})"', self.eas).group(1)
        app_id = f'{team}.{self.app["ios"]["bundleIdentifier"]}'
        detail = self.aasa["applinks"]["details"][0]
        self.assertEqual(detail["appIDs"], [app_id])
        self.assertEqual(detail["appID"], app_id)
        self.assertEqual(sorted(c["/"] for c in detail["components"]),
                         sorted(p + "/*" for p in self.JOIN_PATHS))

    def test_the_website_itself_is_never_claimed_by_the_app(self):
        # Only invitations. The homepage, the web app and everything else must
        # keep opening in the browser.
        detail = self.aasa["applinks"]["details"][0]
        for path in detail["paths"] + [c["/"] for c in detail["components"]]:
            self.assertTrue(path.split("/*")[0] in self.JOIN_PATHS, path)

    def test_github_pages_publishes_the_well_known_folder(self):
        # Jekyll skips dot-folders unless it is switched off, and the Pages
        # upload action leaves hidden files out unless told to include them.
        # Either one alone ships a site without the files, silently.
        self.assertTrue(os.path.exists(os.path.join(DOCS, ".nojekyll")))
        with open(os.path.join(ROOT, ".github", "workflows", "pages-deploy.yml"),
                  encoding="utf-8") as fh:
            workflow = fh.read()
        self.assertIn("include-hidden-files: true", workflow)
        self.assertIn(".well-known/apple-app-site-association", workflow)
