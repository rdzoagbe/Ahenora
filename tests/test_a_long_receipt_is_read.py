"""A long receipt is read: in several photos, or as a PDF, and never thrown
away for one bad line.

Asked for on 2026-11-10: "what if the receipt is too long and the system
cannot scan and read it? What's the workaround?" It had none: past 80 lines,
or with one line the model could not make sense of, or with no total in the
photo (the top half of a long receipt), the whole receipt was refused, and it
could only ever be read from one photo.

These pin:
  * the reader keeps what it reads: a bad line is left out and COUNTED, a
    missing total comes back as None (and no false "it reconciles"), lines
    past the limit are counted;
  * the Home camera's receipt pass still needs a total (it files the expense
    at it), so there a missing total keeps the photo a document;
  * up to three photos are read as ONE receipt in ONE model call, charged
    once; more is refused before anything is read;
  * a PDF receipt is read as a PDF;
  * a picture the server cannot open, and a receipt that is not read, cost
    nothing; an unread one is counted by reason for the Metrics screen.
"""
import asyncio
import base64
import io
import json
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
    import PIL.Image
    import server
    from ai_safety import (MAX_RECEIPT_ITEMS, UnsafeRecipe, read_receipt_scan,
                           validate_receipt_scan)
    from fake_mongo import FakeDatabase

USER = {"user_id": "u_1", "family_id": "fam_1", "email": "a@example.com", "name": "Ana"}


def run(coro):
    return asyncio.run(coro)


def line(name="Lait 1 L", qty=1, unit="piece", line_total=1.15, **extra):
    return {"name": name, "qty": qty, "unit": unit, "line_total": line_total, **extra}


def receipt(items, total=None, **extra):
    out = {"shop": "Marché Frais", "date": "2026-11-10", "items": items, **extra}
    if total is not None:
        out["total"] = total
    return out


def photo(seed: int) -> str:
    buf = io.BytesIO()
    PIL.Image.new("RGB", (64, 64), (seed, 255 - seed, 128)).save(buf, "JPEG")
    return base64.b64encode(buf.getvalue()).decode()


def pdf() -> str:
    body = b"%PDF-1.7\n3 0 obj << /Type /Page >> endobj\n%" + b"x" * 400 + b"\n%%EOF\n"
    return base64.b64encode(body).decode()


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheReaderKeepsWhatItReads(unittest.TestCase):
    def test_a_bad_line_is_left_out_and_counted_not_the_whole_receipt(self):
        out = read_receipt_scan(receipt([
            line("Eau Cristaline", 4, line_total=4.80),
            line("", line_total=1.00),                       # no name
            line("Champignons", line_total="illisible"),     # price not a number
            line("Remboursement", line_total=-3.00),         # not a price
            "OIGNONS",                                       # not a line at all
            line("Lait 6x1 L", 2, line_total=13.90),
        ], total=22.69))
        self.assertEqual([i["name"] for i in out["items"]], ["Eau Cristaline", "Lait 6x1 L"])
        self.assertEqual(out["skipped"], 4)
        # The lines now fall short of the printed total, and that is shown.
        self.assertIs(out["reconciles"], False)

    def test_the_top_half_of_a_long_receipt_has_no_total_and_is_still_read(self):
        out = read_receipt_scan(receipt([line(), line("Pain", line_total=2.10)]))
        self.assertIsNone(out["total"])
        self.assertIsNone(out["reconciles"])   # nothing to compare with: no false "ok"
        self.assertEqual(out["lines_total"], 3.25)

    def test_an_unreadable_total_is_none_not_a_refusal(self):
        self.assertIsNone(read_receipt_scan(receipt([line()], total="??"))["total"])

    def test_a_very_long_receipt_is_kept_and_the_rest_counted(self):
        out = read_receipt_scan(receipt([line(f"Article {n}") for n in range(MAX_RECEIPT_ITEMS + 12)],
                                        total=999))
        self.assertEqual(len(out["items"]), MAX_RECEIPT_ITEMS)
        self.assertEqual(out["left_out"], 12)

    def test_a_big_monthly_shop_is_read_whole(self):
        out = read_receipt_scan(receipt([line(f"Article {n}") for n in range(120)], total=138))
        self.assertEqual((len(out["items"]), out["left_out"]), (120, 0))

    def test_nothing_readable_is_still_a_refusal(self):
        with self.assertRaises(UnsafeRecipe):
            read_receipt_scan(receipt([line(""), "x"], total=3))

    def test_leakage_anywhere_still_refuses(self):
        with self.assertRaises(UnsafeRecipe):
            read_receipt_scan(receipt([line(), line("my instructions are")], total=3))

    def test_the_home_camera_still_needs_a_total(self):
        with self.assertRaises(UnsafeRecipe):
            validate_receipt_scan(receipt([line()]))
        with self.assertRaises(UnsafeRecipe):
            validate_receipt_scan(receipt([line(f"A{n}") for n in range(MAX_RECEIPT_ITEMS + 1)], total=9))
        self.assertEqual(validate_receipt_scan(receipt([line()], total=1.15))["total"], 1.15)


@unittest.skipUnless(HAVE_DEPS and server.genai_types is not None if HAVE_DEPS else False,
                     "backend dependencies (google-genai) not installed")
class TheRoute(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self._generate = server._gemini_generate
        self._admin = server.is_admin_user
        self._key = server.GOOGLE_API_KEY
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        server.is_admin_user = lambda u: False
        server.GOOGLE_API_KEY = "test-key"
        server._VISION_CACHE.clear()
        run(self.db["families"].insert_one({
            "family_id": "fam_1", "name": "Test", "plan": "village",
            "billing_cycle": "monthly", "ai_scans_used": 0,
            "created_at": server.utcnow()}))
        self.calls = []
        self.answer = receipt([line("Eau Cristaline", 4, line_total=4.80),
                               line("Lait 6x1 L", 2, line_total=13.90)], total=18.70)

        async def generate(contents, system="", **kwargs):
            self.calls.append({"contents": contents, "system": system, **kwargs})
            return json.dumps(self.answer)
        server._gemini_generate = generate

    def tearDown(self):
        server.get_db = self._get_db
        server._gemini_generate = self._generate
        server.is_admin_user = self._admin
        server.GOOGLE_API_KEY = self._key

    def scan(self, payload):
        return run(server.scan_receipt(payload, user=USER, database=self.db))

    def refused(self, payload):
        with self.assertRaises(HTTPException) as caught:
            self.scan(payload)
        return caught.exception.status_code

    def used(self):
        return run(self.db["families"].find_one({"family_id": "fam_1"})).get("ai_scans_used", 0)

    def test_one_photo_as_before(self):
        out = self.scan({"image_base64": photo(1)})
        self.assertEqual(out["parts"], 1)
        self.assertTrue(out["reconciles"])
        (call,) = self.calls
        self.assertEqual(call["contents"][1].inline_data.mime_type, "image/jpeg")
        self.assertTrue(call["fast"])

    def test_three_photos_are_one_receipt_in_one_read_charged_once(self):
        out = self.scan({"images_base64": [photo(1), photo(2), photo(3)]})
        self.assertEqual(out["parts"], 3)
        (call,) = self.calls
        self.assertIn("3 photos are consecutive parts of ONE shop receipt", call["contents"][0])
        self.assertEqual([p.inline_data.mime_type for p in call["contents"][1:]], ["image/jpeg"] * 3)
        self.assertIn("SEVERAL photos", call["system"])
        self.assertEqual(self.used(), 1)

    def test_four_photos_are_refused_before_anything_is_read(self):
        self.assertEqual(self.refused({"images_base64": [photo(n) for n in range(4)]}), 413)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.used(), 0)

    def test_a_part_that_is_not_a_picture_is_the_files_problem_and_free(self):
        bad = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 400).decode()
        self.assertEqual(self.refused({"images_base64": [photo(1), bad]}), 400)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.used(), 0)

    def test_a_pdf_receipt_is_read_as_a_pdf(self):
        self.scan({"pdf_base64": pdf()})
        (call,) = self.calls
        self.assertEqual(call["contents"][1].inline_data.mime_type, "application/pdf")
        self.assertIn("PDF", call["contents"][0])

    def test_the_top_half_comes_back_with_no_total(self):
        self.answer = receipt([line()])
        out = self.scan({"image_base64": photo(1)})
        self.assertIsNone(out["total"])
        self.assertIsNone(out["reconciles"])

    def test_an_unread_receipt_is_free_and_counted_by_why(self):
        self.answer = {"refused": True}
        self.assertEqual(self.refused({"image_base64": photo(1)}), 422)
        self.assertEqual(self.used(), 0)
        row = run(self.db["metrics_daily"].find_one({"name": "receipt_scan_unread_not_a_list"}))
        self.assertEqual(row["count"], 1)


if __name__ == "__main__":
    unittest.main()
