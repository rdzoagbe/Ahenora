"""Controls a thumb can actually hit.

Apple asks for 44x44pt, Google for 48dp. A control below that is not a style
choice, it is a control people miss — and it is invisible to every test that
clicks by selector, because a selector always hits dead centre.

Two things are measured.

  HOW BIG THINGS ARE DRAWN, on every screen, laid out at phone width.

  WHETHER hitSlop ACTUALLY WORKS, which is the part that decides whether a
  small control matters. react-native-web implements hitSlop in its legacy
  Touchable and NOT in Pressable, which is what this app builds on — so every
  hitSlop in the app worked on iOS and Android and did nothing at all on
  ahenora.com/app. PressScale now restores it, and this presses four pixels
  outside a control that declares a slop of six to prove it.

  The first version of that check pressed a dismiss cross that declares no
  slop at all. It proved nothing, reported a failure, and very nearly had a
  working fix reverted on the strength of it — hence the note in the code
  about which control is being pressed and why.

Usage:  python3 scripts/e2e_targets.py <web-port> <api-port>
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright
sys.path.insert(0, "scripts")
from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"
MIN = 44

def api(m, p, b=None, t=None):
    r = urllib.request.Request(f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")

FIND = """
(min) => {
  const out = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(
        '[role="button"],[role="radio"],[role="switch"],[role="link"],button,a')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // A control inside another control is measured by its parent.
    if (el.parentElement && el.parentElement.closest('[role="button"],button')) continue;
    if (r.width >= min && r.height >= min) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 34);
    const id = el.getAttribute('data-testid') || '';
    const key = id + '|' + label + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, label, w: Math.round(r.width), h: Math.round(r.height) });
  }
  return out;
}
"""

ROUTES = ["feed", "calendar", "kids", "kitchen", "vault", "settings", "account",
          "chat", "search", "expenses", "gift-pot", "santa", "pricing"]

async def main():
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register", {"name": "Target Parent",
            "email": f"tg-{run}@sim.test", "password": "password123"})
    tok = a["session_token"]; api("POST", "/auth/complete-onboarding", {}, tok)
    for call in (("POST", "/family/members", {"name": "Arielle", "role": "Child", "age": 8}),
                 ("POST", "/shopping/bulk", {"names": ["Rice", "Beans"]}),
                 ("POST", "/cards", {"type": "TASK", "title": "Book the dentist", "shared": True})):
        try: api(*call, tok)
        except Exception as e: print("seed skipped", call[1], e)

    found = []
    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        ctx = await br.new_context(viewport={"width": 390, "height": 844})
        page = await ctx.new_page()
        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host","content-length","origin","referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
        await page.route("**/api/**", route)
        await page.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")
        for r in ROUTES:
            await page.goto(f"{WEB}/{r}", wait_until="domcontentloaded")
            await page.wait_for_timeout(2200)
            for bad in await page.evaluate(FIND, MIN):
                found.append(f"{r}: {bad['w']}x{bad['h']}  {bad['id'] or bad['label']!r}")
        await br.close()
    # And the part that decides whether the small ones actually matter: does a
    # press LANDING OUTSIDE the visual box still reach the control? That is what
    # hitSlop promises, and what react-native-web's Pressable does not deliver.
    reach = "not tested"
    async with async_playwright() as pw2:
        br2 = await launch_chromium(pw2)
        ctx2 = await br2.new_context(viewport={"width": 390, "height": 844})
        pg = await ctx2.new_page()
        async def route2(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx2.request.fetch(f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host","content-length","origin","referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
        await pg.route("**/api/**", route2)
        await pg.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")
        # `child-back` — chosen because it DECLARES hitSlop={6}. The first
        # version of this check used a dismiss cross that declares none, so it
        # proved nothing at all and very nearly had a working fix reverted.
        await pg.goto(f"{WEB}/kids", wait_until="domcontentloaded")
        await pg.wait_for_timeout(2500)
        child = pg.locator("[data-testid^='child-']").first
        if await child.count():
            await child.click()
            await pg.wait_for_timeout(1500)
        target = pg.get_by_test_id("child-back")
        if await target.count():
            box = await target.first.bounding_box()
            # 4px OUTSIDE the left edge: inside the declared slop of 6, outside
            # the drawn control. If this lands, hitSlop is doing its job.
            await pg.mouse.click(box["x"] - 4, box["y"] + box["height"] / 2)
            await pg.wait_for_timeout(1500)
            # Pressing back leaves the child page: the button goes away.
            reach = ("a press outside the box reaches the control"
                     if await pg.get_by_test_id("child-back").count() == 0
                     else "a press outside the box does NOT reach the control")
        await br2.close()
    print("hitSlop on web:", reach)

    if found:
        print(f"{len(found)} control(s) drawn under {MIN}x{MIN} "
              f"(reachable anyway where a hitSlop is declared):")
        for f in sorted(set(found)): print("  -", f)
    else:
        print(f"every control is drawn at least {MIN}x{MIN}")

    if "does NOT reach" in reach:
        print("FAIL  hitSlop is not reaching past the control on the web build")
        return 1
    print("PASS  hitSlop reaches past the control on the web build")
    return 0
sys.exit(asyncio.run(main()))
