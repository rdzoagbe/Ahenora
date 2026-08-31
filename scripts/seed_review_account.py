"""Create (or refresh) the App Store / Play review demo account.

Apple rejects a login-gated app it cannot sign into, and an EMPTY account is
nearly as bad: a reviewer who sees a blank Feed reports that they could not
evaluate the app. So this builds a household that looks lived-in — kids with
stars, a week of tasks and events, meals, a vault document — and grants it the
top tier so every gated feature is reachable.

The entitlement is granted with the `grandfathered` flag, NOT by adding the
address to ADMIN_EMAILS. Both would unlock the top plan; only the second would
also hand every /api/admin route — subscriber list, billing events, dedupe
tools — to credentials that get typed into a form at Apple and sit in a review
queue.

The existing smoke accounts are no use for this: they self-purge, and they live
on a .smoke domain that could never receive mail.

Usage (admin session token — works whatever sign-in method the admin uses):

    python3 scripts/seed_review_account.py \\
        --api https://household-coo-production.up.railway.app/api \\
        --admin-token 'PASTE_TOKEN' \\
        --review-email appreview@ahenora.com --review-password '...'

Get the token by signing in at https://ahenora.com/app as the admin, then in
the browser devtools console:

    localStorage.getItem('coo_session_token')

--admin-email with --admin-password still works for a password account.

Re-running is safe: if the review account already exists it signs in instead of
registering, and seeding skips anything already there.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone


def call(api, method, path, body=None, token=None, allow=()):
    req = urllib.request.Request(
        f"{api}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
        method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        if e.code in allow:
            return None
        detail = e.read().decode()[:300]
        raise SystemExit(f"{method} {path} -> {e.code}: {detail}")


# Names that read naturally in every language the app speaks, so one seeded
# household serves an English, French, Spanish or German reviewer alike.
KIDS = [("Ama", 42, "1234"), ("Leo", 28, "5678")]
REWARDS = [("Ice cream", 10, "🍦"), ("Movie night", 25, "🎬"),
           ("Extra screen time", 15, "🎮"), ("Trip to the zoo", 60, "🦁")]
TASKS = [("Tidy your room", "Ama"), ("Finish homework", "Leo"),
         ("Grocery run", "Jordan"), ("Pack school lunches", "Jordan"),
         ("Walk the dog", "Ama"), ("Book dentist for Ama", "Jordan")]
EVENTS = [("Soccer practice", 0, "Leo"), ("Dentist appointment", 1, "Ama"),
          ("Parent-teacher meeting", 2, "Jordan"), ("Swim class", 3, "Ama"),
          ("Family movie night", 4, "Jordan")]
DINNERS = [("monday", "Spaghetti Bolognese"), ("tuesday", "Taco night"),
           ("wednesday", "Veggie stir-fry"), ("thursday", "Chicken curry"),
           ("friday", "Homemade pizza"), ("saturday", "Grilled salmon"),
           ("sunday", "Roast dinner")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True, help="e.g. https://host/api")
    # Two ways to authenticate as an admin, because a founder who signs in with
    # Google has no password to give: /auth/login answers "No password account
    # found for this email. Try Google sign-in." A session token works for any
    # sign-in method, and keeps a password off the command line and out of shell
    # history either way.
    # A session token can begin with "-", and argparse then reads it as another
    # flag no matter how it is quoted. AHENORA_ADMIN_TOKEN avoids that entirely,
    # and keeps a live credential out of shell history where it would otherwise
    # sit for as long as the history file does.
    ap.add_argument("--admin-token",
                    default=os.environ.get("AHENORA_ADMIN_TOKEN", ""),
                    help="session token; or set AHENORA_ADMIN_TOKEN instead")
    ap.add_argument("--admin-email")
    ap.add_argument("--admin-password")
    ap.add_argument("--review-email", required=True)
    ap.add_argument("--review-password", required=True)
    a = ap.parse_args()
    api = a.api.rstrip("/")

    # Checked FIRST, before anything is created. The original order registered
    # the review account and only then tried to authenticate as admin — so a
    # wrong admin credential left a real, half-made account on production that
    # a re-run then could not sign into. Fail before touching anything.
    if not a.admin_token and not (a.admin_email and a.admin_password):
        raise SystemExit(
            "Need --admin-token, or --admin-email with --admin-password.\n"
            "To get a token: sign in at https://ahenora.com/app as the admin,\n"
            "open the browser devtools console and run:\n"
            "    localStorage.getItem('coo_session_token')")
    # A prefix list is the wrong shape for this: the first version checked
    # YOUR_/CHOOSE_/PASTE_ and then the instructions said PICK_A_REAL_ONE, which
    # sailed through and created a real account. Match the SHAPE of a
    # placeholder instead — SCREAMING_SNAKE_CASE is not a password anyone picks.
    import re as _re
    for name, value in (("--review-email", a.review_email),
                        ("--review-password", a.review_password)):
        if _re.fullmatch(r"[A-Z][A-Z0-9]*(_[A-Z0-9]+)+", value) or " " in value:
            raise SystemExit(f"{name} still looks like a placeholder: {value!r}")

    # Prove the admin credential works before creating anything.
    if a.admin_token:
        admin_tok = a.admin_token.strip()
    else:
        admin_tok = call(api, "POST", "/auth/login",
                         {"email": a.admin_email,
                          "password": a.admin_password})["session_token"]
    me = call(api, "GET", "/auth/me", token=admin_tok)
    print("authenticated as", (me or {}).get("email", "?"))

    # 1. The review account itself. Registering a second time returns a
    #    conflict, so fall through to signing in — that is what makes a re-run
    #    safe rather than destructive.
    reg = call(api, "POST", "/auth/register",
               {"name": "Jordan", "email": a.review_email,
                "password": a.review_password}, allow=(400, 409))
    if reg:
        print("registered the review account")
        tok = reg["session_token"]
    else:
        print("review account already existed; signing in")
        tok = call(api, "POST", "/auth/login",
                   {"email": a.review_email, "password": a.review_password})["session_token"]
    call(api, "POST", "/auth/complete-onboarding", {}, tok, allow=(400, 404))

    # 2. Top tier, via the flag that means exactly that and nothing else.
    granted = call(api, "POST", "/admin/grandfather",
                   {"email": a.review_email, "grandfathered": True}, admin_tok)
    print("entitlement:", granted)

    # 3. Content. Every step tolerates "already there" so a re-run tops up
    #    rather than duplicating or dying.
    existing = {c.get("title") for c in (call(api, "GET", "/cards", token=tok) or [])}
    members = {m.get("name") for m in (call(api, "GET", "/family/members", token=tok) or [])}

    for name, stars, pin in KIDS:
        if name in members:
            continue
        call(api, "POST", "/family/members",
             {"name": name, "role": "Child", "starting_stars": stars, "pin": pin},
             tok, allow=(400, 402, 409))
    for title, cost, icon in REWARDS:
        call(api, "POST", "/rewards", {"title": title, "cost_stars": cost, "icon": icon},
             tok, allow=(400, 402, 409))
    for title, who in TASKS:
        if title in existing:
            continue
        call(api, "POST", "/cards",
             {"type": "TASK", "title": title, "assignee": who, "shared": True}, tok)
    now = datetime.now(timezone.utc).replace(hour=15, minute=0, second=0, microsecond=0)
    for title, days, who in EVENTS:
        if title in existing:
            continue
        call(api, "POST", "/cards",
             {"type": "EVENT", "title": title, "assignee": who, "shared": True,
              "due_date": (now + timedelta(days=days)).isoformat()}, tok)
    # A vault document also completes the third onboarding step, so the reviewer
    # sees a working Feed rather than a getting-started checklist.
    call(api, "POST", "/vault",
         {"title": "Passports", "category": "Legal",
          "image_base64": "x", "mime_type": "image/jpeg"}, tok, allow=(400, 402, 409))
    for day, title in DINNERS:
        call(api, "POST", "/meals",
             {"day": day, "meal_type": "dinner", "title": title,
              "ingredients": [], "notes": ""}, tok, allow=(400, 402, 409))

    sub = call(api, "GET", "/subscription", token=tok) or {}
    print("\nReview account ready.")
    print(f"  email    : {a.review_email}")
    print(f"  plan     : {sub.get('plan')}  grandfathered={sub.get('grandfathered')}")
    print("\nPaste the email and password into App Store Connect > App Review Information.")
    if not sub.get("grandfathered"):
        print("\nWARNING: the entitlement did not stick — the reviewer will hit paywalls.",
              file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
