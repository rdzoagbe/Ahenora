"""A photographed shopping list goes on the shopping list.

Reported from a real phone: a handwritten list (toilet liquid, big tissue, WC
lingette, bathing soap, air freshener) photographed from the camera on Home
became ONE task called "Toiletries shopping list", and every item on it was
thrown away. The camera's reader had two words for a photograph — document
and recipe — and no word for a shopping list. The kitchen has its own list
reader; it was simply unreachable from the camera everyone uses.

These pin:
  * the reader may call a photograph "shopping";
  * a shopping list is read item by item, inside the SAME request, so the
    photograph is charged once;
  * if the items cannot be read it stays a document — never an empty list;
  * everything else is unchanged: a letter is still a document.
"""
import asyncio
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
    import server
    from ai_safety import DOCUMENT_SCAN_SYSTEM_PROMPT, validate_document_scan
    from fake_mongo import FakeDatabase

USER = {"user_id": "u_1", "family_id": "fam_1", "email": "a@example.com", "name": "Ana"}

LIST_AS_DOCUMENT = ('{"kind":"shopping","type":"TASK","title":"Toiletries shopping list",'
                    '"description":"Purchase the listed toiletries.","assignee":"",'
                    '"due_date":null,"vault_category":"","save_to_vault":false,'
                    '"expires_on":null,"amount":null}')
ITEMS = ('{"items":[{"name":"Toilet liquid for scrubbing"},{"name":"Big tissue"},'
         '{"name":"WC lingette"},{"name":"Yves Rocher bathing soap"},'
         '{"name":"Air freshener","unsure":true}]}')


def run(coro):
    return asyncio.run(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheReaderHasAWordForIt(unittest.TestCase):
    def test_the_prompt_offers_shopping(self):
        self.assertIn('"shopping"', DOCUMENT_SCAN_SYSTEM_PROMPT)

    def test_shopping_survives_validation(self):
        out = validate_document_scan({"kind": "shopping", "title": "Groceries", "type": "TASK"}, [])
        self.assertEqual(out["kind"], "shopping")

    def test_an_unknown_kind_is_still_a_document(self):
        out = validate_document_scan({"kind": "poem", "title": "Ode", "type": "TASK"}, [])
        self.assertEqual(out["kind"], "document")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheCameraOnHome(unittest.TestCase):
    def setUp(self):
        self._get_db = server.get_db
        self._vision = server._gemini_vision
        self._admin = server.is_admin_user
        self._key = server.GOOGLE_API_KEY
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        server.is_admin_user = lambda u: False
        server.GOOGLE_API_KEY = "test-key"
        run(self.db["families"].insert_one({
            "family_id": "fam_1", "plan": "village", "billing_cycle": "monthly",
            "ai_scans_used": 0, "created_at": server.utcnow()}))
        self.calls = []

    def tearDown(self):
        server.get_db = self._get_db
        server._gemini_vision = self._vision
        server.is_admin_user = self._admin
        server.GOOGLE_API_KEY = self._key

    def model(self, first, second=None):
        async def fake(prompt, image, system="", fast=False):
            self.calls.append(prompt)
            if len(self.calls) == 1:
                return first
            if isinstance(second, Exception):
                raise second
            return second
        server._gemini_vision = fake

    def scan(self):
        return run(server.vision_extract(
            server.VisionIn(image_base64="data:image/jpeg;base64,abc"), user=USER))

    def used(self):
        return run(self.db["families"].find_one({"family_id": "fam_1"}))["ai_scans_used"]

    def test_the_items_come_back_one_by_one(self):
        self.model(LIST_AS_DOCUMENT, ITEMS)
        out = self.scan()
        self.assertEqual(out["kind"], "shopping")
        names = [i["name"] for i in out["shopping_items"]]
        self.assertEqual(len(names), 5)
        self.assertIn("WC lingette", names)

    def test_an_unsure_read_is_marked_so_the_app_leaves_it_unticked(self):
        self.model(LIST_AS_DOCUMENT, ITEMS)
        items = self.scan()["shopping_items"]
        self.assertTrue(items[-1]["unsure"])
        self.assertFalse(items[0]["unsure"])

    def test_one_photograph_is_one_scan(self):
        self.model(LIST_AS_DOCUMENT, ITEMS)
        self.scan()
        self.assertEqual(len(self.calls), 2, "read as a document, then the items")
        self.assertEqual(self.used(), 1)

    def test_items_it_cannot_read_leave_a_document_not_an_empty_list(self):
        self.model(LIST_AS_DOCUMENT, RuntimeError("model unavailable"))
        out = self.scan()
        self.assertEqual(out["kind"], "document")
        self.assertNotIn("shopping_items", out)
        self.assertTrue(out["understood"])

    def test_a_letter_is_still_a_letter(self):
        self.model('{"kind":"document","type":"TASK","title":"School letter",'
                   '"description":"Sign and return.","assignee":"","due_date":null,'
                   '"vault_category":"School","save_to_vault":true,"expires_on":null,'
                   '"amount":null}')
        out = self.scan()
        self.assertEqual(out["kind"], "document")
        self.assertEqual(len(self.calls), 1)


RECEIPT_AS_DOCUMENT = ('{"kind":"receipt","type":"TASK","title":"Carrefour receipt",'
                       '"description":"Groceries.","assignee":"","due_date":null,'
                       '"vault_category":"","save_to_vault":false,"expires_on":null,"amount":null}')
RECEIPT = ('{"shop":"Carrefour","date":"2026-09-28","total":12.5,'
           '"items":[{"name":"Milk","qty":1,"unit":"l","line_total":1.2},'
           '{"name":"Bread","qty":null,"unit":"piece","line_total":2.3}]}')


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AReceiptGoesToTheExpenses(TheCameraOnHome):
    """The camera on Home routes a till receipt the way the Spending screen
    reads one: shop, date, total and lines — still one photograph, one scan."""

    def test_the_prompt_offers_receipt(self):
        self.assertIn('"receipt"', DOCUMENT_SCAN_SYSTEM_PROMPT)

    def test_a_receipt_comes_back_read(self):
        self.model(RECEIPT_AS_DOCUMENT, RECEIPT)
        out = self.scan()
        self.assertEqual(out["kind"], "receipt")
        self.assertEqual(out["receipt"]["shop"], "Carrefour")
        self.assertEqual(out["receipt"]["total"], 12.5)
        self.assertEqual(len(out["receipt"]["items"]), 2)
        self.assertEqual(self.used(), 1)

    def test_an_unreadable_receipt_stays_a_document(self):
        self.model(RECEIPT_AS_DOCUMENT, "not json at all")
        out = self.scan()
        self.assertEqual(out["kind"], "document")
        self.assertNotIn("receipt", out)


if __name__ == "__main__":
    unittest.main()
