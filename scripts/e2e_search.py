"""One box for "where did I put the school form" — and it keeps its mouth shut.

Two parents in one household. Roland searches; the probe checks he finds his
own things across every screen, and that Keigh's private task and private
document stay as invisible here as they are on the feed and in the vault. A
search box is the easiest place in an app to leak, so that half matters more
than the finding half.

Usage:  python3 scripts/e2e_search.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

WEB = f"http://127.0.0.1:{sys.argv[1]}/Household-COO/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})},
        method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def persona(browser, token, w=390, h=844):
    ctx = await browser.new_context(viewport={"width": w, "height": h})
    page = await ctx.new_page()

    async def route(ro):
        path = ro.request.url.split("/api/", 1)[1]
        resp = await ctx.request.fetch(
            f"{API}/{path}", method=ro.request.method,
            headers={k: v for k, v in ro.request.headers.items()
                     if k.lower() not in ("host", "content-length", "origin", "referer")},
            data=ro.request.post_data)
        await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())

    await page.route("**/api/**", route)
    await page.add_init_script(f"localStorage.setItem('coo_session_token','{token}');")
    return page


async def look_for(page, term):
    await page.fill('[data-testid="search-input"]', "")
    await page.fill('[data-testid="search-input"]', term)
    # Debounce (260ms) plus the round trip.
    await page.wait_for_timeout(2500)
    return await page.inner_text("body")


async def main():
    r = {}
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register", {"name": "Roland S", "email": f"rs-{run}@sim.test",
                                       "password": "password123"})
    tok_a = a["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_a)
    inv = api("POST", "/family/invite", {"email": f"ks-{run}@sim.test"}, tok_a)
    b = api("POST", "/auth/register", {"name": "Keigh S", "email": f"ks-{run}@sim.test",
                                       "password": "password123",
                                       "invite_token": inv["invite"]["token"]})
    tok_b = b["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_b)

    # Roland's household knowledge, scattered across four screens.
    api("POST", "/cards", {"type": "TASK", "title": "Return the school form",
                           "description": "due Friday", "shared": True}, tok_a)
    api("POST", "/cards", {"type": "TASK", "title": "Call back",
                           "description": "the plumber about the boiler", "shared": True}, tok_a)
    api("POST", "/shopping/bulk", {"names": ["Olive oil", "Bread"]}, tok_a)
    api("POST", "/vault", {"title": "School insurance letter", "category": "School",
                           "image_base64": "x", "mime_type": "image/jpeg"}, tok_a)

    # Keigh's private things — the ones that must not surface.
    api("POST", "/cards", {"type": "TASK", "title": "Therapy appointment", "shared": False}, tok_b)
    doc = api("POST", "/vault", {"title": "Medical results", "category": "Medical",
                                 "image_base64": "x", "mime_type": "image/jpeg"}, tok_b)
    api("PATCH", f"/vault/{doc['doc_id']}/visibility", {"visibility": "private"}, tok_b)

    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        roland = await persona(br, tok_a)
        errs = []
        roland.on("pageerror", lambda e: errs.append(str(e)))

        # Reachable from the feed, not buried in a menu.
        await roland.goto(f"{WEB}/feed", wait_until="networkidle")
        await roland.wait_for_timeout(3000)
        r["feed_offers_search"] = await roland.locator('[data-testid="feed-search"]').count() == 1
        await roland.click('[data-testid="feed-search"]')
        await roland.wait_for_timeout(2500)
        r["search_screen_opens"] = await roland.locator('[data-testid="search-input"]').count() == 1

        # --- finding -------------------------------------------------------
        body = await look_for(roland, "school")
        r["finds_task_by_title"] = "Return the school form" in body
        r["finds_document_by_title"] = "School insurance letter" in body
        r["groups_the_results"] = "DOCUMENTS" in body.upper() and "TASKS" in body.upper()
        await roland.screenshot(path="search_school.png")

        body = await look_for(roland, "plumber")
        r["finds_task_by_its_notes"] = "Call back" in body

        body = await look_for(roland, "olive")
        r["finds_shopping_item"] = "Olive oil" in body

        # --- not finding ---------------------------------------------------
        body = await look_for(roland, "therapy")
        r["coparent_private_task_hidden"] = "Therapy appointment" not in body
        r["says_so_when_empty"] = "Nothing found" in body

        body = await look_for(roland, "medical")
        r["coparent_private_document_hidden"] = "Medical results" not in body
        await roland.screenshot(path="search_private.png")

        # And the owner can still find her own.
        keigh = await persona(br, tok_b)
        await keigh.goto(f"{WEB}/search", wait_until="networkidle")
        await keigh.wait_for_timeout(3000)
        body = await look_for(keigh, "medical")
        r["owner_still_finds_her_own"] = "Medical results" in body

        r["no_js_errors"] = not errs
        if errs:
            print("page errors:", errs[:3])
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    ok = all(r.values())
    print("ALL PASS" if ok else "FAILURES PRESENT")
    sys.exit(0 if ok else 1)


asyncio.run(main())
