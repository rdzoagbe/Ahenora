"""A shopping list sent as a PDF is read like a photographed one.

Asked for on 2026-11-10: "Can I import a pdf shopping list in the app?" Until
now the scan sheet took photos only, so a list that arrived as a PDF had to be
copied by hand or screenshotted first.

Gemini reads PDFs natively, sent inline as application/pdf (Google's
"Document understanding" guide: up to 50 MB or 1000 pages, 258 tokens a page).
These pin:
  * the PDF reaches the model as a PDF, read with the same rules (the same
    system prompt, the same validator) as a photo, and charged once;
  * the result is candidates only, exactly like a photo: nothing is added;
  * a file that is not a PDF, or is far bigger than a shopping list, is turned
    away BEFORE the model is called and before anything is charged;
  * a PDF the model cannot read as a list costs nothing;
  * the photo path is untouched.
"""
import asyncio
import base64
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    from fastapi import HTTPException
    import server
    from ai_safety import SHOPPING_SCAN_SYSTEM_PROMPT
    from fake_mongo import FakeDatabase

USER = {"user_id": "u_1", "family_id": "fam_1", "email": "a@example.com", "name": "Ana"}
ITEMS = '{"items":[{"name":"Lait 1 L"},{"name":"Pain"},{"name":"Oeufs x12","unsure":true}]}'


def run(coro):
    return asyncio.run(coro)


def pdf(pages: int = 1, pad: int = 400) -> str:
    """A small PDF-shaped file: the header, `pages` page objects, some bulk."""
    body = b"%PDF-1.7\n" + b"".join(
        b"%d 0 obj << /Type /Page /Parent 2 0 R >> endobj\n" % (i + 3) for i in range(pages))
    body += b"2 0 obj << /Type /Pages /Count %d >> endobj\n" % pages
    body += b"%" + b"x" * pad + b"\n%%EOF\n"
    return base64.b64encode(body).decode()


def png() -> str:
    """A real (tiny) picture, padded past the route's 100-character floor."""
    import io
    import PIL.Image
    buf = io.BytesIO()
    PIL.Image.new("RGB", (64, 64), "white").save(buf, "PNG", compress_level=0)
    return base64.b64encode(buf.getvalue()).decode()


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class APdfShoppingList(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self._generate = server._gemini_generate
        self._vision = server._gemini_vision
        self._admin = server.is_admin_user
        self._key = server.GOOGLE_API_KEY
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        server.is_admin_user = lambda u: False
        server.GOOGLE_API_KEY = "test-key"
        run(self.db["families"].insert_one({
            "family_id": "fam_1", "name": "Test", "plan": "village",
            "billing_cycle": "monthly", "ai_scans_used": 0,
            "created_at": server.utcnow()}))
        self.calls = []

        async def generate(contents, system="", **kwargs):
            self.calls.append({"contents": contents, "system": system, **kwargs})
            return ITEMS
        server._gemini_generate = generate

        async def vision(*a, **k):
            self.calls.append({"vision": True})
            return ITEMS
        server._gemini_vision = vision

    def tearDown(self):
        server.get_db = self._get_db
        server._gemini_generate = self._generate
        server._gemini_vision = self._vision
        server.is_admin_user = self._admin
        server.GOOGLE_API_KEY = self._key

    def scan(self, payload):
        return run(server.scan_shopping_list(payload, user=USER, database=self.db))

    def used(self):
        return run(self.db["families"].find_one({"family_id": "fam_1"})).get("ai_scans_used", 0)

    def refused(self, payload):
        with self.assertRaises(HTTPException) as caught:
            self.scan(payload)
        return caught.exception.status_code

    # --- it is read -----------------------------------------------------

    def test_the_pdf_reaches_the_model_as_a_pdf(self):
        out = self.scan({"pdf_base64": pdf()})
        self.assertEqual([i["name"] for i in out["items"]], ["Lait 1 L", "Pain", "Oeufs x12"])
        self.assertEqual([i["unsure"] for i in out["items"]], [False, False, True])
        (call,) = self.calls
        part = call["contents"][1]
        self.assertEqual(part.inline_data.mime_type, "application/pdf")
        self.assertTrue(part.inline_data.data.startswith(b"%PDF-"))
        self.assertIn("PDF", call["contents"][0])

    def test_it_is_read_with_the_shopping_rules_and_the_quick_model(self):
        self.scan({"pdf_base64": pdf()})
        self.assertEqual(self.calls[0]["system"], SHOPPING_SCAN_SYSTEM_PROMPT)
        self.assertTrue(self.calls[0].get("fast"))
        self.assertIn("PDF", SHOPPING_SCAN_SYSTEM_PROMPT)
        self.assertIn("read every page", SHOPPING_SCAN_SYSTEM_PROMPT)

    def test_a_data_url_is_accepted_as_well(self):
        out = self.scan({"pdf_base64": "data:application/pdf;base64," + pdf()})
        self.assertEqual(len(out["items"]), 3)

    def test_it_is_charged_once_and_nothing_is_added(self):
        self.scan({"pdf_base64": pdf()})
        self.assertEqual(self.used(), 1)
        self.assertEqual(run(self.db["shopping_list"].count_documents({})), 0)

    def test_a_two_page_list_is_fine(self):
        self.assertEqual(len(self.scan({"pdf_base64": pdf(pages=2)})["items"]), 3)

    # --- turned away before the model, and free -------------------------

    def test_a_file_that_is_not_a_pdf_is_turned_away(self):
        png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 400).decode()
        self.assertEqual(self.refused({"pdf_base64": png}), 400)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.used(), 0)

    def test_text_that_is_not_base64_is_turned_away(self):
        self.assertEqual(self.refused({"pdf_base64": "%PDF-" + "!" * 400}), 400)
        self.assertEqual(self.calls, [])

    def test_an_empty_pdf_is_turned_away(self):
        self.assertEqual(self.refused({"pdf_base64": "JVBERi0="}), 400)

    def test_a_long_document_is_not_a_shopping_list(self):
        self.assertEqual(self.refused({"pdf_base64": pdf(pages=server.SHOPPING_PDF_MAX_PAGES + 1)}), 413)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.used(), 0)

    def test_a_list_saved_many_times_is_counted_by_its_pages_not_its_saves(self):
        # An incremental save appends a fresh copy of the page objects; three
        # pages saved five times are still three pages.
        body = b"%PDF-1.7\n" + b"".join(
            b"%d 0 obj << /Type /Page /Parent 2 0 R >> endobj\n" % n
            for _ in range(5) for n in (3, 4, 5))
        body += b"%" + b"x" * 400 + b"\n%%EOF\n"
        out = self.scan({"pdf_base64": base64.b64encode(body).decode()})
        self.assertEqual(len(out["items"]), 3)

    def test_counting_pages_stays_quick_on_a_hostile_file(self):
        import time
        for hostile in ((b"1 0 obj " * 700000), (b"1 0 obj " + b"/Type /Page " * 400000), os.urandom(5 << 20)):
            started = time.monotonic()
            server.pdf_page_count_seen(hostile[:5 << 20], server.SHOPPING_PDF_MAX_PAGES + 1)
            self.assertLess(time.monotonic() - started, 0.5)

    def test_ten_pages_is_still_allowed(self):
        self.assertEqual(len(self.scan({"pdf_base64": pdf(pages=server.SHOPPING_PDF_MAX_PAGES)})["items"]), 3)

    def test_a_heavy_file_is_turned_away(self):
        heavy = pdf(pad=server.SHOPPING_PDF_MAX_BYTES + 10)
        self.assertEqual(self.refused({"pdf_base64": heavy}), 413)
        self.assertEqual(self.calls, [])

    def test_the_largest_allowed_file_goes_through(self):
        # Just under the limit, header and all: the size check is on the
        # file, not a guess that rounds a legitimate PDF away.
        near = pdf(pad=server.SHOPPING_PDF_MAX_BYTES - 1000)
        self.assertEqual(len(self.scan({"pdf_base64": near})["items"]), 3)

    # --- unread costs nothing -------------------------------------------

    def test_a_pdf_that_is_not_a_list_costs_nothing(self):
        async def refused(contents, system="", **kwargs):
            return '{"refused": true}'
        server._gemini_generate = refused
        self.assertEqual(self.refused({"pdf_base64": pdf()}), 422)
        self.assertEqual(self.used(), 0)

    def test_a_pdf_the_model_will_not_take_is_this_files_problem_not_an_outage(self):
        # Password-protected or damaged: Gemini answers 400 INVALID_ARGUMENT.
        # That is a 422 about the file, which the app says as "could not read
        # that PDF", never the 502 it says as "server trouble".
        async def invalid(contents, system="", **kwargs):
            raise RuntimeError("400 INVALID_ARGUMENT. {'error': {'code': 400}}")
        server._gemini_generate = invalid
        self.assertEqual(self.refused({"pdf_base64": pdf()}), 422)
        self.assertEqual(self.used(), 0)

    def test_failures_name_the_pdf_not_a_photo(self):
        async def refused(contents, system="", **kwargs):
            return '{"refused": true}'
        server._gemini_generate = refused
        with self.assertRaises(HTTPException) as caught:
            self.scan({"pdf_base64": pdf()})
        self.assertIn("PDF", caught.exception.detail)
        self.assertNotIn("photo", caught.exception.detail)

    def test_a_model_failure_costs_nothing(self):
        async def broken(contents, system="", **kwargs):
            raise RuntimeError("unavailable")
        server._gemini_generate = broken
        self.assertEqual(self.refused({"pdf_base64": pdf()}), 502)
        self.assertEqual(self.used(), 0)

    # --- the photo path -------------------------------------------------

    def test_a_photo_still_goes_the_photo_way(self):
        out = self.scan({"image_base64": "data:image/png;base64," + png()})
        self.assertEqual(len(out["items"]), 3)
        self.assertEqual(self.calls, [{"vision": True}])

    def test_a_picture_the_server_cannot_open_is_the_files_problem(self):
        # Imported from Files: a HEIC without the plugin, or a renamed
        # document. Said as a 400 about the file, free, never a 502.
        not_a_picture = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 400).decode()
        self.assertEqual(self.refused({"image_base64": not_a_picture}), 400)
        # Refused before the model and before any allowance: free.
        self.assertEqual(self.calls, [])
        self.assertEqual(self.used(), 0)

    def test_it_is_refused_even_when_the_month_is_used_up(self):
        # The file's problem is said first, not "no scans left".
        run(self.db["families"].update_one({"family_id": "fam_1"}, {"$set": {"ai_scans_used": 999}}))
        not_a_picture = base64.b64encode(b"%PDF-1.4 renamed" * 20).decode()
        self.assertEqual(self.refused({"image_base64": not_a_picture}), 400)

    def test_a_half_downloaded_picture_is_the_files_problem_too(self):
        # A JPG cut short (iCloud not finished): perfect header, missing
        # pixels. Caught before the model, not as a 502 after it.
        import io
        import PIL.Image
        buf = io.BytesIO()
        PIL.Image.new("RGB", (400, 400), "white").save(buf, "JPEG")
        cut = base64.b64encode(buf.getvalue()[:-600]).decode()
        self.assertEqual(self.refused({"image_base64": cut}), 400)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.used(), 0)

    def test_a_photo_saved_on_its_side_reaches_the_model_upright(self):
        # A portrait photo saved as a file keeps its orientation in EXIF,
        # which re-encoding drops; it is turned upright first.
        import io
        import PIL.Image
        seen = []

        async def generate(contents, system="", **kwargs):
            seen.append(contents[1].size)
            return ITEMS
        server._gemini_generate = generate
        server._gemini_vision = self._vision
        picture = PIL.Image.new("RGB", (80, 40), "white")
        exif = picture.getexif()
        exif[0x0112] = 6   # "rotate 90° to view"
        buf = io.BytesIO()
        picture.save(buf, "JPEG", exif=exif)
        self.scan({"image_base64": base64.b64encode(buf.getvalue()).decode()})
        self.assertEqual(seen, [(40, 80)])

    def test_a_real_picture_still_reaches_the_model(self):
        seen = []

        async def generate(contents, system="", **kwargs):
            seen.append(contents)
            return ITEMS
        server._gemini_generate = generate
        server._gemini_vision = self._vision
        out = self.scan({"image_base64": png()})
        self.assertEqual(len(out["items"]), 3)
        self.assertEqual(len(seen), 1)

    def test_no_photo_and_no_pdf_is_still_a_400(self):
        self.assertEqual(self.refused({}), 400)


if __name__ == "__main__":
    unittest.main()
