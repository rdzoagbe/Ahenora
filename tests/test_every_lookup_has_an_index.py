"""A query on an unindexed field is a collection scan, and nothing says so.

2026-09-16. Roland: "Everything is really loading slowly." An audit counted
every query filter in server.py against INDEXES and found 45 filtered fields
with no index, across 30 collections. The worst was `families`, looked up by
family_id 28 times — effectively on every authenticated request, to read the
plan, the settings and the member list — with no index at all.

Nothing was broken. No test could see it. A scan of a small collection is
fast, so this was invisible while there were few families and gets steadily
worse with every one that joins: degradation that arrives as "the app feels
slow lately" rather than as an error. That is precisely the kind this file
exists to stop.

THE RULE: if server.py filters a collection on a field, that field is indexed.

The exemptions below are deliberate and each says why. Adding a query on a new
field fails this test until the field is either indexed or exempted with a
reason — which is the point. You cannot add a collection scan by accident.

Run with:  python3 -m unittest discover -s tests -v
"""
import collections
import os
import re
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))

# Fields a scan is the right answer for. Each needs a reason, not a shrug.
EXEMPT = {
    # Two values. An index over a boolean does not narrow a scan enough to pay
    # for the write cost it adds to every insert.
    ("notification_tokens", "active"),
    ("push_tickets", "checked"),
    ("web_push_subscriptions", "active"),
    # Always indexed by MongoDB itself.
    ("*", "_id"),
    # Two values again, and read only by the grant-evidence appendix: an
    # admin-only, run-by-hand count over the whole table. Nobody waits on it.
    ("cards", "status"),
}

# Below this many uses a field is a one-off admin or migration path, where a
# scan costs nothing anybody waits on.
MIN_USES = 2

FILTER = re.compile(
    r'(?:database|db)\["([a-z_]+)"\]\.'
    r'(?:find_one|find|update_one|update_many|delete_one|delete_many|count_documents)'
    r'\(\s*\{\s*"([a-z_$]+)"')


def filtered_fields():
    with open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8") as handle:
        src = handle.read()
    uses = collections.defaultdict(collections.Counter)
    for collection, field in FILTER.findall(src):
        if not field.startswith("$"):
            uses[collection][field] += 1
    return uses


class EveryLookupHasAnIndex(unittest.TestCase):

    def test_nothing_is_queried_on_an_unindexed_field(self):
        import server

        gaps = []
        for collection, fields in sorted(filtered_fields().items()):
            indexed = set(server.INDEXES.get(collection, []))
            for field, count in sorted(fields.items()):
                if count < MIN_USES:
                    continue
                if (collection, field) in EXEMPT or ("*", field) in EXEMPT:
                    continue
                if field not in indexed:
                    gaps.append(f"  {collection}.{field} "
                                f"({count} queries, no index -> collection scan)")
        self.assertEqual(gaps, [], "\n\nThese are collection scans:\n"
                         + "\n".join(gaps)
                         + "\n\nAdd the field to INDEXES in server.py, or to "
                           "EXEMPT here WITH A REASON.\n")

    def test_the_detector_still_finds_queries(self):
        """If the regex stops matching, the test above passes trivially and
        guards nothing. That failure mode has bitten this repo before, so the
        detector is asserted to still see the traffic it is measuring."""
        uses = filtered_fields()
        self.assertGreater(len(uses), 20,
                           "the filter regex matched almost nothing — it has "
                           "probably drifted from how server.py is written")
        self.assertGreater(sum(sum(c.values()) for c in uses.values()), 150)

    def test_families_is_indexed_because_every_request_reads_it(self):
        """Named on its own: this was the expensive one, and a future tidy-up
        of INDEXES should fail here rather than quietly re-introduce it."""
        import server
        self.assertIn("family_id", server.INDEXES.get("families", []))

    def test_every_indexed_collection_is_one_the_app_uses(self):
        """The other direction: an index on a collection nothing queries is
        write cost for nothing."""
        import server
        with open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8") as handle:
            src = handle.read()
        for collection in server.INDEXES:
            self.assertIn(f'["{collection}"]', src,
                          f"{collection} is indexed but never accessed")


class NothingSlowRunsOnTheEventLoop(unittest.TestCase):
    """A synchronous network call inside an async def stops the whole worker.

    Two were found in the AI path on 2026-09-16, both calling _discover_models,
    which does a round-trip to Google through the SYNC genai client:

      * in _gemini_generate, on the first AI request after every restart — and
        several scans arriving together each saw an empty cache and each ran
        their own, one after another;
      * in /api/health/ai, where it is NOT cached at all, so every call to the
        endpoint blocked the worker for a round-trip.

    Same shape as the crop, which cost 0.58s of everybody's time per scan.
    """

    def source(self):
        with open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8") as handle:
            return "\n".join(line for line in handle.read().splitlines()
                             if not line.lstrip().startswith("#"))

    def test_model_discovery_is_never_called_bare(self):
        src = self.source()
        bare = re.findall(r"(?<!run_in_threadpool\()\b_discover_models\(\)", src)
        # The definition itself is "def _discover_models() -> list:", not a call.
        calls = [m for m in re.finditer(r"_discover_models\(\)", src)
                 if "def _discover_models" not in
                 src[max(0, m.start() - 40):m.start() + 20]]
        for match in calls:
            window = src[max(0, match.start() - 60):match.start()]
            self.assertIn("run_in_threadpool", window,
                          "_discover_models() is called without a threadpool: "
                          "that is a synchronous network round-trip on the "
                          "event loop")

    def test_the_crop_is_still_threaded(self):
        """It was moved off the loop the same day; keep it there."""
        src = self.source()
        self.assertNotIn("crop_to_document(payload.image_base64)", src)


class PasswordHashingDoesNotStopTheWorker(unittest.TestCase):
    """200,000 rounds of PBKDF2 is 60-100ms of solid CPU, and it ran on the
    event loop at eight call sites — login, registration, password change,
    password reset, account deletion, the kid PIN escape.

    On an event loop that is not 60ms for the person signing in. It is 60ms in
    which the worker answers NOBODY: five people signing in at once means the
    fifth waits a third of a second and every unrelated request queues behind
    all five. The cost is deliberate — it is what makes a stolen hash
    expensive — so the fix is to pay it on a thread, not to lower it.
    """

    def source(self):
        with open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8") as handle:
            return "\n".join(line for line in handle.read().splitlines()
                             if not line.lstrip().startswith("#"))

    def test_the_work_factor_has_not_been_quietly_lowered(self):
        import server
        self.assertGreaterEqual(server.PASSWORD_ITERATIONS, 200_000,
                                "PBKDF2 rounds are the defence; moving the "
                                "hash to a thread is not a reason to cut them")

    def test_no_call_site_hashes_on_the_event_loop(self):
        import ast
        with open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8") as handle:
            tree = ast.parse(handle.read())
        bare = []

        class Visit(ast.NodeVisitor):
            def __init__(self):
                self.stack = []

            def visit_AsyncFunctionDef(self, node):
                self.stack.append(("async", node.name))
                self.generic_visit(node)
                self.stack.pop()

            def visit_FunctionDef(self, node):
                self.stack.append(("sync", node.name))
                self.generic_visit(node)
                self.stack.pop()

            def visit_Call(self, node):
                name = node.func.id if isinstance(node.func, ast.Name) else None
                if (name in ("hash_password", "verify_password")
                        and self.stack and self.stack[-1][0] == "async"):
                    bare.append(f"  server.py:{node.lineno} in {self.stack[-1][1]}")
                self.generic_visit(node)

        Visit().visit(tree)
        self.assertEqual(bare, [], "\n\nPassword hashing on the event loop:\n"
                         + "\n".join(bare) + "\n\nUse run_in_threadpool.\n")

    def test_no_await_hides_inside_a_generator_expression(self):
        """`await` inside a genexp makes it an ASYNC generator, which next()
        cannot consume — it raises TypeError on the first login. That is
        exactly what the mechanical rewrite above did to login_email, and the
        suite is the only reason a user never saw it."""
        import ast
        with open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8") as handle:
            tree = ast.parse(handle.read())
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                fn = node.func
                if isinstance(fn, ast.Name) and fn.id in ("next", "any", "all", "sorted"):
                    for arg in node.args:
                        if isinstance(arg, ast.GeneratorExp) and any(
                                isinstance(x, ast.Await) for x in ast.walk(arg)):
                            self.fail(f"server.py:{node.lineno}: await inside a "
                                      f"generator passed to {fn.id}() — that is "
                                      "an async generator and will raise")
