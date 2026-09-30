"""The picture a shared invitation shows in WhatsApp, Messages and the rest.

A link preview is the first thing the invited person sees, before they tap
anything, and it used to be the website's general artwork. This is an
invitation card instead, one per language, 1200x630 (the size the preview
services crop to), as a JPEG: WhatsApp drops a preview image over
about 300 KB, and the PNG of this card is 420 KB.

Usage:  python3 scripts/make_invite_og.py   ->  docs/assets/invite-og-{lang}.jpg
"""
import asyncio
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render_print_pdfs import font_css  # noqa: E402
from e2e_browser import launch_chromium  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ASSETS = os.path.join(ROOT, "docs", "assets")

CARDS = {
    "en": ("You're invited", "to join a household on Ahenora",
           "Shared calendar · tasks · lists"),
    "fr": ("Vous êtes invité·e", "à rejoindre un foyer sur Ahenora",
           "Agenda partagé · tâches · listes"),
    "es": ("Te han invitado", "a unirte a un hogar en Ahenora",
           "Calendario compartido · tareas · listas"),
    "de": ("Du bist eingeladen", "in einen Haushalt auf Ahenora",
           "Gemeinsamer Kalender · Aufgaben · Listen"),
}

PAGE = """<!doctype html><html><head><meta charset="utf-8"><style>
{fonts}
html,body{{margin:0}}
.card{{width:1200px;height:630px;box-sizing:border-box;padding:70px 80px;
  background:linear-gradient(135deg,#F7892F 0%,#F26A1B 45%,#CA470A 100%);
  display:flex;align-items:center;gap:64px;color:#fff;font-family:Figtree,sans-serif}}
.icon{{flex:none;width:300px;height:300px;border-radius:72px;background:#fff;
  box-shadow:0 30px 60px -20px rgba(80,30,0,.45);display:flex;align-items:center;justify-content:center}}
.icon img{{width:260px;height:260px;border-radius:60px}}
h1{{font-family:'Playfair Display',serif;font-weight:800;font-size:92px;line-height:1;margin:0}}
h2{{font-weight:800;font-size:44px;line-height:1.15;margin:18px 0 0;color:#FFF2E8}}
p{{font-weight:700;font-size:30px;margin:34px 0 0;color:#FFE0CC}}
</style></head><body><div class="card">
<div class="icon"><img src="data:image/png;base64,{icon}"></div>
<div><h1>{title}</h1><h2>{line}</h2><p>{foot}</p></div>
</div></body></html>"""


async def main():
    with open(os.path.join(ASSETS, "icon.png"), "rb") as fh:
        icon = base64.b64encode(fh.read()).decode()
    fonts = font_css()
    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        page = await browser.new_page(viewport={"width": 1200, "height": 630})
        for lang, (title, line, foot) in CARDS.items():
            await page.set_content(PAGE.format(fonts=fonts, icon=icon, title=title,
                                               line=line, foot=foot))
            await page.evaluate("document.fonts.ready")
            out = os.path.join(ASSETS, f"invite-og-{lang}.jpg")
            await page.screenshot(path=out, type="jpeg", quality=86,
                                  clip={"x": 0, "y": 0, "width": 1200, "height": 630})
            print("wrote", os.path.relpath(out, ROOT))
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
