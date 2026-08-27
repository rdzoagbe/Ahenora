"""Secret Santa — a name-draw gift exchange. Building and shuffling are free;
sending is the Family gate.

Covers the parts that must not go wrong: the draw is always valid (everyone
gives and receives, no self-draws, "keep apart" pairs honoured); the assignment
map is never exposed through the organiser view; the send gate; the private
one-match reveals (member in-app and outsider by token); cross-family isolation;
lock-after-send; and account-deletion cleanup. All under fake_mongo, so any
filter Mongo operators can't be trusted for is done in Python in the endpoints.

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


def P(name, member_id=None):
    return server.SantaParticipantIn(name=name, member_id=member_id)


@unittest.skipUnless(HAVE, "backend deps not installed")
class SecretSanta(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self._had_rc = os.environ.get("RC_WEBHOOK_SECRET")
        os.environ["RC_WEBHOOK_SECRET"] = "santa-test"
        run(self._seed())

    def tearDown(self):
        server.get_db = self._get_db
        if self._had_rc is None:
            os.environ.pop("RC_WEBHOOK_SECRET", None)
        else:
            os.environ["RC_WEBHOOK_SECRET"] = self._had_rc

    async def _seed(self, plan="village"):
        await self.db["families"].insert_one({
            "family_id": "fam1", "plan": plan, "billing_cycle": "monthly",
            "grandfathered": False, "updated_at": server.utcnow()})
        for uid, name in (("u_r", "Roland"), ("u_k", "Keigh")):
            await self.db["users"].insert_one({"user_id": uid, "family_id": "fam1", "name": name})
            await self.db["family_members"].insert_one(
                {"member_id": f"m_{uid}", "family_id": "fam1", "user_id": uid, "name": name, "role": "Parent"})

    def _user(self, uid="u_r"):
        return {"user_id": uid, "family_id": "fam1", "name": {"u_r": "Roland", "u_k": "Keigh"}[uid]}

    async def _set_plan(self, plan):
        await self.db["families"].update_one({"family_id": "fam1"}, {"$set": {"plan": plan}})

    def _raw(self, draw_id):
        # The stored doc, including the secret assignment map, for test assertions.
        return run(self.db["santa_draws"].find_one({"draw_id": draw_id}, {"_id": 0}))

    def _mk(self, names=("Roland", "Keigh", "Maman", "Sarah"), exclusions=None, **kw):
        return run(server.create_santa_draw(
            server.SantaDrawIn(title="Christmas", participants=[P(n) for n in names],
                               exclusions=exclusions or [], **kw),
            self._user()))

    # --- building & shuffling are free -----------------------------------
    def test_building_and_shuffling_are_free(self):
        draw = self._mk()
        self.assertEqual(draw["status"], "draft")
        got = run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        self.assertEqual(got["status"], "matched")   # no 402 on the free plan

    def test_a_shuffle_is_a_valid_derangement(self):
        draw = self._mk(names=("A", "B", "C", "D", "E"))
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        a = self._raw(draw["draw_id"])["assignments"]
        pids = [p["pid"] for p in self._raw(draw["draw_id"])["participants"]]
        self.assertEqual(sorted(a.keys()), sorted(pids))            # everyone gives
        self.assertEqual(sorted(a.values()), sorted(pids))          # everyone receives
        self.assertTrue(all(g != r for g, r in a.items()))          # no one draws themselves

    def test_keep_apart_pairs_are_never_matched(self):
        draw = self._mk(names=("A", "B", "C", "D"), exclusions=[["A", "B"]])
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        raw = self._raw(draw["draw_id"])
        a = raw["assignments"]
        name = {p["pid"]: p["name"] for p in raw["participants"]}
        for g, r in a.items():
            pair = {name[g], name[r]}
            self.assertNotEqual(pair, {"A", "B"})

    def test_impossible_exclusions_are_refused_cleanly(self):
        # Two people who must be kept apart cannot draw anyone → no valid draw.
        draw = self._mk(names=("A", "B"), exclusions=[["A", "B"]])
        with self.assertRaises(server.HTTPException) as e:
            run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        self.assertEqual(e.exception.status_code, 409)

    def test_a_draw_needs_at_least_two(self):
        draw = self._mk(names=("Solo",))
        with self.assertRaises(server.HTTPException) as e:
            run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        self.assertEqual(e.exception.status_code, 400)

    # --- the assignment is never leaked ----------------------------------
    def test_the_organiser_view_never_carries_the_assignment(self):
        draw = self._mk()
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        view = run(server.get_santa_draw(draw["draw_id"], self._user()))
        blob = repr(view)
        self.assertNotIn("assignment", blob)
        for p in view["participants"]:
            self.assertNotIn("giftee", p)
            self.assertNotIn("receiver", p)

    # --- the send gate ---------------------------------------------------
    def test_sending_is_refused_on_the_free_plan(self):
        draw = self._mk()
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        with self.assertRaises(server.HTTPException) as e:
            run(server.send_santa_draw(draw["draw_id"], self._user()))
        self.assertEqual(e.exception.status_code, 402)
        self.assertEqual(e.exception.detail["feature"], "secret_santa")

    def test_family_plan_can_send(self):
        run(self._set_plan("executive"))
        draw = self._mk()
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        got = run(server.send_santa_draw(draw["draw_id"], self._user()))
        self.assertEqual(got["status"], "sent")

    def test_cannot_send_before_shuffling(self):
        run(self._set_plan("executive"))
        draw = self._mk()
        with self.assertRaises(server.HTTPException) as e:
            run(server.send_santa_draw(draw["draw_id"], self._user()))
        self.assertEqual(e.exception.status_code, 409)

    def test_sending_is_idempotent(self):
        run(self._set_plan("executive"))
        draw = self._mk()
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        run(server.send_santa_draw(draw["draw_id"], self._user()))
        again = run(server.send_santa_draw(draw["draw_id"], self._user()))
        self.assertEqual(again["status"], "sent")

    # --- the reveals -----------------------------------------------------
    def test_a_member_reveals_only_their_own_match(self):
        run(self._set_plan("executive"))
        draw = run(server.create_santa_draw(server.SantaDrawIn(
            title="X", participants=[P("Roland", "m_u_r"), P("Keigh", "m_u_k"),
                                     P("Maman"), P("Sarah")]), self._user()))
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        run(server.send_santa_draw(draw["draw_id"], self._user()))
        match = run(server.my_santa_match(draw["draw_id"], self._user("u_r")))
        self.assertEqual(match["giver_name"], "Roland")
        self.assertTrue(match["giftee_name"])
        self.assertNotEqual(match["giftee_name"], "Roland")     # never yourself

    def test_my_match_marks_opened(self):
        run(self._set_plan("executive"))
        draw = run(server.create_santa_draw(server.SantaDrawIn(
            title="X", participants=[P("Roland", "m_u_r"), P("Keigh", "m_u_k"), P("Maman")]),
            self._user()))
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        run(server.send_santa_draw(draw["draw_id"], self._user()))
        run(server.my_santa_match(draw["draw_id"], self._user("u_r")))
        view = run(server.get_santa_draw(draw["draw_id"], self._user()))
        roland = next(p for p in view["participants"] if p["name"] == "Roland")
        self.assertTrue(roland["opened"])

    def test_my_match_before_send_is_refused(self):
        run(self._set_plan("executive"))
        draw = run(server.create_santa_draw(server.SantaDrawIn(
            title="X", participants=[P("Roland", "m_u_r"), P("Keigh", "m_u_k")]), self._user()))
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        with self.assertRaises(server.HTTPException) as e:
            run(server.my_santa_match(draw["draw_id"], self._user("u_r")))
        self.assertEqual(e.exception.status_code, 409)

    def test_an_outsider_reveals_their_match_by_token(self):
        run(self._set_plan("executive"))
        draw = self._mk(names=("Roland", "Keigh", "Maman", "Sarah"))
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        run(server.send_santa_draw(draw["draw_id"], self._user()))
        raw = self._raw(draw["draw_id"])
        outsider = next(p for p in raw["participants"] if p["name"] == "Maman")
        self.assertTrue(outsider["token"])
        match = run(server.public_santa_match(outsider["token"]))
        self.assertEqual(match["giver_name"], "Maman")
        self.assertTrue(match["giftee_name"])

    def test_an_unknown_or_empty_token_never_reveals(self):
        run(self._set_plan("executive"))
        draw = self._mk()
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        run(server.send_santa_draw(draw["draw_id"], self._user()))
        for bad in ("", "   ", "nope"):
            with self.assertRaises(server.HTTPException) as e:
                run(server.public_santa_match(bad))
            self.assertEqual(e.exception.status_code, 404)

    def test_tokens_exist_only_after_send(self):
        draw = self._mk()
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        raw = self._raw(draw["draw_id"])
        self.assertTrue(all(not p.get("token") for p in raw["participants"]))

    # --- editing & locking ----------------------------------------------
    def test_editing_the_list_resets_a_shuffle(self):
        draw = self._mk()
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        edited = run(server.edit_santa_draw(
            draw["draw_id"],
            server.SantaDrawEditIn(participants=[P("A"), P("B"), P("C")]),
            self._user()))
        self.assertEqual(edited["status"], "draft")
        self.assertEqual(self._raw(draw["draw_id"])["assignments"], {})

    def test_editing_details_keeps_the_shuffle(self):
        draw = self._mk()
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        edited = run(server.edit_santa_draw(
            draw["draw_id"], server.SantaDrawEditIn(title="New name", budget=25), self._user()))
        self.assertEqual(edited["status"], "matched")
        self.assertEqual(edited["title"], "New name")
        self.assertEqual(edited["budget"], 25)

    def test_a_sent_draw_is_locked(self):
        run(self._set_plan("executive"))
        draw = self._mk()
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        run(server.send_santa_draw(draw["draw_id"], self._user()))
        with self.assertRaises(server.HTTPException) as e:
            run(server.edit_santa_draw(draw["draw_id"], server.SantaDrawEditIn(title="x"), self._user()))
        self.assertEqual(e.exception.status_code, 409)
        with self.assertRaises(server.HTTPException) as e2:
            run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        self.assertEqual(e2.exception.status_code, 409)

    def test_editing_can_clear_the_budget(self):
        draw = self._mk(budget=30)
        self.assertEqual(draw["budget"], 30)
        got = run(server.edit_santa_draw(draw["draw_id"], server.SantaDrawEditIn(clear_budget=True), self._user()))
        self.assertIsNone(got["budget"])

    # --- isolation & cleanup ---------------------------------------------
    def test_another_family_cannot_read_or_delete_your_draw(self):
        draw = self._mk()
        outsider = {"user_id": "u_x", "family_id": "fam2", "name": "Outsider"}
        with self.assertRaises(server.HTTPException) as e:
            run(server.get_santa_draw(draw["draw_id"], outsider))
        self.assertEqual(e.exception.status_code, 404)
        with self.assertRaises(server.HTTPException):
            run(server.delete_santa_draw(draw["draw_id"], outsider))

    def test_delete_removes_the_draw(self):
        draw = self._mk()
        run(server.delete_santa_draw(draw["draw_id"], self._user()))
        with self.assertRaises(server.HTTPException):
            run(server.get_santa_draw(draw["draw_id"], self._user()))

    def test_participants_are_deduped_by_name(self):
        draw = self._mk(names=("Ama", "Ama", "Bob"))
        self.assertEqual(draw["participant_count"], 2)

    def test_an_outsider_contact_is_kept_for_delivery(self):
        draw = run(server.create_santa_draw(server.SantaDrawIn(
            title="X", participants=[P("Roland"), P("Maman")] + [
                server.SantaParticipantIn(name="Sarah", contact="+33 6 12 34 56 78")]),
            self._user()))
        sarah = next(p for p in draw["participants"] if p["name"] == "Sarah")
        self.assertEqual(sarah["contact"], "+33 6 12 34 56 78")

    def test_an_email_contact_is_kept(self):
        draw = run(server.create_santa_draw(server.SantaDrawIn(
            title="X", participants=[P("Roland"), P("Maman"),
                                     server.SantaParticipantIn(name="Sarah", contact="sarah@example.com")]),
            self._user()))
        sarah = next(p for p in draw["participants"] if p["name"] == "Sarah")
        self.assertEqual(sarah["contact"], "sarah@example.com")

    def test_opening_a_match_logs_a_feed_line(self):
        run(self._set_plan("executive"))
        draw = run(server.create_santa_draw(server.SantaDrawIn(
            title="Xmas", participants=[P("Roland", "m_u_r"), P("Keigh", "m_u_k"), P("Maman")]),
            self._user()))
        run(server.shuffle_santa_draw(draw["draw_id"], self._user()))
        run(server.send_santa_draw(draw["draw_id"], self._user()))
        run(server.my_santa_match(draw["draw_id"], self._user("u_r")))
        acts = run(self.db["activity"].find_one({"kind": "santa_opened"}, {"_id": 0}))
        self.assertIsNotNone(acts)
        self.assertEqual(acts["subject"], "Xmas")
        self.assertEqual(acts["actor_name"], "Roland")

    def test_a_member_contact_is_dropped(self):
        # Members reveal in-app, so no contact is stored even if one is sent.
        draw = run(server.create_santa_draw(server.SantaDrawIn(
            title="X", participants=[
                server.SantaParticipantIn(name="Roland", member_id="m_u_r", contact="0612345678"),
                P("Maman")]), self._user()))
        roland = next(p for p in draw["participants"] if p["name"] == "Roland")
        self.assertIsNone(roland["contact"])


@unittest.skipUnless(HAVE, "backend deps not installed")
class Derangement(unittest.TestCase):
    """The pure draw function, exercised hard so a rare seed can't slip a bad
    assignment past the endpoint tests."""

    def test_many_runs_stay_valid(self):
        pids = [f"p{i}" for i in range(8)]
        for _ in range(200):
            a = server._derange(pids, set())
            self.assertIsNotNone(a)
            self.assertEqual(sorted(a.values()), sorted(pids))
            self.assertTrue(all(g != r for g, r in a.items()))

    def test_respects_a_tight_exclusion_set(self):
        pids = [f"p{i}" for i in range(6)]
        excluded = {frozenset({"p0", "p1"}), frozenset({"p2", "p3"})}
        for _ in range(100):
            a = server._derange(pids, excluded)
            self.assertIsNotNone(a)
            for g, r in a.items():
                self.assertNotIn(frozenset({g, r}), excluded)

    def test_returns_none_when_impossible(self):
        self.assertIsNone(server._derange(["only"], set()))
        self.assertIsNone(server._derange(["a", "b"], {frozenset({"a", "b"})}))


if __name__ == "__main__":
    unittest.main()
