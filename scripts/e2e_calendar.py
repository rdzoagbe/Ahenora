"""The calendar's "Upcoming" list must actually be upcoming.

With no day picked, the list is headed "Upcoming" and used to show every open
dated card oldest first — so the top of it was the most overdue thing in the
house, and what was actually coming up sat below however many months of it.

What is held here: past days are held back behind a counted row, never hidden
and never marked done. A date passing is not evidence that a job happened, and
the app has no business deciding it did. And picking a day still shows that
whole day, because picking a day is asking for it.
"""
import asyncio, json, sys, urllib.request, uuid
from datetime import datetime, timedelta, timezone
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


async def persona(browser, token, w, h):
    ctx = await browser.new_context(viewport={"width": w, "height": h})
    page = await ctx.new_page()

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
    return page


async def main():
    r = {}
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register",
            {"name": "Roland C", "email": f"rc-{run}@sim.test", "password": "password123"})
    tok = a["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    now = datetime.now(timezone.utc)
    long_ago = (now - timedelta(days=40)).replace(hour=9).isoformat()
    yesterday = (now - timedelta(days=1)).replace(hour=9).isoformat()
    soon = (now + timedelta(days=3)).replace(hour=9).isoformat()

    api("POST", "/cards", {"type": "TASK", "title": "Dentist last month", "due_date": long_ago}, tok)
    api("POST", "/cards", {"type": "TASK", "title": "Bins yesterday", "due_date": yesterday}, tok)
    api("POST", "/cards", {"type": "TASK", "title": "School trip soon", "due_date": soon}, tok)

    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        page = await persona(br, tok, 412, 915)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        await page.goto(f"{WEB}/calendar", wait_until="domcontentloaded")
        await page.wait_for_timeout(3500)
        body = await page.inner_text("body")

        # The list is what is ahead. The two past ones are not in it.
        r["upcoming_shows_what_is_ahead"] = "School trip soon" in body
        r["past_is_not_in_the_upcoming_list"] = (
            "Dentist last month" not in body and "Bins yesterday" not in body)

        # But it says how much is behind it, and says how many.
        r["earlier_row_present"] = await page.locator(
            '[data-testid="calendar-earlier-toggle"]').count() > 0
        r["earlier_row_counts_them"] = "2" in await page.locator(
            '[data-testid="calendar-earlier-toggle"]').inner_text()

        # Opening it brings them back — held, not hidden.
        await page.click('[data-testid="calendar-earlier-toggle"]')
        await page.wait_for_timeout(600)
        body = await page.inner_text("body")
        r["opening_it_shows_the_past"] = (
            "Dentist last month" in body and "Bins yesterday" in body)
        r["and_keeps_what_is_ahead"] = "School trip soon" in body
        await page.screenshot(path="calendar_earlier_open.png")

        # Closing it puts them away again.
        await page.click('[data-testid="calendar-earlier-toggle"]')
        await page.wait_for_timeout(600)
        r["closing_it_hides_them_again"] = "Dentist last month" not in await page.inner_text("body")

        # Nothing was completed on the way. A date passing is not a decision.
        cards = api("GET", "/cards", None, tok)
        past = [c for c in cards if c["title"] in ("Dentist last month", "Bins yesterday")]
        r["past_events_are_still_open"] = len(past) == 2 and all(
            c["status"] == "OPEN" for c in past)

        r["no_js_errors"] = not errors
        if errors:
            print("page errors:", errors[:3])
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)


asyncio.run(main())
