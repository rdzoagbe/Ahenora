"""Every page, both personas, real backend: renders, no JS errors."""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/Ahenora/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
PAGES = ["feed", "calendar", "kids", "kitchen", "vault", "settings", "account"]
MARKERS = {"feed": "AHENORA", "calendar": "Calendar", "kids": "Kids",
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
            # The URL matters as much as the text. A failed request logs TWO
            # console lines: one naming the host, and a bare "Failed to load
            # resource" that names nothing. Filtering on truncated text alone
            # could never attribute that second line to anything, so an
            # environmental failure looked identical to a product one.
            # ConsoleMessage.location carries the resource URL — use it.
            page.on("console", lambda m, s=errs: s.append(
                f"console: {m.text[:120]} [{(m.location or {}).get('url', '')}]")
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
                await page.goto(f"{WEB}/{p}", wait_until="domcontentloaded")
                await page.wait_for_timeout(2600)
                body = await page.inner_text("body")
                checked += 1
                if MARKERS[p] not in body:
                    failures.append(f"{label}/{p}: marker '{MARKERS[p]}' missing")
                if len(body.strip()) < 40:
                    failures.append(f"{label}/{p}: page looks empty")
                # Now that the test build points at its own origin, the rule
                # is simple and honest: anything the app failed to load from
                # SOMEBODY ELSE'S host is the environment, not the product.
                # A GitHub runner, this sandbox and a laptop all differ in
                # what they can reach, and none of that is a bug in the app.
                # Errors from our own origin still fail the build.
                noise = ("favicon", "manifest")

                def environmental(entry: str) -> bool:
                    if any(n in entry for n in noise):
                        return True
                    url = entry.rsplit("[", 1)[-1].rstrip("]") if "[" in entry else ""
                    return bool(url) and "127.0.0.1" not in url

                real = [e for e in errs if not environmental(e)]
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
