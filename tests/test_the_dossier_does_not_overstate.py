"""The grant documents may not claim more than the code has.

These files go to a funder. A number that drifts upward as the code changes
under it is not a typo, it is a claim nobody checked — and the direction that
matters is one-sided. Understating is harmless and self-correcting; saying
there are more routes, more guards or more indexes than exist is the kind of
thing that is found by somebody else, in the worst possible room.

So this fails when a document overstates, and allows understatement within a
margin so that a normal week of work does not turn every pull request red.
Test COUNTS are not held here: pytest's total includes parametrised cases and
subtests, which cannot be counted from the source, so those lines stay
maintained by hand.
"""
import ast
import os
import re
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
DOCS = os.path.join(ROOT, "docs", "grant")
SERVER = os.path.join(ROOT, "backend", "server.py")

sys.path.insert(0, os.path.join(ROOT, "tests"))


def source() -> str:
    with open(SERVER) as fh:
        return fh.read()


def doc(name: str) -> str:
    with open(os.path.join(DOCS, name)) as fh:
        return fh.read()


def claimed(text: str, pattern: str) -> int:
    """The number a document claims, read from its own words."""
    found = re.search(pattern, text)
    assert found, f"the dossier no longer states this at all: {pattern}"
    return int(found.group(1).replace(",", ""))


def real_routes():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "guard", os.path.join(ROOT, "tests",
                              "test_a_new_endpoint_cannot_be_public_by_accident.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    rows = m.routes()
    public = [r for r in rows if not m.is_authenticated(r[2])]
    return len(rows), len(rows) - len(public), len(public)


def real_indexes() -> int:
    for node in ast.parse(source()).body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "INDEXES":
            return sum(len(v) for v in ast.literal_eval(node.value).values())
    raise AssertionError("INDEXES is no longer a plain literal this can read")


def real_functions() -> int:
    return len(re.findall(r"^(?:async )?def ", source(), re.M))


class TheNumbersAreNotInflated(unittest.TestCase):
    # How far behind reality a document may fall before it is simply wrong.
    # Generous on purpose: this guards honesty, not freshness.
    TOLERANCE = 0.10

    def assertNotOverstated(self, label: str, stated: int, actual: int):
        self.assertLessEqual(
            stated, actual,
            f"the dossier claims {stated} {label} and the code has {actual}. "
            "A funder reads these. Lower the number or add the thing.")
        self.assertGreaterEqual(
            stated, actual * (1 - self.TOLERANCE),
            f"the dossier claims {stated} {label} and the code has {actual} — "
            "far enough behind to be worth refreshing.")

    def test_it_does_not_claim_more_routes_than_exist(self):
        total, _, _ = real_routes()
        self.assertNotOverstated(
            "API routes", claimed(doc("TECHNOLOGY_APPENDIX.md"), r"([\d,]+) API routes"), total)

    def test_it_does_not_claim_more_guarded_routes_than_exist(self):
        # The security claim, and the one that would matter most if wrong.
        _, guarded, _ = real_routes()
        self.assertNotOverstated(
            "guarded routes", claimed(doc("SECURITY_BASELINE.md"), r"([\d,]+) guarded"), guarded)

    def test_it_states_the_public_routes_exactly(self):
        # Not a range: "18 deliberately public" is a list somebody can read.
        _, _, public = real_routes()
        self.assertEqual(
            claimed(doc("SECURITY_BASELINE.md"), r"([\d,]+) deliberately public"), public)

    def test_it_does_not_claim_more_functions_than_exist(self):
        self.assertNotOverstated(
            "functions", claimed(doc("TECHNOLOGY_APPENDIX.md"), r"([\d,]+) functions"),
            real_functions())

    def test_it_states_the_indexes_exactly(self):
        # A countable literal, so there is no excuse for it to drift.
        stated = claimed(doc("TECHNOLOGY_APPENDIX.md"), r"([\d,]+) indexes")
        self.assertEqual(stated, real_indexes())

    def test_the_risk_register_agrees_with_the_baseline(self):
        # Two documents quoting different test counts is the version of this
        # that a careful reader notices first.
        appendix = claimed(doc("TECHNOLOGY_APPENDIX.md"), r"([\d,]+) backend tests")
        baseline = claimed(doc("SECURITY_BASELINE.md"), r"([\d,]+) backend tests")
        register = claimed(doc("RISK_REGISTER.md"), r"([\d,]+) backend and")
        self.assertEqual({appendix, baseline, register}, {appendix},
                         "the three documents quote different backend test counts")


if __name__ == "__main__":
    unittest.main()
