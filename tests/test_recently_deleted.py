"""Recently deleted: what a delete takes away comes back for 30 days.

Asked for on 2026-11-10: "if I mistakenly deleted my list I can restore
recently deleted without putting back all the list, and it should be the same
for any place where we have data stored, documents etc."

Decided with Roland the same day: a Coffre document in the bin does not count
toward the storage, restoring counts it again and is refused when it no longer
fits; health details never go to the bin.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import re
import sys
import unittest
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fastapi import HTTPException
    from fake_mongo import FakeDatabase

ROOT = os.path.join(os.path.dirname(__file__), "..")
ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
KEIGH = {"user_id": "u_k", "family_id": "fam1", "name": "Keigh", "email": "k@x.com"}
NANA = {"user_id": "u_n", "family_id": "fam1", "name": "Nana", "email": "n@x.com", "is_helper": True}
OUTSIDER = {"user_id": "u_o", "family_id": "fam2", "name": "Other", "email": "o@x.com"}


def run(coro):
    return asyncio.run(coro)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class RecentlyDeleted(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        run(self.db["families"].insert_one({
            "family_id": "fam1", "plan": "executive", "billing_cycle": "monthly",
            "grandfathered": False, "updated_at": server.utcnow(),
            "ai_scans_used": 0, "ai_scans_period_start": server.utcnow(),
            "vault_bytes_used": 0,
        }))

    def tearDown(self):
        server.get_db = self._get_db

    # -- helpers -----------------------------------------------------------
    def _item(self, name, checked=False, family="fam1"):
        doc = {"item_id": server.new_id("item"), "family_id": family, "name": name,
               "category": "Other", "checked": checked, "created_at": server.utcnow()}
        run(self.db["shopping_list"].insert_one(dict(doc)))
        return doc

    def _names(self):
        return sorted(d["name"] for d in self.db["shopping_list"].rows if d["family_id"] == "fam1")

    def _bin(self, user):
        return run(server.list_trash(user=dict(user)))

    def _upload(self, user, title, visibility=None):
        payload = server.VaultIn(title=title, category="Medical",
                                 image_base64="data:image/jpeg;base64,AAAA", visibility=visibility)
        return run(server.create_vault_doc(payload, user=dict(user)))

    def _vault_used(self):
        return next(f for f in self.db["families"].rows if f["family_id"] == "fam1")["vault_bytes_used"]

    # -- one thing ---------------------------------------------------------
    def test_a_deleted_item_is_in_the_bin_and_comes_back_whole(self):
        milk = self._item("Lait")
        out = run(server.delete_shopping_item(milk["item_id"], user=dict(ROLAND)))
        self.assertTrue(out["trash_id"])
        self.assertEqual(self._names(), [])
        (entry,) = self._bin(KEIGH)
        self.assertEqual((entry["kind"], entry["label"], entry["deleted_by_name"]),
                         ("shopping_item", "Lait", "Roland"))
        self.assertIsNone(entry["batch_id"])
        run(server.restore_trash(entry["trash_id"], user=dict(KEIGH)))
        back = [d for d in self.db["shopping_list"].rows if d["family_id"] == "fam1"]
        self.assertEqual(len(back), 1)
        self.assertEqual(back[0]["item_id"], milk["item_id"])
        self.assertEqual(self._bin(ROLAND), [])

    def test_it_stays_30_days_and_the_database_erases_it_after(self):
        milk = self._item("Lait")
        run(server.delete_shopping_item(milk["item_id"], user=dict(ROLAND)))
        (row,) = self.db["trash"].rows
        self.assertEqual(server.TRASH_DAYS, 30)
        self.assertEqual(row["expires_at"] - row["deleted_at"], timedelta(days=30))
        # A row past its date is never listed, even before the TTL monitor runs.
        row["expires_at"] = server.utcnow() - timedelta(seconds=1)
        self.assertEqual(self._bin(ROLAND), [])

    def test_the_ttl_index_is_declared(self):
        src = open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8").read()
        self.assertIn('await db["trash"].create_index("expires_at", expireAfterSeconds=0)', src)

    def test_restoring_twice_never_makes_two(self):
        milk = self._item("Lait")
        out = run(server.delete_shopping_item(milk["item_id"], user=dict(ROLAND)))
        entry = next(d for d in self.db["trash"].rows if d["trash_id"] == out["trash_id"])
        run(server._restore_entry(self.db, dict(entry), dict(ROLAND)))
        # Second phone, same moment: the row is already back.
        run(self.db["trash"].insert_one(dict(entry)))
        run(server._restore_entry(self.db, dict(entry), dict(KEIGH)))
        self.assertEqual(self._names(), ["Lait"])
        self.assertEqual(self.db["trash"].rows, [])

    # -- a cleared list ----------------------------------------------------
    def test_a_cleared_list_is_one_batch_and_any_line_comes_back_alone(self):
        for n in ("Lait", "Pain", "Oeufs"):
            self._item(n, checked=True)
        self._item("Riz")
        out = run(server.clear_checked_shopping(user=dict(ROLAND)))
        self.assertEqual(self._names(), ["Riz"])
        rows = self._bin(ROLAND)
        self.assertEqual(len(rows), 3)
        self.assertEqual({r["batch_id"] for r in rows}, {out["batch_id"]})
        pain = next(r for r in rows if r["label"] == "Pain")
        run(server.restore_trash(pain["trash_id"], user=dict(ROLAND)))
        self.assertEqual(self._names(), ["Pain", "Riz"])
        self.assertEqual(len(self._bin(ROLAND)), 2)

    def test_annuler_brings_the_whole_list_back(self):
        for n in ("Lait", "Pain"):
            self._item(n)
        out = run(server.clear_all_shopping(user=dict(ROLAND)))
        self.assertEqual(self._names(), [])
        res = run(server.restore_trash_batch(server.TrashBatchIn(batch_id=out["batch_id"]), user=dict(KEIGH)))
        self.assertEqual(res["restored"], 2)
        self.assertEqual(self._names(), ["Lait", "Pain"])

    def test_clearing_an_empty_list_offers_nothing_to_undo(self):
        out = run(server.clear_all_shopping(user=dict(ROLAND)))
        self.assertIsNone(out["batch_id"])

    def test_a_cleared_meal_plan_is_one_batch(self):
        for title in ("Pasta", "Soup"):
            run(self.db["meals"].insert_one({"meal_id": server.new_id("meal"), "family_id": "fam1",
                                             "title": title, "created_at": server.utcnow()}))
        out = run(server.clear_all_meals(user=dict(ROLAND), database=self.db))
        self.assertEqual(self.db["meals"].rows, [])
        run(server.restore_trash_batch(server.TrashBatchIn(batch_id=out["batch_id"]), user=dict(ROLAND)))
        self.assertEqual(sorted(m["title"] for m in self.db["meals"].rows), ["Pasta", "Soup"])

    # -- who sees what -----------------------------------------------------
    def test_another_household_never_sees_or_restores_it(self):
        milk = self._item("Lait")
        out = run(server.delete_shopping_item(milk["item_id"], user=dict(ROLAND)))
        self.assertEqual(self._bin(OUTSIDER), [])
        for call in (server.restore_trash, server.purge_trash):
            with self.assertRaises(HTTPException) as ctx:
                run(call(out["trash_id"], user=dict(OUTSIDER)))
            self.assertEqual(ctx.exception.status_code, 404)
        res = run(server.restore_trash_batch(server.TrashBatchIn(batch_id="tbatch_x"), user=dict(OUTSIDER)))
        self.assertEqual(res["restored"], 0)
        self.assertEqual(run(server.empty_trash(user=dict(OUTSIDER)))["deleted"], 0)
        self.assertEqual(len(self.db["trash"].rows), 1)

    def test_a_private_coffre_document_is_its_owners_alone(self):
        doc = self._upload(ROLAND, "Passport")
        out = run(server.delete_vault_doc(doc["doc_id"], user=dict(ROLAND)))
        self.assertEqual([r["label"] for r in self._bin(ROLAND)], ["Passport"])
        self.assertEqual(self._bin(KEIGH), [])
        with self.assertRaises(HTTPException) as ctx:
            run(server.restore_trash(out["trash_id"], user=dict(KEIGH)))
        self.assertEqual(ctx.exception.status_code, 404)
        # "Empty" by the co-parent leaves it alone.
        run(server.empty_trash(user=dict(KEIGH)))
        self.assertEqual(len(self.db["trash"].rows), 1)

    def test_a_private_card_is_its_authors_alone(self):
        card = {"card_id": "card_p", "family_id": "fam1", "title": "Surprise", "shared": False,
                "created_by_user_id": "u_r", "created_at": server.utcnow()}
        run(self.db["cards"].insert_one(dict(card)))
        run(server.delete_card("card_p", user=dict(ROLAND)))
        self.assertEqual([r["label"] for r in self._bin(ROLAND)], ["Surprise"])
        self.assertEqual(self._bin(KEIGH), [])

    def test_a_helper_sees_no_documents_or_money_in_the_bin(self):
        doc = self._upload(ROLAND, "House insurance", visibility="shared")
        run(server.delete_vault_doc(doc["doc_id"], user=dict(ROLAND)))
        run(self.db["expenses"].insert_one({"expense_id": "exp1", "family_id": "fam1",
                                            "description": "Shoes", "amount": 40.0,
                                            "created_at": server.utcnow()}))
        run(server.delete_expense("exp1", user=dict(ROLAND)))
        milk = self._item("Lait")
        run(server.delete_shopping_item(milk["item_id"], user=dict(ROLAND)))
        self.assertEqual([r["kind"] for r in self._bin(NANA)], ["shopping_item"])
        for entry in list(self.db["trash"].rows):
            if entry["kind"] == "shopping_item":
                continue
            with self.assertRaises(HTTPException):
                run(server.restore_trash(entry["trash_id"], user=dict(NANA)))
        run(server.empty_trash(user=dict(NANA)))
        self.assertEqual(sorted(e["kind"] for e in self.db["trash"].rows), ["expense", "vault_doc"])

    # -- storage -----------------------------------------------------------
    def test_a_document_in_the_bin_frees_its_storage_and_restoring_counts_it_again(self):
        doc = self._upload(ROLAND, "Passport")
        used = self._vault_used()
        self.assertGreater(used, 0)
        out = run(server.delete_vault_doc(doc["doc_id"], user=dict(ROLAND)))
        self.assertEqual(self._vault_used(), 0)
        run(server.restore_trash(out["trash_id"], user=dict(ROLAND)))
        self.assertEqual(self._vault_used(), used)
        self.assertEqual([d["title"] for d in self.db["vault"].rows], ["Passport"])

    def test_a_document_that_no_longer_fits_is_refused_and_stays_in_the_bin(self):
        doc = self._upload(ROLAND, "Passport")
        out = run(server.delete_vault_doc(doc["doc_id"], user=dict(ROLAND)))
        fam = next(f for f in self.db["families"].rows if f["family_id"] == "fam1")
        limit = run(server.build_subscription("fam1"))["limits"]["vault_bytes"]
        fam["vault_bytes_used"] = limit
        with self.assertRaises(HTTPException) as ctx:
            run(server.restore_trash(out["trash_id"], user=dict(ROLAND)))
        self.assertEqual(ctx.exception.status_code, 402)
        self.assertEqual(fam["vault_bytes_used"], limit)
        self.assertEqual(self.db["vault"].rows, [])
        self.assertEqual(len(self._bin(ROLAND)), 1)

    def test_restoring_a_document_already_back_does_not_count_it_twice(self):
        doc = self._upload(ROLAND, "Passport")
        used = self._vault_used()
        out = run(server.delete_vault_doc(doc["doc_id"], user=dict(ROLAND)))
        entry = dict(next(d for d in self.db["trash"].rows if d["trash_id"] == out["trash_id"]))
        run(server.restore_trash(out["trash_id"], user=dict(ROLAND)))
        run(self.db["trash"].insert_one(dict(entry)))
        run(server.restore_trash(out["trash_id"], user=dict(ROLAND)))
        self.assertEqual(self._vault_used(), used)
        self.assertEqual(len(self.db["vault"].rows), 1)

    # -- an expense --------------------------------------------------------
    def test_an_expense_comes_back_with_its_receipt_lines(self):
        run(self.db["expenses"].insert_one({"expense_id": "exp1", "family_id": "fam1",
                                            "description": "Carrefour", "amount": 12.5,
                                            "created_at": server.utcnow()}))
        for name in ("Lait", "Pain"):
            run(self.db["expense_items"].insert_one({"expense_id": "exp1", "family_id": "fam1",
                                                     "name": name, "price": 1.0}))
        out = run(server.delete_expense("exp1", user=dict(ROLAND)))
        self.assertEqual((self.db["expenses"].rows, self.db["expense_items"].rows), ([], []))
        run(server.restore_trash(out["trash_id"], user=dict(KEIGH)))
        self.assertEqual([e["expense_id"] for e in self.db["expenses"].rows], ["exp1"])
        self.assertEqual(sorted(i["name"] for i in self.db["expense_items"].rows), ["Lait", "Pain"])

    def test_an_expense_is_named_by_its_shop_and_amount(self):
        self.assertEqual(server._trash_label_expense({"merchant": "Lidl", "amount": 12.5}), "Lidl · 12.50")
        self.assertEqual(server._trash_label_expense({"description": "Shoes", "amount": None}), "Shoes")
        self.assertEqual(server._trash_label_expense({"amount": 3}), "3.00")

    # -- erasing -----------------------------------------------------------
    def test_erase_now_and_empty_the_bin(self):
        a, b = self._item("Lait"), self._item("Pain")
        ta = run(server.delete_shopping_item(a["item_id"], user=dict(ROLAND)))["trash_id"]
        run(server.delete_shopping_item(b["item_id"], user=dict(ROLAND)))
        run(server.purge_trash(ta, user=dict(KEIGH)))
        self.assertEqual([r["label"] for r in self._bin(ROLAND)], ["Pain"])
        self.assertEqual(run(server.empty_trash(user=dict(ROLAND)))["deleted"], 1)
        self.assertEqual(self._bin(ROLAND), [])
        self.assertEqual(self._names(), [])

    def test_the_list_never_carries_the_deleted_contents(self):
        doc = self._upload(ROLAND, "Passport")
        run(server.delete_vault_doc(doc["doc_id"], user=dict(ROLAND)))
        (entry,) = self._bin(ROLAND)
        self.assertEqual(set(entry), {"trash_id", "kind", "label", "deleted_by_name",
                                      "deleted_at", "expires_at", "batch_id"})

    # -- leaving and the copy of one's data -------------------------------
    def test_a_departing_parent_takes_their_private_bin_with_them(self):
        doc = self._upload(ROLAND, "Passport")
        run(server.delete_vault_doc(doc["doc_id"], user=dict(ROLAND)))
        milk = self._item("Lait")
        run(server.delete_shopping_item(milk["item_id"], user=dict(ROLAND)))
        run(server._purge_departing_parent(self.db, "fam1", "u_r"))
        self.assertEqual([e["kind"] for e in self.db["trash"].rows], ["shopping_item"])

    def test_the_bin_is_family_scoped_so_a_deleted_household_takes_it(self):
        self.assertIn("trash", server._FAMILY_SCOPED_COLLECTIONS)

    def test_the_copy_of_my_data_lists_what_is_in_my_bin(self):
        doc = self._upload(ROLAND, "Passport")
        run(server.delete_vault_doc(doc["doc_id"], user=dict(ROLAND)))
        mine = run(server.export_my_data(user=dict(ROLAND), database=self.db))
        theirs = run(server.export_my_data(user=dict(KEIGH), database=self.db))
        self.assertEqual([r["label"] for r in mine["recently_deleted"]], ["Passport"])
        self.assertEqual(theirs["recently_deleted"], [])


class HealthNeverGoesToTheBin(unittest.TestCase):
    """Deleting a medicine or a vaccination withdraws consent, which the
    privacy policy promises is immediate: it is never filed in the bin."""

    def test_no_health_kind(self):
        src = open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8").read()
        kinds = re.search(r"TRASH_KINDS = \{(.*?)\n\}", src, re.S).group(1)
        for word in ("medic", "vaccin", "health", "allerg"):
            self.assertNotIn(word, kinds.lower())


if __name__ == "__main__":
    unittest.main()
