"""Hand-off, and the dark-mode contrast bug that hid the Account screen.

Two halves:

  1. Roland gives Keigh a job. It appears on her feed under "Handed to you",
     the household record says who it went to, and the private version of the
     same thing stays invisible.
  2. The Account screen in dark mode. It used to draw its text from the fixed
     light palette while its cards came from the theme, so headings and names
     were dark-on-dark — invisible on a real phone. Checked by sampling
     pixels, not by looking at a screenshot: contrast is the sort of thing
     that only a measurement can actually settle.

Usage:  python3 scripts/e2e_handoff.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

WEB = f"http://127.0.0.1:{sys.argv[1]}/Household-COO/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})},
        method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def persona(browser, token, appearance=None):
    ctx = await browser.new_context(viewport={"width": 390, "height": 844})
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
    script = f"localStorage.setItem('coo_session_token','{token}');"
    if appearance:
        # Same key the store writes, so the app boots straight into the mode.
        script += f"localStorage.setItem('coo_appearance_mode_minimal_light_v5','{appearance}');"
    await page.add_init_script(script)
    return page


def luminance(rgb):
    def channel(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


async def sample(page, selector):
    """The rendered colour of an element's text and of what sits behind it."""
    return await page.evaluate("""(sel) => {
        const el = [...document.querySelectorAll('*')]
          .find(e => e.textContent && e.textContent.trim() === sel && e.children.length === 0);
        if (!el) return null;
        const parse = (s) => (s.match(/\\d+/g) || []).slice(0, 3).map(Number);
        const fg = parse(getComputedStyle(el).color);
        let node = el, bg = null;
        while (node && !bg) {
            const c = getComputedStyle(node).backgroundColor;
            if (c && !c.includes('rgba(0, 0, 0, 0)')) bg = parse(c);
            node = node.parentElement;
        }
        return {fg, bg: bg || [255, 255, 255]};
    }""", selector)


async def main():
    r = {}
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register", {"name": "Roland H", "email": f"rh-{run}@sim.test",
                                       "password": "password123"})
    tok_a = a["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_a)
    inv = api("POST", "/family/invite", {"email": f"kh-{run}@sim.test"}, tok_a)
    b = api("POST", "/auth/register", {"name": "Keigh H", "email": f"kh-{run}@sim.test",
                                       "password": "password123",
                                       "invite_token": inv["invite"]["token"]})
    tok_b = b["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_b)

    # Roland hands over the school run, keeps one thing to himself, and takes
    # one job for himself.
    api("POST", "/cards", {"type": "TASK", "title": "School run Tuesday",
                           "assignee": "Keigh H", "shared": True}, tok_a)
    api("POST", "/cards", {"type": "TASK", "title": "Surprise party venue",
                           "assignee": "Keigh H", "shared": False}, tok_a)
    api("POST", "/cards", {"type": "TASK", "title": "Bins out",
                           "assignee": "Roland H", "shared": True}, tok_a)

    server_mine = api("GET", "/cards/mine", None, tok_b)
    r["server_gives_her_only_hers"] = [c["title"] for c in server_mine] == ["School run Tuesday"]

    async with async_playwright() as pw:
        br = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")

        # --- her side of the hand-off --------------------------------------
        keigh = await persona(br, tok_b)
        errs = []
        keigh.on("pageerror", lambda e: errs.append(str(e)))
        await keigh.goto(f"{WEB}/feed", wait_until="networkidle")
        await keigh.wait_for_timeout(4000)
        body = await keigh.inner_text("body")
        r["she_sees_the_handoff_section"] = "Handed to you" in body
        r["his_private_item_stays_hidden"] = "Surprise party venue" not in body
        # Scoped to the section itself: "Bins out" is shared, so it rightly
        # appears elsewhere on her feed — it just is not on HER plate.
        section = await keigh.inner_text('[data-testid="feed-assigned"]')
        r["it_holds_the_task_he_gave_her"] = "School run Tuesday" in section
        r["his_own_job_is_not_on_her_plate"] = "Bins out" not in section
        await keigh.screenshot(path="handoff_feed.png")

        # --- his side: the household record --------------------------------
        roland = await persona(br, tok_a)
        await roland.goto(f"{WEB}/feed", wait_until="networkidle")
        await roland.wait_for_timeout(4000)
        body = await roland.inner_text("body")
        r["record_names_who_it_went_to"] = "gave Keigh H" in body

        # --- the Account screen in dark mode -------------------------------
        dark = await persona(br, tok_a, appearance="dark")
        dark_errs = []
        dark.on("pageerror", lambda e: dark_errs.append(str(e)))
        await dark.goto(f"{WEB}/account", wait_until="networkidle")
        await dark.wait_for_timeout(4000)
        await dark.screenshot(path="handoff_account_dark.png")

        readable = {}
        for label in ("Roland H", "Account", "Google account"):
            s = await sample(dark, label)
            readable[label] = round(contrast(s["fg"], s["bg"]), 2) if s else 0
        # WCAG AA for body text is 4.5:1. The bug measured about 1.2:1.
        r["dark_account_name_readable"] = readable["Roland H"] >= 4.5
        r["dark_account_title_readable"] = readable["Account"] >= 4.5
        r["dark_account_rows_readable"] = readable["Google account"] >= 4.5
        print("contrast ratios:", readable)

        # And light mode did not regress.
        light = await persona(br, tok_a, appearance="light")
        await light.goto(f"{WEB}/account", wait_until="networkidle")
        await light.wait_for_timeout(4000)
        s = await sample(light, "Google account")
        r["light_account_still_readable"] = bool(s) and contrast(s["fg"], s["bg"]) >= 4.5
        await light.screenshot(path="handoff_account_light.png")

        r["no_js_errors_on_feed"] = not errs
        r["no_js_errors_on_account"] = not dark_errs
        if errs:
            print("feed errors:", errs[:3])
        if dark_errs:
            print("account errors:", dark_errs[:3])
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    ok = all(r.values())
    print("ALL PASS" if ok else "FAILURES PRESENT")
    sys.exit(0 if ok else 1)


asyncio.run(main())
