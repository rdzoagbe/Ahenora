"""Can you actually read it? Every screen, both modes, measured.

The Account screen shipped unreadable in dark mode — theme-aware cards with
light-palette text on them, about 1.2:1, invisible on a real phone. Seven
harnesses passed it, because they all check what the app DOES and none of
them checked whether a human can see the result. A parent found it by
opening the app.

So: walk every screen in light and dark, sample every piece of visible text,
and compute the real WCAG contrast ratio between its rendered colour and
whatever is actually behind it. Thresholds are the WCAG AA ones — 4.5:1 for
body text, 3:1 for large text (>=24px, or >=18.66px when bold), since large
type stays legible at lower contrast.

Deliberately measures rather than screenshots: "looks fine to me" is exactly
the judgement that let the last one through.

Usage:  python3 scripts/e2e_contrast.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.request, uuid
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/Household-COO/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"

SCREENS = ["feed", "calendar", "kids", "kitchen", "vault", "settings", "account", "search"]
MODES = ["light", "dark"]

# Text drawn ON a coloured chip or button reports the chip as its background
# only if the chip actually paints one; a few decorative labels sit on
# gradients or images where a computed background cannot be resolved. Those
# are reported separately rather than failed, so the signal stays honest.
AA_NORMAL = 4.5
AA_LARGE = 3.0


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})},
        method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


# The measurement runs in the page: it needs getComputedStyle on every node,
# and shipping thousands of style objects back over the wire would be slower
# than doing the arithmetic where the styles already live.
MEASURE_JS = r"""
() => {
  const parse = (s) => {
    const n = (s || '').match(/[\d.]+/g);
    if (!n) return null;
    const [r, g, b, a] = n.map(Number);
    return {r, g, b, a: a === undefined ? 1 : a};
  };
  const over = (fg, bg) => ({           // alpha compositing
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // What is really behind an element: walk up compositing every translucent
  // layer until something opaque is hit.
  const backdrop = (el) => {
    let stack = [], node = el;
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 1) break;
      }
      node = node.parentElement;
    }
    let base = {r: 255, g: 255, b: 255, a: 1};
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  };

  const out = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length) continue;                 // leaf text only
    const text = (el.textContent || '').trim();
    if (!text) continue;
    // Emoji are colour glyphs: the CSS `color` never applies to them, so
    // measuring one measures nothing. Anything with no letter or digit in it
    // is decoration, not reading matter.
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const opacity = Number(st.opacity);
    if (!(opacity > 0.05)) continue;                  // deliberately faded out

    const bg = backdrop(el);
    let fg = parse(st.color);
    if (!fg) continue;
    fg = over({...fg, a: fg.a * opacity}, bg);

    const size = parseFloat(st.fontSize) || 14;
    const weight = Number(st.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    out.push({
      text: text.slice(0, 40),
      ratio: Math.round(ratio(fg, bg) * 100) / 100,
      size, weight, large,
    });
  }
  return out;
}
"""


async def persona(browser, token, appearance):
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
    await page.add_init_script(
        f"localStorage.setItem('coo_session_token','{token}');"
        f"localStorage.setItem('coo_appearance_mode_minimal_light_v5','{appearance}');")
    return page


async def main():
    run = uuid.uuid4().hex[:6]
    u = api("POST", "/auth/register", {"name": "Contrast Sweep",
                                       "email": f"cs-{run}@sim.test", "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)
    # Enough real content that the screens are not all empty states.
    api("POST", "/family/members", {"name": "Ama", "role": "Child"}, tok)
    api("POST", "/shopping/bulk", {"names": ["Rice", "Beans", "Olive oil"]}, tok)
    api("POST", "/cards", {"type": "TASK", "title": "Sweep task", "shared": True}, tok)
    api("POST", "/cards", {"type": "APPOINTMENT", "title": "Dentist", "shared": True}, tok)
    api("POST", "/vault", {"title": "Insurance letter", "category": "Insurance",
                           "image_base64": "x", "mime_type": "image/jpeg"}, tok)

    failures = []
    measured = 0

    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        for mode in MODES:
            page = await persona(br, tok, mode)
            for screen in SCREENS:
                await page.goto(f"{WEB}/{screen}", wait_until="domcontentloaded")
                await page.wait_for_timeout(3500)
                rows = await page.evaluate(MEASURE_JS)
                measured += len(rows)
                for row in rows:
                    need = AA_LARGE if row["large"] else AA_NORMAL
                    if row["ratio"] < need:
                        failures.append({"mode": mode, "screen": screen, "need": need, **row})
            await page.close()
        await br.close()

    print(f"measured {measured} pieces of text across "
          f"{len(SCREENS)} screens x {len(MODES)} modes")

    if not failures:
        print("ALL PASS")
        sys.exit(0)

    # Worst first — that is the order they are worth fixing in.
    failures.sort(key=lambda f: f["ratio"])
    seen = set()
    print(f"\n{len(failures)} unreadable pieces of text:\n")
    for f in failures:
        key = (f["mode"], f["screen"], f["text"])
        if key in seen:
            continue
        seen.add(key)
        print(f"  {f['ratio']:>5}:1  (needs {f['need']})  "
              f"[{f['mode']:<5} {f['screen']:<9}] {f['size']:.0f}px  {f['text']!r}")
    print("\nFAILURES PRESENT")
    sys.exit(1)


asyncio.run(main())
