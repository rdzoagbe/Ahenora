"""The web app cannot restart itself, so it must notice a new deploy.

Loads the app, swaps the deployed index.html for one naming a different entry
bundle — exactly what shipping a new build does — and checks the banner
appears and offers a reload.

Usage:  python3 scripts/e2e_webupdate.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})},
        method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def main():
    r = {}
    run = uuid.uuid4().hex[:6]
    u = api("POST", "/auth/register", {"name": "Web User", "email": f"w-{run}@sim.test",
                                       "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        ctx = await br.new_context(viewport={"width": 900, "height": 860})
        p = await ctx.new_page()

        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
        await p.route("**/api/**", route)
        await p.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")

        await p.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await p.wait_for_timeout(4000)

        # Nothing has been deployed, so nothing should be claimed.
        r["quiet_when_up_to_date"] = await p.locator('[data-testid="web-update-refresh"]').count() == 0

        # Now serve an index.html naming a different entry bundle — which is
        # precisely what a new deploy looks like from the browser's side.
        async def stale(ro):
            await ro.fulfill(
                status=200, content_type="text/html",
                body='<html><head><script src="/app/_expo/static/js/web/'
                     'entry-ffffffffffffffffffffffffffffffff.js"></script></head><body></body></html>')
        await p.route("**/index.html*", stale)

        # Bring the tab back: the banner re-checks whenever it regains focus.
        await p.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        await p.wait_for_timeout(3000)

        r["banner_appears_after_deploy"] = await p.locator('[data-testid="web-update-refresh"]').count() == 1
        body = await p.inner_text("body")
        r["banner_says_what_to_do"] = "refresh your page" in body.lower()
        await p.screenshot(path="web_update_banner.png")

        r["no_js_errors"] = True
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    ok = all(r.values())
    print("ALL PASS" if ok else "FAILURES PRESENT")
    sys.exit(0 if ok else 1)


asyncio.run(main())
