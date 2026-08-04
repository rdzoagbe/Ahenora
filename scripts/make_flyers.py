"""Render the TikTok flyers to PNG files you can post directly.

The copy lives in docs/TIKTOK_FLYERS.md; this is the same copy, typeset.

These follow the printed A4 flyer's design language rather than inventing a
second one: the orange rules top and bottom, the dot-and-caps logo lockup,
an upright serif headline with one phrase in orange, a grey supporting line,
and — the part that actually sells it — a photograph of the real app.

An earlier version of these was type only, on the theory that a screenshot
asks a viewer to squint at a UI they have no reason to care about yet. That
was wrong for this product. The screenshots are the evidence; without them
the flyers were five nicely-set assertions, and they looked like they came
from a different company than the flyer already in use.

Why render here rather than in a design tool: these are mostly type, and type
is what generated designs get wrong — a headline reflows, an apostrophe turns
into a box, a line breaks in the wrong place. Laying them out in HTML and
photographing the result with the browser we already have means the words are
pixel-identical to what is written below, every time.

Screenshots come from scripts/make_flyer_shots.py and must exist first.

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
SHOTS = os.path.join(OUT, "shots")

# The printed flyer's palette, unchanged. A flyer and the first screen after
# install should look like the same object.
CREAM = "#FDFAF6"
PEACH = "#FBEADF"
INK = "#101318"
ORANGE = "#F56519"
ORANGE_DEEP = "#C2410C"
GREY = "#5F656E"

# Each flyer is one thought: the situation, then the turn. `highlight` is the
# phrase that goes orange inside the headline — one per flyer, the way the
# printed one puts "chaos" in orange and nothing else.
FLYERS = [
    {
        "slug": "1-mental-load",
        "kicker": "The invisible job",
        "head": "You’re not disorganised.",
        "highlight": "You’re the only one who remembers.",
        "support": "Tasks, dates and the school letter in your bag — "
                   "in one place both parents can see.",
        "caption": "Your day at a glance",
    },
    {
        "slug": "2-privacy",
        "kicker": "Private by default",
        "head": "He can see the shopping list.",
        "highlight": "Not my therapy appointment.",
        "support": "Every task and document is private until you share it.",
        "caption": "Yours until you say otherwise",
    },
    {
        "slug": "3-handoff",
        "kicker": "Who is actually doing it",
        "head": "“I thought YOU were picking her up.”",
        "highlight": "Assign it. They get told.",
        "support": "It lands on their phone, not in a group chat — "
                   "with a name against it.",
        "caption": "One calendar, both parents",
    },
    {
        "slug": "4-offline",
        "kicker": "Works offline",
        "head": "No signal in the shop.",
        "highlight": "The list was still there.",
        "support": "Basement aisle, no bars. The list, the tasks, the lot — "
                   "ticks catch up when you’re back.",
        "caption": "Sorted by aisle, works with no bars",
    },
    {
        "slug": "5-kid-mode",
        "kicker": "Their own little app",
        "head": "He tidied his room. Without being asked.",
        "highlight": "Twice.",
        "support": "Their chores, their stars, their PIN. "
                   "Nothing else in the house.",
        "caption": "Stars they can actually spend",
    },
]


def data_uri(path: str, mime: str) -> str:
    with open(path, "rb") as fh:
        return f"data:{mime};base64,{base64.b64encode(fh.read()).decode()}"


def font_face(family: str, path_glob: str, style: str = "normal",
              weight: int = 400) -> str:
    """Inline a font file as a data URI.

    The renderer has no network and no system copy of these faces, so a plain
    @font-face URL would silently fall back to DejaVu and the flyer would come
    out looking like a Linux dialog box. Embedding the bytes removes the
    possibility.
    """
    matches = glob.glob(os.path.join(FONTS, path_glob))
    if not matches:
        raise SystemExit(f"font not found: {path_glob}")
    return (f"@font-face{{font-family:'{family}';font-style:{style};"
            f"font-weight:{weight};"
            f"src:url({data_uri(matches[0], 'font/ttf')}) format('truetype');}}")


def build_css() -> str:
    return "".join([
        font_face("Playfair", "playfair-display/700Bold/*.ttf", weight=700),
        font_face("Playfair", "playfair-display/900Black/*.ttf", weight=900),
        font_face("Inter", "inter/800ExtraBold/*.ttf", weight=800),
        font_face("Inter", "inter/700Bold/*.ttf", weight=700),
        font_face("Inter", "inter/500Medium/*.ttf", weight=500),
    ])


def page(flyer: dict, css: str, shot: str) -> str:
    # Everything that must be read lives in the top 1440px. TikTok stacks its
    # caption, username, sound and buttons over the bottom quarter of every
    # video — that region is somebody else's furniture, not a design choice.
    # The phone deliberately runs past it and off the frame: a screen that
    # continues past the edge reads as a real screen rather than a cutout.
    return f"""<html><head><meta charset="utf-8"><style>
{css}
* {{ margin:0; padding:0; box-sizing:border-box; }}
body {{
  width:1080px; height:1920px;
  background:linear-gradient(170deg, {CREAM} 0%, {CREAM} 42%, {PEACH} 100%);
  font-kerning:normal; -webkit-font-smoothing:antialiased;
  position:relative; overflow:hidden;
}}
.rule {{ position:absolute; left:0; right:0; height:26px; background:{ORANGE}; }}
.rule.top {{ top:0; }}
.rule.bottom {{ bottom:0; }}
.frame {{ padding:118px 88px 0 88px; }}
.lockup {{ display:flex; align-items:center; gap:20px; margin-bottom:44px; }}
.dot {{ width:34px; height:34px; border-radius:999px; background:{ORANGE}; }}
.lockup span {{
  font-family:Inter, sans-serif; font-weight:800; font-size:31px;
  letter-spacing:5px; color:{INK};
}}
.kicker {{
  font-family:Inter, sans-serif; font-weight:700; font-size:27px;
  letter-spacing:4px; text-transform:uppercase; color:{ORANGE_DEEP};
  margin-bottom:26px;
}}
.head {{
  font-family:Playfair, serif; font-weight:900; font-size:82px;
  line-height:1.1; color:{INK}; letter-spacing:-1.5px;
}}
.head em {{ font-style:normal; color:{ORANGE_DEEP}; }}
.support {{
  font-family:Inter, sans-serif; font-weight:500; font-size:34px;
  line-height:1.5; color:{GREY}; margin-top:26px; max-width:880px;
}}
.stage {{ margin-top:44px; display:flex; justify-content:center; }}
/* The device. A dark bezel and a real shadow, because a screenshot pasted
   flat onto a background reads as a picture of a website. */
.phone {{
  width:560px; height:1180px; overflow:hidden;
  border:13px solid #16181D; border-radius:56px 56px 0 0;
  border-bottom:0;
  box-shadow:0 34px 70px rgba(16,19,24,0.24);
  background:#16181D;
}}
.phone img {{ width:100%; display:block; }}
</style></head><body>
<div class="rule top"></div>
<div class="frame">
  <div class="lockup"><div class="dot"></div><span>HOUSEHOLD COO</span></div>
  <div class="kicker">{flyer['kicker']}</div>
  <div class="head">{flyer['head']} <em>{flyer['highlight']}</em></div>
  <div class="support">{flyer['support']}</div>
  <div class="stage"><div class="phone"><img src="{shot}"></div></div>
</div>
<div class="rule bottom"></div>
</body></html>"""


async def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    missing = [f["slug"] for f in FLYERS
               if not os.path.exists(os.path.join(SHOTS, f"{f['slug']}.png"))]
    if missing:
        raise SystemExit(
            "No app screenshots for: " + ", ".join(missing) +
            "\nRun scripts/make_flyer_shots.py first — the flyers show the "
            "real app, so they cannot be built without it.")

    css = build_css()
    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        ctx = await br.new_context(
            viewport={"width": 1080, "height": 1920}, device_scale_factor=1)
        page_obj = await ctx.new_page()
        for flyer in FLYERS:
            shot = data_uri(os.path.join(SHOTS, f"{flyer['slug']}.png"), "image/png")
            await page_obj.set_content(page(flyer, css, shot))
            await page_obj.wait_for_timeout(500)
            path = os.path.join(OUT, f"{flyer['slug']}.png")
            await page_obj.screenshot(path=path)
            print(f"wrote {os.path.relpath(path, ROOT)}")
        await br.close()
    return 0


sys.exit(asyncio.run(main()))
