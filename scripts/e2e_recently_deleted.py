"""Recently deleted, in a real browser against the real server.

Asked for on 2026-11-10: "if I mistakenly deleted my list I can restore
recently deleted without putting back all the list, and it should be the same
for any place where we have data stored, documents etc." Holds, on a French
household:

  * deleting items from the shopping list offers "Annuler", and it brings
    them back;
  * clearing the whole list puts it in Récemment supprimés as ONE row
    ("3 articles d'une liste vidée") that opens onto its items;
  * one item of that list comes back alone, the rest stay in the bin;
  * an expense deleted elsewhere is there too, and comes back;
  * "Effacer" erases one thing now, and "Vider" empties the bin, each after
    a confirmation;
  * the bin is reached from Réglages.

tests/test_recently_deleted.py holds the server's side (privacy, helpers,
the Coffre's storage, the 30 days).
"""
import asyncio, json, os, sys, traceback, urllib.request, uuid
from datetime import date
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


def names(tok):
    return sorted(i["name"] for i in api("GET", "/shopping", t=tok))


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=os.path.join(SHOTS, name))


async def main():
    u = api("POST", "/auth/register",
            {"name": "Roland", "email": f"bin-{uuid.uuid4().hex[:6]}@sim.test",
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
    for n in ("Lait", "Pain", "Oeufs"):
        api("POST", "/shopping", {"name": n}, tok)
    items = {i["name"]: i["item_id"] for i in api("GET", "/shopping", t=tok)}

    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, locale="fr-FR",
                                        device_scale_factor=2)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        dialogs = []

        async def on_dialog(d):
            dialogs.append(d.message)
            await d.accept()
        page.on("dialog", lambda d: asyncio.ensure_future(on_dialog(d)))

        # The web build points at one port; each harness gets its own server.
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
        await page.goto(f"{WEB}/kitchen?view=shop", wait_until="domcontentloaded")
        await page.wait_for_selector(f'[data-testid="shop-item-{items["Lait"]}"]', timeout=20000)
        await page.wait_for_timeout(500)

        # Delete one item, then "Annuler".
        await page.locator('[data-testid="shop-select-mode"]').click()
        await page.locator(f'[data-testid="shop-item-{items["Lait"]}"]').click()
        await page.locator('[data-testid="shop-delete-selected"]').click()
        await page.wait_for_selector('[data-testid="toast-action"]', timeout=10000)
        r["a_delete_offers_annuler"] = (await page.locator('[data-testid="toast-action"]').inner_text()).strip() == "Annuler"
        r["the_item_left_the_list"] = names(tok) == ["Oeufs", "Pain"]
        await page.wait_for_timeout(600)
        await shot(page, "bin-undo-toast.png")
        await page.locator('[data-testid="toast-action"]').click()
        await page.wait_for_timeout(1500)
        r["annuler_brings_it_back"] = names(tok) == ["Lait", "Oeufs", "Pain"]
        r["and_the_list_shows_it"] = await page.locator(f'[data-testid="shop-item-{items["Lait"]}"]').count() == 1

        # Clear the whole list.
        await page.locator('[data-testid="shop-clear-all"]').click()
        await page.wait_for_timeout(1500)
        r["clearing_asked_first"] = len(dialogs) == 1
        r["the_list_is_empty"] = names(tok) == []

        # An expense deleted elsewhere.
        exp = api("POST", "/expenses", {"description": "Pharmacie", "amount": 12.5,
                                        "spent_on": date.today().isoformat()}, tok)
        api("DELETE", f"/expenses/{exp['expense_id']}", t=tok)

        # The bin, from Réglages.
        await page.goto(f"{WEB}/settings", wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="settings-group-more"]', timeout=20000)
        await page.locator('[data-testid="settings-group-more"]').scroll_into_view_if_needed()
        await page.locator('[data-testid="settings-group-more"]').click()
        await page.wait_for_selector('[data-testid="settings-trash"]', timeout=10000)
        await page.locator('[data-testid="settings-trash"]').scroll_into_view_if_needed()
        r["settings_names_the_bin"] = "Récemment supprimés" in await page.locator('[data-testid="settings-trash"]').inner_text()
        await page.locator('[data-testid="settings-trash"]').click()
        await page.wait_for_selector('[data-testid^="trash-batch-"]', timeout=20000)
        await page.wait_for_timeout(500)
        body = await page.locator("body").inner_text()
        r["the_cleared_list_is_one_row"] = "3 articles d’une liste vidée" in body
        r["the_expense_is_there"] = "Pharmacie" in body and "Dépense" in body
        r["says_who_and_how_long"] = "Supprimé par Roland" in body and "encore 30 jours" in body
        await shot(page, "bin-list.png")

        batch = (await page.locator('[data-testid^="trash-batch-open-"]').first.get_attribute("data-testid")).split("trash-batch-open-", 1)[1]
        await page.locator(f'[data-testid="trash-batch-open-{batch}"]').click()
        await page.wait_for_timeout(500)
        bin_rows = {e["label"]: e["trash_id"] for e in api("GET", "/trash", t=tok)}
        shown = [await page.locator(f'[data-testid="trash-{bin_rows[n]}"]').count() for n in ("Lait", "Pain", "Oeufs")]
        r["the_list_opens_onto_its_items"] = shown == [1, 1, 1]
        await shot(page, "bin-list-open.png")

        # One item back alone.
        await page.locator(f'[data-testid="trash-restore-{bin_rows["Pain"]}"]').click()
        await page.wait_for_timeout(1500)
        r["one_item_comes_back_alone"] = names(tok) == ["Pain"]
        r["the_rest_stays_in_the_bin"] = sorted(e["label"] for e in api("GET", "/trash", t=tok) if e["kind"] == "shopping_item") == ["Lait", "Oeufs"]

        # The expense back.
        exp_trash = bin_rows["Pharmacie · 12.50"]
        await page.locator(f'[data-testid="trash-restore-{exp_trash}"]').click()
        await page.wait_for_timeout(1500)
        r["the_expense_comes_back"] = any(e["expense_id"] == exp["expense_id"] for e in api("GET", "/expenses?days=30", t=tok))

        # Erase one now, then empty the rest.
        before = len(dialogs)
        await page.locator(f'[data-testid="trash-erase-{bin_rows["Lait"]}"]').click()
        await page.wait_for_timeout(1500)
        r["erasing_asks_first"] = len(dialogs) == before + 1
        r["erase_takes_it_for_good"] = [e["label"] for e in api("GET", "/trash", t=tok)] == ["Oeufs"]
        await page.locator('[data-testid="trash-empty-all"]').click()
        await page.wait_for_timeout(1500)
        r["emptying_asks_first"] = len(dialogs) == before + 2
        r["the_bin_is_empty"] = api("GET", "/trash", t=tok) == []
        r["and_says_so"] = await page.locator('[data-testid="trash-empty"]').count() == 1
        await shot(page, "bin-empty.png")

        r["no_page_errors"] = not errs
        if errs:
            print("page errors:", errs[:3])
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
