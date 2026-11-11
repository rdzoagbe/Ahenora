"""Health details are not lost by mistake, and can still be erased.

Roland, 2026-11-11: health details should not be lost. The law (GDPR art.
7(3), 17(1)(b)) says a parent must still be able to erase one, at any time.
Held in a real browser against the real server, on a French household:

  * a medicine no longer taken is "Arrêter"-ed: it moves to "Médicaments
    passés" with the day it stopped, and "Reprendre" brings it back;
  * erasing asks first, naming the medicine and saying it goes at once;
  * it is gone from the SERVER straight away, and "Annuler" (10 seconds)
    writes it back, dose and times included;
  * a vaccination: the same, named in the question.

tests/test_what_somebody_is_taking.py holds the server's side.
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


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=os.path.join(SHOTS, name))


async def main():
    u = api("POST", "/auth/register",
            {"name": "Roland", "email": f"health-{uuid.uuid4().hex[:6]}@sim.test",
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
    child = api("POST", "/family/members", {"name": "Léa"}, tok)
    mid = child["member_id"]
    rec = api("POST", f"/family/members/{mid}/medicines",
              {"name": "Amoxicilline", "dose": "5 ml", "times": ["08:00", "20:00"]}, tok)
    med = rec["medicines"][0]["med_id"]
    rec = api("POST", f"/family/members/{mid}/vaccinations",
              {"name": "ROR", "given_on": "2025-03-01"}, tok)
    vax = rec["vaccinations"][0]["vax_id"]

    def record():
        return api("GET", f"/family/members/{mid}/record", t=tok)

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
        await page.goto(f"{WEB}/member?id={mid}&name=L%C3%A9a&role=child", wait_until="domcontentloaded")
        await page.wait_for_selector(f'[data-testid="med-{med}"]', timeout=20000)
        await page.wait_for_timeout(500)

        # Stop it: kept, among the past ones, with the day.
        await page.locator(f'[data-testid="med-stop-{med}"]').click()
        await page.wait_for_selector(f'[data-testid="med-past-{med}"]', timeout=10000)
        today = date.today().isoformat()
        r["stopping_keeps_it_on_the_server"] = [m["stopped_on"] for m in record()["medicines"]] == [today]
        # The heading is drawn in capitals, like every heading on the record.
        r["it_is_among_the_past_ones"] = "médicaments passés" in (await page.locator(
            '[data-testid="record-medicines-past"]').inner_text()).lower()
        r["with_the_day_it_stopped"] = f"Arrêté le {today}" in await page.locator(
            f'[data-testid="med-stopped-{med}"]').inner_text()
        r["nothing_taken_now_is_said_so"] = "Aucun en ce moment." in await page.locator(
            '[data-testid="record-medicines"]').inner_text()
        await page.locator('[data-testid="record-medicines"]').scroll_into_view_if_needed()
        await shot(page, "health-past-medicine.png")

        # Taken again.
        await page.locator(f'[data-testid="med-resume-{med}"]').click()
        await page.wait_for_selector(f'[data-testid="med-stop-{med}"]', timeout=10000)
        r["it_can_be_taken_again"] = record()["medicines"][0]["stopped_on"] == ""

        # Erase: asked first, named; gone from the server at once; Annuler.
        await page.locator(f'[data-testid="med-remove-{med}"]').click()
        await page.wait_for_selector('[data-testid="toast-action"]', timeout=10000)
        r["erasing_asks_first_naming_it"] = bool(dialogs) and "Amoxicilline" in dialogs[-1] \
            and "10 secondes" in dialogs[-1]
        r["it_is_gone_from_the_server_at_once"] = record()["medicines"] == []
        await page.wait_for_timeout(400)
        await shot(page, "health-erased-undo.png")
        await page.wait_for_timeout(5000)  # past the usual 6 s of other toasts
        r["annuler_is_still_there_after_6_seconds"] = await page.locator('[data-testid="toast-action"]').count() == 1
        await page.locator('[data-testid="toast-action"]').click()
        await page.wait_for_timeout(1500)
        back = record()["medicines"]
        r["annuler_writes_it_back_whole"] = len(back) == 1 and back[0]["name"] == "Amoxicilline" \
            and back[0]["dose"] == "5 ml" and back[0]["times"] == ["08:00", "20:00"]
        r["and_the_screen_shows_it"] = "Amoxicilline" in await page.locator(
            '[data-testid="record-medicines"]').inner_text()

        # A vaccination: named in the question, erased, put back.
        await page.wait_for_timeout(2500)
        before = len(dialogs)
        await page.locator(f'[data-testid="vax-remove-{vax}"]').click()
        await page.wait_for_selector('[data-testid="toast-action"]', timeout=10000)
        r["a_vaccination_is_named_too"] = len(dialogs) == before + 1 and "ROR" in dialogs[-1]
        r["the_vaccination_is_gone_at_once"] = record()["vaccinations"] == []
        await page.locator('[data-testid="toast-action"]').click()
        await page.wait_for_timeout(1500)
        vback = record()["vaccinations"]
        r["and_comes_back_with_its_date"] = len(vback) == 1 and vback[0]["given_on"] == "2025-03-01"

        r["no_page_errors"] = not errs
        if errs:
            print("page errors:", errs[:3])
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
