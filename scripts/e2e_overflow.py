"""Nothing that carries words may run off the side of the screen.

On 2026-09-08 the teen screen shipped an "Add" button whose right edge landed
at 401px on a 390px phone: half of it was simply not on the screen. The cause
is the oldest trap in flexbox — a flex child defaults to `min-width: auto`,
so a text field beside a button refuses to shrink below its own content and
pushes the button out of the viewport. Nothing failed. Every test passed. It
was found by photographing a screen nobody had ever photographed.

That class of bug cannot be caught by reading code, because the widths only
exist once it is laid out. So this measures the laid-out page.

It reports an element only when all of these hold, which is what keeps it
from crying wolf:
  * it paints text of its own (a bare container that overhangs shows nothing);
  * it is actually visible — displayed, not transparent, non-zero size;
  * no ancestor scrolls horizontally, because content inside a carousel or a
    wide table is MEANT to extend past the edge and is reachable by swiping.

Usage:  python3 scripts/e2e_overflow.py <web-port> <api-port>
"""
import asyncio
import json
import sys
import urllib.request
import uuid

from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

# The narrowest phone worth supporting. A layout that survives 320 survives
# everything; most of these bugs only appear at the small end.
WIDTHS = (320, 390)

ROUTES = ["feed", "calendar", "kids", "kitchen", "vault", "settings", "account",
          "chat", "search", "expenses", "gift-pot", "santa", "pricing"]

# A pixel of slack: sub-pixel rounding in the layout engine is not a bug.
TOLERANCE = 1.5

FIND_OVERFLOW = """
(tolerance) => {
  const out = [];
  const scrollsSideways = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (parseFloat(style.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const over = r.right - window.innerWidth;
    const under = -r.left;
    if (over <= tolerance && under <= tolerance) continue;
    // Only elements that paint their own words: a container that overhangs
    // is invisible, a clipped label is the bug.
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();
    if (!ownText) continue;
    if (scrollsSideways(el)) continue;
    out.push({
      text: ownText.slice(0, 60),
      right: Math.round(r.right),
      left: Math.round(r.left),
      width: Math.round(r.width),
      testId: el.getAttribute('data-testid') || '',
    });
  }
  return out;
}
"""


def api(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}", data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})}, method=method)
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


def seed():
    """A parent with content, and a teen — whose screen is where this started."""
    run = uuid.uuid4().hex[:6]
    a = api("POST", "/auth/register", {"name": "Overflow Parent",
                                       "email": f"of-{run}@sim.test", "password": "password123"})
    tok = a["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    for call in (
        ("POST", "/family/members", {"name": "Arielle", "role": "Child", "age": 8}),
        ("POST", "/shopping/bulk", {"names": ["Rice", "Beans", "Milk"]}),
        ("POST", "/cards", {"type": "TASK", "title": "Book the dentist", "shared": True}),
    ):
        try:
            api(call[0], call[1], call[2], tok)
        except Exception as exc:  # noqa: BLE001
            print(f"seed skipped {call[1]}: {exc}")

    teen_tok = None
    try:
        inv = api("POST", "/family/invite",
                  {"email": f"oft-{run}@sim.test", "is_teen": True, "age": 15}, tok)
        teen = api("POST", "/auth/register",
                   {"name": "Ama", "email": f"oft-{run}@sim.test", "password": "password123",
                    "invite_token": inv["invite"]["token"]})
        teen_tok = teen["session_token"]
    except Exception as exc:  # noqa: BLE001
        print(f"seed skipped teen: {exc}")
    return tok, teen_tok


async def check(browser, token, routes, width, label, found):
    ctx = await browser.new_context(viewport={"width": width, "height": 900})
    page = await ctx.new_page()

    async def route(ro):
        path = ro.request.url.split("/api/", 1)[1]
        resp = await ctx.request.fetch(
            f"{API}/{path}", method=ro.request.method,
            headers={k: v for k, v in ro.request.headers.items()
                     if k.lower() not in ("host", "content-length", "origin", "referer")},
            data=ro.request.post_data)
        await ro.fulfill(status=resp.status, content_type="application/json",
                         body=await resp.body())

    await page.route("**/api/**", route)
    await page.add_init_script(f"localStorage.setItem('coo_session_token','{token}');")
    for r in routes:
        await page.goto(f"{WEB}/{r}", wait_until="domcontentloaded")
        await page.wait_for_timeout(2200)
        for bad in await page.evaluate(FIND_OVERFLOW, TOLERANCE):
            found.append(f"{label}/{r} @{width}px: {bad['text']!r} "
                         f"spans {bad['left']}..{bad['right']}"
                         f"{' [' + bad['testId'] + ']' if bad['testId'] else ''}")
    await ctx.close()


async def main():
    tok, teen_tok = seed()
    found = []
    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        for width in WIDTHS:
            await check(browser, tok, ROUTES, width, "parent", found)
            if teen_tok:
                await check(browser, teen_tok, ["teen"], width, "teen", found)
        await browser.close()

    if found:
        print(f"FAIL  {len(found)} element(s) painting off the edge of the screen:")
        for line in found:
            print(f"  - {line}")
        return 1
    print("PASS  nothing runs off the side of the screen")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
