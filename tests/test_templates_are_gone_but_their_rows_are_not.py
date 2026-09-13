"""The recurring-templates feature is removed. Its rows are still somebody's.

Templates had five endpoints, five api.ts wrappers, a Feed row that ran one in
a tap, and a `templates` collection — and no household could ever reach any of
it, because `create_template` was the only writer of that collection and
nothing in the app called it. `list_templates` returned `[]` for everybody, so
the Feed's "Quick templates" row never rendered for a single user. It was
removed rather than finished.

The part worth a test is what did NOT go. `_FAMILY_SCOPED_COLLECTIONS` is the
list `/auth/delete-account` promises the stores and the user, and its own
comment says a forgotten collection is orphaned personal data. Rows written
before the feature went are still somebody's data, so the collection stays
listed even though nothing can write to it any more. That reads like dead
configuration and is exactly the kind of line a later tidy-up deletes.

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
FEED = open(os.path.join(ROOT, "frontend", "app", "(tabs)", "feed.tsx"),
            encoding="utf-8").read()

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server


class TheFeatureIsGone(unittest.TestCase):
    def test_no_template_route_is_served(self):
        self.assertNotIn('"/api/templates"', SERVER)
        self.assertNotIn('"/api/templates/{template_id}"', SERVER)
        self.assertNotIn('"/api/templates/{template_id}/generate"', SERVER)

    def test_no_handler_serialiser_or_model_is_left_behind(self):
        for name in ("list_templates", "create_template", "update_template",
                     "delete_template", "generate_from_template",
                     "public_template", "class TemplateIn"):
            self.assertNotIn(name, SERVER, name)

    def test_the_app_cannot_ask_for_one(self):
        for name in ("listTemplates", "createTemplate", "toggleTemplate",
                     "deleteTemplate", "generateFromTemplate",
                     "interface Template"):
            self.assertNotIn(name, API_TS, name)

    def test_the_feed_no_longer_carries_the_row_or_its_leftovers(self):
        # Including the styles and the icon import: a stylesheet entry with
        # nothing rendering it is how the next person concludes the feature
        # is still there.
        for name in ("templateRow", "templateChip", "templateChipText",
                     "runTemplate", "enabledTemplates", "setTemplates"):
            self.assertNotIn(name, FEED, name)


class TheRowsAreStillDeleted(unittest.TestCase):
    """The half that must NOT be tidied away."""

    def test_templates_is_still_purged_when_an_account_is_deleted(self):
        block = re.search(r"_FAMILY_SCOPED_COLLECTIONS = \((.*?)\n\)", SERVER, re.S)
        self.assertIsNotNone(block, "the deletion list moved or was renamed")
        # Comments stripped first. The note beside the entry contains the word
        # "templates" in quotes, so a naive search passes on the explanation
        # after somebody has deleted the thing it explains — which a mutation
        # caught this test doing.
        entries = "\n".join(line for line in block.group(1).split("\n")
                             if not line.strip().startswith("#"))
        self.assertIn('"templates"', entries)

    @unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
    def test_the_loaded_module_agrees_and_not_only_the_source(self):
        self.assertIn("templates", server._FAMILY_SCOPED_COLLECTIONS)

    def test_the_line_says_why_it_is_there(self):
        # Without a reason beside it, a collection no feature writes to reads
        # as leftovers. The next cleanup deletes it and a household's rows
        # quietly survive their own account deletion.
        window = SERVER[SERVER.index("_FAMILY_SCOPED_COLLECTIONS") - 1200:
                        SERVER.index("_FAMILY_SCOPED_COLLECTIONS") + 2000]
        self.assertIn("templates", window)
        self.assertRegex(window, r"(?i)no feature behind it|rows written before")


if __name__ == "__main__":
    unittest.main()
