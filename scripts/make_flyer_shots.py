"""Photograph the real app for the flyers.

The printed flyer shows three phones running the actual product, and it is
the most persuasive thing on the page — you can see the household before you
have one. Mock-ups drawn in a design tool cannot do that honestly, because
they show a version of the app that does not exist.

So these are screenshots of the app, taken against a seeded backend that
looks like a household two weeks in: a co-parent, a child, tasks with real
dates, a shopping list, documents, stars owed. An empty account photographs
as an empty account.

Run this with a web build already exported and a backend already up — or let
make_flyers.py drive it, which is the usual path.

Usage:  python3 scripts/make_flyer_shots.py <web_port> <api_port>
"""
import asyncio
import json
import os
import sys
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_browser import launch_chromium  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
OUT = os.path.join(ROOT, "docs", "store-assets", "tiktok", "shots")

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

# Which screen tells which story. Five different screens rather than five of
# the feed: the flyers are a set, and a set that shows one screen five times
# is advertising one screen.
SHOTS = {
    "feed": "1-mental-load",
    "vault": "2-privacy",
    "calendar": "3-handoff",
    "kitchen": "4-offline",
    "kids": "5-kid-mode",
}

# A plain 8x8 swatch in the app's own line colour. The vault renders a
# thumbnail per document, and what matters in a photograph of the screen is
# that documents exist — not what is in them. It has to be neutral, though:
# an earlier "grey" pixel was actually bright green, and five green squares
# down the side of the vault is the first thing anyone would look at.
PIXEL = ("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSnc"
         "AAAAFUlEQVR4nGN89vAWAzbAhFV00EoAAA+4ArGkaFy+AAAAAElFTkSuQmCC")


def call(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
        method=method)
    with urllib.request.urlopen(req, timeout=25) as res:
        return json.loads(res.read().decode() or "{}")


def iso_in(days: int) -> str:
    """A date relative to whenever this runs, so shots never look stale."""
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def seed() -> str:
    """A household two weeks in. Returns the parent's session token."""
    run = uuid.uuid4().hex[:6]
    parent = call("POST", "/auth/register", {
        "name": "Amara", "email": f"amara-{run}@sim.test", "password": "password123"})
    tok = parent["session_token"]
    call("POST", "/auth/complete-onboarding", {}, tok)

    invite = call("POST", "/family/invite", {"email": f"tom-{run}@sim.test"}, tok)
    partner = call("POST", "/auth/register", {
        "name": "Tom", "email": f"tom-{run}@sim.test", "password": "password123",
        "invite_token": invite["invite"]["token"]})
    call("POST", "/auth/complete-onboarding", {}, partner["session_token"])
    kofi = call("POST", "/family/members",
                {"name": "Kofi", "role": "Child", "starting_stars": 0}, tok)

    # Stars earned and rewards waiting. A Kids screen showing zero of both is
    # a true picture of an account nobody has used yet, and the least
    # convincing thing you could put on a flyer about chores working.
    call("POST", f"/family/members/{kofi['member_id']}/stars", {"delta": 46}, tok)
    # Reward icons are emoji, not icon names. A name lands in the UI as the
    # literal word "clapperboard" sitting where a picture should be.
    for title, cost, icon in (
        ("Cinema trip", 60, "\U0001F3AC"),
        ("Pick Friday's dinner", 25, "\U0001F355"),
        ("An hour of extra screen time", 30, "\U0001F3AE"),
    ):
        call("POST", "/rewards", {"title": title, "cost_stars": cost, "icon": icon}, tok)

    for card in (
        # Two land today. Without them the feed opens on its "nothing urgent"
        # state, which is a fine thing for the app to say and a useless thing
        # to photograph — the flyer is meant to show a household running.
        {"type": "SIGN_SLIP", "title": "Sign Kofi's swimming form",
         "due_date": iso_in(0), "assignee": "Amara", "shared": True},
        {"type": "TASK", "title": "Pick Kofi up at 3.30",
         "due_date": iso_in(0), "assignee": "Tom", "shared": True},
        {"type": "SIGN_SLIP", "title": "School trip permission slip",
         "due_date": iso_in(1), "assignee": "Tom", "shared": True},
        {"type": "APPOINTMENT", "title": "Kofi — dentist",
         "due_date": iso_in(3), "assignee": "Amara", "shared": True},
        {"type": "TASK", "title": "Book the car in for its MOT",
         "due_date": iso_in(5), "assignee": "Tom", "shared": True},
        {"type": "SCHOOL", "title": "Non-uniform day — £1",
         "due_date": iso_in(6), "shared": True},
        {"type": "TASK", "title": "Renew the house insurance",
         "due_date": iso_in(9), "assignee": "Amara", "shared": True},
    ):
        call("POST", "/cards", card, tok)

    call("POST", "/shopping/bulk", {
        "names": ["Pasta 500g", "Tomatoes x6", "Chicken thighs", "Milk 2L",
                  "Bread", "Washing-up liquid", "Bananas", "Cheddar 200g"],
        "categories": ["Pantry", "Produce", "Meat", "Dairy",
                       "Bakery", "Household", "Produce", "Dairy"],
    }, tok)

    for title, category in (
        ("Kofi — vaccination record", "Medical"),
        ("Home insurance renewal", "Insurance"),
        ("Term dates 2026", "School"),
        ("Gas bill — November", "Bills"),
        ("Tenancy agreement", "Legal"),
    ):
        call("POST", "/vault", {"title": title, "category": category,
                                "image_base64": PIXEL}, tok)

    return tok


async def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    token = seed()

    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        # Tall enough to read on a flyer, narrow enough to still be a phone.
        ctx = await browser.new_context(
            viewport={"width": 390, "height": 844}, device_scale_factor=3)
        page = await ctx.new_page()

        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length",
                                              "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json",
                             body=await resp.body())

        await page.route("**/api/**", route)
        await page.add_init_script(
            f"localStorage.setItem('coo_session_token','{token}');"
            "localStorage.setItem('coo_appearance_mode_minimal_light_v5','light');"
            # First-run tips are good product and bad photography: they are
            # the largest thing on a screen precisely because they are meant
            # to be read once. Mark them seen — a flyer should show the app a
            # family lives in, not the app on the day it was installed.
            "localStorage.setItem('coo_tip_seen_vault_why','1');"
            "localStorage.setItem('coo_tip_seen_kids_stars','1');")

        for screen, slug in SHOTS.items():
            await page.goto(f"{WEB}/{screen}", wait_until="domcontentloaded")
            # Long enough for the lists to arrive: a screenshot of a spinner
            # is a screenshot of the app failing to load.
            await page.wait_for_timeout(4500)
            path = os.path.join(OUT, f"{slug}.png")
            await page.screenshot(path=path)
            print(f"wrote {os.path.relpath(path, ROOT)}")

        await browser.close()
    return 0


sys.exit(asyncio.run(main()))
