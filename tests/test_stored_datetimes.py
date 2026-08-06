"""Timestamps that come back from the database.

BSON has no timezone. A datetime written to MongoDB is read back NAIVE, while
`utcnow()` is aware, and comparing the two does not return False — it raises
TypeError. That took invite acceptance down in production: `expires_at <
utcnow()` in `_resolve_invite`, sitting outside the handler's try, surfaced as
a bare 500 on the one endpoint a new co-parent has to pass through. It ran for
an unknown length of time with nothing reporting it.

Every local test passed throughout, because the in-memory double handed back
the very objects it was given, tzinfo intact — kinder than the thing it stands
in for. That is the specific way a test double fails: not by being wrong, but
by being lenient about the one thing production is strict about.

So there are two guards here, and the second matters more than the first:
  1. Comparisons go through `_expired`/`_coerce_dt`, never a bare `<`.
  2. The double now strips tzinfo on write, exactly as the wire format does,
     so any new bare comparison fails here first.
"""

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

# The double is pure stdlib, so the tests that pin ITS behaviour run
# everywhere — including a dependency-free CI, which is exactly where a
# regression in it would otherwise pass unnoticed. Only the tests that call
# into the server need the backend installed.
from fake_mongo import _bsonify, _eq, _cmp_pair  # noqa: E402

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server


class WhatTheDatabaseHandsBack(unittest.TestCase):
    def test_the_double_strips_tzinfo_exactly_as_bson_does(self):
        """The guard that would have caught this before it shipped."""
        stored = _bsonify({"expires_at": datetime.now(timezone.utc)})
        self.assertIsNone(stored["expires_at"].tzinfo)

    def test_nested_and_listed_datetimes_are_stripped_too(self):
        out = _bsonify({
            "a": {"when": datetime.now(timezone.utc)},
            "b": [datetime.now(timezone.utc)],
        })
        self.assertIsNone(out["a"]["when"].tzinfo)
        self.assertIsNone(out["b"][0].tzinfo)

    def test_a_bare_comparison_is_what_actually_breaks(self):
        """Pinned so the failure mode stays legible to whoever reads this next.

        Deliberately uses a locally-built aware datetime rather than
        server.utcnow(), so the clearest statement of the bug does not need
        the backend installed to run.
        """
        naive = _bsonify({"t": datetime.now(timezone.utc)})["t"]
        with self.assertRaises(TypeError):
            naive < datetime.now(timezone.utc)  # noqa: B015 — it must raise


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ExpiryChecks(unittest.TestCase):
    def test_expired_survives_a_naive_stored_value(self):
        past = datetime.now(timezone.utc) - timedelta(days=1)
        self.assertTrue(server._expired(past.replace(tzinfo=None)))

    def test_expired_survives_an_aware_one(self):
        past = datetime.now(timezone.utc) - timedelta(days=1)
        self.assertTrue(server._expired(past))

    def test_a_future_expiry_has_not_passed_either_way(self):
        soon = datetime.now(timezone.utc) + timedelta(days=1)
        self.assertFalse(server._expired(soon))
        self.assertFalse(server._expired(soon.replace(tzinfo=None)))

    def test_an_iso_string_is_accepted(self):
        # Some rows carry strings rather than datetimes; both must compare.
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        self.assertTrue(server._expired(past))

    def test_nothing_stored_is_not_expired(self):
        self.assertFalse(server._expired(None))
        self.assertFalse(server._expired(""))

    def test_junk_does_not_expire_a_valid_invite(self):
        # Failing open beats raising: an unparseable stamp must not 500, and
        # must not silently void an invite somebody is holding.
        self.assertFalse(server._expired("not a date"))


class QueriesCompareInstantsNotRepresentations(unittest.TestCase):
    """The other half: a mismatch the real database does NOT have.

    `{"expires_at": {"$gt": utcnow()}}` is evaluated server-side on BSON
    instants — aware-vs-naive never reaches it. The double models that too, or
    every session lookup in the suite would fail for a reason production does
    not have.
    """

    def test_aware_and_naive_line_up_for_comparison(self):
        now = datetime.now(timezone.utc)
        left, right = _cmp_pair(now.replace(tzinfo=None), now)
        self.assertEqual(left, right)

    def test_equality_holds_across_the_two_forms(self):
        now = datetime.now(timezone.utc)
        self.assertTrue(_eq(now.replace(tzinfo=None), now))

    def test_ordering_still_means_something(self):
        now = datetime.now(timezone.utc)
        later = now + timedelta(hours=1)
        left, right = _cmp_pair(later.replace(tzinfo=None), now)
        self.assertGreater(left, right)


class TheClientAsksForAwareDatetimes(unittest.TestCase):
    def test_tz_aware_is_set_on_the_real_client(self):
        """Belt to the code's braces — and unreachable by any other test,
        because the double never constructs a Motor client."""
        src = open(os.path.join(os.path.dirname(__file__), "..",
                                "backend", "server.py")).read()
        head = src[:src.index("appname=")]
        self.assertIn("tz_aware=True", head)


if __name__ == "__main__":
    unittest.main()
