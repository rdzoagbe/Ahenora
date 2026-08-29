"""A purchase that never reaches a household must be visible, and must heal.

Somebody subscribed to the €49.99 yearly plan and the admin screen never showed
it. There are three ways that happens — the webhook secret is unset so every
event is refused, the webhook was never pointed at us so nothing arrives, or an
event arrives carrying an app_user_id we cannot place and is acknowledged with
a 200 so the provider never retries. All three look identical from inside the
app: a household that paid and reads as free.

These tests hold two lines. Every event is written down, matched or not, so the
three cases can be told apart. And the server asks RevenueCat on its own, so a
missed webhook heals without the family that paid having to notice.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import secrets
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase

# Generated per run rather than written down. A literal here would be a
# credential-shaped string flowing into a parameter named `authorization`,
# which is the one pattern static analysis is right to refuse in a repository —
# and the tests do not care what the value is, only that the right one is
# accepted and a wrong one is refused.
RC_SECRET = secrets.token_hex(16)
ADMIN_EMAIL = "boss@ahenora.com"
ADMIN = {"user_id": "u_admin", "family_id": "famA", "email": ADMIN_EMAIL}


def rc_event(event_type, app_user_id, product_id="ahenora_family_yearly"):
    return {"event": {"type": event_type, "app_user_id": app_user_id,
                      "product_id": product_id}}


def subscriber(active=True, product="ahenora_family_yearly", days=365):
    exp = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    if not active:
        return {"subscriber": {"entitlements": {}}}
    return {"subscriber": {"entitlements": {
        "premium": {"product_identifier": product, "expires_date": exp}}}}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class BillingEventsAreRecorded(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        os.environ["RC_WEBHOOK_SECRET"] = RC_SECRET

    def tearDown(self):
        server.get_db = self._get_db
        os.environ.pop("RC_WEBHOOK_SECRET", None)

    def _events(self):
        return asyncio.run(self._read())

    async def _read(self):
        return [r async for r in self.db["billing_events"].find({}, {"_id": 0})]

    def test_a_purchase_we_cannot_place_is_written_down(self):
        """The silent case, and the expensive one. We answer 200 so the store
        stops retrying — which means this row is the ONLY evidence that money
        arrived and went nowhere."""
        res = asyncio.run(server.revenuecat_webhook(
            rc_event("INITIAL_PURCHASE", "u_nobody"), authorization=f"Bearer {RC_SECRET}"))
        self.assertEqual(res, {"ok": True, "matched": False})

        rows = self._events()
        self.assertEqual(len(rows), 1)
        self.assertFalse(rows[0]["matched"])
        self.assertEqual(rows[0]["source"], "revenuecat")
        self.assertEqual(rows[0]["event_type"], "INITIAL_PURCHASE")
        self.assertEqual(rows[0]["app_user_id"], "u_nobody")
        self.assertIsNotNone(rows[0]["received_at"])

    def test_a_purchase_that_lands_is_written_down_too(self):
        """Not only failures: without the successful rows there is no way to
        tell 'the webhook is broken' from 'no one has bought anything'."""
        asyncio.run(self.db["users"].insert_one({"user_id": "u_1", "family_id": "famB"}))
        asyncio.run(self.db["families"].insert_one({"family_id": "famB", "plan": "village"}))

        asyncio.run(server.revenuecat_webhook(
            rc_event("INITIAL_PURCHASE", "u_1"), authorization=f"Bearer {RC_SECRET}"))

        rows = self._events()
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["matched"])
        self.assertEqual(rows[0]["family_id"], "famB")
        self.assertEqual(rows[0]["plan"], "executive")

    def test_a_forged_event_is_refused_and_records_nothing(self):
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.revenuecat_webhook(
                rc_event("INITIAL_PURCHASE", "u_1"), authorization="Bearer wrong"))
        self.assertEqual(ctx.exception.status_code, 401)
        self.assertEqual(self._events(), [])

    def test_recording_never_breaks_the_webhook(self):
        """The log is a convenience. A purchase must still be applied if it
        cannot be written down."""
        asyncio.run(self.db["users"].insert_one({"user_id": "u_1", "family_id": "famB"}))
        asyncio.run(self.db["families"].insert_one({"family_id": "famB", "plan": "village"}))

        class Broken:
            async def insert_one(self, *a, **k):
                raise RuntimeError("disk full")

        real = self.db.__getitem__

        def only_events_broken(name):
            return Broken() if name == "billing_events" else real(name)

        self.db.__getitem__ = only_events_broken
        try:
            res = asyncio.run(server.revenuecat_webhook(
                rc_event("INITIAL_PURCHASE", "u_1"), authorization=f"Bearer {RC_SECRET}"))
        finally:
            self.db.__getitem__ = real
        self.assertEqual(res, {"ok": True, "matched": True})
        fam = asyncio.run(real("families").find_one({"family_id": "famB"}))
        self.assertEqual(fam["plan"], "executive")

    def test_the_log_does_not_grow_without_end(self):
        keep = server.BILLING_EVENT_KEEP
        server.BILLING_EVENT_KEEP = 3
        try:
            for i in range(6):
                asyncio.run(server.revenuecat_webhook(
                    rc_event("INITIAL_PURCHASE", f"u_ghost_{i}"),
                    authorization=f"Bearer {RC_SECRET}"))
        finally:
            server.BILLING_EVENT_KEEP = keep
        rows = self._events()
        self.assertEqual(len(rows), 3)
        # The newest survive, not an arbitrary three.
        kept = {r["app_user_id"] for r in rows}
        self.assertEqual(kept, {"u_ghost_3", "u_ghost_4", "u_ghost_5"})


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheAdminCanSeeWhatArrived(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        self._admins = server.ADMIN_EMAILS
        server.get_db = lambda: self.db
        server.ADMIN_EMAILS = {ADMIN_EMAIL}

    def tearDown(self):
        server.get_db = self._get_db
        server.ADMIN_EMAILS = self._admins
        os.environ.pop("RC_WEBHOOK_SECRET", None)

    def test_silence_is_reported_as_silence(self):
        """Nothing has ever arrived. That is the 'webhook not pointed at us'
        case, and it must read differently from 'nobody has bought anything'."""
        os.environ.pop("RC_WEBHOOK_SECRET", None)
        out = asyncio.run(server.admin_billing_events(user=dict(ADMIN), limit=40))
        self.assertFalse(out["ever_received"])
        self.assertIsNone(out["last_event_at"])
        self.assertFalse(out["revenuecat_configured"])
        self.assertEqual(out["events"], [])

    def test_unmatched_events_are_counted_separately(self):
        os.environ["RC_WEBHOOK_SECRET"] = RC_SECRET
        asyncio.run(self.db["users"].insert_one({"user_id": "u_1", "family_id": "famB"}))
        asyncio.run(self.db["families"].insert_one({"family_id": "famB", "plan": "village"}))
        asyncio.run(server.revenuecat_webhook(
            rc_event("INITIAL_PURCHASE", "u_1"), authorization=f"Bearer {RC_SECRET}"))
        asyncio.run(server.revenuecat_webhook(
            rc_event("INITIAL_PURCHASE", "u_nobody"), authorization=f"Bearer {RC_SECRET}"))

        out = asyncio.run(server.admin_billing_events(user=dict(ADMIN), limit=40))
        self.assertTrue(out["ever_received"])
        self.assertTrue(out["revenuecat_configured"])
        self.assertEqual(out["total"], 2)
        self.assertEqual(out["unmatched"], 1)
        self.assertEqual(out["by_source"], {"revenuecat": 2})
        # Newest first, so the thing that just went wrong is at the top.
        self.assertFalse(out["events"][0]["matched"])

    def test_a_non_admin_is_refused(self):
        with self.assertRaises(server.HTTPException) as ctx:
            asyncio.run(server.admin_billing_events(
                user={"user_id": "u_2", "family_id": "famB", "email": "b@x.test"},
                limit=40))
        self.assertEqual(ctx.exception.status_code, 403)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheSweepHealsAMissedWebhook(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        self._fetch = server._fetch_rc_subscriber
        server.get_db = lambda: self.db
        self.asked = []

    def tearDown(self):
        server.get_db = self._get_db
        server._fetch_rc_subscriber = self._fetch

    def _answer(self, table):
        async def fake(user_id, secret):
            self.asked.append(user_id)
            reply = table.get(user_id)
            if reply is None:
                raise server.HTTPException(status_code=502, detail="RevenueCat error 404")
            return reply
        server._fetch_rc_subscriber = fake

    def _seed(self, families, users):
        for f in families:
            asyncio.run(self.db["families"].insert_one(f))
        for u in users:
            asyncio.run(self.db["users"].insert_one(u))

    def test_a_household_that_paid_is_lifted_without_anyone_opening_the_app(self):
        self._seed(
            [{"family_id": "famB", "plan": "village"}],
            [{"user_id": "u_payer", "family_id": "famB"}],
        )
        self._answer({"u_payer": subscriber()})
        res = asyncio.run(server.sweep_billing_once(self.db, "sk", 50))

        self.assertEqual(res["corrected"], 1)
        fam = asyncio.run(self.db["families"].find_one({"family_id": "famB"}))
        self.assertEqual(fam["plan"], "executive")
        self.assertEqual(fam["billing_cycle"], "yearly")

    def test_the_correction_is_recorded_so_it_is_not_invisible_too(self):
        self._seed(
            [{"family_id": "famB", "plan": "village"}],
            [{"user_id": "u_payer", "family_id": "famB"}],
        )
        self._answer({"u_payer": subscriber()})
        asyncio.run(server.sweep_billing_once(self.db, "sk", 50))

        rows = asyncio.run(self._events())
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["source"], "sweep")
        self.assertEqual(rows[0]["family_id"], "famB")
        self.assertTrue(rows[0]["matched"])

    async def _events(self):
        return [r async for r in self.db["billing_events"].find({}, {"_id": 0})]

    def test_it_never_takes_a_plan_away(self):
        """The dangerous direction. RevenueCat saying 'not active' about a
        household that pays by card, or answering oddly once, must not strip a
        paying customer's features with nobody watching."""
        self._seed(
            [{"family_id": "famPaid", "plan": "executive", "rc_last_event": "INITIAL_PURCHASE"}],
            [{"user_id": "u_card", "family_id": "famPaid"}],
        )
        self._answer({"u_card": subscriber(active=False)})
        asyncio.run(server.sweep_billing_once(self.db, "sk", 50))

        fam = asyncio.run(self.db["families"].find_one({"family_id": "famPaid"}))
        self.assertEqual(fam["plan"], "executive")
        # It should not even have asked: a paid household is not a candidate.
        self.assertEqual(self.asked, [])

    def test_every_adult_is_a_candidate_not_only_the_founder(self):
        """app_user_id is whoever pressed buy. Checking only the household's
        creator would miss a co-parent's purchase entirely."""
        self._seed(
            [{"family_id": "famB", "plan": "village"}],
            [{"user_id": "u_founder", "family_id": "famB"},
             {"user_id": "u_coparent", "family_id": "famB"}],
        )
        self._answer({"u_coparent": subscriber()})
        res = asyncio.run(server.sweep_billing_once(self.db, "sk", 50))

        self.assertEqual(res["corrected"], 1)
        self.assertIn("u_coparent", self.asked)
        fam = asyncio.run(self.db["families"].find_one({"family_id": "famB"}))
        self.assertEqual(fam["plan"], "executive")

    def test_an_unknown_subscriber_does_not_end_the_pass(self):
        """RevenueCat 404s for anyone who never bought anything — which is most
        people. That must not stop the pass before it reaches the one who did."""
        self._seed(
            [{"family_id": "fam1", "plan": "village"},
             {"family_id": "fam2", "plan": "village"}],
            [{"user_id": "u_never", "family_id": "fam1"},
             {"user_id": "u_payer", "family_id": "fam2"}],
        )
        self._answer({"u_payer": subscriber()})
        res = asyncio.run(server.sweep_billing_once(self.db, "sk", 50))

        self.assertEqual(res["checked"], 2)
        self.assertEqual(res["corrected"], 1)
        fam = asyncio.run(self.db["families"].find_one({"family_id": "fam2"}))
        self.assertEqual(fam["plan"], "executive")

    def test_the_budget_is_respected_and_the_rest_come_next_pass(self):
        """A base larger than the budget must be covered ACROSS passes, not
        half-checked forever — so who was asked last time is remembered."""
        self._seed(
            [{"family_id": f"fam{i}", "plan": "village"} for i in range(4)],
            [{"user_id": f"u{i}", "family_id": f"fam{i}"} for i in range(4)],
        )
        self._answer({"u3": subscriber()})

        first = asyncio.run(server.sweep_billing_once(self.db, "sk", 2))
        self.assertEqual(first["checked"], 2)
        self.assertEqual(first["candidates"], 4)
        seen_first = list(self.asked)

        second = asyncio.run(server.sweep_billing_once(self.db, "sk", 2))
        self.assertEqual(second["checked"], 2)
        # The second pass asks the two nobody asked the first time.
        self.assertEqual(set(self.asked[len(seen_first):]) & set(seen_first), set())
        fam = asyncio.run(self.db["families"].find_one({"family_id": "fam3"}))
        self.assertEqual(fam["plan"], "executive")

    def test_the_revenuecat_key_never_reaches_the_log(self):
        """_fetch_rc_subscriber builds its detail by interpolating the urllib
        error it caught, and a urllib error can carry the request it failed on
        — Authorization header and all. Railway keeps these logs, so echoing
        that detail would write the RevenueCat key down in clear text.

        The status code carries the useful half (404 = never bought anything,
        5xx = ask again later) and carries nothing else.
        """
        key = "sk_live_" + secrets.token_hex(16)
        self._seed(
            [{"family_id": "famB", "plan": "village"}],
            [{"user_id": "u_payer", "family_id": "famB"}],
        )

        async def leaky(user_id, secret):
            # Exactly the shape _fetch_rc_subscriber produces on a network fault.
            raise server.HTTPException(
                status_code=502,
                detail=f"RevenueCat request failed: <urlopen error {secret}>")
        server._fetch_rc_subscriber = leaky

        with self.assertLogs(server.log, level="INFO") as caught:
            asyncio.run(server.sweep_billing_once(self.db, key, 50))

        blob = "\n".join(caught.output)
        self.assertNotIn(key, blob)
        # Still diagnosable: the status survives.
        self.assertIn("502", blob)

    def test_a_household_product_lifts_to_the_top_tier(self):
        self._seed(
            [{"family_id": "famB", "plan": "village"}],
            [{"user_id": "u_payer", "family_id": "famB"}],
        )
        self._answer({"u_payer": subscriber(product="ahenora_household_monthly")})
        asyncio.run(server.sweep_billing_once(self.db, "sk", 50))

        fam = asyncio.run(self.db["families"].find_one({"family_id": "famB"}))
        self.assertEqual(fam["plan"], "household")
        self.assertEqual(fam["billing_cycle"], "monthly")

    def test_nothing_to_do_when_every_household_already_pays(self):
        self._seed(
            [{"family_id": "famB", "plan": "executive"}],
            [{"user_id": "u_payer", "family_id": "famB"}],
        )
        self._answer({})
        res = asyncio.run(server.sweep_billing_once(self.db, "sk", 50))
        self.assertEqual(res, {"checked": 0, "corrected": 0, "candidates": 0})


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ProductNaming(unittest.TestCase):
    def test_the_mapping_is_one_place_and_reads_both_halves(self):
        for product, expected in (
            ("ahenora_family_yearly", ("executive", "yearly")),
            ("ahenora_family_monthly", ("executive", "monthly")),
            ("ahenora_household_annual", ("household", "yearly")),
            ("AHENORA_HOUSEHOLD_MONTHLY", ("household", "monthly")),
            (None, ("executive", "monthly")),
        ):
            with self.subTest(product=product):
                self.assertEqual(server.rc_plan_from_product(product), expected)


if __name__ == "__main__":
    unittest.main()
