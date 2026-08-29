"""The solo household's way out, in one tap.

Nine invitations across seventy-two households: at least 87% never invited
anybody. The asking was never the problem — the app asks in onboarding and again
on the Feed. What the ask LED to was: a jump to the Settings screen, and a field
wanting a partner's email address typed from memory. For a couple that is the
wrong input through the wrong channel.

What is held here: the nudge sends the invitation itself. One tap mints a link
and hands it to the share sheet — no navigation, nothing typed — and the
invitation really exists on the server afterwards. The email route stays, as a
second option rather than the only one.
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def main():
    r = {}
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register",
            {"name": "Roland S", "email": f"rs-{run}@sim.test", "password": "password123"})
    tok = a["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    before = api("GET", "/family/invites", None, tok)

    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        ctx = await br.new_context(viewport={"width": 412, "height": 915})
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
        # navigator.clipboard is a read-only getter in Chromium, so it has to be
        # defined before the page loads rather than assigned afterwards.
        await page.add_init_script(
            f"localStorage.setItem('coo_session_token','{tok}');"
            "Object.defineProperty(navigator, 'clipboard', {"
            "  configurable: true,"
            "  value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }"
            "});")

        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)

        r["solo_household_is_nudged"] = await page.locator(
            '[data-testid="cp-nudge-invite"]').count() > 0
        # The email route is still offered — just no longer the only way through.
        r["email_route_still_offered"] = await page.locator(
            '[data-testid="cp-nudge-by-email"]').count() > 0

        # One tap. On web there is no share sheet, so the link is copied — the
        # branch a browser can actually exercise.
        await page.click('[data-testid="cp-nudge-invite"]')
        await page.wait_for_timeout(2500)

        r["stayed_on_the_feed"] = "/feed" in page.url
        copied = await page.evaluate("window.__copied || ''")
        r["a_link_was_handed_over"] = "invite" in (copied or "").lower()
        r["it_says_it_worked"] = "sent" in (await page.inner_text("body")).lower() \
            or "copied" in (await page.inner_text("body")).lower()

        # The part that matters: the invitation is real, not just a message.
        after = api("GET", "/family/invites", None, tok)
        r["an_invitation_now_exists"] = len(after) == len(before) + 1
        await page.screenshot(path="invite_nudge.png")
        r["no_js_errors"] = not errors
        if errors:
            print("page errors:", errors[:3])
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)


asyncio.run(main())
