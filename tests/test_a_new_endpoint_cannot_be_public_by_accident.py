"""Every route requires a signed-in caller, unless it is listed here with a reason.

Roland asked how to prepare for the conversation where somebody asks a solo
founder why their database is readable by the internet. The honest answer is
that you do not prepare by being careful — nobody is careful at 1am — you
prepare by making the build refuse the mistake.

This is that refusal for the most common version of it: an endpoint shipped
without `Depends(require_user)`. It is a one-line omission, it looks exactly
like a working endpoint in every manual test you would think to run (your own
app sends a token, so YOU never see the hole), and it hands a stranger a
family's calendar, shopping list, or children's names.

So: every route in server.py must take one of the auth dependencies, or appear
in PUBLIC_ROUTES below with a written reason. Adding a public endpoint is
allowed. Adding one SILENTLY is not.

A note on why this file is defensive about its own parser
---------------------------------------------------------
A test that parses source can fail in the one way that matters least visibly:
find nothing and pass. The first version of this check used
`async def \\w+\\(([^)]*)\\)` to grab a handler's signature — and `[^)]*` stops
at the first `)`, which is the one inside `Depends(require_user)`. Every
signature came back truncated, the auth dependency was invisible, and it
reported 34 wide-open endpoints that were all perfectly well guarded.

The second version handled parentheses correctly and still silently skipped
`/api/health`, because that one route is declared with `@app.api_route(...)`
rather than `@app.get(...)`.

Both mistakes fail toward silence. So this file guards itself: it pins a floor
on the number of routes found, keeps a canary for every decorator form, and
fails on any `@app.<something>` it does not recognise — because the next
decorator form somebody reaches for is exactly where the next hole hides.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import re
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
SERVER = os.path.join(ROOT, "backend", "server.py")

# Dependencies that establish WHO is calling. `require_feature` is deliberately
# not here: it gates a paid plan, takes an already-authenticated user, and is
# called in a handler body rather than as a dependency. Counting it as auth
# would let a plan check masquerade as a login check.
AUTH_DEPENDENCIES = (
    "require_user",          # any signed-in account
    "require_full_member",   # parent/co-parent only (helpers refused)
    "require_teen",          # teen token
    "require_child",         # kid-mode token
    "require_chat_account",  # any account that may use chat
)

# `@app.<attr>` forms that declare a route, and the ones that do not. Anything
# outside both sets fails the build rather than being quietly ignored.
ROUTE_DECORATORS = ("get", "post", "put", "patch", "delete", "api_route")
NON_ROUTE_DECORATORS = (
    "on_event",
    # Registers a handler for exceptions raised by other routes. It serves no
    # URL of its own, so there is nothing here to authenticate — but it had to
    # be classified, which is the point of the unknown-decorator check.
    "exception_handler",
)

# One route per decorator form that must always be found. If a canary goes
# missing, the parser has stopped understanding that form — which is the
# failure that would otherwise make this whole file pass while seeing nothing.
CANARIES = {
    "get": "/api/cards",
    "post": "/api/auth/login",
    "put": None,
    "patch": "/api/vault/{doc_id}/expiry",
    "delete": None,
    "api_route": "/api/health",
}

# Routes that are public ON PURPOSE. The reason is the point: it is what a
# reviewer reads, and what makes adding a new entry a decision rather than a
# reflex. Keep it to why a stranger may call this and what limits the damage.
PUBLIC_ROUTES = {
    ("GET", "/"):
        "Root banner. Returns no data about anybody.",
    ("GET", "/api/health"):
        "Liveness probe for uptime monitoring. Pings the database and reports "
        "up/down only — no household data.",
    ("GET", "/api/app/version-info"):
        "The current app version, so an old build can tell itself to update. "
        "Identical for every caller.",
    ("GET", "/api/notifications/web-config"):
        "The PUBLIC VAPID key. It is public by design — it ships inside every "
        "web bundle and can only be used to encrypt a push TO this service.",
    ("GET", "/api/billing/stripe/config"):
        "The Stripe publishable key. Public by design, same as the VAPID key.",

    # Sign-in. These have to be reachable by someone with no session yet.
    ("POST", "/api/auth/register"): "Creating the account that auth requires.",
    ("POST", "/api/auth/login"): "Exchanging a password for a session.",
    ("POST", "/api/auth/session"): "Exchanging a Google id_token for a session.",
    ("POST", "/api/auth/apple"): "Exchanging an Apple identity token for a session.",
    ("POST", "/api/auth/request-password-reset"):
        "Locked-out by definition. Rate-limited, and answers the same whether "
        "or not the address exists, so it cannot be used to enumerate users.",
    ("POST", "/api/auth/reset-password"):
        "Locked-out by definition. The emailed code is the credential.",

    # Signature-verified machine callers. Public because the provider has no
    # session; safe because an unsigned request is refused.
    ("POST", "/api/billing/stripe/webhook"):
        "Stripe. HMAC-verified against STRIPE_WEBHOOK_SECRET with a timestamp, "
        "so an unsigned or replayed request is refused.",
    ("POST", "/api/billing/revenuecat-webhook"):
        "RevenueCat. Constant-time compare against RC_WEBHOOK_SECRET.",

    # Capability links: the unguessable token IS the credential, so that a
    # person who has not joined the household yet can still open the page.
    ("GET", "/api/family/invite/{token}"):
        "Opening an invitation before you have an account. token_urlsafe.",
    ("GET", "/api/pot/{token}"):
        "A gift pot shared with someone outside the household.",
    ("POST", "/api/pot/{token}/join"):
        "Contributing to that pot without joining the household.",
    ("GET", "/api/ops/error-budget"):
        "Polled hourly by the error-watch workflow, which has no account to "
        "sign in with. Constant-time compare against OPS_ALERT_TOKEN, the same "
        "shape as the billing webhooks, and 503s when that is unset. Returns "
        "two integers — how many error groups and occurrences in the window — "
        "so a stranger who guessed both the URL and the token learns only "
        "whether something is broken, not what or where.",

    ("GET", "/api/santa/match/{token}"):
        "A Secret Santa match, sent to one person. Deliberately reachable "
        "without an account so a guest can see who they drew.",
}


def routes():
    """Every route in server.py as (METHOD, path, signature).

    Written as an explicit scan rather than a regex because the signature runs
    across lines and contains nested parentheses — see the module docstring for
    what the regex versions of this got wrong.
    """
    with open(SERVER, encoding="utf-8") as handle:
        src = handle.read().split("\n")
    found = []
    i = 0
    while i < len(src):
        decorator = re.match(r'@app\.([a-z_]+)\(\s*"([^"]+)"(.*)$', src[i])
        if not decorator:
            i += 1
            continue
        attr, path, rest = decorator.groups()
        if attr in NON_ROUTE_DECORATORS or attr not in ROUTE_DECORATORS:
            i += 1
            continue

        if attr == "api_route":
            methods = re.findall(r'"(GET|POST|PUT|PATCH|DELETE|HEAD)"', rest)
        else:
            methods = [attr.upper()]

        # Walk to the handler, then take its signature by balancing parens.
        j = i + 1
        while j < len(src) and not re.match(r"\s*(async )?def ", src[j]):
            j += 1
        signature, depth, started = "", 0, False
        while j < len(src):
            for char in src[j]:
                signature += char
                if char == "(":
                    depth += 1
                    started = True
                elif char == ")":
                    depth -= 1
            if started and depth == 0:
                break
            j += 1

        for method in methods:
            if method != "HEAD":   # HEAD rides along with its GET
                found.append((method, path, signature))
        i += 1
    return found


def is_authenticated(signature):
    return any(f"Depends({dep})" in signature for dep in AUTH_DEPENDENCIES)


class TheParserItself(unittest.TestCase):
    """Guards against the only failure that would make this file useless:
    understanding nothing and reporting everything is fine."""

    def test_it_finds_a_plausible_number_of_routes(self):
        # A floor, not an exact count — routes get added. This fails when they
        # start DISAPPEARING, which means the parser broke, not the app.
        self.assertGreaterEqual(len(routes()), 240)

    def test_it_still_understands_every_decorator_form(self):
        found = {(m, p) for m, p, _ in routes()}
        for attr, path in CANARIES.items():
            if path is None:
                continue
            self.assertTrue(any(p == path for _, p in found),
                            f"parser lost the @app.{attr} form: {path} not found")

    def test_an_unknown_decorator_form_is_not_silently_ignored(self):
        """The next hole hides behind the next decorator somebody reaches for.

        If a websocket route, or a sub-router, or anything else appears, this
        fails and asks for a decision — instead of leaving a whole family of
        endpoints outside the check without anyone noticing.
        """
        with open(SERVER, encoding="utf-8") as handle:
            src = handle.read()
        seen = set(re.findall(r"^@app\.([a-z_]+)", src, re.M))
        unknown = seen - set(ROUTE_DECORATORS) - set(NON_ROUTE_DECORATORS)
        self.assertEqual(unknown, set(),
                         f"unrecognised @app decorator(s): {sorted(unknown)}. "
                         "Decide whether each declares a route, then add it to "
                         "ROUTE_DECORATORS or NON_ROUTE_DECORATORS.")

    def test_it_does_not_count_a_plan_gate_as_a_login_gate(self):
        self.assertNotIn("require_feature", AUTH_DEPENDENCIES)


class EveryRouteIsGuarded(unittest.TestCase):

    def test_no_endpoint_is_public_without_a_written_reason(self):
        unguarded = sorted(
            (method, path) for method, path, sig in routes()
            if not is_authenticated(sig) and (method, path) not in PUBLIC_ROUTES)
        self.assertEqual(unguarded, [], "\n\n".join([
            "These routes take no auth dependency and are not on the public list:",
            "\n".join(f"  {m} {p}" for m, p in unguarded),
            "Add Depends(require_user) (or require_full_member / require_teen / "
            "require_child / require_chat_account) to the handler.",
            "If it is genuinely meant to be public, add it to PUBLIC_ROUTES "
            "with a reason saying why a stranger may call it and what limits "
            "the damage.",
        ]))

    def test_the_public_list_has_no_stale_entries(self):
        """A list that outlives its routes stops describing the app.

        Worse: a stale entry silently pre-authorises a path. Delete a route,
        add one back later at the same path, and it would be born public with
        nothing failing.
        """
        live = {(m, p) for m, p, _ in routes()}
        stale = sorted(set(PUBLIC_ROUTES) - live)
        self.assertEqual(stale, [],
                         f"PUBLIC_ROUTES names routes that no longer exist: {stale}")

    def test_every_public_route_carries_a_real_reason(self):
        for key, reason in PUBLIC_ROUTES.items():
            self.assertGreater(len(reason.strip()), 25,
                               f"{key} needs a reason, not a placeholder")

    def test_a_public_route_is_never_also_guarded(self):
        """Being on the list while actually requiring auth is not harmless: it
        is a false record of the app's exposed surface, and the next person
        reads the list rather than the code."""
        for method, path, sig in routes():
            if (method, path) in PUBLIC_ROUTES:
                self.assertFalse(
                    is_authenticated(sig),
                    f"{method} {path} requires auth — take it off PUBLIC_ROUTES")

    def test_the_whole_vault_is_parent_only_including_reads(self):
        """The vault is the one surface where READING is the sensitive act.

        Everywhere else a helper may look and not touch — they use the normal
        app, and a nanny who cannot see who is in the household cannot do the
        job. The vault is different: it holds passports, bank letters and
        medical documents, so `require_full_member` guards every method,
        including GET and the render endpoint.
        """
        for method, path, sig in routes():
            if path.startswith("/api/vault"):
                self.assertIn("require_full_member", sig,
                              f"{method} {path} would let a helper into the vault")

    def test_changing_the_household_roster_stays_parent_only(self):
        """A regression guard on the exact routes, not a guess at a rule.

        A first version of this asserted that everything under
        /api/family/members must be parent-only, and failed on GET — which is
        correct as it stands: reading the roster is open to helpers ON PURPOSE,
        and only mutating it is refused. Writing the rule as a prefix would
        have meant either a false alarm or loosening the check until it said
        nothing. So the surfaces are named.
        """
        parent_only = {
            ("POST", "/api/family/members"),
            ("PATCH", "/api/family/members/{member_id}"),
            ("DELETE", "/api/family/members/{member_id}"),
            ("PUT", "/api/family/members/{member_id}/pin"),
            ("DELETE", "/api/family/members/{member_id}/pin"),
            ("POST", "/api/billing/stripe/checkout"),
            # Medical writes. A helper reads what a child takes; deciding it
            # is a parent's, and this is the row most likely to be acted on
            # by somebody who did not write it.
            ("POST", "/api/family/members/{member_id}/medicines"),
            ("PATCH", "/api/family/members/{member_id}/medicines/{med_id}"),
            ("DELETE", "/api/family/members/{member_id}/medicines/{med_id}"),
            ("POST", "/api/family/members/{member_id}/vaccinations"),
        }
        live = {(m, p): s for m, p, s in routes()}
        for key in sorted(parent_only):
            self.assertIn(key, live, f"{key} no longer exists — update this list")
            self.assertIn("require_full_member", live[key],
                          f"{key[0]} {key[1]} was downgraded to admit helpers")


if __name__ == "__main__":
    unittest.main()
