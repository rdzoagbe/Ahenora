"""Screenshot every screen of the web build, seeded, in three looks.

Not a pass/fail harness: a set of images for a person to look at. The app
renders the same components on Android, iOS and the web, so a wrong name,
a clipped line or an untranslated string seen here is seen everywhere.

Usage:  python3 scripts/sweep_screenshots.py <web-port> <api-port> <out-dir>
Requires serve_web.py on <web-port> and e2e_backend.py on <api-port>.
"""
import asyncio
import json
import os
import sys
import urllib.request
import uuid

from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(__file__))
from e2e_browser import launch_chromium  # noqa: E402

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
OUT = sys.argv[3]

ROUTES = [
    "feed", "calendar", "kids", "kitchen", "vault", "settings", "account",
    "chat", "search", "expenses", "gift-pot", "santa", "pricing", "metrics",
    "terms", "privacy", "delete-account", "teen", "onboarding",
]
LOGGED_OUT = ["", "auth"]


def api(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})}, method=method)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


def seed():
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register", {"name": "Roland Sweep", "email": "e2e-admin@sim.test",
                                       "password": "password123"})
    tok = a["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    inv = api("POST", "/family/invite", {"email": f"keigh-{run}@sim.test",
                                         "relationship": "Co-parent"}, tok)
    b = api("POST", "/auth/register", {"name": "Keigh Sweep", "email": f"keigh-{run}@sim.test",
                                       "password": "password123",
                                       "invite_token": inv["invite"]["token"]})
    tok_b = b["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_b)
    api("PATCH", "/auth/language", {"language": "fr"}, tok_b)
    def try_(method, path, body, token):
        # Seeding is best effort: one screen's content must not stop the
        # sweep from photographing the others.
        try:
            api(method, path, body, token)
        except Exception as exc:  # noqa: BLE001
            print(f"seed skipped {path}: {exc}")

    for kid in ("Arielle", "Jonael", "Isaiah"):
        try_("POST", "/family/members", {"name": kid, "role": "Child", "age": 8}, tok)
    try_("POST", "/shopping/bulk", {"names": ["Rice", "Beans", "Milk", "Bread"]}, tok)
    try_("POST", "/cards", {"type": "TASK", "title": "Book the dentist", "shared": True}, tok)
    try_("POST", "/cards", {"type": "EVENT", "title": "Swimming lesson", "shared": True,
                            "due_date": "2026-09-09T16:00:00Z"}, tok)
    try_("POST", "/cards", {"type": "TASK", "title": "Private: passport renewal",
                            "shared": False}, tok)
    try_("POST", "/handoff-notes", {"text": "Isaiah has a cold, keep him warm."}, tok)
    try_("POST", "/chat/adults/messages", {"text": "Can you pick up the kids Friday?"}, tok_b)
    return tok, tok_b


async def shoot(browser, token, look, routes, extra_init=""):
    scheme = "dark" if look.endswith("dark") else "light"
    ctx = await browser.new_context(viewport={"width": 390, "height": 844},
                                    color_scheme=scheme, device_scale_factor=2)
    page = await ctx.new_page()

    async def route(ro):
        path = ro.request.url.split("/api/", 1)[1]
        resp = await ctx.request.fetch(
            f"{API}/{path}", method=ro.request.method,
            headers={k: v for k, v in ro.request.headers.items()
                     if k.lower() not in ("host", "content-length", "origin", "referer")},
            data=ro.request.post_data)
        await ro.fulfill(status=resp.status, content_type="application/json",
                         body=await resp.body())

    await page.route("**/api/**", route)
    init = extra_init
    if token:
        init += f"localStorage.setItem('coo_session_token','{token}');"
    if init:
        await page.add_init_script(init)
    errors = {}
    for r in routes:
        errs = []
        page.on("pageerror", lambda e, s=errs: s.append(str(e)[:200]))
        await page.goto(f"{WEB}/{r}", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        name = (r or "index").replace("/", "_")
        await page.screenshot(path=os.path.join(OUT, f"{look}__{name}.png"), full_page=True)
        if errs:
            errors[f"{look}/{name}"] = errs
    await ctx.close()
    return errors


async def main():
    os.makedirs(OUT, exist_ok=True)
    tok, tok_b = seed()
    errors = {}
    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        errors.update(await shoot(browser, None, "out-light", LOGGED_OUT))
        errors.update(await shoot(browser, tok, "en-light", ROUTES))
        errors.update(await shoot(browser, tok, "en-dark", ROUTES,
                                  "localStorage.setItem('coo_appearance_mode_minimal_light_v5','dark');"))
        errors.update(await shoot(browser, tok_b, "fr-light", ROUTES))
        await browser.close()
    print(json.dumps({"shots": len(os.listdir(OUT)), "pageerrors": errors}, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
