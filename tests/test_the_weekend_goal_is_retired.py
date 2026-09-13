"""The per-child weekend goal is gone, and stays gone.

`PUT /api/family/members/{member_id}/weekend-goal` pinned the one treat a
child was working toward, to drive a progress ring. It was retired when the
week became a single target for everybody rather than a per-child goal, and
it never had a caller in the app — the unreachable-API ledger has carried
"Retired when the week became one target for everyone" against it since.

Removed rather than left sitting there, for the same reason as task templates
before it: a retired endpoint nothing can reach is an attack surface and a
maintenance cost with no user behind either. This one took a raw `dict` body
and had to guard against `{"reward_id": {"$ne": null}}` being stored as a
child's goal — a guard that is now simply absent along with the thing it
guarded.

Three things this pins, because each would go wrong quietly:

  * the route, handler and client wrapper are gone;
  * `weekend_goal_reward_id` is no longer served to any client, so nothing
    starts reading a value nothing can write;
  * `family_members` is still purged on account deletion. The stored field
    goes with the member document it lives on, so there is nothing extra to
    clean up — but that only holds while the collection stays on the list.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import re
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))

SERVER = open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8").read()
API_TS = open(os.path.join(ROOT, "frontend", "src", "api.ts"), encoding="utf-8").read()

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server


class TheEndpointIsGone(unittest.TestCase):
    def test_no_route_is_served(self):
        self.assertNotIn("weekend-goal", SERVER)

    def test_no_handler_is_left_behind(self):
        self.assertNotIn("set_weekend_goal", SERVER)

    def test_the_app_cannot_call_it(self):
        self.assertNotIn("setWeekendGoal", API_TS)

    @unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
    def test_the_loaded_app_serves_no_such_path(self):
        # Source greps miss a route registered some other way; the router is
        # the authority on what is actually reachable.
        paths = {getattr(r, "path", "") for r in server.app.routes}
        self.assertFalse([p for p in paths if "weekend-goal" in p], sorted(paths)[:0])


class TheFieldIsNoLongerServed(unittest.TestCase):
    def test_no_serialiser_hands_it_to_a_client(self):
        self.assertNotIn("weekend_goal_reward_id", SERVER)

    def test_the_client_type_does_not_declare_it(self):
        # A type that still declares it invites a screen to read a value
        # nothing can ever set.
        self.assertNotIn("weekend_goal_reward_id", API_TS)


class TheMemberDocumentIsStillDeleted(unittest.TestCase):
    """The stored field rides on family_members, so account deletion covers it
    — but only while that collection stays on the list."""

    def test_family_members_is_still_purged(self):
        block = re.search(r"_FAMILY_SCOPED_COLLECTIONS = \((.*?)\n\)", SERVER, re.S)
        self.assertIsNotNone(block, "the deletion list moved or was renamed")
        entries = "\n".join(line for line in block.group(1).split("\n")
                            if not line.strip().startswith("#"))
        self.assertIn('"family_members"', entries)

    @unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
    def test_the_loaded_module_agrees(self):
        self.assertIn("family_members", server._FAMILY_SCOPED_COLLECTIONS)


if __name__ == "__main__":
    unittest.main()
