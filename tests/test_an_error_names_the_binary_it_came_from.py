"""The build stamp named the bundle, not the binary.

On 2026-09-16 Roland sent a screenshot: Stéphanie's phone failing
/push-register with "Unable to get Firebase Messaging instance", repeatedly,
stamped `android · 1.1.0`.

The stamp was added the day before for exactly this decision — "an error from
a stale build needs a user to update; the same error on current code needs an
engineer" — and it could not make it. Two reasons, and the second is worse:

  1. app.json's `version` has read 1.1.0 since launch. It is not bumped per
     build, so an APK from August and one from last week are the same string.

  2. It came from Constants.expoConfig.version, which describes the OTA
     BUNDLE rather than the installed app. After an update every phone
     reports the newest app.json's version whatever binary it is running — so
     the field describes the JavaScript while the failure is in native code.

expo-application reads the INSTALLED app. nativeBuildVersion is the Android
versionCode, which EAS increments per build (appVersionSource: remote), and
nativeApplicationVersion is the real installed version string. Those belong
to the binary, which is what a Firebase failure belongs to.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import re
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


def code_only(text):
    """Source with comments stripped.

    Text matching cannot tell code from prose, and this file is about a
    mistake whose explanation names every field involved — so a comment would
    satisfy every assertion below on its own. Fifth time this has bitten.
    """
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    return "\n".join(line for line in text.splitlines()
                     if not line.lstrip().startswith(("//", "*", "#")))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheServerAcceptsAndStoresTheBinary(unittest.TestCase):

    def test_the_model_takes_the_native_build(self):
        self.assertIn("native_build", server.ClientErrorIn.model_fields)
        self.assertIn("native_version", server.ClientErrorIn.model_fields)

    def test_it_is_optional_like_every_stamp_field(self):
        """An install that predates the field cannot send it, and that
        absence is the answer rather than an error."""
        for field in ("native_build", "native_version"):
            self.assertFalse(server.ClientErrorIn.model_fields[field].is_required(),
                             f"{field} must not be required")

    def test_a_report_without_it_is_still_accepted(self):
        payload = server.ClientErrorIn(endpoint="/push-register")
        self.assertIsNone(payload.native_build)

    def test_it_is_written_and_served(self):
        src = code_only(read("backend", "server.py"))
        self.assertIn('"native_build": (payload.native_build or "")[:32]', src)
        self.assertIn('item["native_build"] = item.get("native_build") or ""', src)

    def test_it_is_bounded_like_the_others(self):
        # Client-supplied, so it is truncated rather than trusted.
        self.assertIn("[:32]", code_only(read("backend", "server.py")).split(
            '"native_build"')[1][:60])


class TheClientReadsTheInstalledApp(unittest.TestCase):

    def api(self):
        return code_only(read("frontend", "src", "api.ts"))

    def test_it_asks_expo_application(self):
        self.assertIn("expo-application", self.api())

    def test_it_sends_the_native_build_version(self):
        self.assertIn("Application.nativeBuildVersion", self.api())

    def test_and_the_native_application_version(self):
        self.assertIn("Application.nativeApplicationVersion", self.api())

    def test_the_import_is_lazy_like_the_others(self):
        """A static import of an expo native module at this file's top level
        breaks the `unit` jest project, which runs under node without the
        React Native transforms — and a suite that fails to LOAD contributes
        no failing tests, only a smaller total."""
        source = self.api()
        self.assertIn("await import('expo-application')", source)
        self.assertNotIn("from 'expo-application'", source)

    def test_a_build_that_cannot_answer_still_sends_the_error(self):
        # The stamp must never cost the report.
        source = self.api()
        block = source[source.index("expo-application"):]
        self.assertIn("catch", block[:400])

    def test_expo_application_is_in_the_binary_already(self):
        """This ships over the air, so the module has to be in every build
        that will receive it. Adding a NEW native module here would be the
        outage of 2026-09-15 again."""
        import json
        declared = json.loads(read("frontend", "native-modules.json"))
        self.assertIn("expo-application", declared["nativeDependencies"])


class TheAdminRowNamesTheBuild(unittest.TestCase):
    """A field the server stores and the screen does not show is not a fix."""

    def settings(self):
        return read("frontend", "app", "(tabs)", "settings.tsx")

    def test_the_row_uses_the_build_label(self):
        self.assertIn("buildLabel(e)", code_only(self.settings()))

    def test_the_label_prefers_the_native_build(self):
        label = self.settings()
        body = label[label.index("function buildLabel"):]
        self.assertLess(body.index("native_build"), body.index("app_version"))

    def test_an_app_version_without_a_build_is_marked_as_such(self):
        """Not shown as if it were a build number. That is the mistake this
        whole change exists to correct."""
        self.assertIn("build unknown", self.settings())

    def test_nothing_at_all_still_reads_as_unknown(self):
        self.assertIn("unknown build", self.settings())


class TheOldFieldIsNotTreatedAsABuild(unittest.TestCase):
    """The failure was not a missing field — it was a present one that read
    like an answer. app_version stays (it says which BUNDLE), but nothing may
    present it as the build again."""

    def test_the_row_no_longer_prints_app_version_directly(self):
        row = code_only(read("frontend", "app", "(tabs)", "settings.tsx"))
        self.assertNotIn("${e.app_version || 'unknown build'}", row)


if __name__ == "__main__":
    unittest.main()
