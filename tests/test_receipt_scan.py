"""Reading a till receipt into lines, so prices can eventually be compared.

The Spending tab could only ever say "you spent ninety at one shop and eighty
at another", which compares basket SIZES, not prices. The lines are what let it
one day say the thing a family can act on: these onions cost less per kilo
there than here.

Two rules are held here, and both are about not being confidently wrong.

A price is only comparable once it is per kilo or per litre. 1.20 against 0.89
says nothing while one is a 500g bag and the other a kilo — so the amount and
its unit travel with the price, and a line with no usable amount gets NO unit
price rather than a made-up one.

And the arithmetic is reported, never repaired. A receipt whose lines do not
add up to its printed total was read wrong somewhere, and a wrong price does
not announce itself the way a wrong product name does.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    from ai_safety import UnsafeRecipe, validate_receipt_scan


def receipt(items, total=None, shop="Aldi", date="2026-08-20"):
    body = {"shop": shop, "date": date, "items": items}
    body["total"] = sum(i["line_total"] for i in items) if total is None else total
    return body


def line(name="Oignons", qty=1.0, unit="kg", line_total=0.89, unsure=False):
    return {"name": name, "qty": qty, "unit": unit,
            "line_total": line_total, "unsure": unsure}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheUnitPriceIsTheWholePoint(unittest.TestCase):
    def test_a_weighed_line_gets_a_price_per_kilo(self):
        out = validate_receipt_scan(receipt([line(qty=2.0, unit="kg", line_total=1.78)]))
        item = out["items"][0]
        self.assertEqual(item["unit"], "kg")
        self.assertEqual(item["qty"], 2.0)
        self.assertAlmostEqual(item["unit_price"], 0.89, places=4)

    def test_a_line_with_no_amount_gets_no_price_at_all(self):
        """The dangerous case. Inventing a per-unit price for a line whose
        quantity could not be read is how the feature would compare a 500g bag
        against a kilo and call the wrong shop cheaper."""
        out = validate_receipt_scan(receipt([line(qty=0, line_total=1.20)]))
        item = out["items"][0]
        self.assertIsNone(item["unit_price"])
        self.assertIsNone(item["qty"])
        # It is still spending, and it is still shown — just never compared.
        self.assertEqual(item["line_total"], 1.20)
        self.assertTrue(item["unsure"])

    def test_an_unknown_unit_falls_back_to_pieces(self):
        out = validate_receipt_scan(receipt([line(unit="punnet", qty=2, line_total=3.00)]))
        self.assertEqual(out["items"][0]["unit"], "piece")

    def test_every_allowed_unit_survives(self):
        for unit in ("kg", "g", "l", "ml", "piece"):
            with self.subTest(unit=unit):
                out = validate_receipt_scan(receipt([line(unit=unit)]))
                self.assertEqual(out["items"][0]["unit"], unit)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheArithmeticIsReportedNotRepaired(unittest.TestCase):
    def test_lines_that_add_up_reconcile(self):
        out = validate_receipt_scan(receipt([
            line(line_total=0.89), line(name="Tomates", line_total=2.10)]))
        self.assertTrue(out["reconciles"])
        self.assertEqual(out["lines_total"], 2.99)
        self.assertEqual(out["total"], 2.99)

    def test_lines_that_do_not_add_up_say_so_instead_of_being_fixed(self):
        """A misread price is silent. Saying the total disagrees is the only
        chance anybody has to catch it before it poisons a price history."""
        out = validate_receipt_scan(receipt(
            [line(line_total=0.89), line(name="Tomates", line_total=2.10)],
            total=48.75))
        self.assertFalse(out["reconciles"])
        self.assertEqual(out["lines_total"], 2.99)
        self.assertEqual(out["total"], 48.75)   # both survive; neither is edited

    def test_rounding_across_many_lines_still_reconciles(self):
        items = [line(name=f"Item {i}", qty=1, line_total=1.005) for i in range(10)]
        out = validate_receipt_scan(receipt(items, total=10.00))
        self.assertTrue(out["reconciles"])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatMustNeverBeAccepted(unittest.TestCase):
    def test_a_refusal_is_a_refusal(self):
        with self.assertRaises(UnsafeRecipe):
            validate_receipt_scan({"refused": True})

    def test_a_negative_line_is_refused(self):
        """A refund is not a price. Letting one through would drag a product's
        average below anything a shop ever charged."""
        with self.assertRaises(UnsafeRecipe):
            validate_receipt_scan(receipt([line(line_total=-3.00)]))

    def test_a_misplaced_decimal_point_is_refused(self):
        with self.assertRaises(UnsafeRecipe):
            validate_receipt_scan(receipt([line(line_total=99999.0)]))

    def test_a_price_that_is_not_a_number_is_refused(self):
        with self.assertRaises(UnsafeRecipe):
            validate_receipt_scan(receipt([line(line_total="deux euros")], total=2.00))

    def test_an_empty_receipt_is_refused(self):
        with self.assertRaises(UnsafeRecipe):
            validate_receipt_scan(receipt([]))

    def test_an_unreadably_long_receipt_is_refused(self):
        items = [line(name=f"Item {i}") for i in range(200)]
        with self.assertRaises(UnsafeRecipe):
            validate_receipt_scan(receipt(items))

    def test_a_nameless_line_is_refused(self):
        with self.assertRaises(UnsafeRecipe):
            validate_receipt_scan(receipt([line(name="   ")]))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheHeaderFields(unittest.TestCase):
    def test_a_readable_shop_and_date_come_through(self):
        out = validate_receipt_scan(receipt([line()], shop="Carrefour Market",
                                            date="2026-08-20"))
        self.assertEqual(out["shop"], "Carrefour Market")
        self.assertEqual(out["date"], "2026-08-20")

    def test_an_unreadable_date_comes_back_empty_rather_than_invented(self):
        """The app then asks. A guessed date lands the shop in the wrong month
        and quietly moves a monthly total."""
        for bad in ("20/08/2026", "last Tuesday", "", "2026-13-45x"):
            with self.subTest(date=bad):
                out = validate_receipt_scan(receipt([line()], date=bad))
                self.assertEqual(out["date"], "")

    def test_the_products_keep_the_words_on_the_receipt(self):
        out = validate_receipt_scan(receipt([
            line(name="Lait demi-ecreme"), line(name="Tomates grappe")]))
        self.assertEqual([i["name"] for i in out["items"]],
                         ["Lait demi-ecreme", "Tomates grappe"])

    def test_unsure_lines_stay_marked_unsure(self):
        out = validate_receipt_scan(receipt([line(unsure=True)]))
        self.assertTrue(out["items"][0]["unsure"])


if __name__ == "__main__":
    unittest.main()
