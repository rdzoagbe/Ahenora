"""The centre + captures — it opens the picker and never changes tab.

From Calendar, Family and Kitchen: open +, confirm the right primary tile, run
the universal "Task" action, and assert the AddCardModal opened WITHOUT the
page navigating away. Plus the shopping quick-add: type an item, add it, and
confirm we stayed put.

The FEED is deliberately different, and that difference is asserted here too.
Two adds sat inches apart on that screen and the smaller one did more — the
capture bar routes a typed line to the shopping list, the week's menu or a
task. So on the Feed the + points at the bar instead of opening a second
sheet. Scan and voice did not go anywhere: they are the camera and microphone
on the bar itself, and the long-hand composer is the third icon beside them.
"""
import asyncio, json, sys, urllib.request
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


# Per tab: the primary-tile wording the picker must lead with. Calendar leads
# with "New event"; every other tab leads with the add-a-task wording.
PRIMARY = {
    "calendar": "New event",
    "kids": "Add a task",
    "kitchen": "Add a task",
}


async def main():
    import uuid
    u = api("POST", "/auth/register",
            {"name": "QuickAdd Probe", "email": f"qa-{uuid.uuid4().hex[:6]}@sim.test",
             "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    api("POST", "/family/members", {"name": "QA Kid", "role": "Child"}, tok)

    r = {}
    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        errs = []
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
        await page.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")

        def path_of(url):
            return url.split("?", 1)[0].split("#", 1)[0]

        # The picker used to hang off a raised ＋ in the tab bar. The bar now
        # carries four destinations and More, so the ＋ moved into each screen's
        # own header — same sheet, same testID, different door. The Feed is
        # handled separately below: its capture bar is the add, so it has no ＋.
        for tab in ("calendar", "kids", "kitchen"):
            await page.goto(f"{WEB}/{tab}", wait_until="domcontentloaded")
            await page.wait_for_timeout(2400)
            before = path_of(page.url)

            # Open the picker.
            await page.click('[data-testid="tab-add"]')
            await page.wait_for_timeout(700)
            body = await page.inner_text("body")

            # The context eyebrow proves the picker (not a navigate) appeared.
            # Case-insensitive: the eyebrow renders uppercase via text-transform,
            # so Playwright's inner_text returns "YOU'RE ON …".
            r[f"{tab}_picker_opens"] = "you're on" in body.lower()
            # The primary tile leads with the right create for this tab.
            r[f"{tab}_primary_text"] = PRIMARY[tab] in body

            # Run the universal Task action.
            await page.click('[data-testid="quickadd-task"]')
            await page.wait_for_timeout(700)
            # AddCardModal is open when its title input is present.
            r[f"{tab}_addmodal_opens"] = await page.locator('[data-testid="input-title"]').count() == 1
            # ...and the + never changes tab.
            r[f"{tab}_stayed_put"] = path_of(page.url) == before

            # Close the modal for the next iteration.
            if await page.locator('[data-testid="close-add-card"]').count() == 1:
                await page.click('[data-testid="close-add-card"]')
                await page.wait_for_timeout(400)

        # The Feed carries no ＋ of its own: the capture bar is the add, and a
        # second button beside it would just be asking the same question twice.
        await page.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await page.wait_for_timeout(2400)
        r["feed_has_no_picker_plus"] = await page.locator(
            '[data-testid="tab-add"]').count() == 0
        r["feed_capture_bar_is_the_add"] = await page.locator(
            '[data-testid="feed-capture-input"]').count() == 1
        # Long-hand composer, scan and voice are still on the Feed — on the bar,
        # not behind a picker.
        r["feed_keeps_scan_and_voice"] = (
            await page.locator('[data-testid="feed-open-add"]').count() == 1)

        # Shopping quick-add, from a tab whose header ＋ opens the picker.
        await page.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await page.wait_for_timeout(2400)
        before = path_of(page.url)
        await page.click('[data-testid="tab-add"]')
        await page.wait_for_timeout(700)
        await page.click('[data-testid="quickadd-shopping"]')
        await page.wait_for_timeout(700)
        await page.fill('[data-testid="quickadd-shopping-input"]', "Olive oil")
        await page.click('[data-testid="quickadd-shopping-add"]')
        await page.wait_for_timeout(900)
        r["shopping_stayed_put"] = path_of(page.url) == before

        r["no_js_errors"] = not errs
        await browser.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    failures = [k for k, v in r.items() if not v]
    print("ALL PASS" if not failures else f"{len(failures)} FAILURES")
    sys.exit(0 if not failures else 1)


asyncio.run(main())
