"""Tests for billing reconciliation — the self-healing path for a missed
RevenueCat webhook.

The rule under test: the server corrects the stored plan from RevenueCat's
answer in both directions, but a downgrade only applies when the plan
verifiably came from billing — a manually granted plan is never silently
revoked by a reconcile.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server

USER = {"user_id": "u1", "family_id": "fam1", "name": "Roland", "role": "Parent"}

FUTURE = (datetime.now(timezone.utc) + timedelta(days=20)).isoformat()
PAST = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()


def subscriber(entitlements):
    return {"entitlements": entitlements}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class EntitlementState(unittest.TestCase):
    def now(self):
        return datetime.now(timezone.utc)

    def test_active_when_expiry_is_in_the_future(self):
        active, product = server.rc_entitlement_state(
            subscriber({"premium": {"expires_date": FUTURE, "product_identifier": "coo_yearly"}}),
            self.now(),
        )
        self.assertTrue(active)
        self.assertEqual(product, "coo_yearly")

    def test_inactive_when_expiry_has_passed(self):
        active, product = server.rc_entitlement_state(
            subscriber({"premium": {"expires_date": PAST, "product_identifier": "coo_monthly"}}),
            self.now(),
        )
        self.assertFalse(active)
        self.assertIsNone(product)

    def test_no_expiry_means_lifetime(self):
        active, _ = server.rc_entitlement_state(
            subscriber({"premium": {"expires_date": None, "product_identifier": "coo_life"}}),
            self.now(),
        )
        self.assertTrue(active)

    def test_garbage_is_distrusted_not_trusted(self):
        # A malformed expiry must not grant access.
        active, _ = server.rc_entitlement_state(
            subscriber({"premium": {"expires_date": "not a date", "product_identifier": "x"}}),
            self.now(),
        )
        self.assertFalse(active)
        active, _ = server.rc_entitlement_state(subscriber({"premium": "not a dict"}), self.now())
        self.assertFalse(active)
        active, _ = server.rc_entitlement_state({}, self.now())
        self.assertFalse(active)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Reconcile(unittest.TestCase):
    """Drive the endpoint with RevenueCat and the database stubbed."""

    def setUp(self):
        self._env = os.environ.get("REVENUECAT_SECRET_KEY")
        os.environ["REVENUECAT_SECRET_KEY"] = "test-secret"
        self._fetch = server._fetch_rc_subscriber
        self._get_db = server.get_db
        self._family = server.get_family_doc
        self._build = server.build_subscription

    def tearDown(self):
        if self._env is None:
            os.environ.pop("REVENUECAT_SECRET_KEY", None)
        else:
            os.environ["REVENUECAT_SECRET_KEY"] = self._env
        server._fetch_rc_subscriber = self._fetch
        server.get_db = self._get_db
        server.get_family_doc = self._family
        server.build_subscription = self._build

    def run_reconcile(self, entitlements, family):
        updates = []

        async def fake_fetch(user_id, secret):
            return {"subscriber": subscriber(entitlements)}

        class _Families:
            async def update_one(self, q, u):
                updates.append(u["$set"])

        class _DB:
            def __getitem__(self, name):
                return _Families()

        async def fake_family(fid):
            return dict(family)

        async def fake_build(fid):
            return {"plan": family.get("plan"), "limits": {}}

        server._fetch_rc_subscriber = fake_fetch
        server.get_db = lambda: _DB()
        server.get_family_doc = fake_family
        server.build_subscription = fake_build
        asyncio.run(server.reconcile_billing(user=dict(USER)))
        return updates[0] if updates else {}

    def test_an_active_subscription_upgrades_the_family(self):
        changed = self.run_reconcile(
            {"premium": {"expires_date": FUTURE, "product_identifier": "coo_annual"}},
            {"plan": "village"},
        )
        self.assertEqual(changed.get("plan"), "executive")
        self.assertEqual(changed.get("billing_cycle"), "yearly")

    def test_an_expired_billing_plan_downgrades(self):
        changed = self.run_reconcile(
            {},
            {"plan": "executive", "rc_last_event": "RENEWAL"},
        )
        self.assertEqual(changed.get("plan"), "village")

    def test_a_manually_granted_plan_is_never_revoked(self):
        # No webhook state on the family: the plan did not come from billing,
        # so RevenueCat having no record of it proves nothing.
        changed = self.run_reconcile({}, {"plan": "executive"})
        self.assertNotIn("plan", changed)

    def test_unconfigured_key_fails_loudly(self):
        os.environ.pop("REVENUECAT_SECRET_KEY", None)
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.reconcile_billing(user=dict(USER)))
        self.assertEqual(ctx.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
