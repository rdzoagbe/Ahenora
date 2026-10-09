"""Finishing a shared job tells the other parent.

Roland, 2026-10-09: "when a co-parent marks something as done I do not get
the notification". The server wrote who finished it into the household
activity and sent nobody anything, while a hand-off, a new card and a
shopping add all pushed. Finishing was the one half of a shared job that
stayed silent, and it is the half the other parent is waiting on.

Now: ticking a shared card tells the other parents, in their own language,
with the card to open; clearing the shop tells them once how much was
bought. The actor is never told about their own tick, a private card stays
private, an undo and a re-save say nothing, and a teen is not buzzed about
the grown-ups' jobs.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    import server
    from fake_mongo import FakeDatabase
    HAVE = True
except ImportError:
    HAVE = False


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@unittest.skipUnless(HAVE, "backend deps not installed")
class FinishingTellsTheOtherParent(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.pushes = []
        self._push = server.send_push_to_user

        async def capture(database, user_id, title, body, data, channel="household-alerts", pref_key=None):
            self.pushes.append({"to": user_id, "title": title, "body": body, "data": data, "pref": pref_key})
            return {"devices": 1, "web": 0}
        server.send_push_to_user = capture
        run(self._seed())

    def tearDown(self):
        server.get_db = self._get_db
        server.send_push_to_user = self._push

    async def _seed(self):
        await self.db["families"].insert_one({
            "family_id": "fam1", "plan": "family", "billing_cycle": "monthly",
            "grandfathered": False, "updated_at": server.utcnow()})
        people = (("u_r", "Roland", "Parent", "en"), ("u_k", "Keigh", "Co-parent", "fr"),
                  ("u_t", "Tobi", "Teen", "en"))
        for uid, name, role, lang in people:
            await self.db["users"].insert_one(
                {"user_id": uid, "family_id": "fam1", "name": name, "language": lang})
            await self.db["family_members"].insert_one(
                {"member_id": f"m_{uid}", "family_id": "fam1", "user_id": uid,
                 "name": name, "role": role})
        await self.db["cards"].insert_one(self._card("c_shared", "School run", shared=True))
        await self.db["cards"].insert_one(self._card("c_private", "Consult lawyer", shared=False))
        await self.db["cards"].insert_one({**self._card("c_done", "Bins out", shared=True),
                                           "status": "DONE", "completed_at": server.utcnow()})

    @staticmethod
    def _card(card_id, title, shared):
        return {"card_id": card_id, "family_id": "fam1", "type": "TASK", "title": title,
                "status": "OPEN", "source": "MANUAL", "recurrence": "NONE", "reminder_minutes": 0,
                "shared": shared, "created_by_user_id": "u_r", "created_at": server.utcnow(),
                "updated_at": server.utcnow()}

    @staticmethod
    def _user(uid="u_k"):
        return {"user_id": uid, "family_id": "fam1",
                "name": {"u_r": "Roland", "u_k": "Keigh", "u_t": "Tobi"}[uid]}

    def _tick(self, card_id, uid="u_k", status="DONE"):
        return run(server.update_card(card_id, server.CardPatchIn(status=status), user=self._user(uid)))

    # --- cards ------------------------------------------------------------

    def test_ticking_a_shared_card_tells_the_other_parent_and_nobody_else(self):
        self._tick("c_shared", uid="u_k")
        self.assertEqual([p["to"] for p in self.pushes], ["u_r"])
        push = self.pushes[0]
        self.assertEqual(push["title"], "Keigh finished something")
        self.assertEqual(push["body"], "School run")
        self.assertEqual(push["data"]["type"], "task_done")
        self.assertEqual(push["data"]["card_id"], "c_shared")
        # Rides the household-activity toggle, so it can be switched off.
        self.assertEqual(push["pref"], "new_card_alerts")

    def test_the_push_is_in_the_recipients_language(self):
        self._tick("c_shared", uid="u_r")           # Roland ticks; Keigh reads French
        self.assertEqual([p["to"] for p in self.pushes], ["u_k"])
        self.assertEqual(self.pushes[0]["title"], "Roland a terminé quelque chose")

    def test_a_teen_is_not_told_about_the_grown_ups_jobs(self):
        self._tick("c_shared", uid="u_k")
        self.assertNotIn("u_t", [p["to"] for p in self.pushes])

    def test_a_private_card_tells_nobody(self):
        self._tick("c_private", uid="u_r")
        self.assertEqual(self.pushes, [])

    def test_undoing_and_re_saving_say_nothing(self):
        self._tick("c_done", uid="u_k", status="OPEN")      # undo
        self._tick("c_done", uid="u_k", status="DONE")      # done again: one push for that edge
        self.assertEqual(len(self.pushes), 1)
        self._tick("c_done", uid="u_k", status="DONE")      # re-save of something already done
        self.assertEqual(len(self.pushes), 1)

    # --- the shop ---------------------------------------------------------

    def _stock(self, names, checked=True):
        for i, name in enumerate(names):
            run(self.db["shopping_list"].insert_one({
                "item_id": f"it{i}", "family_id": "fam1", "name": name,
                "checked": checked, "category": "other", "created_at": server.utcnow()}))

    def test_clearing_the_shop_tells_the_other_parent_how_much_was_bought(self):
        self._stock(["milk", "bread", "eggs"])
        out = run(server.clear_checked_shopping(user=self._user("u_r")))
        self.assertEqual(out["deleted"], 3)
        self.assertEqual([p["to"] for p in self.pushes], ["u_k"])
        push = self.pushes[0]
        self.assertEqual(push["title"], "Roland a fini les courses")
        self.assertEqual(push["body"], "3 articles achetés")
        self.assertEqual(push["data"]["type"], "shopping_done")
        self.assertEqual(push["pref"], "new_card_alerts")

    def test_one_thing_bought_reads_as_one(self):
        self._stock(["milk"])
        run(server.clear_checked_shopping(user=self._user("u_k")))
        self.assertEqual(self.pushes[0]["body"], "1 thing bought")

    def test_clearing_an_unticked_list_says_nothing(self):
        self._stock(["milk", "bread"], checked=False)
        run(server.clear_checked_shopping(user=self._user("u_r")))
        self.assertEqual(self.pushes, [])


if __name__ == "__main__":
    unittest.main()
