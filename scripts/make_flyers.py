"""Render the TikTok flyers to PNG files you can post directly.

The copy lives in docs/TIKTOK_FLYERS.md; this is the same copy, typeset.

Why render them here rather than in a design tool: these flyers are almost
entirely type, and type is exactly what generated designs get wrong — a
headline reflows, an apostrophe turns into a box, an em dash lands at the
start of a line. Laying them out in HTML and photographing the result with
the browser we already have means the words are pixel-identical to what is
written below, every time, and re-rendering after an edit costs seconds.

It also keeps the flyers on-brand by construction: the fonts are the app's
own font files and the colours are the app's own ink, so the flyer and the
first screen after install look like the same object.

Output: docs/store-assets/tiktok/*.png at 1080x1920, TikTok's native size.

Usage:  python3 scripts/make_flyers.py
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
OUT = os.path.join(ROOT, "docs", "store-assets", "tiktok")

CREAM = "#F6F3EE"
INK = "#26221E"
ORANGE_DEEP = "#C2410C"   # on cream this clears WCAG AA, which the flyers
ORANGE = "#F56519"        # inherit from the app's palette rules
GREY = "#6B6259"

# Each flyer is one thought: the situation, then the turn. The gap between
# the two lines is the design — it is where the reader finishes the joke
# before the flyer does, so it is deliberately larger than it looks like it
# should be.
FLYERS = [
    {
        "slug": "1-mental-load",
        "setup": "You’re not disorganised.",
        "turn": "You’re just the only one who remembers.",
        "support": "Everything in one place — tasks, dates, "
                   "and the school letter in your bag.",
        "kicker": "The invisible job",
    },
    {
        "slug": "2-privacy",
        "setup": "He can see the shopping list.",
        "turn": "Not my therapy appointment.",
        "support": "Every task and document is private until you share it.",
        "kicker": "Private by default",
    },
    {
        "slug": "3-handoff",
        "setup": "“I thought YOU were picking her up.”",
        "turn": "Hand it over. They actually get told.",
        "support": "Assign a task and it lands on their phone, "
                   "not in a group chat.",
        "kicker": "Who is actually doing it",
    },
    {
        "slug": "4-offline",
        "setup": "No signal in the shop. Basement aisle. Nothing.",
        "turn": "The list was still there.",
        "support": "The list, the tasks, the lot. Ticks catch up "
                   "when you’re back.",
        "kicker": "Works offline",
    },
    {
        "slug": "5-kid-mode",
        "setup": "He tidied his room. Without being asked.",
        "turn": "Twice.",
        "support": "Their chores, their stars, their PIN. "
                   "Nothing else in the house.",
        "kicker": "Their own little app",
    },
]


def font_face(family: str, path_glob: str, style: str = "normal",
              weight: int = 400) -> str:
    """Inline a font file as a data URI.

    The renderer has no network and no system copy of these faces, so a
    plain @font-face URL would silently fall back to DejaVu and the flyer
    would come out looking like a Linux dialog box. Embedding the bytes
    removes the possibility.
    """
    matches = glob.glob(os.path.join(FONTS, path_glob))
    if not matches:
        raise SystemExit(f"font not found: {path_glob}")
    with open(matches[0], "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode()
    return (f"@font-face{{font-family:'{family}';font-style:{style};"
            f"font-weight:{weight};"
            f"src:url(data:font/ttf;base64,{b64}) format('truetype');}}")


def build_css() -> str:
    return "".join([
        font_face("Playfair", "playfair-display/700Bold_Italic/*.ttf",
                  style="italic", weight=700),
        font_face("Inter", "inter/800ExtraBold/*.ttf", weight=800),
        font_face("Inter", "inter/500Medium/*.ttf", weight=500),
        font_face("Inter", "inter/700Bold/*.ttf", weight=700),
    ])


def page(flyer: dict, css: str) -> str:
    # Everything lives in the top 1440px and is centred within it. TikTok
    # stacks the caption, the username, the sound and three buttons over the
    # bottom of every video, so the last quarter of the frame is not a design
    # decision — it is somebody else's furniture. Centring inside what is
    # left is what stops the flyer reading as top-heavy with a dead half.
    return f"""<html><head><meta charset="utf-8"><style>
{css}
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{
  width:1080px; height:1920px; background:{CREAM};
  font-kerning:normal; -webkit-font-smoothing:antialiased;
}}
.frame {{
  height:1440px; padding:0 96px;
  display:flex; flex-direction:column; justify-content:center;
}}
.kicker {{
  font-family:Inter, sans-serif; font-weight:700; font-size:30px;
  letter-spacing:4px; text-transform:uppercase; color:{ORANGE_DEEP};
  opacity:0.85; margin-bottom:44px;
}}
.setup {{
  font-family:Playfair, serif; font-style:italic; font-weight:700;
  font-size:86px; line-height:1.16; color:{INK}; letter-spacing:-1px;
}}
.gap {{ height:64px; }}
.turn {{
  font-family:Inter, sans-serif; font-weight:800;
  font-size:96px; line-height:1.1; color:{ORANGE_DEEP};
  letter-spacing:-3px;
}}
.rule {{
  width:150px; height:5px; background:{ORANGE}; opacity:0.55;
  margin:76px 0 40px 0; border-radius:3px;
}}
.support {{
  font-family:Inter, sans-serif; font-weight:500;
  font-size:38px; line-height:1.5; color:{GREY}; max-width:820px;
}}
.badge {{
  margin-top:96px;
  align-self:flex-start; display:flex; align-items:center; gap:16px;
  background:{ORANGE}; border-radius:999px; padding:22px 40px;
}}
.badge span {{
  font-family:Inter, sans-serif; font-weight:800; font-size:36px;
  color:#FFFFFF; letter-spacing:-0.5px;
}}
.roof {{ width:38px; height:38px; }}
</style></head><body>
<div class="frame">
<div class="kicker">{flyer['kicker']}</div>
<div class="setup">{flyer['setup']}</div>
<div class="gap"></div>
<div class="turn">{flyer['turn']}</div>
<div class="rule"></div>
<div class="support">{flyer['support']}</div>
<div class="badge">
  <svg class="roof" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF"
       stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h14V10"/>
    <path d="M10 20v-6h4v6"/>
  </svg>
  <span>Household COO</span>
</div>
</div>
</body></html>"""


async def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    css = build_css()
    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        ctx = await br.new_context(
            viewport={"width": 1080, "height": 1920},
            device_scale_factor=1)
        page_obj = await ctx.new_page()
        for flyer in FLYERS:
            await page_obj.set_content(page(flyer, css))
            await page_obj.wait_for_timeout(400)
            path = os.path.join(OUT, f"{flyer['slug']}.png")
            await page_obj.screenshot(path=path)
            print(f"wrote {os.path.relpath(path, ROOT)}")
        await br.close()
    return 0


sys.exit(asyncio.run(main()))
