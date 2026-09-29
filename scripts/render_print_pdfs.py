"""Render the print sheets in docs/print to PDF, ready for a printer.

    python3 scripts/build_flyers.py        # the HTML, from the copy
    python3 scripts/render_print_pdfs.py   # the PDFs, from the HTML

The sheets link Figtree and Playfair Display from Google Fonts, which is right
for someone opening them in a browser but wrong for a print file: a PDF made
while the font request was slow or blocked silently falls back to Georgia and
Arial, and nobody notices until the box of flyers arrives. So the font request
is answered here from the copies already in frontend/node_modules, embedded as
data, and every PDF carries exactly the typeface it was designed in.

Output: docs/print/<name>.pdf next to each <name>.html.
"""
import asyncio
import base64
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e_browser import launch_chromium  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FONTS = os.path.join(ROOT, "frontend", "node_modules", "@expo-google-fonts")
PRINT = os.path.join(ROOT, "docs", "print")

# family, package, weights; italics where the sheets use them.
FACES = [
    ("Figtree", "figtree", "Figtree", (400, 500, 600, 700, 800), ()),
    ("Playfair Display", "playfair-display", "PlayfairDisplay", (700, 800), (700,)),
    ("Inter", "inter", "Inter", (400, 600, 700, 800), ()),
]
WEIGHT_NAMES = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold"}


def font_css() -> str:
    rules = []
    for family, pkg, stem, weights, italics in FACES:
        variants = [(w, False) for w in weights] + [(w, True) for w in italics]
        for w, italic in variants:
            name = f"{w}{WEIGHT_NAMES[w]}{'_Italic' if italic else ''}"
            matches = glob.glob(os.path.join(FONTS, pkg, name, "*.ttf"))
            if not matches:
                raise SystemExit(f"missing font {family} {name}; run npm ci in frontend/")
            with open(matches[0], "rb") as fh:
                data = base64.b64encode(fh.read()).decode()
            rules.append(
                f"@font-face{{font-family:'{family}';font-weight:{w};"
                f"font-style:{'italic' if italic else 'normal'};"
                f"src:url(data:font/ttf;base64,{data}) format('truetype');}}")
    return "\n".join(rules)


async def main(only):
    css = font_css()
    sheets = sorted(glob.glob(os.path.join(PRINT, "*.html")))
    if only:
        sheets = [s for s in sheets if any(o in os.path.basename(s) for o in only)]
    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        page = await browser.new_page()

        async def fonts(route):
            if "fonts.googleapis.com" in route.request.url:
                await route.fulfill(status=200, content_type="text/css", body=css)
            else:
                await route.abort()

        await page.route("https://fonts.googleapis.com/**", fonts)
        await page.route("https://fonts.gstatic.com/**", fonts)
        for sheet in sheets:
            await page.goto("file://" + sheet)
            await page.evaluate("document.fonts.ready")
            size = "A3" if "-a3-" in os.path.basename(sheet) else "A5"
            out = sheet[:-5] + ".pdf"
            await page.pdf(path=out, format=size, print_background=True,
                           prefer_css_page_size=True)
            print("wrote", os.path.relpath(out, ROOT))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
