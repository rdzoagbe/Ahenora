"""Tapping a morning summary that counts several things shows those things.

Reported a third time on 2026-11-11, with a screenshot of "Aujourd'hui · 2
choses encore en attente": tapping it opened the Feed, which leads with
today, so two jobs from a fortnight ago were nowhere in sight and the tap
looked like it did nothing. The tap now opens "À traiter", the list
behind the bell, overdue first.

The tap is delivered the way the browser's notification worker delivers it
(public/sw.js posts "push-notification-tap"), so the layout's held target and
its retries run as they do for a real tap.
"""
import asyncio, json, os, sys, traceback, urllib.request, uuid
from datetime import datetime, timedelta, timezone
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
SHOTS = os.environ.get("E2E_SHOTS_DIR")


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def main():
    u = api("POST", "/auth/register",
            {"name": "Roland", "email": f"digest-{uuid.uuid4().hex[:6]}@sim.test",
             "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    api("PATCH", "/auth/language", {"language": "fr"}, tok)
    r = {}
    try:
        await run(r, tok)
    except Exception:
        traceback.print_exc()
        r["ran_to_the_end"] = False
    for k, v in r.items():
        print(f"{k}: {v}")
    failures = [k for k, v in r.items() if not v]
    print("ALL PASS" if not failures else f"{len(failures)} FAILURES")
    sys.exit(0 if not failures else 1)


async def run(r, tok):
    old = (datetime.now(timezone.utc) - timedelta(days=10)).replace(hour=9, minute=0).isoformat()
    a = api("POST", "/cards", {"title": "Renvoyer le formulaire de la cantine", "due_date": old}, tok)
    b = api("POST", "/cards", {"title": "Appeler le plombier", "due_date": old}, tok)

    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, locale="fr-FR",
                                        device_scale_factor=2)
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
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
        await page.route("**/api/**", route)
        await page.add_init_script(
            f"localStorage.setItem('coo_session_token','{tok}');"
            "localStorage.setItem('coo_policy_notice_seen','2026-11-10');")

        await page.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="feed-week"]', timeout=20000)
        await page.wait_for_timeout(1500)

        async def tap():
            # Exactly what the browser's notification worker posts on a tap
            # (public/sw.js), so the layout's held-target and retry run too.
            await page.evaluate("""() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
                data: { type: 'push-notification-tap', data: { type: 'morning_digest' } } }))""")

        # A task sheet already open when the tap arrives: it gives way.
        # (These two are a fortnight old: they are not in the Feed's day list,
        # which is the whole complaint. They are in "À traiter", behind the bell.)
        await page.locator('[data-testid="feed-bell"]').click()
        await page.locator(f'[data-testid="feed-alert-{b["card_id"]}"]').click()
        await page.wait_for_selector('[data-testid="feed-detail-close"]', timeout=10000)
        await page.wait_for_timeout(400)
        await tap()
        await page.wait_for_selector(f'[data-testid="feed-alert-{b["card_id"]}"]', timeout=20000)
        await page.wait_for_timeout(600)
        r["the_tap_opens_the_list_of_them"] = await page.locator(
            f'[data-testid="feed-alert-{a["card_id"]}"]').count() == 1
        r["named_on_screen"] = "Appeler le plombier" in await page.locator(
            f'[data-testid="feed-alert-{b["card_id"]}"]').inner_text()
        r["no_task_sheet_underneath"] = await page.locator('[data-testid="feed-detail-close"]').count() == 0
        if SHOTS:
            await page.screenshot(path=os.path.join(SHOTS, "digest-tap-list.png"))

        # Closed, it stays closed: the tap is not pushed again behind it.
        await page.locator('[data-testid="feed-alerts-close"]').click()
        await page.wait_for_timeout(3500)
        r["a_closed_list_stays_closed"] = await page.locator('[data-testid="feed-alerts-close"]').count() == 0

        # The next such tap opens it again.
        await tap()
        await page.wait_for_selector('[data-testid="feed-alerts-close"]', timeout=15000)
        r["the_next_tap_opens_it_again"] = True

        # Tapping one opens THAT task's own sheet.
        await page.locator(f'[data-testid="feed-alert-{a["card_id"]}"]').click()
        await page.wait_for_selector('[data-testid="feed-detail-close"]', timeout=10000)
        await page.wait_for_timeout(2500)
        r["tapping_one_opens_its_sheet"] = await page.locator('[data-testid="feed-alerts-close"]').count() == 0 \
            and await page.locator('[data-testid="feed-detail-close"]').count() == 1

        # Opening the app normally does not pop the list open.
        await page.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="feed-week"]', timeout=20000)
        await page.wait_for_timeout(2500)
        r["a_normal_launch_stays_on_the_feed"] = await page.locator(
            '[data-testid="feed-alerts-close"]').count() == 0

        r["no_page_errors"] = not errs
        if errs:
            print("page errors:", errs[:3])
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
