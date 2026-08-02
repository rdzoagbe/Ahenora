"""The new bar: four tabs + More, and More really reaches what it hides."""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright

WEB = f"http://127.0.0.1:{sys.argv[1]}/Household-COO/app"
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
        b = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
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

        await p.goto(f"{WEB}/feed", wait_until="networkidle")
        await p.wait_for_timeout(3000)
        bar = await p.inner_text("body")
        # Only the active tab spells its name; the others are icons.
        r["active_tab_named"] = "Feed" in bar
        r["inactive_labels_gone"] = "Calendar" not in bar and "Kitchen" not in bar
        r["more_button_present"] = await p.locator('[data-testid="tab-more"]').count() == 1
        await p.screenshot(path="nav_feed.png")

        # More opens a sheet with the hidden destinations
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

        await p.click('[data-testid="tab-more"]')
        await p.wait_for_timeout(1000)
        await p.click('[data-testid="more-settings"]')
        await p.wait_for_timeout(3000)
        r["more_reaches_settings"] = "Manage members" in await p.inner_text("body")

        # The four daily tabs still work
        for label, marker in (("calendar", "Calendar"), ("kids", "Kids"), ("kitchen", "Kitchen")):
            await p.goto(f"{WEB}/{label}", wait_until="networkidle")
            await p.wait_for_timeout(2200)
            r[f"tab_{label}_ok"] = marker in await p.inner_text("body")

        r["no_js_errors"] = not errs
        await b.close()

    for k, v in r.items(): print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)

asyncio.run(main())
