"""The vault: the one screen where losing something is unrecoverable.

Everywhere else in the app a mistake costs time. Here it costs a passport
scan, a tenancy agreement, a child's medical letter — things a family
photographed precisely because the paper is easy to lose. There was no
browser coverage of any of it.

What this holds:

  A. a document saved is a document listed, and it survives a reload — the
     whole promise of the screen, and the one nobody had checked;
  B. the storage figure is real, not decorative: it moves when a file is
     added, because a number that never changes is worse than no number —
     it reads as a measurement;
  C. opening a document shows the document, not a broken image;
  D. deleting asks first, NAMES what it is about to delete, and a cancelled
     delete leaves the file alone;
  E. a save that fails says so and does not leave the sheet looking as
     though it worked — the silence bug that has now been found on four
     separate screens in this app.

The vault is parent-only on the server (require_full_member throughout,
reads included), so this runs as a parent; the helper's view is a backend
concern and is tested there.

Usage:  python3 scripts/e2e_vault.py <web_port> <api_port>
"""
import asyncio
import base64
import json
import sys
import urllib.request
import uuid

from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

# A small real PNG — the vault stores what it is given, so the bytes only
# need to be a valid image, not a pretty one.
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAA"
    "DklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=")


def api(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def main():
    r = {}
    who = f"vault-{uuid.uuid4().hex[:6]}@sim.test"
    user = api("POST", "/auth/register",
               {"name": "Vault Probe", "email": who, "password": "password123"})
    token = user["session_token"]
    api("POST", "/auth/complete-onboarding", {}, token)

    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        crashes = []
        page.on("pageerror", lambda e: crashes.append(str(e)))

        # Saving can be told to fail, for E.
        fail_save = {"v": False}

        async def route(ro):
            if fail_save["v"] and ro.request.method == "POST" and "/api/vault" in ro.request.url:
                await ro.fulfill(status=500, content_type="application/json",
                                 body=json.dumps({"detail": "storage unavailable"}))
                return
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json",
                             body=await resp.body())

        await page.route("**/api/**", route)
        await page.add_init_script(
            f"localStorage.setItem('coo_session_token','{token}');")

        async def open_vault():
            await page.goto(f"{WEB}/vault", wait_until="domcontentloaded")
            await page.wait_for_timeout(3500)

        async def add_document(title, settle=3000):
            await page.click('[data-testid="vault-add"], [data-testid="vault-empty-add"]')
            await page.wait_for_timeout(900)
            await page.fill('[data-testid="vault-title"]', title)
            async with page.expect_file_chooser(timeout=15000) as got:
                await page.click('[data-testid="vault-pick-photo"]')
            chooser = await got.value
            await chooser.set_files({"name": "passport.png",
                                     "mimeType": "image/png",
                                     "buffer": TINY_PNG})
            await page.wait_for_timeout(1500)
            await page.click('[data-testid="vault-save"]')
            await page.wait_for_timeout(settle)

        # --- A. it saves, and it is still there after a reload -------------
        await open_vault()
        before_used = (api("GET", "/subscription/entitlements", None, token) or {}).get("vault_bytes_used", 0)
        await add_document("Passport scan")
        body = await page.inner_text("body")
        r["a_saved_document_is_listed"] = "Passport scan" in body

        await open_vault()   # the real question: does it survive a reload
        body = await page.inner_text("body")
        r["a_saved_document_survives_a_reload"] = "Passport scan" in body
        r["the_server_has_it_too"] = any(
            d.get("title") == "Passport scan" for d in api("GET", "/vault", None, token))
        await page.screenshot(path="vault_saved.png")

        # --- B. the storage figure is a measurement, not decoration --------
        after_used = (api("GET", "/subscription/entitlements", None, token) or {}).get("vault_bytes_used", 0)
        r["storage_used_went_up"] = after_used > before_used

        # --- C. opening it shows it ----------------------------------------
        await page.click("text=Passport scan")
        await page.wait_for_timeout(2500)
        r["opening_a_document_shows_a_preview"] = (
            await page.locator('[data-testid="preview-close"]').count() > 0)
        await page.screenshot(path="vault_preview.png")
        await page.click('[data-testid="preview-close"]')
        await page.wait_for_timeout(800)

        # --- D. deleting asks first, and names what it will delete ---------
        asked = {"text": ""}
        page.on("dialog", lambda d: (asked.__setitem__("text", d.message),
                                     asyncio.ensure_future(d.dismiss())))
        await page.click("text=Passport scan")
        await page.wait_for_timeout(1500)
        if await page.locator('[data-testid="preview-delete"]').count() > 0:
            await page.click('[data-testid="preview-delete"]')
            await page.wait_for_timeout(1500)
        r["deleting_asks_first"] = bool(asked["text"])
        # "Delete this document?" on a list of six is a question nobody can
        # answer correctly.
        r["the_question_names_the_document"] = "Passport scan" in asked["text"]
        # Dismissed, so it must still be there — on the server, not just on
        # screen, because an optimistic removal would look identical.
        r["a_cancelled_delete_keeps_the_file"] = any(
            d.get("title") == "Passport scan" for d in api("GET", "/vault", None, token))

        # --- E. a failed save says so --------------------------------------
        # The silence bug, found on four screens in this app already: a sheet
        # that closes on failure reads exactly like one that saved.
        fail_save["v"] = True
        await open_vault()
        # Read while the toast is still up. It auto-dismisses, and a first
        # version of this waited three seconds and then reported the app as
        # silent — the message had been shown and had gone. A harness that
        # arrives after the notice has cleared learns nothing about whether
        # there was one.
        await add_document("Will not save", settle=1200)
        body = await page.inner_text("body")
        r["a_failed_save_says_something"] = (
            "could not" in body.lower() or "error" in body.lower()
            or "unavailable" in body.lower())
        r["a_failed_save_did_not_invent_a_document"] = not any(
            d.get("title") == "Will not save" for d in api("GET", "/vault", None, token))
        await page.screenshot(path="vault_failed_save.png")

        r["no_js_errors"] = not crashes
        if crashes:
            r["first_js_error"] = crashes[0][:200]
        await browser.close()

    print(json.dumps(r, indent=2))
    ok = all(v for k, v in r.items() if k != "first_js_error")
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
