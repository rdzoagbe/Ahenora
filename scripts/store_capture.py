"""Capture clean phone-viewport screenshots of the new (Option A) app for the
Play Store listing. Drives the existing docs/app export, intercepting /api/**
to a local backend seeded with a lively household so the screens look real.

Usage: python3 scripts/store_capture.py <web_port> <api_port> <out_dir> [lang]

`lang` (default "en") seeds language-appropriate content and flips the user's
language server-side via PATCH /auth/language, so the whole UI chrome renders
in that language for a localised store listing (e.g. fr-FR).
"""
import asyncio, json, sys, urllib.request, uuid
from datetime import datetime, timedelta, timezone
from playwright.async_api import async_playwright
from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
OUT = sys.argv[3]
LANG = sys.argv[4] if len(sys.argv) > 4 else "en"

SCALE = 3  # deviceScaleFactor -> 390x844 logical => 1170x2532 image

# Per-language seed content. The kid names (Ama, Leo) and admin name (Jordan)
# read naturally in every locale, so only the free-text content is translated.
CONTENT = {
    "en": {
        "rewards": [("Ice cream", 10, "🍦"), ("Movie night", 25, "🎬"),
                    ("Extra screen time", 15, "🎮"), ("Trip to the zoo", 60, "🦁")],
        "tasks": [("Tidy your room", "Ama"), ("Finish homework", "Leo"),
                  ("Grocery run", "Jordan"), ("Pack school lunches", "Jordan"),
                  ("Walk the dog", "Ama"), ("Book dentist for Ama", "Jordan"),
                  ("Sign school permission slip", "Jordan")],
        # Icons come from the app's own catalogue (backend/card_icons.py); any other
        # glyph is refused with "Unknown icon".
        "chores": [("Tidy your room", "🧹", "Ama", 5), ("Feed the dog", "🐶", "Ama", 3),
                   ("Help with dinner", "🍳", "Ama", 4), ("Take the bins out", "🗑️", "Leo", 5),
                   ("Homework done", "📚", "Leo", 3)],
        "vault": [("Passports", "Legal"), ("Home insurance", "Insurance")],
        "events": [("Soccer practice", 0, "Leo"), ("Dentist appointment", 1, "Ama"),
                   ("Parent-teacher meeting", 2, "Jordan"), ("Swim class", 3, "Ama"),
                   ("Family movie night", 4, "Jordan")],
        "dinners": [("monday", "Spaghetti Bolognese"), ("tuesday", "Taco night"),
                    ("wednesday", "Veggie stir-fry"), ("thursday", "Chicken curry"),
                    ("friday", "Homemade pizza"), ("saturday", "Grilled salmon"),
                    ("sunday", "Roast dinner")],
    },
    "fr": {
        "rewards": [("Glace", 10, "🍦"), ("Soirée cinéma", 25, "🎬"),
                    ("Temps d'écran en plus", 15, "🎮"), ("Sortie au zoo", 60, "🦁")],
        "tasks": [("Range ta chambre", "Ama"), ("Finis tes devoirs", "Leo"),
                  ("Faire les courses", "Jordan"), ("Préparer les déjeuners", "Jordan"),
                  ("Promener le chien", "Ama"), ("RDV dentiste pour Ama", "Jordan"),
                  ("Signer l'autorisation scolaire", "Jordan")],
        "chores": [("Ranger ta chambre", "🧹", "Ama", 5), ("Nourrir le chien", "🐶", "Ama", 3),
                   ("Aider pour le dîner", "🍳", "Ama", 4), ("Sortir les poubelles", "🗑️", "Leo", 5),
                   ("Devoirs faits", "📚", "Leo", 3)],
        "vault": [("Passeports", "Legal"), ("Assurance habitation", "Insurance")],
        "events": [("Entraînement de foot", 0, "Leo"), ("Rendez-vous dentiste", 1, "Ama"),
                   ("Réunion parents-profs", 2, "Jordan"), ("Cours de natation", 3, "Ama"),
                   ("Soirée film en famille", 4, "Jordan")],
        "dinners": [("monday", "Spaghetti bolognaise"), ("tuesday", "Soirée tacos"),
                    ("wednesday", "Sauté de légumes"), ("thursday", "Curry de poulet"),
                    ("friday", "Pizza maison"), ("saturday", "Saumon grillé"),
                    ("sunday", "Rôti du dimanche")],
    },
}


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


def seed():
    c = CONTENT[LANG]
    # Unique per language: the capture is run once per locale against one
    # backend, and a fixed address made the second run die on 409 Conflict.
    u = api("POST", "/auth/register",
            {"name": "Jordan", "email": f"e2e-admin-{LANG}@sim.test",
             "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    # Flip the account's language so the whole UI renders localised.
    if LANG != "en":
        api("PATCH", "/auth/language", {"language": LANG}, tok)

    # Kids with stars — a bank from before, and a week in progress, because
    # the child's page is the first store screenshot and "0 this week" sold
    # nothing. The chores are what the page is about; the stars this week are
    # what a parent sees first.
    ama = api("POST", "/family/members", {"name": "Ama", "role": "Child",
                                          "starting_stars": 42, "pin": "1234"}, tok)
    leo = api("POST", "/family/members", {"name": "Leo", "role": "Child",
                                          "starting_stars": 28, "pin": "5678"}, tok)
    for title, icon, who, stars in c["chores"]:
        member = ama if who == "Ama" else leo
        api("POST", "/chores", {"title": title, "icon": icon, "frequency": "daily",
                                "assigned_members": [member["member_id"]],
                                "star_reward": stars}, tok)
    for member, delta, reason in ((ama, 5, c["chores"][0][0]), (ama, 3, c["chores"][1][0]),
                                  (ama, 4, c["chores"][2][0]), (leo, 5, c["chores"][3][0])):
        api("POST", f"/family/members/{member['member_id']}/stars",
            {"delta": delta, "reason": reason}, tok)
    # Rewards
    for title, cost, icon in c["rewards"]:
        api("POST", "/rewards", {"title": title, "cost_stars": cost, "icon": icon}, tok)
    # Tasks (shared so they populate the shared feed)
    for title, who in c["tasks"]:
        api("POST", "/cards", {"type": "TASK", "title": title,
                               "assignee": who, "shared": True}, tok)
    # A vault document — this completes the 3rd "getting started" step so the
    # onboarding checklist auto-hides and the Feed shows a real, lived-in list.
    for title, cat in c["vault"]:
        api("POST", "/vault", {"title": title, "category": cat,
                               "image_base64": "x", "mime_type": "image/jpeg"}, tok)
    # Calendar events across the week
    now = datetime.now(timezone.utc).replace(hour=15, minute=0, second=0, microsecond=0)
    for title, days, who in c["events"]:
        due = (now + timedelta(days=days)).isoformat()
        # APPOINTMENT, not EVENT: the server retired EVENT as a card type and
        # refused the seed with 400, which nothing caught until the next listing.
        # time_set: the clock time was chosen, so the feed shows "3:00 PM"
        # rather than "All day" (the server stores an unsent flag as false).
        api("POST", "/cards", {"type": "APPOINTMENT", "title": title, "assignee": who,
                               "due_date": due, "shared": True, "time_set": True}, tok)
    # Meals for the week (admin unlocks meal_planner)
    for day, title in c["dinners"]:
        try:
            api("POST", "/meals", {"day": day, "meal_type": "dinner", "title": title,
                                   "ingredients": [], "notes": ""}, tok)
        except Exception as e:
            print("meal seed skipped", day, e)
    return tok


async def main():
    tok = seed()
    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        ctx = await br.new_context(viewport={"width": 390, "height": 844},
                                   device_scale_factor=SCALE)
        p = await ctx.new_page()

        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json",
                             body=await resp.body())
        await p.route("**/api/**", route)
        await p.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")

        async def shot(screen, name, before=None):
            # Verify the page actually RENDERED before photographing it.
            #
            # This did not check, and a misconfigured web root produced six
            # screenshots of "Error 404: File not found" — saved without a
            # single complaint, ready to be uploaded to a store listing. A
            # capture script that cannot tell an app from an error page is
            # worse than one that crashes, because the output looks like work.
            resp = await p.goto(f"{WEB}/{screen}", wait_until="domcontentloaded")
            if resp is not None and resp.status >= 400:
                raise SystemExit(f"{screen}: server returned {resp.status} — "
                                 f"is the web root right? serve_web serves <root>/docs")
            await p.wait_for_timeout(3800)
            body = await p.inner_text("body")
            if "Error code:" in body or "File not found" in body:
                raise SystemExit(f"{screen}: got an error page, not the app")
            # The app always renders its tab bar; an empty React root does not.
            if not await p.query_selector("[data-testid]"):
                raise SystemExit(f"{screen}: page rendered nothing recognisable")
            if before:
                await before()
                await p.wait_for_timeout(1400)
            await p.screenshot(path=f"{OUT}/{name}.png")
            print("captured", name)

        # The kids' week leads (docs/PLAY_STORE_LISTING.md, section 2): it is
        # what Family is paid for, and the first screenshot decides the install.
        async def open_ama():
            # The first-run tip sits over the list; then Ama's own page, the
            # week row, her chores and the stars she has earned this week.
            try:
                await p.click('[data-testid="kids-first-run-tip-got-it"]', timeout=3000)
            except Exception:
                pass
            await p.click("text=Ama")
        await shot("kids", "01-kids", before=open_ama)

        async def settle_feed():
            # The trial's thank-you card sits at the foot of the feed on this
            # seeded household. "Got it" closes it for good; the page is then
            # loaded again so the screenshot is the feed a family lives with.
            try:
                await p.click('[data-testid="trial-thanks-ok"]', timeout=3000)
                await p.goto(f"{WEB}/feed", wait_until="domcontentloaded")
                await p.wait_for_timeout(3000)
            except Exception:
                pass
        await shot("feed", "02-feed", before=settle_feed)
        await shot("calendar", "03-calendar")

        async def open_meal_planner():
            # Kitchen opens on the shopping list; switch to the meal planner,
            # which is the seeded weekly plan and the stronger store screen.
            #
            # The old kitchen-switch / kitchen-pick-meal pair went away when the
            # Kitchen was rebuilt around three tabs (list / meals / spending).
            # Nothing caught it, because this script is run by hand at listing
            # time rather than by the harness runner — so it stayed broken from
            # the redesign until the next time somebody needed screenshots.
            await p.click('[data-testid="kitchen-tab-meal"]')
            await p.wait_for_timeout(600)
        await shot("kitchen", "04-kitchen", before=open_meal_planner)

        # The picker lives in each screen's own header now, so shoot it where
        # it actually is — the Feed's add is its capture bar.
        async def open_quickadd():
            await p.click('[data-testid="tab-add"]')
        await shot("calendar", "05-quickadd", before=open_quickadd)

        async def open_household():
            await p.click('[data-testid="tab-more"]')
        await shot("feed", "06-household", before=open_household)

        await br.close()
    print("DONE")


asyncio.run(main())
