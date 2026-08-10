"""Capture clean phone-viewport screenshots of the new (Option A) app for the
Play Store listing. Drives the existing docs/app export, intercepting /api/**
to a local backend seeded with a lively household so the screens look real.

Usage: python3 scripts/store_capture.py <web_port> <api_port> <out_dir>
"""
import asyncio, json, sys, urllib.request, uuid
from datetime import datetime, timedelta, timezone
from playwright.async_api import async_playwright
from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/Ahenora/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
OUT = sys.argv[3]

SCALE = 3  # deviceScaleFactor -> 390x844 logical => 1170x2532 image


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


def seed():
    run = uuid.uuid4().hex[:6]
    u = api("POST", "/auth/register",
            {"name": "Jordan", "email": f"e2e-admin@sim.test",
             "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    # Kids with stars
    api("POST", "/family/members", {"name": "Ama", "role": "Child",
                                    "starting_stars": 42, "pin": "1234"}, tok)
    api("POST", "/family/members", {"name": "Leo", "role": "Child",
                                    "starting_stars": 28, "pin": "5678"}, tok)
    # Rewards
    for title, cost, icon in [("Ice cream", 10, "🍦"), ("Movie night", 25, "🎬"),
                              ("Extra screen time", 15, "🎮"), ("Trip to the zoo", 60, "🦁")]:
        api("POST", "/rewards", {"title": title, "cost_stars": cost, "icon": icon}, tok)
    # Tasks (shared so they populate the shared feed)
    for title, who in [("Tidy your room", "Ama"), ("Finish homework", "Leo"),
                       ("Grocery run", "Jordan"), ("Pack school lunches", "Jordan"),
                       ("Walk the dog", "Ama"), ("Book dentist for Ama", "Jordan"),
                       ("Sign school permission slip", "Jordan")]:
        api("POST", "/cards", {"type": "TASK", "title": title,
                               "assignee": who, "shared": True}, tok)
    # A vault document — this completes the 3rd "getting started" step so the
    # onboarding checklist auto-hides and the Feed shows a real, lived-in list.
    for title, cat in [("Passports", "Legal"), ("Home insurance", "Insurance")]:
        api("POST", "/vault", {"title": title, "category": cat,
                               "image_base64": "x", "mime_type": "image/jpeg"}, tok)
    # Calendar events across the week
    now = datetime.now(timezone.utc).replace(hour=15, minute=0, second=0, microsecond=0)
    for title, days, who in [("Soccer practice", 0, "Leo"), ("Dentist appointment", 1, "Ama"),
                            ("Parent-teacher meeting", 2, "Jordan"), ("Swim class", 3, "Ama"),
                            ("Family movie night", 4, "Jordan")]:
        due = (now + timedelta(days=days)).isoformat()
        api("POST", "/cards", {"type": "EVENT", "title": title, "assignee": who,
                               "due_date": due, "shared": True}, tok)
    # Meals for the week (admin unlocks meal_planner)
    dinners = [("monday", "Spaghetti Bolognese"), ("tuesday", "Taco night"),
               ("wednesday", "Veggie stir-fry"), ("thursday", "Chicken curry"),
               ("friday", "Homemade pizza"), ("saturday", "Grilled salmon"),
               ("sunday", "Roast dinner")]
    for day, title in dinners:
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
            await p.goto(f"{WEB}/{screen}", wait_until="domcontentloaded")
            await p.wait_for_timeout(3800)
            if before:
                await before()
                await p.wait_for_timeout(1400)
            await p.screenshot(path=f"{OUT}/{name}.png")
            print("captured", name)

        await shot("feed", "01-feed")
        await shot("calendar", "02-calendar")
        await shot("kids", "03-kids")

        async def open_meal_planner():
            # Kitchen opens on the shopping list; switch to the meal planner,
            # which is the seeded weekly plan and the stronger store screen.
            await p.click('[data-testid="kitchen-switch"]')
            await p.wait_for_timeout(600)
            await p.click('[data-testid="kitchen-pick-meal"]')
        await shot("kitchen", "04-kitchen", before=open_meal_planner)

        async def open_quickadd():
            await p.click('[data-testid="tab-add"]')
        await shot("feed", "05-quickadd", before=open_quickadd)

        async def open_household():
            await p.click('[data-testid="feed-household-menu"]')
        await shot("feed", "06-household", before=open_household)

        await br.close()
    print("DONE")


asyncio.run(main())
