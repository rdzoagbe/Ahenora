"""An invitation shared by link arrives as an invitation, and survives the store.

Roland, 2026-09-30, on an invitation his partner got on WhatsApp: "this
shouldn't be how the invitation comes". It previewed as the website and opened
the browser version of the app, and installing from the store lost it.

Holds, in a real browser against the real server:
  * the invitation page says who is inviting (its lookup is pointed at this
    test server; the page asks the live one in production);
  * on an Android phone it offers Google Play, and on an iPhone the App Store;
  * "Open in Ahenora" carries the invitation to the app's own link;
  * an unknown invitation says so instead of offering buttons that lead nowhere;
  * the app's "Have an invitation?" takes the pasted link and shows who invited.
"""
import asyncio, json, os, sys, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

PORT = sys.argv[1]
SITE = f"http://127.0.0.1:{PORT}"
WEB = f"{SITE}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
SHOTS = os.environ.get("E2E_SHOTS_DIR")
LIVE_API = "https://household-coo-production.up.railway.app"
ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36"
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


def to_test_server(ctx):
    """The page asks the live server; in this test, ask this one instead."""
    async def handler(ro):
        await _forward(ctx, ro)
    return handler


async def _forward(ctx, ro):
    url = ro.request.url
    path = url.split("/api/", 1)[1]
    resp = await ctx.request.fetch(f"{API}/{path}", method=ro.request.method)
    await ro.fulfill(status=resp.status, content_type="application/json",
                     body=await resp.body(),
                     headers={"Access-Control-Allow-Origin": "*"})


async def main():
    u = api("POST", "/auth/register",
            {"name": "Svet", "email": f"join-{uuid.uuid4().hex[:6]}@sim.test",
             "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    link = api("POST", "/family/invite/link", {}, tok)["invite_url"]
    token = link.split("invite=", 1)[1].split("&", 1)[0]

    r = {}
    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        errs = []

        for who, ua in (("android", ANDROID), ("iphone", IPHONE)):
            ctx = await browser.new_context(viewport={"width": 390, "height": 844}, user_agent=ua)
            page = await ctx.new_page()
            page.on("pageerror", lambda e: errs.append(str(e)))
            await page.route(f"{LIVE_API}/**", to_test_server(ctx))
            await page.goto(f"{SITE}/fr/join/?invite={token}", wait_until="domcontentloaded")
            await page.wait_for_timeout(1500)
            heading = await page.inner_text("#heading")
            r[f"{who}_names_the_inviter"] = heading.startswith("Svet vous invite")
            play = await page.locator("#store-android").is_visible()
            apple = await page.locator("#store-ios").is_visible()
            r[f"{who}_offers_its_own_store"] = (play, apple) == ((True, False) if who == "android" else (False, True))
            href = await page.get_attribute("#open-app", "href")
            r[f"{who}_open_app_carries_the_invitation"] = href == f"householdcoo://?invite={token}"
            if SHOTS:
                os.makedirs(SHOTS, exist_ok=True)
                await page.screenshot(path=os.path.join(SHOTS, f"join-{who}.png"), full_page=True)
            await ctx.close()

        # An invitation that does not exist says so.
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, user_agent=ANDROID)
        page = await ctx.new_page()
        await page.route(f"{LIVE_API}/**", to_test_server(ctx))
        await page.goto(f"{SITE}/join/?invite=doesnotexist123", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        r["unknown_invitation_says_so"] = (
            await page.locator("#gone").is_visible() and not await page.locator("#steps").is_visible())
        await ctx.close()

        # The app: signed out, paste the link the page copied.
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errs.append(str(e)))

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
        await page.goto(f"{WEB}/", wait_until="domcontentloaded")
        await page.wait_for_timeout(2600)
        # The value tour shows on a first visit; step past it.
        for _ in range(6):
            skip = page.get_by_text("Skip", exact=True)
            if await skip.count():
                await skip.first.click()
                await page.wait_for_timeout(400)
            else:
                break
        await page.click('[data-testid="invite-paste-open"]')
        await page.wait_for_timeout(400)
        await page.fill('[data-testid="invite-paste-input"]', "nonsense")
        await page.click('[data-testid="invite-paste-use"]')
        await page.wait_for_timeout(900)
        r["a_bad_paste_says_so"] = await page.locator('[data-testid="invite-paste-error"]').count() == 1
        await page.fill('[data-testid="invite-paste-input"]', f"https://ahenora.com/fr/join/?invite={token}")
        await page.click('[data-testid="invite-paste-use"]')
        await page.wait_for_timeout(1500)
        r["pasted_invitation_shows_who_invited"] = (
            await page.locator('[data-testid="invite-banner"]').count() == 1
            and "Svet" in await page.inner_text('[data-testid="invite-banner"]'))
        stored = await page.evaluate("localStorage.getItem('pending_invite')")
        r["pasted_invitation_is_kept_for_sign_in"] = stored == token
        if SHOTS:
            await page.screenshot(path=os.path.join(SHOTS, "join-app-pasted.png"), full_page=False)
        await ctx.close()

        r["no_js_errors"] = not errs
        await browser.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    failures = [k for k, v in r.items() if not v]
    print("ALL PASS" if not failures else f"{len(failures)} FAILURES")
    sys.exit(0 if not failures else 1)


asyncio.run(main())
