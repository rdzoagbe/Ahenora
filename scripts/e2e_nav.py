"""The new bar: four tabs + More, and More really reaches what it hides."""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

def api(m, p, b=None, t=None):
    r = urllib.request.Request(f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res: return json.loads(res.read().decode() or "{}")

async def main():
    import uuid
    r = {}
    u = api("POST", "/auth/register", {"name": "Nav Probe", "email": f"nav-{uuid.uuid4().hex[:6]}@sim.test",
                                       "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    async with async_playwright() as pw:
        b = await launch_chromium(pw)
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        p = await ctx.new_page()
        errs = []
        p.on("pageerror", lambda e: errs.append(str(e)))

        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
        await p.route("**/api/**", route)
        await p.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")

        await p.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await p.wait_for_timeout(3000)
        bar = await p.inner_text("body")
        # Every tab spells its name under the icon — a bar you have to tap to
        # learn is doing half its job. The daily bar is Feed · Calendar ·
        # Family · Kitchen in one pill, with More on its own button beside it.
        # Messaging moved into the Family Hub (open a member to chat), so the
        # Messages inbox is no longer a bar seat; Kitchen took it.
        r["active_tab_named"] = "Feed" in bar
        r["all_tabs_named"] = all(w in bar for w in ("Feed", "Calendar", "Family", "Kitchen"))
        # More is a button beside the pill, not a fifth seat inside it — and it
        # is reachable from every tab, not just the Feed.
        r["more_button_present"] = await p.locator('[data-testid="tab-more"]').count() == 1
        r["no_raised_plus_in_the_bar"] = await p.locator('[data-testid="tab-add"]').count() == 0
        await p.screenshot(path="nav_feed.png")

        # The More button opens a sheet with the hidden destinations
        await p.click('[data-testid="tab-more"]')
        await p.wait_for_timeout(1200)
        sheet = await p.inner_text("body")
        r["sheet_lists_vault"] = "Vault" in sheet
        r["sheet_lists_settings"] = "Settings" in sheet
        r["sheet_lists_account"] = "Your account" in sheet
        await p.screenshot(path="nav_more.png")

        # ...and actually navigates
        await p.click('[data-testid="more-vault"]')
        await p.wait_for_timeout(3000)
        r["more_reaches_vault"] = "Vault" in await p.inner_text("body")
        await p.screenshot(path="nav_vault.png")

        # More rides the tab bar, so it is reachable from wherever we landed —
        # no trip back to the Feed to find it.
        await p.click('[data-testid="tab-more"]')
        await p.wait_for_timeout(1000)
        await p.click('[data-testid="more-settings"]')
        await p.wait_for_timeout(3000)
        # Settings is a hub of group rows now; "Household" is a group header,
        # visible without opening anything. (Manage members lives inside it.)
        r["more_reaches_settings"] = "Household" in await p.inner_text("body")

        # The daily tabs still load. Assert a page-UNIQUE element on each — not a
        # word that also lives in the always-visible bottom bar (a body-text
        # check for a tab label passes even if the screen rendered nothing); a
        # per-screen testID is real content that only appears once it mounted.
        await p.goto(f"{WEB}/calendar", wait_until="domcontentloaded")
        await p.wait_for_timeout(2200)
        r["tab_calendar_ok"] = await p.locator('[data-testid="prev-month"]').count() >= 1

        await p.goto(f"{WEB}/kids", wait_until="domcontentloaded")
        await p.wait_for_timeout(2200)
        r["tab_kids_ok"] = await p.locator('[data-testid="family-manage-members"]').count() >= 1

        await p.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await p.wait_for_timeout(2200)
        # All three Kitchen views must be reachable without opening anything.
        r["tab_kitchen_ok"] = all([
            await p.locator('[data-testid="kitchen-tab-shop"]').count() >= 1,
            await p.locator('[data-testid="kitchen-tab-meal"]').count() >= 1,
            await p.locator('[data-testid="kitchen-tab-spend"]').count() >= 1,
        ])

        r["no_js_errors"] = not errs
        await b.close()

    for k, v in r.items(): print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)

asyncio.run(main())
