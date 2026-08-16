"""The first five minutes: every screen with nothing in it yet.

Every other harness seeds content, because that is how you exercise a
feature. So for months nobody looked at what a brand-new family actually
sees — and that is the entire first session. Two of the four bugs a real
parent reported lived exactly there: a feed reassuring them twice that
nothing was wrong, and a screen no measurement had ever been taken of.

An empty screen has one job: say what this is for, and offer the first
step. "Nothing here" is a dead end; "Nothing here — snap a school letter"
is an invitation. So each screen is checked for three things:

  1. it renders at all, with no page errors;
  2. it says something — not a blank card or a bare heading;
  3. it offers a way in — something tappable that starts the thing.

Usage:  python3 scripts/e2e_firstrun.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/Ahenora/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

# What a parent should be able to tell about each screen before they have
# put anything into it. Deliberately loose — this asks "does it explain
# itself", not "does it match this exact copy", so wording can change
# without the harness pretending that is a regression.
SCREENS = {
    "feed":     ["add", "capture", "task"],
    "calendar": ["calendar", "sync", "event"],
    "kids":     ["child", "star", "reward"],
    "kitchen":  ["shopping", "meal", "add"],
    "vault":    ["document", "photograph", "add"],
}


async def main():
    r = {}
    run = uuid.uuid4().hex[:6]
    req = urllib.request.Request(
        f"{API}/auth/register",
        data=json.dumps({"name": "Brand New", "email": f"bn-{run}@sim.test",
                         "password": "password123"}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=20) as res:
        tok = json.loads(res.read().decode())["session_token"]
    # Onboarding marked done, and NOTHING else. No co-parent, no child, no
    # task, no document. This is the household on day one.
    urllib.request.urlopen(urllib.request.Request(
        f"{API}/auth/complete-onboarding", data=b"{}",
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {tok}"}, method="POST"), timeout=20)

    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        for mode in ("light", "dark"):
            ctx = await br.new_context(viewport={"width": 390, "height": 844})
            page = await ctx.new_page()
            errs = []
            page.on("pageerror", lambda e, s=errs: s.append(str(e)))

            async def route(ro):
                path = ro.request.url.split("/api/", 1)[1]
                resp = await ctx.request.fetch(
                    f"{API}/{path}", method=ro.request.method,
                    headers={k: v for k, v in ro.request.headers.items()
                             if k.lower() not in ("host", "content-length",
                                                  "origin", "referer")},
                    data=ro.request.post_data)
                await ro.fulfill(status=resp.status, content_type="application/json",
                                 body=await resp.body())

            await page.route("**/api/**", route)
            await page.add_init_script(
                f"localStorage.setItem('coo_session_token','{tok}');"
                f"localStorage.setItem('coo_appearance_mode_minimal_light_v5','{mode}');")

            for screen, expected in SCREENS.items():
                errs.clear()
                await page.goto(f"{WEB}/{screen}", wait_until="domcontentloaded")
                await page.wait_for_timeout(4000)
                body = (await page.inner_text("body")).lower()
                key = f"{mode}_{screen}"

                # 1. It rendered, and quietly. The bar is "not blank", not
                #    "wordy": the Kids screen says its whole piece in 97
                #    characters — "No children yet / Add your first child to
                #    start using stars and rewards / [Add child]" — and an
                #    earlier version of this check failed it for that. A good
                #    empty state is SHORT. Measuring length would have pushed
                #    the app toward the padding this project spent a day
                #    removing, so the real signal is the two checks below.
                r[f"{key}_renders"] = len(body.strip()) > 30 and not errs
                if errs:
                    print(f"{key} page errors: {errs[:2]}")

                # 2. It says what it is for.
                r[f"{key}_explains_itself"] = any(w in body for w in expected)

                # 3. There is a way in. Counting tappable things rather than
                #    looking for one label: an empty screen with nothing to
                #    press is where a new family stops.
                actions = await page.evaluate("""() => {
                    const nodes = [...document.querySelectorAll(
                        '[role=button], button, [data-testid]')];
                    return nodes.filter(el => {
                        const b = el.getBoundingClientRect();
                        return b.width > 40 && b.height > 24 && b.top < 844;
                    }).length;
                }""")
                r[f"{key}_offers_a_way_in"] = actions >= 2
                if not r[f"{key}_offers_a_way_in"]:
                    print(f"{key}: only {actions} tappable things on the first screen")

            await page.screenshot(path=f"firstrun_{mode}.png")
            await ctx.close()
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    ok = all(r.values())
    print("ALL PASS" if ok else "FAILURES PRESENT")
    sys.exit(0 if ok else 1)


asyncio.run(main())
