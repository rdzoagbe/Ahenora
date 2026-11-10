"""A shopping list that arrived as a PDF goes on the shopping list.

Asked for on 2026-11-10 ("Can I import a pdf shopping list in the app?").
Holds, in a real browser against the real server, on a French household:

  * the scan sheet offers "Importer un PDF" beside the camera and the gallery;
  * the PDF picked is what reaches the server, as `pdf_base64` (a PDF, not a
    photo, and not a data URL);
  * the read comes back as the same ticked review a photo gets, unsure lines
    unticked, says it was read from the PDF, and offers another FILE rather
    than another photo;
  * "Ajouter" puts exactly the ticked items on the list;
  * a file that is not a PDF, or one too heavy for a shopping list, is said
    so in the sheet and never uploaded;
  * a file called .pdf that is not one inside is told "not a PDF" by the
    real server (its header), and the sheet says so — not "server trouble".

The reading itself is stubbed: it is Gemini's, and the server's tests
(tests/test_a_pdf_shopping_list_is_read.py) hold that side.
"""
import asyncio, base64, json, os, sys, traceback, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
SHOTS = os.environ.get("E2E_SHOTS_DIR")

READ = {"items": [
    {"name": "Lait demi-écrémé 1 L", "unsure": False},
    {"name": "Pain de campagne", "unsure": False},
    {"name": "Œufs x12", "unsure": False},
    {"name": "Pommes Gala 1 kg", "unsure": True},
]}
# Enough of a PDF for the picker and the checks before the upload.
PDF = (b"%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
       b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
       b"3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF\n")


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


async def pick(page, files):
    """Tap "Importer un PDF" and answer the file chooser it opens."""
    async with page.expect_file_chooser(timeout=10000) as chooser:
        await page.locator('[data-testid="scan-pdf"]').click()
    await (await chooser.value).set_files(files)


async def main():
    u = api("POST", "/auth/register",
            {"name": "Pdf Probe", "email": f"pdf-{uuid.uuid4().hex[:6]}@sim.test",
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
            body = json.loads(ro.request.post_data or "{}") if path.startswith("shopping/scan") else {}
            # Only a real PDF is "read" here; anything else goes to the real
            # server, which turns it away on its header before any model.
            if path.startswith("shopping/scan") and base64.b64decode(body.get("pdf_base64", "")).startswith(b"%PDF-"):
                sent.append(body)
                await ro.fulfill(status=200, content_type="application/json", body=json.dumps(READ))
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
        await page.wait_for_selector('[data-testid="shop-scan"]', timeout=20000)
        await page.locator('[data-testid="shop-scan"]').click()
        await page.wait_for_selector('[data-testid="scan-pdf"]', timeout=10000)
        await page.wait_for_timeout(400)

        r["offers_a_pdf_beside_camera_and_gallery"] = (
            await page.locator('[data-testid="scan-camera"]').count() == 1
            and await page.locator('[data-testid="scan-gallery"]').count() == 1
            and "Importer un PDF" in await text_of(page, "scan-pdf"))
        await shot(page, "shopping-pdf-sheet.png")

        # Not a PDF: said in the sheet, nothing uploaded.
        await pick(page, {"name": "photo.jpg", "mimeType": "image/jpeg", "buffer": b"\xff\xd8\xff" + b"0" * 64})
        await page.wait_for_timeout(500)
        body = await page.locator("body").inner_text()
        r["a_photo_picked_here_is_not_a_pdf"] = "Ce fichier n’est pas un PDF." in body and not sent

        # Too heavy for a shopping list: said, nothing uploaded.
        await pick(page, {"name": "catalogue.pdf", "mimeType": "application/pdf",
                          "buffer": PDF + b"%" + b"x" * (5 * 1024 * 1024) + b"\n"})
        await page.wait_for_timeout(800)
        body = await page.locator("body").inner_text()
        r["a_heavy_pdf_is_turned_away_before_upload"] = "trop long pour une liste de courses" in body and not sent

        # Called .pdf, a PNG inside: the real server reads the header.
        await pick(page, {"name": "liste.pdf", "mimeType": "application/pdf",
                          "buffer": b"\x89PNG\r\n\x1a\n" + b"0" * 400})
        await page.wait_for_timeout(1500)
        body = await page.locator("body").inner_text()
        r["a_renamed_picture_is_told_not_a_pdf_by_the_server"] = "Ce fichier n’est pas un PDF." in body and not sent

        # The real thing.
        await pick(page, {"name": "liste.pdf", "mimeType": "application/pdf", "buffer": PDF})
        await page.wait_for_selector('[data-testid="scan-item-0"]', timeout=15000)
        await page.wait_for_timeout(400)
        payload = sent[0] if sent else {}
        r["the_pdf_itself_reaches_the_server"] = (
            len(sent) == 1 and "image_base64" not in payload
            and base64.b64decode(payload.get("pdf_base64", "")) == PDF)
        body = await page.locator("body").inner_text()
        r["the_review_lists_what_was_read"] = all(i["name"] in body for i in READ["items"])
        r["it_says_it_was_read_from_the_pdf"] = "depuis votre PDF" in body and "Choisir un autre fichier" in body
        r["the_sheet_is_no_longer_titled_photo"] = "Lire une liste" in body and "Depuis votre photo" not in body
        await shot(page, "shopping-pdf-review.png")

        # The unsure line comes unticked; add the rest.
        await page.locator('[data-testid="scan-add"]').click()
        await page.wait_for_timeout(1500)
        names = {i["name"] for i in api("GET", "/shopping", t=tok)}
        r["exactly_the_ticked_items_go_on_the_list"] = names == {
            "Lait demi-écrémé 1 L", "Pain de campagne", "Œufs x12"}
        await shot(page, "shopping-pdf-added.png")

        r["no_page_errors"] = not errs
        if errs:
            print("page errors:", errs[:3])
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
