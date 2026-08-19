"""The supermarket probe: no signal, and the list is still there.

Kills the network at the browser level (every /api/** request is aborted the
way a dead connection aborts it), then checks the three things a parent in a
shop actually needs:

  1. the shopping list still renders, from the copy on disk;
  2. the banner says so, instead of just "you're offline";
  3. ticking an item off is remembered and reaches the server when the
     signal comes back.

Usage:  python3 scripts/e2e_offline.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}",
        data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})},
        method=m,
    )
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def main():
    r = {}
    u = api("POST", "/auth/register", {"name": "Offline Probe",
                                       "email": f"offline-{uuid.uuid4().hex[:6]}@sim.test",
                                       "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    api("POST", "/shopping/bulk", {"names": ["Milk", "Bread", "Olive oil"]}, tok)

    async with async_playwright() as pw:
        b = await launch_chromium(pw)
        ctx = await b.new_context(viewport={"width": 390, "height": 844})
        p = await ctx.new_page()
        errs = []
        p.on("pageerror", lambda e: errs.append(str(e)))

        online = {"v": True}

        async def route(ro):
            if not online["v"]:
                # What a dead connection looks like to fetch(): not a 500, not
                # a slow answer — nothing at all.
                await ro.abort("internetdisconnected")
                return
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())

        await p.route("**/api/**", route)
        await p.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")

        # --- 1. one good visit, so there is something to remember -----------
        await p.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await p.wait_for_timeout(4000)
        body = await p.inner_text("body")
        r["online_list_renders"] = "Milk" in body and "Olive oil" in body
        snap = await p.evaluate("localStorage.getItem('coo_snap:/shopping')")
        r["snapshot_written"] = bool(snap) and "Milk" in snap

        # --- 2. the connection dies ----------------------------------------
        online["v"] = False
        await p.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        # Retries have to run out before the disk copy is served.
        await p.wait_for_timeout(12000)
        body = await p.inner_text("body")
        r["offline_list_still_renders"] = "Milk" in body and "Olive oil" in body
        r["banner_explains_the_copy"] = "last saved copy" in body
        await p.screenshot(path="offline_kitchen.png")

        # --- 3. ticking off with no signal ---------------------------------
        item = api("GET", "/shopping", None, tok)[0]
        before = item["checked"]
        await p.click(f'text=Milk')
        await p.wait_for_timeout(12000)
        queue = await p.evaluate("localStorage.getItem('coo_offline_queue')")
        r["tick_off_was_queued"] = bool(queue) and "/shopping/" in queue
        body = await p.inner_text("body")
        r["banner_counts_pending"] = "will sync" in body
        await p.screenshot(path="offline_queued.png")

        server_items = api("GET", "/shopping", None, tok)
        r["server_untouched_while_offline"] = all(
            i["checked"] == before for i in server_items if i["item_id"] == item["item_id"])

        # --- 4. the signal returns -----------------------------------------
        online["v"] = True
        await p.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await p.wait_for_timeout(8000)
        queue = await p.evaluate("localStorage.getItem('coo_offline_queue')")
        r["queue_drained"] = queue in (None, "[]")
        milk = [i for i in api("GET", "/shopping", None, tok) if i["name"] == "Milk"]
        r["tick_off_reached_the_server"] = bool(milk) and milk[0]["checked"] != before
        body = await p.inner_text("body")
        r["banner_gone_when_back"] = "last saved copy" not in body and "will sync" not in body
        await p.screenshot(path="offline_recovered.png")

        r["no_js_errors"] = not errs
        if errs:
            print("page errors:", errs[:3])
        await b.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    ok = all(r.values())
    print("ALL PASS" if ok else "FAILURES PRESENT")
    sys.exit(0 if ok else 1)


asyncio.run(main())
