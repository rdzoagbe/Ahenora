"""The shopping list knows what things cost, from the family's own receipts.

Everything here is built on scanned receipts, and none of it had a browser
check: each part was unit-tested on its own, and the screens were looked at
by hand. Seeds a French household with four weeks of receipts, then holds,
in a real browser against the real server:

  * a price under each item from its last receipt, "Pas encore de prix" when
    there is none, and "le moins cher" with the saving when two shops are
    surely different (2 visits each);
  * "À racheter bientôt" offers the milk bought every ~6 days and last bought
    7 days ago, adds it in one tap, and then stops offering it;
  * typing on the list offers "De vos tickets", and a tap adds that name;
    a name already on the list is not offered again;
  * the total is the arithmetic of the items' last prices, and names what
    has no price;
  * "Par magasin" groups the list under the cheapest shop, with each shop's
    total, unpriced items under "N'importe où", and is remembered on reload;
  * a scanned receipt (the scan itself stubbed: the reading is Gemini's,
    tested on the server) offers to tick what it shows from the list, ticks
    it on save, says which receipt did it on the list, and can be undone.

The days are counted back from today, so the rhythm is the same on any date.
"""
import asyncio, base64, json, os, sys, tempfile, urllib.request, uuid
from datetime import date, timedelta
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


def day(n):
    return (date.today() - timedelta(days=n)).isoformat()


def line(name, total, qty=1, unit="piece"):
    return {"name": name, "line_total": total, "qty": qty, "unit": unit}


# What the stubbed scan "reads": Carrefour today. Tomates grappe and
# Gingembre frais are on the list as "Tomates" and "Gingembre"; Sel is not.
FAKE_SCAN = {
    "shop": "Carrefour", "date": day(0), "total": 6.47, "lines_total": 6.47, "reconciles": True,
    "items": [
        {"name": "Tomates grappe", "qty": 1, "unit": "kg", "line_total": 2.89, "unit_price": 2.89, "unsure": False},
        {"name": "Gingembre frais", "qty": 1, "unit": "piece", "line_total": 1.49, "unit_price": 1.49, "unsure": False},
        {"name": "Sel fin", "qty": 1, "unit": "piece", "line_total": 2.09, "unit_price": 2.09, "unsure": False},
    ],
}
# Any picture will do: the reading is stubbed.
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


async def text_of(page, test_id):
    loc = page.locator(f'[data-testid="{test_id}"]')
    return await loc.inner_text() if await loc.count() == 1 else ""


async def tap(page, test_id):
    """Click it if it is there. A missing button is a failed check, reported
    with the rest, not a 30-second timeout that hides every later result."""
    loc = page.locator(f'[data-testid="{test_id}"]')
    if await loc.count() != 1:
        return False
    await loc.click()
    return True


async def main():
    u = api("POST", "/auth/register",
            {"name": "Receipt Probe", "email": f"tix-{uuid.uuid4().hex[:6]}@sim.test",
             "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    api("PATCH", "/auth/language", {"language": "fr"}, tok)

    def receipt(shop, n, lines):
        api("POST", "/expenses", {
            "description": shop, "merchant": shop, "category": "Groceries", "spent_on": day(n),
            "amount": round(sum(x["line_total"] for x in lines), 2), "items": lines}, tok)

    # Milk every 6 days, alternating shops: due again (last bought 7 days ago),
    # and two visits at each shop, which is what a sure comparison needs.
    receipt("Lidl", 7, [line("Lait demi-écrémé", 0.99), line("Tomates grappe", 3.69, 1.234, "kg")])
    receipt("Carrefour", 13, [line("Lait demi-écrémé", 1.15)])
    receipt("Lidl", 19, [line("Lait demi-écrémé", 0.99)])
    receipt("Carrefour", 25, [line("Lait demi-écrémé", 1.15)])
    receipt("Boulangerie", 4, [line("Pain de campagne", 2.10)])
    api("POST", "/shopping", {"name": "Tomates"}, tok)
    api("POST", "/shopping", {"name": "Gingembre"}, tok)

    def listed():
        return {i["name"]: i for i in api("GET", "/shopping", t=tok)}

    picture = os.path.join(tempfile.mkdtemp(), "ticket.png")
    with open(picture, "wb") as f:
        f.write(PNG_1PX)

    r = {}
    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, locale="fr-FR")
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        scans = []

        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            if path.startswith("expenses/scan-receipt"):
                scans.append(path)
                await ro.fulfill(status=200, content_type="application/json", body=json.dumps(FAKE_SCAN))
                return
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json",
                             body=await resp.body())

        await page.route("**/api/**", route)
        await page.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")
        await page.goto(f"{WEB}/kitchen?view=shop", wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)

        items = listed()
        tom, gin = items["Tomates"]["item_id"], items["Gingembre"]["item_id"]
        # The receipt's longer name says whose price it is: "Tomates grappe".
        tline = await text_of(page, f"shop-price-{tom}")
        r["price_from_the_last_receipt"] = "Lidl" in tline and "Tomates grappe" in tline and "2,99" in tline
        r["no_price_says_so"] = "Pas encore de prix" in await text_of(page, f"shop-price-{gin}")

        # À racheter bientôt: milk, every ~6 days, last bought a week ago.
        due = await text_of(page, "shop-due")
        r["due_offers_the_milk"] = "À racheter bientôt" in due and "Lait demi-écrémé" in due
        r["due_leaves_out_bread_not_yet_a_habit"] = "Pain" not in due
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            await page.screenshot(path=os.path.join(SHOTS, "shop-receipts-due.png"))
        r["due_has_an_add_button"] = await tap(page, "shop-due-add-0")
        await page.wait_for_timeout(1500)
        items = listed()
        r["due_adds_in_one_tap"] = "Lait demi-écrémé" in items
        r["due_stops_offering_it"] = await page.locator('[data-testid="shop-due"]').count() == 0
        milk = items.get("Lait demi-écrémé", {}).get("item_id")
        mline = await text_of(page, f"shop-price-{milk}")
        # 0,99 at Lidl against 1,15 at Carrefour, two visits each: 0,16 less.
        r["cheapest_shop_and_saving"] = ("Lidl" in mline and "le moins cher" in mline
                                         and "0,16" in mline and "de moins" in mline)

        # De vos tickets: typing offers what the receipts saw.
        box = page.get_by_placeholder("Ajouter — virgules si plusieurs")
        await box.fill("lai")
        await page.wait_for_timeout(600)
        r["already_on_the_list_not_offered"] = await page.locator('[data-testid="shop-suggest-panel"]').count() == 0
        await box.fill("pai")
        await page.wait_for_timeout(600)
        panel = await text_of(page, "shop-suggest-panel")
        # The heading is drawn in capitals, and inner_text reads it as drawn.
        r["suggestions_from_receipts"] = ("de vos tickets" in panel.lower()
                                          and "Pain de campagne" in panel and "2,10" in panel)
        if SHOTS:
            await page.screenshot(path=os.path.join(SHOTS, "shop-receipts-suggest.png"))
        r["suggestion_can_be_tapped"] = await tap(page, "shop-suggest-0")
        await page.wait_for_timeout(1500)
        items = listed()
        r["suggestion_adds_its_name"] = "Pain de campagne" in items
        await box.fill("")
        await page.wait_for_timeout(400)

        # The total: Tomates 3,69 + Lait 0,99 + Pain 2,10 = 6,78, and Gingembre
        # named as the one without a price.
        total = await text_of(page, "shop-total")
        r["total_is_the_sum"] = "6,78" in total and "3 articles" in total
        r["total_names_what_has_no_price"] = "1 sans prix" in total and "Gingembre" in total

        # Par magasin.
        r["store_switch_is_there"] = await tap(page, "shop-view-store")
        await page.wait_for_timeout(800)
        lidl = await text_of(page, "shop-store-head-Lidl")
        bakery = await text_of(page, "shop-store-head-Boulangerie")
        anywhere = await text_of(page, "shop-store-head-anywhere")
        r["store_lidl_has_its_two_and_their_total"] = "2 articles" in lidl and "4,68" in lidl
        r["store_bakery_has_the_bread"] = "1 article" in bakery and "2,10" in bakery
        r["store_unpriced_goes_anywhere"] = "N’importe où" in anywhere
        r["store_milk_goes_to_the_cheaper_shop"] = await page.locator(
            '[data-testid="shop-store-head-Carrefour"]').count() == 0
        heads = []
        for s in ("Lidl", "Boulangerie", "anywhere"):
            loc = page.locator(f'[data-testid="shop-store-head-{s}"]')
            heads.append(await loc.bounding_box() if await loc.count() == 1 else None)
        r["unpriced_comes_last"] = (all(heads) and heads[2]["y"] > max(heads[0]["y"], heads[1]["y"])) or False
        if SHOTS:
            await page.screenshot(path=os.path.join(SHOTS, "shop-receipts-by-store.png"))
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(3000)
        r["store_view_remembered"] = await page.locator('[data-testid="shop-store-head-Lidl"]').count() == 1
        await tap(page, "shop-view-aisle")
        await page.wait_for_timeout(600)

        # A receipt ticks the list.
        await page.get_by_text("Dépenses", exact=True).first.click()
        await page.wait_for_timeout(1500)
        if await page.locator('[data-testid="exp-scan-receipt"]').count() == 1:
            async with page.expect_file_chooser() as fc:
                await page.click('[data-testid="exp-scan-receipt"]')
            await (await fc.value).set_files(picture)
        await page.wait_for_timeout(2500)
        r["scan_was_stubbed_not_sent"] = len(scans) == 1
        box_text = await text_of(page, "exp-tick-box")
        r["receipt_offers_what_it_shows"] = ("Tomates" in box_text and "Gingembre" in box_text
                                             and "Lait" not in box_text)
        r["save_button_counts_them"] = "cocher 2 articles" in await text_of(page, "exp-scan-save")
        if SHOTS and box_text:
            await page.locator('[data-testid="exp-tick-box"]').scroll_into_view_if_needed()
            await page.screenshot(path=os.path.join(SHOTS, "shop-receipts-tick.png"))
        r["receipt_can_be_saved"] = await tap(page, "exp-scan-save")
        await page.wait_for_timeout(2500)
        items = listed()
        r["save_ticks_them"] = (items["Tomates"]["checked"] and items["Gingembre"]["checked"]
                                and not items.get("Lait demi-écrémé", {}).get("checked"))
        r["ticks_say_which_receipt"] = items["Tomates"].get("ticked_from") == "Carrefour"
        await page.get_by_text("Liste", exact=True).first.click()
        await page.wait_for_timeout(1500)
        r["list_says_ticked_from_the_receipt"] = (
            "Coché d’après le ticket Carrefour" in await text_of(page, f"shop-ticked-from-{tom}"))
        await page.get_by_text("Dépenses", exact=True).first.click()
        await page.wait_for_timeout(1200)
        r["undo_is_offered"] = await tap(page, "exp-ticked-undo")
        await page.wait_for_timeout(2000)
        items = listed()
        r["undo_unticks"] = not items["Tomates"]["checked"] and not items["Gingembre"]["checked"]
        r["undo_clears_the_receipt_note"] = not items["Tomates"].get("ticked_from")

        r["no_js_errors"] = not errs
        await browser.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    failures = [k for k, v in r.items() if not v]
    print("ALL PASS" if not failures else f"{len(failures)} FAILURES")
    sys.exit(0 if not failures else 1)


asyncio.run(main())
