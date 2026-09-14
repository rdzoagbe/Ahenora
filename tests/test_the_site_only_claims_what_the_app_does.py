"""Marketing copy checked against the code that has to honour it.

Roland: "check what we propose, how it's proposed based on the app built, and
confirm we are not saying anything that isn't there and making false
statements to our users."

Seven things were wrong. Three I had written that morning, three had been on
the pricing page for a while, and one was in the privacy policy.

The pattern in all of them is the same, and it is worth naming because it is
not carelessness: every false claim was a REASONABLE-SOUNDING sentence that
nobody could check without opening the server. "Servers in the EU" sounds like
something a European app would say. "Up to 5 children and caregivers" sounds
like what a middle tier offers. Prose does not fail a build.

So the claims that cost a user money, or that a regulator would read, are
pinned here against the values they describe. Not every sentence on the site —
a test suite that pinned the whole homepage would be rewritten with every copy
change and would stop meaning anything. These are the load-bearing ones.

Run with:  python3 -m unittest discover -s tests -v
"""
import html as html_mod
import json
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


def page(name):
    return open(os.path.join(ROOT, "docs", name), encoding="utf-8").read()


def visible(name):
    """The page as a reader meets it: no scripts, styles or comments."""
    s = re.sub(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", "", page(name), flags=re.S)
    return re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", s)))


def plan_card(name, heading):
    """Just one pricing card's text.

    Scoped on purpose. A first version asserted that "aidants" appeared
    nowhere on the French page — but it appears correctly on the HOUSEHOLD
    card, where carer accounts really do exist. A whole-page search cannot
    tell a true claim from a false one when the same word belongs on one card
    and not another.
    """
    s = re.sub(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", "", page(name), flags=re.S)
    cards = re.split(r"<h3>", s)
    for card in cards[1:]:
        if card.startswith(heading):
            return re.sub(r"\s+", " ", html_mod.unescape(re.sub(r"<[^>]+>", " ", card)))
    raise AssertionError(f"{name}: no plan card headed {heading!r}")


def money(value, lang):
    """6.99 in English, 6,99 in French — the page is localised, the test has
    to be too, or it pins the English page and waves the French one through."""
    return f"{value:.2f}".replace(".", "," if lang == "fr" else ".")


def faq_answers(name):
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>',
                            page(name), re.S):
        data = json.loads(block)
        if data.get("@type") == "FAQPage":
            return [q["acceptedAnswer"]["text"] for q in data["mainEntity"]]
    raise AssertionError(f"{name}: no FAQPage")


PAGES = ("index.html", "fr.html")


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ThePricesAndLimits(unittest.TestCase):
    """Numbers on the page against PLAN_CATALOG."""

    def plan(self, key):
        return server.PLAN_CATALOG[key]

    def test_the_advertised_prices_are_the_charged_prices(self):
        for key, heading_en, heading_fr in (("executive", "Premium", "Premium"),
                                            ("household", "Household", "Foyer")):
            charged = self.plan(key)["price_monthly"]
            for name, heading, lang in (("index.html", heading_en, "en"),
                                        ("fr.html", heading_fr, "fr")):
                card = plan_card(name, heading)
                self.assertIn(money(charged, lang), card, (key, name))

    def test_the_advertised_yearly_saving_is_arithmetic(self):
        # Two different savings on two cards, which is why the page shows them
        # per card rather than one badge over the toggle.
        for key, saving, pct in (("executive", "33.89", "40"), ("household", "29.89", "17")):
            plan = self.plan(key)
            real = plan["price_monthly"] * 12 - plan["price_yearly"]
            self.assertEqual(f"{real:.2f}", saving, key)
            self.assertEqual(str(round(100 * real / (plan["price_monthly"] * 12))), pct, key)

    def test_the_child_limits_are_the_enforced_ones(self):
        self.assertEqual(self.plan("village")["limits"]["max_children"], 2)
        self.assertEqual(self.plan("executive")["limits"]["max_children"], 5)
        self.assertEqual(self.plan("household")["limits"]["max_children"], 10)

    def test_two_adults_is_the_real_cap_on_every_plan(self):
        # The free card says "up to two adults". That is not a plan limit at
        # all — MAX_PARENTS is global, so it is true of every tier.
        self.assertEqual(server.MAX_PARENTS, 2)

    def test_the_household_vault_really_is_ten_gigabytes(self):
        self.assertEqual(self.plan("household")["limits"]["vault_bytes"], 10 * 1024 ** 3)
        self.assertIn("10 GB", visible("index.html"))

    def test_the_free_vault_and_scan_allowance_match_the_faq(self):
        self.assertEqual(self.plan("village")["limits"]["vault_bytes"], 25 * 1024 * 1024)
        self.assertEqual(self.plan("village")["limits"]["ai_scans_per_month"], 10)
        self.assertIn("25 MB", faq_answers("index.html")[0])
        self.assertIn("25 Mo", faq_answers("fr.html")[0])


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatEachTierActuallyBuys(unittest.TestCase):
    """The features a paid card promises, against the flags that gate them."""

    def test_premium_does_not_promise_helper_accounts(self):
        """The middle card said "Up to 5 children and caregivers".

        require_feature("helper_accounts") is Household-only — the server's own
        refusal reads "Helper and carer accounts are available on the Household
        plan". Somebody paid 6.99 for a nanny account they could not create.
        """
        self.assertFalse(server.PLAN_CATALOG["executive"]["limits"]["helper_accounts"])
        for name, word in (("index.html", "caregivers"), ("fr.html", "aidants")):
            self.assertNotIn(word, plan_card(name, "Premium"), name)

    def test_the_household_card_may_still_offer_them(self):
        # The same word on the Household card is a true claim, and a guard
        # that banned it everywhere would have forced it off the one tier
        # that has the feature.
        self.assertTrue(server.PLAN_CATALOG["household"]["limits"]["helper_accounts"])
        self.assertIn("Helper", plan_card("index.html", "Household"))
        self.assertIn("aidants", plan_card("fr.html", "Foyer"))

    def test_helpers_are_described_as_the_household_plan_in_the_faq(self):
        self.assertTrue(server.PLAN_CATALOG["household"]["limits"]["helper_accounts"])
        self.assertIn("Household plan", " ".join(faq_answers("index.html")))
        self.assertIn("formule Foyer", " ".join(faq_answers("fr.html")))

    def test_everything_premium_lists_is_switched_on_for_premium(self):
        for flag in ("meal_planner", "allowance", "carpool", "weekly_report"):
            self.assertTrue(server.PLAN_CATALOG["executive"]["limits"][flag], flag)

    def test_the_page_does_not_claim_features_are_never_metered(self):
        """It used to say "never on the features that keep your family
        coordinated" — directly above a table metering six of them."""
        for name in PAGES:
            self.assertNotIn("never on the features", visible(name), name)
            self.assertNotIn("jamais les fonctionnalités", visible(name), name)


class WhereTheDataGoes(unittest.TestCase):
    """The claims a regulator would read, against the privacy policy."""

    def test_the_faq_does_not_promise_eu_only_hosting(self):
        """The FAQ said "On servers in the EU."

        The privacy policy says the opposite in as many words: "Our providers
        may process data outside your country." Two documents on one site
        disagreeing about where a family's data lives is worse than either one
        being vague.
        """
        self.assertIn("may process data outside your country", visible("privacy.html"))
        for name in PAGES:
            joined = " ".join(faq_answers(name))
            self.assertNotIn("servers in the EU", joined, name)
            self.assertNotIn("serveurs dans l'Union", joined, name)

    def test_the_faq_points_at_the_policy_for_transfers(self):
        for name in PAGES:
            self.assertIn("privacy.html", page(name), name)

    def test_the_faq_does_not_claim_scans_are_discarded(self):
        """It said a scan "is not kept afterwards unless you save the document
        to the vault yourself".

        create_card stores image_base64 on the card the scan produced, and the
        policy lists "scanned images" among the content we hold.
        """
        self.assertIn("scanned images", visible("privacy.html"))
        for name in PAGES:
            joined = " ".join(faq_answers(name))
            self.assertNotIn("not kept afterwards", joined, name)
            self.assertNotIn("n'est pas conservé ensuite", joined, name)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WhatATeenSees(unittest.TestCase):
    """The policy promised a boundary the server does not draw.

    It said a teen sees "nothing else about the household — not the family
    calendar". _teen_can_see returns True for any SHARED card, so a teen sees
    the household's shared events, and the homepage advertises exactly that.
    The code is intentional; the policy sentence was wrong, and it was framed
    as "a promise we make to the teenager as much as to the parent".
    """

    def test_a_teen_sees_shared_cards(self):
        shared = {"shared": True, "assignee": "", "created_by_user_id": "someone"}
        self.assertTrue(server._teen_can_see(shared, "teen", "t1"))

    def test_a_teen_does_not_see_another_members_private_card(self):
        private = {"shared": False, "assignee": "", "created_by_user_id": "someone"}
        self.assertFalse(server._teen_can_see(private, "teen", "t1"))

    def test_the_policy_no_longer_denies_the_shared_calendar(self):
        text = visible("privacy.html")
        self.assertNotIn("not the family calendar", text)
        self.assertIn("the events the household has shared with everyone", text)


class HowSomebodyPays(unittest.TestCase):
    """iOS buys through the App Store, and the page said otherwise."""

    def test_the_app_uses_native_billing_on_ios(self):
        billing = open(os.path.join(ROOT, "frontend", "src", "billing.ts"),
                       encoding="utf-8").read()
        self.assertIn("appl_", billing)

    def test_the_page_does_not_send_iphone_buyers_to_the_web(self):
        """PricingView refuses to steer an iOS buyer anywhere outside the app —
        guideline 3.1.1, with its own test. The website then told them to pay
        by card on the web, which is not how an iPhone subscription works."""
        for name in PAGES:
            self.assertNotIn("including on iPhone", visible(name), name)
            self.assertNotIn("y compris sur iPhone", visible(name), name)

    def test_the_page_names_both_stores(self):
        for name, store in (("index.html", "App Store"), ("fr.html", "App Store")):
            self.assertIn(store, visible(name), name)


if __name__ == "__main__":
    unittest.main()
