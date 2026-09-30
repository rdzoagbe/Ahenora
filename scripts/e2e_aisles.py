"""The shopping list sorts itself into aisles, and a household can re-sort it.

Roland, 2026-09-30: "every item we put there just goes in, but the category
side is not given — tomatoes should go to one category, washing liquid and
toilet paper to cleaning". He sent a grocery app as the picture of it: each
aisle a small labelled pill that folds away, round ticks, the amount in a tag.

Holds, in a real browser against the real server:
  * items added WITHOUT an aisle (the + button, a typed message) are sorted by
    the server, and items typed on the Kitchen list are too;
  * the aisles appear in the order a shop is walked;
  * "Tomatoes 400g" shows as "Tomatoes" with a "400g" tag;
  * moving an item to another aisle sticks, and the next time the household
    adds it, it lands there;
  * an aisle folds away and comes back.
"""
import asyncio, json, os, sys, urllib.request, uuid
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
            {"name": "Aisle Probe", "email": f"aisle-{uuid.uuid4().hex[:6]}@sim.test",
             "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    # The way the + button and a typed message add: a name and no aisle.
    api("POST", "/shopping", {"name": "Washing liquid"}, tok)
    api("POST", "/shopping", {"name": "Toilet paper"}, tok)

    r = {}
    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
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
            await ro.fulfill(status=resp.status, content_type="application/json",
                             body=await resp.body())

        await page.route("**/api/**", route)
        await page.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")

        await page.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await page.wait_for_timeout(2600)
        box = page.get_by_placeholder("Add items — commas for several")
        await box.fill("Tomatoes 400g, Milk x2, Pampers")
        await box.press("Enter")
        await page.wait_for_timeout(900)
        # Roland: "when I add an item, tell me where it has been added, so I
        # don't have to go and look." Several at once are counted by aisle.
        said = await page.inner_text("body")
        r["adding_several_says_which_aisles"] = (
            "3 added:" in said and "Fruit & veg (1)" in said and "Baby (1)" in said)
        await page.wait_for_timeout(3500)
        await box.fill("Bananas")
        await box.press("Enter")
        await page.wait_for_timeout(900)
        r["adding_one_says_its_aisle"] = "Added to Fruit & veg: Bananas" in await page.inner_text("body")
        if SHOTS:
            await page.screenshot(path=os.path.join(SHOTS, "aisles-toast.png"), full_page=False)
        await page.wait_for_timeout(3500)

        items = {i["name"]: i for i in api("GET", "/shopping", t=tok)}
        r["server_sorted_the_plus_button_adds"] = (
            items.get("Washing liquid", {}).get("category") == "Household"
            and items.get("Toilet paper", {}).get("category") == "Household")
        r["typed_items_sorted"] = (
            items.get("Tomatoes 400g", {}).get("category") == "Produce"
            and items.get("Milk x2", {}).get("category") == "Dairy"
            and items.get("Pampers", {}).get("category") == "Baby")

        heads = {}
        for aisle in ("Produce", "Dairy", "Household", "Baby"):
            loc = page.locator(f'[data-testid="shop-aisle-head-{aisle}"]')
            heads[aisle] = (await loc.bounding_box()) if await loc.count() == 1 else None
        r["every_aisle_has_its_heading"] = all(heads.values())
        if all(heads.values()):
            ys = [heads[a]["y"] for a in ("Produce", "Dairy", "Household", "Baby")]
            r["aisles_in_walking_order"] = ys == sorted(ys)
        else:
            r["aisles_in_walking_order"] = False
        body = await page.inner_text("body")
        r["aisle_names_are_words_not_codes"] = (
            "Fruit & veg" in body and "Cleaning & household" in body
            and "Produce" not in body)
        r["amount_in_its_own_tag"] = "400g" in body and "Tomatoes 400g" not in body

        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            await page.locator('[data-testid="shop-aisle-head-Produce"]').scroll_into_view_if_needed()
            await page.screenshot(path=os.path.join(SHOTS, "aisles-list.png"), full_page=False)

        # Move the milk to Frozen: this household keeps it in the freezer.
        milk = items["Milk x2"]["item_id"]
        await page.click(f'[data-testid="shop-aisle-{milk}"]')
        await page.wait_for_timeout(700)
        r["picker_opens"] = await page.locator('[data-testid="aisle-pick-Frozen"]').count() == 1
        if SHOTS:
            await page.screenshot(path=os.path.join(SHOTS, "aisles-picker.png"), full_page=False)
        await page.click('[data-testid="aisle-pick-Frozen"]')
        await page.wait_for_timeout(1200)
        after = {i["name"]: i for i in api("GET", "/shopping", t=tok)}
        r["move_is_saved"] = after["Milk x2"]["category"] == "Frozen"
        r["moved_item_shows_under_its_new_aisle"] = await page.locator(
            '[data-testid="shop-aisle-head-Frozen"]').count() == 1
        again = api("POST", "/shopping", {"name": "milk"}, tok)
        r["next_time_it_lands_there"] = again.get("category") == "Frozen"

        # Fold an aisle away, and bring it back.
        await page.click('[data-testid="shop-aisle-head-Household"]')
        await page.wait_for_timeout(500)
        r["aisle_folds_away"] = "Toilet paper" not in await page.inner_text("body")
        await page.click('[data-testid="shop-aisle-head-Household"]')
        await page.wait_for_timeout(500)
        r["aisle_comes_back"] = "Toilet paper" in await page.inner_text("body")

        # The same list in dark mode: every aisle tint comes from the theme,
        # and a section band that only works on white would be unreadable.
        dark = await browser.new_context(viewport={"width": 390, "height": 844})
        dpage = await dark.new_page()
        dpage.on("pageerror", lambda e: errs.append(str(e)))

        async def droute(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await dark.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json",
                             body=await resp.body())

        await dpage.route("**/api/**", droute)
        await dpage.add_init_script(
            f"localStorage.setItem('coo_session_token','{tok}');"
            "localStorage.setItem('coo_appearance_mode_minimal_light_v5','dark');")
        await dpage.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await dpage.wait_for_timeout(2600)
        r["dark_mode_shows_the_sections"] = await dpage.locator(
            '[data-testid="shop-aisle-head-Produce"]').count() == 1
        if SHOTS:
            await dpage.locator('[data-testid="shop-aisle-head-Produce"]').scroll_into_view_if_needed()
            await dpage.screenshot(path=os.path.join(SHOTS, "aisles-dark.png"), full_page=False)

        r["no_js_errors"] = not errs
        await browser.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    failures = [k for k, v in r.items() if not v]
    print("ALL PASS" if not failures else f"{len(failures)} FAILURES")
    sys.exit(0 if not failures else 1)


asyncio.run(main())
