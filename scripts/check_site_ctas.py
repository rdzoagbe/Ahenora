"""Every device is shown somewhere it can actually install the app.

The marketing page picks which call to action leads, per device. An earlier
version did that by REWRITING the buttons' hrefs and text, and on a desktop it
overwrote Google Play with the web app — leaving "Open Ahenora in your browser"
beside "Use it on the web", the same offer twice, with one of the two stores
gone from the page entirely. Roland photographed it.

The script now only reorders and re-emphasises. This loads the real page under
three user agents and checks what a person would actually see: both stores
present, exactly one bold button, and no offer made twice.

A source-level test (tests/test_website_stores.py) guards the same rules in CI,
where there is no browser. This is the one that looks at the rendered page.

Usage:  python3 scripts/check_site_ctas.py
"""
import asyncio, json, sys, http.server, socketserver, threading, os, functools
from playwright.async_api import async_playwright
sys.path.insert(0, "scripts")
from e2e_browser import launch_chromium

ROOT = os.path.abspath("docs")
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
h = functools.partial(Q, directory=ROOT)
srv = socketserver.TCPServer(("127.0.0.1", 0), h)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

UAS = {
 "iPhone": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
 "Android": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
 "Desktop": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
}

async def main():
    bad = []
    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        for page_name in ("index.html", "fr.html"):
            for label, ua in UAS.items():
                ctx = await br.new_context(user_agent=ua, viewport={"width": 1200 if label=="Desktop" else 390, "height": 900})
                pg = await ctx.new_page()
                await pg.goto(f"http://127.0.0.1:{port}/{page_name}", wait_until="domcontentloaded")
                await pg.wait_for_timeout(700)
                info = await pg.evaluate("""() => {
                  const row = document.getElementById('cta-primary')?.parentNode;
                  const btns = [...row.querySelectorAll('a')].map(a => ({t: a.textContent.trim(), h: a.getAttribute('href'), c: a.className}));
                  return {btns, header: document.getElementById('cta-header')?.textContent.trim(),
                          final: document.getElementById('cta-final')?.textContent.trim()};
                }""")
                hrefs = " ".join(b["h"] for b in info["btns"])
                if "apps.apple.com" not in hrefs:
                    bad.append(f"{page_name}/{label}: no App Store button")
                if "play.google.com" not in hrefs:
                    bad.append(f"{page_name}/{label}: no Google Play button")
                texts = [b["t"] for b in info["btns"]]
                if len(texts) != len(set(texts)):
                    bad.append(f"{page_name}/{label}: duplicated button text {texts}")
                solid = [b["t"] for b in info["btns"] if b["c"].strip() == "btn"]
                if len(solid) != 1:
                    bad.append(f"{page_name}/{label}: {len(solid)} bold buttons {solid}")
                print(f"{page_name:11} {label:8} order={texts} bold={solid} header={info['header']!r}")
                await ctx.close()
        await br.close()
    srv.shutdown()
    if bad:
        print("\nFAIL"); [print(" -", b) for b in bad]; return 1
    print("\nPASS  every device sees both stores, one bold button, no duplicate offer")
    return 0

sys.exit(asyncio.run(main()))
