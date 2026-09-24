"""Every public promise, checked against the code that has to keep it.

Written after a full audit (September 2026) that read ahenora.com, both store
listing packs, the in-app pricing screen, the privacy policy and the terms
against the code, and found them disagreeing in ways a customer, a store
reviewer or a regulator would care about:

  * the Household plan sold "more than one property" and "priority support",
    neither of which exists anywhere in the code;
  * the app's own pricing screen said 5 AI scans on the free plan and 100 on
    Family, while the server gives 10 and unlimited — the website had it right;
  * one "Save 40%" badge sat over both paid plans, and Household saves 17%;
  * the site promised helpers no access to money or family chat, while every
    pocket-money route let a helper in, and chat always has;
  * the privacy policy said content reaches the AI provider only when you ask,
    while the add-task sheet sent every draft title, and every family member's
    name, to Gemini as it was typed;
  * the policy never mentioned health data, Sign in with Apple, the App Store,
    Stripe, or the contacts a calendar import keeps;
  * the delete button said "Email deletion request" and deleted at once.

Each test names the promise and the code that keeps it, so the next person to
change either one finds out here rather than from a customer.
"""
import asyncio
import html as html_mod
from html.parser import HTMLParser
import os
import re
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from fake_mongo import FakeDatabase
    from fastapi import HTTPException


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class _Text(HTMLParser):
    """The text a reader sees: no scripts, styles or comments.

    A real parser rather than a pattern. Stripping <script> with a regex misses
    an upper-case tag or a spaced closing one, and even here, reading our own
    pages, a helper that looks like HTML filtering should behave like it.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.hidden:
            self.hidden -= 1
        self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def visible(name):
    parser = _Text()
    parser.feed(read("docs", name))
    return re.sub(r"\s+", " ", "".join(parser.parts))


def whole_page(name):
    """Visible text AND the structured FAQ search engines read — a claim
    removed from one and left in the other is still being made."""
    return re.sub(r"\s+", " ", html_mod.unescape(read("docs", name)))


I18N = read("frontend", "src", "i18n.ts")


def app_string(key, lang="en"):
    block = re.search(rf"^const {lang}: Dict = \{{(.*?)^\}};", I18N, re.S | re.M).group(1)
    m = re.search(rf"""^\s*"?{key}"?:\s*(['"`])(.*?)\1,""", block, re.M)
    if not m:
        raise AssertionError(f"i18n {lang} has no {key}")
    return m.group(2)


SERVER = read("backend", "server.py")
SITES = ("index.html", "fr.html")


class NothingIsSoldThatDoesNotExist(unittest.TestCase):
    def test_multiple_properties_are_not_advertised_until_something_uses_the_flag(self):
        gated = re.search(r"require_feature\([^)]*['\"]multi_property['\"]", SERVER)
        if gated:
            self.skipTest("multi_property is gated somewhere now; the claim may return")
        for name in SITES:
            text = whole_page(name).lower()
            for phrase in ("more than one property", "plusieurs logements", "multi-property"):
                self.assertNotIn(phrase, text, name)

    def test_priority_support_is_not_advertised_until_support_knows_the_plan(self):
        # A support ticket that does not record the plan cannot be answered in
        # priority order, so "priority support" is a promise nobody can keep.
        ticket_code = SERVER[SERVER.index('database["support_tickets"]'):][:4000]
        if "plan" in ticket_code:
            self.skipTest("support tickets record the plan now; the claim may return")
        for name in SITES:
            text = whole_page(name).lower()
            self.assertNotIn("priority support", text, name)
            self.assertNotIn("assistance prioritaire", text, name)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheAppsPricingScreenMatchesTheServer(unittest.TestCase):
    def limits(self, plan):
        return server.PLAN_CATALOG[plan]["limits"]

    def test_the_free_scan_allowance(self):
        n = self.limits("village")["ai_scans_per_month"]
        self.assertIn(str(n), app_string("pf_free_6"))

    def test_family_scans_are_unlimited_and_say_so(self):
        self.assertEqual(self.limits("executive")["ai_scans_per_month"], server.AI_SCANS_UNLIMITED)
        self.assertIn("Unlimited", app_string("pf_prem_5"))

    def test_the_vault_sizes(self):
        self.assertEqual(self.limits("executive")["vault_bytes"], 500 * 1024 * 1024)
        self.assertIn("500 MB", app_string("pf_prem_6"))
        self.assertEqual(self.limits("household")["vault_bytes"], 10 * 1024 ** 3)
        self.assertIn("10 GB", app_string("pf_house_5"))

    def test_the_household_card_lists_only_what_family_lacks(self):
        """It said "Unlimited AI scans" and "Document expiry alerts" as extras.
        Family has unlimited scans, and expiry alerts are free for everyone."""
        pricing = read("frontend", "src", "components", "PricingView.tsx")
        card = re.search(r"\n  household: \{\n    icon:.*?features: \[(.*?)\]", pricing, re.S)
        self.assertIsNotNone(card, "no Household card in PricingView")
        keys = re.findall(r"'(pf_house_\d)'", card.group(1))
        self.assertGreaterEqual(len(keys), 4)
        shown = " ".join(app_string(k) for k in keys)
        self.assertNotIn("AI scans", shown)
        self.assertNotIn("expiry", shown.lower())
        self.assertEqual(self.limits("household")["max_members"], 20)
        self.assertIn("20 people", shown)

    def test_one_badge_over_two_savings_says_up_to(self):
        savings = set()
        for plan in ("executive", "household"):
            c = server.PLAN_CATALOG[plan]
            savings.add(round(100 * (c["price_monthly"] * 12 - c["price_yearly"]) / (c["price_monthly"] * 12)))
        if len(savings) > 1:
            self.assertIn("up to", app_string("pricing_save_20").lower())
            self.assertIn(str(max(savings)), app_string("pricing_save_20"))

    def test_no_screen_names_a_plan_that_does_not_exist(self):
        block = re.search(r"^const en: Dict = \{(.*?)^\};", I18N, re.S | re.M).group(1)
        # plan_family_office labels the retired tier that only an admin or
        # tester household is still stored on; no customer can hold it or see it.
        offenders = [line.strip()[:90] for line in block.split("\n")
                     if re.search(r"\bPremium\b|Village|Executive|Family Office", line.split(":", 1)[-1])
                     and not line.strip().startswith("//")
                     and not line.strip().startswith("plan_family_office")]
        self.assertEqual(offenders, [])

    def test_the_server_refusals_name_real_plans(self):
        for text in server.PREMIUM_FEATURE_MESSAGES.values():
            self.assertNotRegex(text, r"\bPremium\b|Executive|Family Office", text)
        self.assertNotIn("Executive and Family Office", SERVER)


class WhatAHelperReaches(unittest.TestCase):
    def test_every_pocket_money_route_refuses_a_helper(self):
        routes = re.findall(r'@app\.\w+\("(/api/allowances[^"]*)"\)\n(?:async )?def \w+\(([^)]*)\)', SERVER)
        self.assertGreaterEqual(len(routes), 7)
        for path, sig in routes:
            self.assertIn("require_full_member", sig, path)

    def test_the_site_says_what_helpers_can_and_cannot_reach(self):
        """Helpers ARE in the family chat (everyone with a login is in the
        household thread), and are kept from documents and money."""
        self.assertIn("return set(by_id)", SERVER)   # household thread = everyone
        en = whole_page("index.html")
        self.assertNotIn("money or family chat", en)
        self.assertIn("the family chat, but not to your documents or your money", en)
        self.assertNotIn("ni à la messagerie familiale", whole_page("fr.html"))

    def test_the_app_hides_pocket_money_from_a_helper(self):
        kids = read("frontend", "app", "(tabs)", "kids.tsx")
        self.assertIn("activeChild && !viewerIsHelper", kids)


class WhatReachesAnAiProvider(unittest.TestCase):
    def test_the_assignee_suggestion_calls_no_ai(self):
        route = SERVER[SERVER.index('@app.post("/api/ai/assign")'):]
        route = route[:route.index("\ndef suggest_assignee_by_name")]
        self.assertNotIn("_gemini", route)

    def test_the_policy_names_the_features_that_do(self):
        policy = visible("privacy.html")
        self.assertIn("only at the moment you ask", policy)
        self.assertIn("does not use an AI provider", policy)

    def test_every_gemini_call_sits_behind_a_route_someone_calls(self):
        """No background job sends content to the AI provider."""
        lines = SERVER.split("\n")
        for i, line in enumerate(lines):
            if re.search(r"await _gemini_(text|vision)\(", line):
                j = i
                while j > 0 and not re.match(r"(async )?def ", lines[j]):
                    j -= 1
                self.assertTrue(lines[j - 1].startswith("@app.post("), (i + 1, lines[j]))


class WhatThePolicyMustSay(unittest.TestCase):
    POLICY = None

    @classmethod
    def setUpClass(cls):
        cls.POLICY = visible("privacy.html")

    def test_health_data_is_declared(self):
        self.assertIn("allergies", SERVER)
        self.assertIn("Health details", self.POLICY)
        self.assertIn("explicit consent", self.POLICY)

    def test_every_way_to_pay_is_named(self):
        for rail in ("App Store", "Google Play", "Stripe", "RevenueCat"):
            self.assertIn(rail, self.POLICY, rail)
        terms = visible("terms.html")
        for rail in ("App Store", "Google Play", "Stripe"):
            self.assertIn(rail, terms, rail)
        self.assertNotIn("Premium", terms)

    def test_sign_in_with_apple_is_named(self):
        self.assertIn("apple_auth", SERVER)
        self.assertIn("Sign in with Apple", self.POLICY)

    def test_the_contacts_a_calendar_import_keeps_are_named(self):
        self.assertIn('database["calendar_contacts"]', SERVER)
        self.assertIn("email addresses of other people invited", self.POLICY)

    def test_the_calendar_screen_does_not_undersell_what_is_read(self):
        self.assertIn("attendees", SERVER)
        self.assertNotIn("only read", app_string("cal_connected_read_only"))

    def test_links_outside_the_household_are_described(self):
        for phrase in ("gift pot link", "Secret Santa link", "never what they are"):
            self.assertIn(phrase, self.POLICY, phrase)


class DeletionSaysWhatItDoes(unittest.TestCase):
    def test_the_button_does_not_call_itself_a_request(self):
        self.assertIn("for real and at once", SERVER)
        for lang in ("en", "es", "fr", "de"):
            label = app_string("del_button", lang).lower()
            for word in ("request", "solicitud", "demande", "antrag"):
                self.assertNotIn(word, label, lang)

    def test_the_web_page_says_in_app_deletion_is_immediate(self):
        page = visible("delete-account.html")
        self.assertIn("at once", page)
        self.assertNotIn("Ahenora Premium", page)
        for place in ("iPhone", "Android", "Card"):
            self.assertIn(place, page)

    def test_the_faq_does_not_promise_the_household_goes_when_a_coparent_stays(self):
        self.assertIn("if nobody else in the household has an account", whole_page("index.html"))
        self.assertIn("si personne d’autre dans le foyer n’a de compte", whole_page("fr.html"))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheSuggestionItself(unittest.TestCase):
    NAMES = ["Arielle", "Isaiah", "Roland", "Ama"]

    def pick(self, text):
        return server.suggest_assignee_by_name(self.NAMES, text)

    def test_a_named_member_is_suggested(self):
        self.assertEqual(self.pick("Arielle's dentist"), "Arielle")
        self.assertEqual(self.pick("dentist for arielle friday"), "Arielle")
        self.assertEqual(self.pick("Ama: piano"), "Ama")

    def test_no_name_no_guess(self):
        self.assertEqual(self.pick("Book the car service"), "")

    def test_two_names_is_nobody_in_particular(self):
        self.assertEqual(self.pick("Pick up Arielle and Isaiah"), "")

    def test_a_name_inside_another_word_does_not_count(self):
        self.assertEqual(self.pick("Isaiahs football"), "")
        self.assertEqual(self.pick("Amazon returns"), "")

    def test_the_route_never_reaches_gemini(self):
        db = FakeDatabase()
        original_db, original_ai = server.get_db, server._gemini_text

        async def forbidden(*a, **k):
            raise AssertionError("the assignee suggestion must not call an AI provider")
        server.get_db = lambda: db
        server._gemini_text = forbidden
        try:
            async def run():
                for n in self.NAMES:
                    await db["family_members"].insert_one({"family_id": "f1", "name": n, "role": "child"})
                payload = server.AiAssignIn(title="Arielle's dentist", description="")
                return await server.ai_assign(payload, user={"family_id": "f1", "user_id": "u1"})
            self.assertEqual(asyncio.run(run()), {"assignee": "Arielle"})
        finally:
            server.get_db, server._gemini_text = original_db, original_ai


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AHelperIsRefusedPocketMoney(unittest.TestCase):
    def test_the_gate_refuses_a_helper_and_admits_a_parent(self):
        async def check(user):
            return await server.require_full_member(user)
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(check({"user_id": "h", "family_id": "f", "is_helper": True}))
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(asyncio.run(check({"user_id": "p", "family_id": "f"}))["user_id"], "p")


if __name__ == "__main__":
    unittest.main()
