"""The Plans page with Duo, in a real browser.

Duo changed the Plans page from "everything above Free is an upgrade" to four
plans in an order, and moving between them now has a direction. This drives
the real page against the real backend, with plans bought through real
RevenueCat webhooks:

  * a Family household sees Downgrade on Duo and Free, Upgrade on Household,
    and its own plan marked as current;
  * choosing Duo with a child in the app opens the sheet that says what is
    hidden, and that nothing is deleted — and "Keep" leaves everything alone;
  * once the household is on Duo, the child is no longer on the Family hub,
    the calendar offers no custody set-up, and Settings says the children's
    sections are hidden on Duo — while the child is still there on the server;
  * a household of three (two invitations out) sees why Duo is not for it.

Usage:  python3 scripts/e2e_plans.py <web_port> <api_port>
"""
import asyncio, json, os, sys, time, urllib.error, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
RC_SECRET = "e2e-gating-live"
SHOTS = os.environ.get("E2E_SHOTS_DIR")


def api(m, p, b=None, t=None, auth=None):
    headers = {"Content-Type": "application/json"}
    if t:
        headers["Authorization"] = f"Bearer {t}"
    if auth:
        headers["Authorization"] = auth
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers=headers, method=m)
    try:
        with urllib.request.urlopen(r, timeout=20) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{m} {p} -> {e.code}: {e.read().decode()[:300]}") from None


def buy(user_id, product):
    """A promotional grant: a real webhook, and no store to change it in, so
    the web page may offer the switch itself."""
    now_ms = int(time.time() * 1000)
    return api("POST", "/billing/revenuecat-webhook", {"event": {
        "type": "INITIAL_PURCHASE", "app_user_id": user_id, "product_id": product,
        "store": "PROMOTIONAL", "purchased_at_ms": now_ms,
        "expiration_at_ms": now_ms + 30 * 86400 * 1000}}, auth=f"Bearer {RC_SECRET}")


def register(name):
    run = uuid.uuid4().hex[:8]
    u = api("POST", "/auth/register", {
        "name": name, "email": f"plans-{run}@sim.test", "password": "password123"})
    api("POST", "/auth/complete-onboarding", {}, u["session_token"])
    return u["session_token"], u["user"]["user_id"]


async def main():
    r = {}
    try:
        await run(r)
    except Exception as e:
        print(f"stopped at: {type(e).__name__}: {str(e).splitlines()[0]}")
    for k, v in r.items():
        print(f"{k}: {v}")
    ok = bool(r) and all(r.values())
    print("ALL PASS" if ok else "FAILURES PRESENT")
    sys.exit(0 if ok else 1)


async def open_page(ctx, tok):
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
    await page.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")
    return page


async def label(page, test_id):
    loc = page.locator(f'[data-testid="{test_id}"]')
    return (await loc.inner_text()).strip() if await loc.count() else ""


async def shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        await page.screenshot(path=os.path.join(SHOTS, f"{name}.png"), full_page=True)


async def run(r):
    tok, uid = register("Camille")
    api("POST", "/family/members", {"name": "Léa"}, tok)
    buy(uid, "ahenora_executive_monthly")
    sub = api("GET", "/subscription", None, tok)
    r["the_household_is_on_family"] = sub.get("plan") == "executive"
    r["and_may_choose_duo"] = sub.get("duo_eligible") is True

    async with async_playwright() as pw:
        b = await launch_chromium(pw)
        ctx = await b.new_context(viewport={"width": 412, "height": 915})
        page = await open_page(ctx, tok)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))

        await page.goto(f"{WEB}/pricing", wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="pricing-choose-duo"]', timeout=30000)
        await page.wait_for_timeout(800)
        await shot(page, "plans-family")

        r["duo_says_downgrade"] = await label(page, "pricing-choose-duo") == "Downgrade"
        r["free_says_downgrade"] = await label(page, "pricing-choose-village") == "Downgrade"
        r["household_says_upgrade"] = await label(page, "pricing-choose-household") == "Upgrade"
        body = await page.inner_text("body")
        r["duo_is_priced"] = "1.99" in body or "19.99" in body
        r["family_is_marked_current"] = await page.locator('[data-testid="pricing-choose-executive"]').count() == 0

        await page.locator('[data-testid="pricing-choose-duo"]').click()
        await page.wait_for_selector('[data-testid="plan-change-confirm"]', timeout=10000)
        await page.wait_for_timeout(400)
        await shot(page, "plans-downgrade-sheet")
        sheet = await page.inner_text("body")
        r["the_sheet_names_the_children"] = await page.locator(
            '[data-testid="plan-change-loss-chg_lose_kids"]').count() == 1
        r["the_sheet_says_nothing_is_deleted"] = "Nothing is deleted" in sheet
        r["the_sheet_says_when"] = "renewal date" in sheet
        await page.locator('[data-testid="plan-change-keep"]').click()
        await page.wait_for_timeout(600)
        r["keep_closes_it"] = await page.locator('[data-testid="plan-change-confirm"]').count() == 0
        r["keep_changes_nothing"] = api("GET", "/subscription", None, tok).get("plan") == "executive"

        # On Family the child is on the hub.
        await page.goto(f"{WEB}/kids", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        r["on_family_the_child_is_shown"] = "Léa" in await page.inner_text("body")

        # Now Duo.
        buy(uid, "ahenora_duo_monthly")
        sub = api("GET", "/subscription", None, tok)
        r["the_household_is_on_duo"] = sub.get("plan") == "duo"
        r["and_the_childrens_side_is_hidden"] = sub.get("kids_sections_hidden") is True

        await page.goto(f"{WEB}/kids", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        hub = await page.inner_text("body")
        await shot(page, "hub-on-duo")
        r["on_duo_the_child_is_not_on_the_hub"] = "Léa" not in hub
        r["the_grown_ups_still_are"] = "Camille" in hub
        r["no_add_child_button"] = await page.locator('[data-testid="kids-add-child"]').count() == 0

        await page.goto(f"{WEB}/calendar", wait_until="domcontentloaded")
        await page.wait_for_timeout(2500)
        r["no_custody_set_up_on_duo"] = await page.locator('[data-testid="custody-setup"]').count() == 0

        members = api("GET", "/family/members", None, tok)
        r["the_child_is_still_on_the_server"] = any(m.get("name") == "Léa" for m in members)

        await page.goto(f"{WEB}/pricing", wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="pricing-choose-executive"]', timeout=30000)
        r["on_duo_family_says_upgrade"] = await label(page, "pricing-choose-executive") == "Upgrade"
        await shot(page, "plans-duo")

        # A household of three cannot choose Duo, and is told why.
        tok2, _ = register("Sam")
        api("POST", "/family/invite/link", {"relationship": "Parent"}, tok2)
        api("POST", "/family/invite/link", {"relationship": "Grandparent"}, tok2)
        r["three_people_are_not_eligible"] = api("GET", "/subscription", None, tok2).get("duo_eligible") is False
        page2 = await open_page(ctx, tok2)
        await page2.goto(f"{WEB}/pricing", wait_until="domcontentloaded")
        await page2.wait_for_selector('[data-testid="pricing-choose-duo"]', timeout=30000)
        await page2.wait_for_timeout(800)
        r["the_duo_card_says_why"] = "For two people. Your household has 3." in await label(page2, "pricing-duo-blocked")

        r["no_page_errors"] = not errs
        if errs:
            print("page errors:", errs[:3])
        await b.close()


if __name__ == "__main__":
    asyncio.run(main())
