"""A receipt too long for one photo, and a receipt that comes as a file.

Asked for on 2026-11-10: "what if the receipt is too long and the system
cannot scan and read it? What's the workaround?" Holds, in a real browser
against the real server, on a French household:

  * the top half of a long receipt (no total in it) is read, the amount is the
    sum of its lines and the review SAYS so, with no false "it adds up";
  * "Ajouter la suite du ticket" photographs the rest, and BOTH photos go up
    together (`images_base64`) to be read as one receipt; the review then
    shows the printed total, "Lu en 2 photos", and lines it could not read;
  * saving files one expense, at the printed total;
  * "Importer un ticket" sends a PDF as a PDF (`pdf_base64`);
  * a ".png" that is not a picture reaches the REAL server, which cannot open
    it, and the sheet says so — not "server trouble".

The reading itself is stubbed: it is Gemini's, and the server's tests
(tests/test_a_long_receipt_is_read.py) hold that side.
"""
import asyncio, base64, json, os, sys, traceback, urllib.request, uuid
from datetime import date
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
SHOTS = os.environ.get("E2E_SHOTS_DIR")
TODAY = date.today().isoformat()


def ln(name, qty, unit, total, unsure=False):
    return {"name": name, "qty": qty, "unit": unit, "line_total": total,
            "unit_price": round(total / qty, 4), "unsure": unsure}


TOP = [ln("Eau source Cristaline", 4, "piece", 4.80), ln("Lait demi-écrémé 6x1 L", 2, "piece", 13.90),
       ln("Pommes de terre", 1, "piece", 3.99)]
REST = [ln("Oignons 1 kg", 1, "piece", 3.99), ln("Échalotes 200 g", 1, "piece", 0.65),
        ln("Champignons blancs 100 g", 3, "piece", 2.97)]
# What the stub "reads": the top alone, then both photos as one receipt.
READ_TOP = {"shop": "Marché Frais", "date": TODAY, "total": None, "lines_total": 22.69,
            "reconciles": None, "items": TOP, "skipped": 0, "left_out": 0, "parts": 1}
READ_BOTH = {"shop": "Marché Frais", "date": TODAY, "total": 31.65, "lines_total": 30.30,
             "reconciles": False, "items": TOP + REST, "skipped": 1, "left_out": 0, "parts": 2}
READ_PDF = {"shop": "Carrefour", "date": TODAY, "total": 4.80, "lines_total": 4.80,
            "reconciles": True, "items": TOP[:1], "skipped": 0, "left_out": 0, "parts": 1}

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
PNG2 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
PDF = b"%PDF-1.4\n3 0 obj << /Type /Page >> endobj\n%%EOF\n"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def text_of(page, test_id):
    loc = page.locator(f'[data-testid="{test_id}"]')
    return await loc.inner_text() if await loc.count() == 1 else ""


async def shot(page, name):
    if SHOTS:
        await page.screenshot(path=os.path.join(SHOTS, name))


async def choose(page, test_id, files):
    async with page.expect_file_chooser(timeout=10000) as chooser:
        await page.locator(f'[data-testid="{test_id}"]').click()
    await (await chooser.value).set_files(files)


async def main():
    u = api("POST", "/auth/register",
            {"name": "Long Receipt", "email": f"longrx-{uuid.uuid4().hex[:6]}@sim.test",
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
    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844}, locale="fr-FR",
                                        device_scale_factor=2)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        sent = []

        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            body = json.loads(ro.request.post_data or "{}") if path.startswith("expenses/scan-receipt") else {}
            if path.startswith("expenses/scan-receipt"):
                images = body.get("images_base64") or ([body["image_base64"]] if body.get("image_base64") else [])
                decoded = [base64.b64decode(i) for i in images]
                answer = None
                if body.get("pdf_base64"):
                    answer = READ_PDF
                elif decoded == [PNG]:
                    answer = READ_TOP
                elif decoded == [PNG, PNG2]:
                    answer = READ_BOTH
                if answer is not None:
                    sent.append(body)
                    await ro.fulfill(status=200, content_type="application/json", body=json.dumps(answer))
                    return
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())

        await page.route("**/api/**", route)
        await page.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")
        await page.goto(f"{WEB}/expenses", wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="exp-scan-receipt"]', timeout=20000)
        await page.wait_for_timeout(500)
        r["offers_a_receipt_file"] = "Importer un ticket" in await text_of(page, "exp-scan-file")

        # A ".png" that is not a picture: the REAL server says it cannot open it.
        await choose(page, "exp-scan-file", {"name": "ticket.png", "mimeType": "image/png",
                                             "buffer": b"\x89PNG\r\n\x1a\n" + b"0" * 400})
        await page.wait_for_timeout(1500)
        body = await page.locator("body").inner_text()
        r["a_broken_picture_is_told_by_the_real_server"] = "n’est pas un PDF, JPG ou PNG" in body and not sent

        # The top of a long receipt: no total in it.
        await choose(page, "exp-scan-receipt", {"name": "haut.png", "mimeType": "image/png", "buffer": PNG})
        await page.wait_for_selector('[data-testid="exp-scan-line-0"]', timeout=15000)
        await page.wait_for_timeout(500)
        r["the_top_is_read_alone"] = len(sent) == 1 and base64.b64decode(sent[0].get("image_base64", "")) == PNG
        r["no_total_is_said_not_hidden"] = "Le total n’a pas été lu" in await text_of(page, "exp-scan-no-total")
        r["no_false_mismatch_without_a_total"] = "mais le ticket indique" not in await page.locator("body").inner_text()
        r["amount_is_the_sum_of_the_lines"] = (await page.locator('[data-testid="exp-scan-total"]').input_value()) == "22,69"
        r["offers_the_rest"] = "Ajouter la suite du ticket" in await text_of(page, "exp-scan-add-part")
        await page.locator('[data-testid="exp-scan-add-part"]').scroll_into_view_if_needed()
        await shot(page, "receipt-top-half.png")

        # The person corrects the shop before adding the rest: kept.
        await page.locator('[data-testid="exp-scan-shop"]').fill("Marché Frais Argenteuil")

        # The rest: both photos go up together, as one receipt.
        await choose(page, "exp-scan-add-part", {"name": "bas.png", "mimeType": "image/png", "buffer": PNG2})
        await page.wait_for_selector('[data-testid="exp-scan-parts"]', timeout=15000)
        await page.wait_for_timeout(500)
        both = sent[-1] if sent else {}
        r["both_photos_go_up_together"] = (len(sent) == 2 and
                                          [base64.b64decode(i) for i in both.get("images_base64", [])] == [PNG, PNG2])
        r["says_two_photos"] = "Lu en 2 photos" in await text_of(page, "exp-scan-parts")
        r["a_corrected_shop_stays_corrected"] = (await page.locator('[data-testid="exp-scan-shop"]').input_value()) == "Marché Frais Argenteuil"
        r["the_printed_total_is_used"] = (await page.locator('[data-testid="exp-scan-total"]').input_value()) == "31,65"
        r["no_total_note_is_gone"] = await page.locator('[data-testid="exp-scan-no-total"]').count() == 0
        r["says_a_line_was_left_out"] = "1 ligne(s) illisible(s)" in await text_of(page, "exp-scan-missed")
        r["all_six_lines_listed"] = await page.locator('[data-testid^="exp-scan-line-"]').count() == 6
        await page.locator('[data-testid="exp-scan-parts"]').scroll_into_view_if_needed()
        await shot(page, "receipt-two-parts.png")

        await page.locator('[data-testid="exp-scan-save"]').click()
        await page.wait_for_timeout(2000)
        saved = api("GET", "/expenses?days=30", t=tok)
        r["one_expense_at_the_printed_total"] = len(saved) == 1 and abs(float(saved[0]["amount"]) - 31.65) < 0.001

        # A PDF receipt.
        await page.wait_for_selector('[data-testid="exp-scan-file"]', timeout=10000)
        await choose(page, "exp-scan-file", {"name": "ticket.pdf", "mimeType": "application/pdf", "buffer": PDF})
        await page.wait_for_selector('[data-testid="exp-scan-line-0"]', timeout=15000)
        last = sent[-1] if sent else {}
        r["a_pdf_goes_up_as_a_pdf"] = base64.b64decode(last.get("pdf_base64", "")) == PDF
        r["no_add_part_for_a_pdf"] = await page.locator('[data-testid="exp-scan-add-part"]').count() == 0

        r["no_page_errors"] = not errs
        if errs:
            print("page errors:", errs[:3])
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
