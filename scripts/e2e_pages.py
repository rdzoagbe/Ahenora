"""Every page, both personas, real backend: renders, no JS errors."""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/Household-COO/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
PAGES = ["feed", "calendar", "kids", "kitchen", "vault", "settings", "account"]
MARKERS = {"feed": "Household COO", "calendar": "Calendar", "kids": "Kids",
           "kitchen": "Kitchen", "vault": "Vault", "settings": "Settings",
           "account": "Account"}


def api(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})}, method=method)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def main():
    import uuid
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register", {"name": "Sweep A", "email": f"sa-{run}@sim.test",
                                       "password": "password123"})
    tok_a = a["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_a)
    inv = api("POST", "/family/invite", {"email": f"sb-{run}@sim.test"}, tok_a)
    b = api("POST", "/auth/register", {"name": "Sweep B", "email": f"sb-{run}@sim.test",
                                       "password": "password123",
                                       "invite_token": inv["invite"]["token"]})
    tok_b = b["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_b)
    api("POST", "/family/members", {"name": "Kid Sweep", "role": "Child"}, tok_a)
    api("POST", "/shopping/bulk", {"names": ["Rice", "Beans"]}, tok_a)
    api("POST", "/cards", {"type": "TASK", "title": "Sweep task", "shared": True}, tok_a)

    failures, checked = [], 0
    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        for label, token, size in (("android", tok_a, (412, 915)), ("iphone", tok_b, (390, 844))):
            ctx = await browser.new_context(viewport={"width": size[0], "height": size[1]})
            page = await ctx.new_page()
            errs = []
            page.on("pageerror", lambda e, s=errs: s.append(f"pageerror: {e}"))
            page.on("console", lambda m, s=errs: s.append(f"console: {m.text[:120]}")
                    if m.type == "error" else None)

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
            await page.add_init_script(f"localStorage.setItem('coo_session_token','{token}');")
            for p in PAGES:
                errs.clear()
                await page.goto(f"{WEB}/{p}", wait_until="networkidle")
                await page.wait_for_timeout(2600)
                body = await page.inner_text("body")
                checked += 1
                if MARKERS[p] not in body:
                    failures.append(f"{label}/{p}: marker '{MARKERS[p]}' missing")
                if len(body.strip()) < 40:
                    failures.append(f"{label}/{p}: page looks empty")
                # The connectivity check pings an external host by design, so
                # its failures are environmental rather than product bugs.
                # ERR_TUNNEL is one development sandbox's proxy refusing that
                # same ping — and it once swallowed a real failure: a build
                # pointed at the PRODUCTION backend phoned home from inside a
                # test, and CI's CORS error looked nothing like ERR_TUNNEL, so
                # it passed here for months and failed the moment it ran
                # anywhere else. Keep this list to genuinely external noise.
                noise = ("clients3.google.com", "ERR_TUNNEL", "favicon", "manifest")
                real = [e for e in errs if not any(n in e for n in noise)]
                if real:
                    failures.append(f"{label}/{p}: {real[:2]}")
            await ctx.close()
        await browser.close()

    print(f"pages checked: {checked}")
    for f in failures:
        print("FAIL", f)
    print("ALL PASS" if not failures else f"{len(failures)} FAILURES")
    sys.exit(0 if not failures else 1)

asyncio.run(main())
