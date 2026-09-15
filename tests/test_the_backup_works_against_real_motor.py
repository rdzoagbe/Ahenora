"""The backup tool had never once dumped a real database.

Roland ran the restore drill on production — its first real run — and it fell
over in the first step:

    AttributeError: '_asyncio.Future' object has no attribute 'startswith'

mongo_backup._names guarded its await with asyncio.iscoroutine(). motor's
list_collection_names() returns a FUTURE, for which iscoroutine() is False, so
the await never happened and the code iterated the Future object itself.

A Future supports `yield from`, so iterating one does not fail loudly the way
iterating an int would. It fails in one of two ways depending on timing:

  * PENDING  — it yields itself, and startswith() raises. That is what
    production did, and it is the lucky outcome.
  * COMPLETE — it yields nothing, _names returns [], and dump() writes a
    manifest with zero collections and prints "dumped 0 documents across 0
    collections" as though it worked.

The second is the one that matters. A backup containing nothing, announced in
the language of a backup that worked, is precisely the failure the drill
exists to find — and it was living inside the tool written to find it.

WHY EVERY TEST PASSED ANYWAY, which is the lesson worth keeping.

fake_mongo.list_collection_names is `async def`, so it returns a coroutine, so
iscoroutine() was True in every test and False against every real database.
The double did not model the library; it modelled the guard. 1,900 tests and
a mutation suite said the backup worked, and none of them had ever seen the
shape the thing actually returns.

So these tests drive _names with all three shapes a driver can hand back, and
the two Future cases are the ones that were broken.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import mongo_backup  # noqa: E402

COLLECTIONS = ["families", "cards", "system.views"]
KEPT = ["families", "cards"]


def run(coro):
    return asyncio.run(coro)


class APendingFutureIsAwaited(unittest.TestCase):
    """What motor hands back, and what production actually hit."""

    class Database:
        def list_collection_names(self):
            async def later():
                await asyncio.sleep(0)
                return list(COLLECTIONS)
            return asyncio.ensure_future(later())

    def test_the_names_come_back(self):
        self.assertEqual(run(mongo_backup._names(self.Database())), KEPT)

    def test_it_does_not_raise_the_production_error(self):
        # "'_asyncio.Future' object has no attribute 'startswith'"
        try:
            run(mongo_backup._names(self.Database()))
        except AttributeError as exc:  # pragma: no cover - the bug itself
            self.fail(f"the production failure is back: {exc}")


class ACompletedFutureIsAwaitedToo(unittest.TestCase):
    """The silent half. This one returned [] and reported success."""

    class Database:
        def list_collection_names(self):
            future = asyncio.get_event_loop().create_future()
            future.set_result(list(COLLECTIONS))
            return future

    def test_the_names_come_back(self):
        self.assertEqual(run(mongo_backup._names(self.Database())), KEPT)

    def test_it_is_not_silently_empty(self):
        """The assertion that matters most in this file. An empty list here is
        a backup of nothing that announces itself as a backup."""
        self.assertNotEqual(run(mongo_backup._names(self.Database())), [])


class ACoroutineStillWorks(unittest.TestCase):
    """fake_mongo's shape. It was the only one ever exercised, and it must keep
    working — the point is to cover MORE shapes, not to swap which one."""

    class Database:
        async def list_collection_names(self):
            return list(COLLECTIONS)

    def test_the_names_come_back(self):
        self.assertEqual(run(mongo_backup._names(self.Database())), KEPT)


class APlainListStillWorks(unittest.TestCase):
    """A synchronous driver, or a stub that does not bother being async."""

    class Database:
        def list_collection_names(self):
            return list(COLLECTIONS)

    def test_the_names_come_back(self):
        self.assertEqual(run(mongo_backup._names(self.Database())), KEPT)


class MongosOwnCollectionsAreLeftOut(unittest.TestCase):
    """Held across the shapes, because the filter is what the await was in the
    way of — and a fix that awaited correctly but dropped the filter would
    back up system.views and report a count nobody could reconcile."""

    class Database:
        def list_collection_names(self):
            future = asyncio.get_event_loop().create_future()
            future.set_result(["families", "system.views", "system.profile"])
            return future

    def test_system_collections_are_not_dumped(self):
        self.assertEqual(run(mongo_backup._names(self.Database())), ["families"])


class TheGuardIsAboutAwaitability(unittest.TestCase):
    """iscoroutine() is true for exactly one of the shapes above. Pinned by
    name so nobody narrows it back."""

    def source(self):
        with open(os.path.join(ROOT, "scripts", "mongo_backup.py"),
                  encoding="utf-8") as handle:
            return handle.read()

    def test_it_uses_isawaitable(self):
        code = "\n".join(line for line in self.source().splitlines()
                         if not line.lstrip().startswith("#"))
        self.assertIn("inspect.isawaitable(names)", code)

    def test_it_does_not_use_iscoroutine(self):
        # Including in a docstring is fine; in the code is the bug.
        code = "\n".join(line for line in self.source().splitlines()
                         if not line.lstrip().startswith("#"))
        self.assertNotIn("if asyncio.iscoroutine(names)", code)


if __name__ == "__main__":
    unittest.main()
