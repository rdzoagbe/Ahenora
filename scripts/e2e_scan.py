"""Scanning a document: the feature with the most users and the least coverage.

Written after Roland photographed a prescription on wifi AND 4G and was told
"No connection. It'll go through when you're back online." Both halves were
false — he had a connection, and nothing was queued, because a scan is not a
queueable write. Three faults were stacked behind that one sentence:

  1. every request shared a 30-second budget, including the one that uploads a
     photograph and then waits for a model to read it;
  2. an aborted request has no HTTP status, and anything without a status was
     classified as a dead network;
  3. the photo was never cropped, so 3-5 MB went up before the model saw
     anything.

None of it was caught by 25 browser harnesses, because not one of them
scanned. The most-touched feature in the app had no end-to-end test at all.

What this holds, in the order the faults happened:

  A. a scan that answers normally reaches the confirm step;
  B. a scan that takes THIRTY-FIVE SECONDS still succeeds — past the old
     budget, inside the new one. This is the regression test: with the old
     30s budget this request aborts, and the app shows an error;
  C. a genuinely dead network still says so, so the fix for B cannot have
     been "call everything a timeout";
  D. the two messages are different sentences, so they cannot quietly merge
     back into one.

B is slow on purpose. Thirty-five seconds of wall clock is the price of
proving the budget is real, and the alternative — asserting a constant in the
source — is what the unit tests already do and is exactly what would not have
caught this.

Usage:  python3 scripts/e2e_scan.py <web_port> <api_port>
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

# The old budget was 30s. Wait past it, but well inside the new 90s.
SLOW_SCAN_MS = 35_000

# A one-pixel JPEG. The harness is about the round trip and the budget, not
# about what a model makes of the picture — and the backend answers with its
# documented fallback when no AI key is configured, which is what makes this
# deterministic rather than a test of Gemini's mood.
TINY_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof"
    "Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB"
    "AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==")

# What the server would send back for a household document. Returned by the
# route interceptor so the assertions are about the CLIENT's handling — the
# budget and the message — rather than about the model.
SCANNED = {
    "kind": "document", "type": "APPOINTMENT",
    "title": "Dentist appointment", "description": "Confirm the time.",
    "assignee": "", "due_date": None, "vault_category": "Medical",
    "save_to_vault": True, "expires_on": None, "amount": None,
    "understood": True,
}


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


async def open_the_scanner(page):
    """Get to the camera sheet from a fresh household's Feed.

    A new family's feed is empty, which is the one place the scan button is
    unmissable — and it is also exactly where a first-time user meets it.
    """
    await page.goto(f"{WEB}/", wait_until="domcontentloaded")
    await page.wait_for_timeout(3500)
    await page.click('[data-testid="feed-empty-scan"]', timeout=15000)
    await page.wait_for_timeout(1200)


async def choose_a_file(page):
    """Hand the picker a photograph.

    expo-image-picker on web is an <input type="file">, so the library button
    raises a real file chooser. Driving it is what makes this an end-to-end
    test of the scan rather than of the API.
    """
    async with page.expect_file_chooser(timeout=15000) as got:
        await page.click('[data-testid="cam-library"]')
    chooser = await got.value
    await chooser.set_files({"name": "letter.jpg",
                             "mimeType": "image/jpeg",
                             "buffer": TINY_JPEG})


async def main():
    results = {}
    who = f"scan-{uuid.uuid4().hex[:6]}@sim.test"
    user = api("POST", "/auth/register",
               {"name": "Scan Probe", "email": who, "password": "password123"})
    token = user["session_token"]
    api("POST", "/auth/complete-onboarding", {}, token)

    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        ctx = await browser.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        crashes = []
        page.on("pageerror", lambda e: crashes.append(str(e)))

        # How /vision/extract should behave on this visit. Everything else is
        # proxied to the real backend untouched.
        mode = {"v": "ok"}

        async def route(ro):
            if "/api/vision/extract" in ro.request.url:
                if mode["v"] == "dead":
                    await ro.abort("internetdisconnected")
                    return
                if mode["v"] == "slow":
                    await asyncio.sleep(SLOW_SCAN_MS / 1000)
                await ro.fulfill(status=200, content_type="application/json",
                                 body=json.dumps(SCANNED))
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

        # --- A. an ordinary scan gets to the confirm step -------------------
        mode["v"] = "ok"
        await open_the_scanner(page)
        await choose_a_file(page)
        await page.wait_for_timeout(4000)
        body = await page.inner_text("body")
        results["a_normal_scan_reaches_confirm"] = (
            await page.locator('[data-testid="cam-continue"]').count() > 0)
        results["a_normal_scan_shows_what_it_read"] = "Dentist appointment" in body
        await page.screenshot(path="scan_confirm.png")

        # --- B. THE REGRESSION: slow is not broken --------------------------
        # 35 seconds. Under the old 30-second budget this aborts and the sheet
        # drops to its error phase; under the new one it simply takes a while.
        mode["v"] = "slow"
        await open_the_scanner(page)
        await choose_a_file(page)
        await page.wait_for_timeout(SLOW_SCAN_MS + 12_000)
        body = await page.inner_text("body")
        results["a_35_second_scan_still_succeeds"] = (
            await page.locator('[data-testid="cam-continue"]').count() > 0)
        # The specific lie that was being told. Never again, at any speed.
        results["a_slow_scan_is_not_called_offline"] = "No connection" not in body
        await page.screenshot(path="scan_slow.png")

        # --- C. a dead network still says so --------------------------------
        # Without this, "stop saying offline" could have been implemented by
        # never saying it, which trades one wrong message for another.
        mode["v"] = "dead"
        await open_the_scanner(page)
        await choose_a_file(page)
        # The retries have to run out first: four attempts with 1s + 2s + 4s
        # of backoff between them, so nothing is on screen for seven seconds
        # however dead the network is. A first version waited six and read the
        # spinner as a missing message.
        await page.wait_for_timeout(16000)
        body = await page.inner_text("body")
        results["a_dead_network_still_says_no_connection"] = "No connection" in body
        # And it must not promise a delivery nothing will make: a scan is not
        # a queueable write, so there is no queue for it to wait in.
        results["it_does_not_promise_to_send_it_later"] = "back online" not in body
        await page.screenshot(path="scan_offline.png")

        results["no_js_errors"] = not crashes
        if crashes:
            results["first_js_error"] = crashes[0][:200]

        await browser.close()

    print(json.dumps(results, indent=2))
    ok = all(v for k, v in results.items() if k != "first_js_error")
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
