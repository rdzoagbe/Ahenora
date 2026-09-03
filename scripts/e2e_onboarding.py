"""Setup, driven the way a new parent drives it.

Onboarding is the most consequential screen in the app and had no harness at
all: e2e_firstrun skips it by calling /auth/complete-onboarding directly, so
every check ran against a household that had never seen setup. The four steps
a real person actually walks through were verified by nobody.

What this proves, end to end and through the UI:

  1. The steps advance and the flow finishes.
  2. Alternating custody is ASKED at setup. It was already built — the calendar
     colours each week by ISO parity, the way a French judgment is written —
     behind a button on the Calendar tab, so the one feature a separated parent
     came for could go unfound for a week.
  3. Answering it actually writes the schedule: the server has the parity, and
     the calendar comes up already coloured, with no second setup step.
  4. Saying "one home" writes nothing. An intact family must not end up with a
     custody schedule because they walked past the question.

Usage:  python3 scripts/e2e_onboarding.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
        method=method)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


def register(tag):
    run = uuid.uuid4().hex[:6]
    u = api("POST", "/auth/register", {"name": "Nouveau Parent",
                                       "email": f"{tag}-{run}@sim.test",
                                       "password": "password123"})
    return u["session_token"]


async def onboard(browser, token):
    """Walk the four steps, choosing one custody answer on the invite step."""
    ctx = await browser.new_context(viewport={"width": 390, "height": 844})
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
    await page.goto(f"{WEB}/onboarding", wait_until="domcontentloaded")
    await page.wait_for_timeout(3500)
    return page, ctx


async def main():
    r = {}
    async with async_playwright() as pw:
        br = await launch_chromium(pw)

        # ---- a separated parent: even weeks ------------------------------
        tok = register("sep")
        page, _ = await onboard(br, tok)

        await page.click('[data-testid="onboarding-continue"]')       # 0 -> 1
        await page.wait_for_timeout(500)
        await page.click('[data-testid="onboarding-continue"]')       # 1 -> 2 (invite)
        await page.wait_for_timeout(700)

        body = await page.inner_text("body")
        r["setup_asks_about_two_homes"] = "garde" in body.lower() or "custody" in body.lower()
        # The three answers, and the current week offered as a reference point
        # so nobody has to remember which parity this week is.
        found = []
        for k in ("none", "even", "odd"):
            found.append(await page.locator(f'[data-testid="onboarding-custody-{k}"]').count() == 1)
        r["offers_one_home_and_both_parities"] = all(found)
        r["names_the_current_week"] = "week" in body.lower() or "semaine" in body.lower()

        await page.screenshot(path="onboarding_step.png")
        await page.click('[data-testid="onboarding-custody-even"]')
        await page.wait_for_timeout(300)
        await page.click('[data-testid="onboarding-continue"]')       # 2 -> 3
        await page.wait_for_timeout(500)
        await page.click('[data-testid="onboarding-continue"]')
        await page.wait_for_timeout(3000)

        sub = api("GET", "/subscription", None, tok)
        cust = sub.get("custody") or {}
        r["answering_writes_the_schedule"] = bool(cust.get("enabled"))
        r["writes_the_parity_that_was_picked"] = cust.get("our_weeks") == "even"

        # It has to be ON the calendar afterwards — writing the config and
        # still showing "set up alternating custody" would be the same gap in
        # a new place.
        await page.goto(f"{WEB}/calendar", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        cal = await page.inner_text("body")
        r["calendar_is_already_set_up"] = ("Set up alternating custody" not in cal
                                           and "Configurer" not in cal)
        await page.screenshot(path="onboarding_custody.png")

        # ---- an intact family: one home ----------------------------------
        tok2 = register("one")
        page2, _ = await onboard(br, tok2)
        await page2.click('[data-testid="onboarding-continue"]')
        await page2.wait_for_timeout(500)
        await page2.click('[data-testid="onboarding-continue"]')
        await page2.wait_for_timeout(700)
        await page2.click('[data-testid="onboarding-custody-none"]')
        await page2.wait_for_timeout(300)
        await page2.click('[data-testid="onboarding-continue"]')
        await page2.wait_for_timeout(500)
        await page2.click('[data-testid="onboarding-continue"]')
        await page2.wait_for_timeout(3000)

        sub2 = api("GET", "/subscription", None, tok2)
        r["one_home_writes_nothing"] = not (sub2.get("custody") or {}).get("enabled")
        r["one_home_still_finishes_setup"] = bool(
            api("GET", "/auth/me", None, tok2).get("onboarding_completed"))

        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)


asyncio.run(main())
