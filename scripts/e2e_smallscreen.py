"""Nothing spills off the side of a small phone.

Every other harness renders at 390 or 412 CSS pixels wide, and the widest runs
at 900 — so the narrow end, where layouts actually break, was never looked at.
Plenty of Android phones report 360dp, and a 320dp device is still out there.
A row that cannot shrink (a long label beside an icon, a fixed-width button)
does not fail loudly: it pushes the page wider than the screen and the user
gets a sideways scroll and clipped text, which is exactly what a parent
reported seeing in the chat.

So: load each main screen at 320 wide and assert the document never grows wider
than its viewport. Checked in the longest language too — German is where a
label like "Aus dem Haushalt entfernen" runs out of room first.

Usage:  python3 scripts/e2e_smallscreen.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

# The narrowest phone worth supporting. Anything that fits here fits everywhere.
NARROW = 320


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})},
        method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def main():
    run = uuid.uuid4().hex[:6]
    u = api("POST", "/auth/register",
            {"name": "Narrow Probe", "email": f"nw-{run}@sim.test",
             "password": "password123", "language": "de"}, None)
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    # A child gives the Family tab real rows to lay out, and a member page to open.
    kid = api("POST", "/family/members",
              {"name": "Maximiliane", "role": "Child", "starting_stars": 12}, tok)
    mid = kid["member_id"]

    r = {}
    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        ctx = await br.new_context(viewport={"width": NARROW, "height": 720})
        page = await ctx.new_page()
        errs = []
        # Record where it happened: an error with no page attached is a hunt.
        page.on("pageerror", lambda e: errs.append(f"{page.url} :: {e}"))

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

        async def fits(label):
            """True when the page is no wider than the screen it is on."""
            over = await page.evaluate(
                "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if over > 1:
                print(f"    {label}: overflows by {over}px at {NARROW}px wide")
            return over <= 1

        for screen in ("feed", "calendar", "kids", "kitchen", "settings"):
            await page.goto(f"{WEB}/{screen}", wait_until="domcontentloaded")
            await page.wait_for_timeout(2600)
            r[f"{screen}_fits"] = await fits(screen)

        # A child's own page: the roster row opens it, and the daily two plus the
        # More door all have to fit the same 320 pixels.
        await page.goto(f"{WEB}/kids", wait_until="domcontentloaded")
        await page.wait_for_timeout(2600)
        if await page.locator(f'[data-testid="child-{mid}"]').count() >= 1:
            await page.click(f'[data-testid="child-{mid}"]')
            await page.wait_for_timeout(1600)
            r["child_page_fits"] = await fits("child page")
            await page.click('[data-testid="kids-show-more"]')
            await page.wait_for_timeout(1200)
            r["child_page_more_fits"] = await fits("child page (More open)")
        else:
            r["child_page_fits"] = False
            r["child_page_more_fits"] = False

        # The person's page carries the manage rows, whose labels are longest in
        # German — the case that pushed a row wider than the screen.
        await page.goto(f"{WEB}/member?id={mid}&name=Maximiliane&role=child&thread=",
                        wait_until="domcontentloaded")
        await page.wait_for_timeout(2200)
        r["member_page_fits"] = await fits("member page")
        r["member_page_has_manage"] = await page.locator('[data-testid="member-rename"]').count() >= 1

        # The picture holder: five choices, and the one you tap has to survive
        # the round trip. A picker that looks chosen but saves nothing is the
        # failure mode worth a harness — it is invisible until you come back.
        offered = True
        for k in ("man", "woman", "boy", "girl", "none"):
            if await page.locator(f'[data-testid="avatar-{k}"]').count() != 1:
                offered = False
        r["member_page_offers_pictures"] = offered

        # The skin tones only appear once a drawing is chosen — a tone over a
        # letter would be a control with nothing to change.
        r["no_tones_before_a_drawing_is_chosen"] = await page.locator(
            '[data-testid="avatar-tone-0"]').count() == 0
        await page.click('[data-testid="avatar-girl"]')
        await page.wait_for_timeout(1400)

        def saved_avatar():
            row = next((m for m in api("GET", "/family/members", None, tok)
                        if m["member_id"] == mid), None)
            return (row or {}).get("avatar")

        r["picking_a_drawing_saves_it"] = saved_avatar() == "illus:girl:1"
        tones = await page.locator('[data-testid^="avatar-tone-"]').count()
        r["five_skin_tones_are_offered"] = tones == 5

        # Changing the tone must keep the person you already chose. Rebuilding
        # the value from scratch here is how you lose the drawing on a recolour.
        await page.click('[data-testid="avatar-tone-4"]')
        await page.wait_for_timeout(1400)
        r["changing_tone_keeps_the_person"] = saved_avatar() == "illus:girl:4"

        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_timeout(2200)
        r["and_it_is_still_chosen_on_return"] = await page.get_attribute(
            '[data-testid="avatar-girl"]', "aria-selected") == "true"
        r["the_tone_survives_too"] = await page.get_attribute(
            '[data-testid="avatar-tone-4"]', "aria-selected") == "true"
        r["member_page_still_fits_with_a_picture"] = await fits("member page + picture")

        await page.screenshot(path="smallscreen_member.png", full_page=True)
        # Say WHICH error. "no_js_errors: False" on its own sends the next
        # person hunting blind, which is exactly what it did to me.
        if errs:
            print("    javascript errors:")
            for e in errs:
                print(f"      {e}")
        r["no_js_errors"] = not errs
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)


asyncio.run(main())
