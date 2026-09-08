"""An Android build that cannot receive push must not be buildable.

Expo push on Android rides Firebase Cloud Messaging. That needs the
google-services Gradle plugin and app/google-services.json in the build. For
the whole life of the app neither was there: the file was gitignored, the
plugin never applied, and every Android phone silently failed to get a token
while iOS got everything. These checks make that state unbuildable.
"""
import os
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class AndroidPushWiring(unittest.TestCase):
    def test_the_gms_plugin_is_on_the_classpath(self):
        self.assertIn("com.google.gms:google-services", read("frontend", "android", "build.gradle"))

    def test_the_plugin_is_applied_unconditionally(self):
        gradle = read("frontend", "android", "app", "build.gradle")
        self.assertIn('apply plugin: "com.google.gms.google-services"', gradle)
        # Not wrapped in a file-exists check: a build without the file must
        # refuse, not quietly ship a phone that never hears anything.
        idx = gradle.index('apply plugin: "com.google.gms.google-services"')
        self.assertNotIn("exists()", gradle[max(0, idx - 200):idx])

    def test_the_firebase_config_is_not_ignored(self):
        ignore = read(".gitignore")
        self.assertIn("!frontend/android/app/google-services.json", ignore)

    def test_the_runbook_exists_and_names_the_three_steps(self):
        doc = read("docs", "ANDROID_PUSH.md")
        for needle in ("google-services.json", "eas credentials", "eas build"):
            self.assertIn(needle, doc)

    def test_the_phone_reports_a_failed_registration(self):
        src = read("frontend", "src", "notifications.ts")
        self.assertEqual(src.count("reportPushFailure(reg.error)"), 2)
        self.assertIn("export function reportPushFailure", read("frontend", "src", "api.ts"))


if __name__ == "__main__":
    unittest.main()
