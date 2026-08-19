"""Keigh finishes a task; Roland's feed says so, in his own language."""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

def api(m, p, b=None, t=None):
    r = urllib.request.Request(f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res: return json.loads(res.read().decode() or "{}")

async def persona(browser, token, w, h):
    ctx = await browser.new_context(viewport={"width": w, "height": h})
    page = await ctx.new_page()
    async def route(ro):
        path = ro.request.url.split("/api/", 1)[1]
        resp = await ctx.request.fetch(f"{API}/{path}", method=ro.request.method,
            headers={k: v for k, v in ro.request.headers.items()
                     if k.lower() not in ("host", "content-length", "origin", "referer")},
            data=ro.request.post_data)
        await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
    await page.route("**/api/**", route)
    await page.add_init_script(f"localStorage.setItem('coo_session_token','{token}');")
    return page

async def main():
    import uuid
    r = {}
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register", {"name": "Roland A", "email": f"ra-{run}@sim.test", "password": "password123"})
    tok_a = a["session_token"]; api("POST", "/auth/complete-onboarding", {}, tok_a)
    inv = api("POST", "/family/invite", {"email": f"ka-{run}@sim.test"}, tok_a)
    b = api("POST", "/auth/register", {"name": "Keigh A", "email": f"ka-{run}@sim.test",
                                       "password": "password123", "invite_token": inv["invite"]["token"]})
    tok_b = b["session_token"]; api("POST", "/auth/complete-onboarding", {}, tok_b)
    card = api("POST", "/cards", {"type": "TASK", "title": "Bins out", "shared": True}, tok_a)

    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        keigh = await persona(br, tok_b, 390, 844)
        roland = await persona(br, tok_a, 412, 915)

        # Keigh ticks it off from her device, through the UI.
        await keigh.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await keigh.wait_for_timeout(3000)
        r["K_sees_shared_task"] = "Bins out" in await keigh.inner_text("body")
        api("PATCH", f"/cards/{card['card_id']}", {"status": "DONE"}, tok_b)

        # Roland opens his feed and learns who did it. The retrospective half
        # of the feed is collapsed by default now, so open the Household row.
        await roland.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await roland.wait_for_timeout(3500)
        await roland.click('[data-testid="feed-household-open"]')
        await roland.wait_for_timeout(700)
        body = await roland.inner_text("body")
        r["R_sees_activity_section"] = "In the household" in body
        r["R_sees_who_finished_it"] = "Keigh A" in body and "finished Bins out" in body
        r["R_sees_who_added_it"] = "Roland A" in body and "added Bins out" in body
        await roland.screenshot(path="activity_feed.png")

        # And in French, from the same stored events.
        api("PATCH", "/auth/language", {"language": "fr"}, tok_a)
        await roland.reload(wait_until="domcontentloaded")
        await roland.wait_for_timeout(3500)
        await roland.click('[data-testid="feed-household-open"]')
        await roland.wait_for_timeout(700)
        body = await roland.inner_text("body")
        r["R_reads_it_in_french"] = "Dans le foyer" in body and "a terminé" in body
        await roland.screenshot(path="activity_feed_fr.png")
        await br.close()

    for k, v in r.items(): print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)

asyncio.run(main())
