# -*- coding: utf-8 -*-
"""Generate the A3 flyers.

Two languages from one template, because a poster that says something slightly
different in French than in English is a poster nobody proofread. Run:

    python3 scripts/build_flyers.py

The QR is emitted as inline SVG rather than a PNG. A QR is pure geometry: as
vector it stays sharp at any size a printer chooses, and a flyer that gets
scaled on a copier is the normal case, not the exception. Error correction is
set to H (30% recoverable) so the code still reads with a drawing pin through
a corner or rain on a school gate.
"""
import os
import qrcode

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs", "print")

# No tracking parameters. There is no web analytics on the site, so a utm tag
# would be decoration that makes the printed URL harder to read and type.
URL = "https://ahenora.com"


def qr_svg(data: str, size_mm: float) -> str:
    """The QR as an SVG of filled squares, sized in millimetres."""
    q = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_H,
                      box_size=1, border=2)
    q.add_data(data)
    q.make(fit=True)
    matrix = q.get_matrix()
    n = len(matrix)
    rects = []
    for y, row in enumerate(matrix):
        x = 0
        while x < n:
            if row[x]:
                run = 1
                while x + run < n and row[x + run]:
                    run += 1
                rects.append(f'<rect x="{x}" y="{y}" width="{run}" height="1"/>')
                x += run
            else:
                x += 1
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" '
        f'width="{size_mm}mm" height="{size_mm}mm" shape-rendering="crispEdges" '
        f'role="img" aria-label="QR code to {data}">'
        f'<rect width="{n}" height="{n}" fill="#fff"/>'
        f'<g fill="#101318">{"".join(rects)}</g></svg>'
    )


COPY = {
    "fr": {
        "lang": "fr",
        "title": "Ahenora — affiche A3",
        "eyebrow": "Gratuit au départ · Sans publicité",
        "headline": "La maison tourne grâce à la mémoire de quelqu’un.",
        "headline2": "Et si elle tournait plus sereinement&nbsp;?",
        "lede": "L’agenda familial, les corvées des enfants, les repas de la semaine "
                "et les papiers de l’école — dans un seul espace partagé et privé.",
        "bullets": [
            ("Un agenda partagé", "Toute la semaine de la famille d’un coup d’œil."),
            ("Corvées et étoiles", "Des routines qui tiennent sans négocier chaque jour."),
            ("Repas et courses", "Le dîner planifié devient la liste de courses."),
            ("Scannez les papiers", "Un mot de l’école devient un rendez-vous dans l’agenda."),
        ],
        "scan": "Scannez pour installer",
        "ios": "Bientôt sur iPhone",
        "ios_sub": "Sur iPhone aujourd’hui&nbsp;: Ahenora fonctionne dans votre navigateur.",
        "android": "Sur Android&nbsp;: installez depuis Google Play.",
        "foot": "ahenora.com",
    },
    "en": {
        "lang": "en",
        "title": "Ahenora — A3 poster",
        "eyebrow": "Free to start · No ads",
        "headline": "The household runs on someone’s memory.",
        "headline2": "Let it run on something calmer.",
        "lede": "The family calendar, the kids’ chores, the week’s meals and the "
                "school paperwork — in one shared, private place.",
        "bullets": [
            ("One shared calendar", "The whole family’s week at a glance."),
            ("Chores and stars", "Routines that stick without the daily negotiation."),
            ("Meals and shopping", "The dinner plan becomes the shopping list."),
            ("Scan the paperwork", "A school letter becomes an appointment in the calendar."),
        ],
        "scan": "Scan to install",
        "ios": "Coming soon to iPhone",
        "ios_sub": "On iPhone today: Ahenora runs in your browser.",
        "android": "On Android: install from Google Play.",
        "foot": "ahenora.com",
    },
}

TEMPLATE = """<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Playfair+Display:wght@700;800&display=swap" rel="stylesheet">
<style>
  /* A3, portrait. The margin is 12mm because most office printers cannot go
     nearer than 10mm and a headline clipped by the printer is a wasted ream. */
  @page {{ size: A3 portrait; margin: 0; }}
  * {{ box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  html, body {{ margin: 0; padding: 0; }}
  body {{
    width: 297mm; height: 420mm;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #101318; background: #F6F3EE;
    display: flex; flex-direction: column; padding: 12mm;
  }}
  .eyebrow {{
    display: inline-block; flex: none;
    font-size: 5.4mm; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: #B8410A;
    border: 0.6mm solid rgba(245,101,25,.35); background: #FFF0E7;
    padding: 2.6mm 5mm; border-radius: 999px;
  }}
  h1 {{
    font-family: "Playfair Display", Georgia, serif; font-weight: 800;
    font-size: 18mm; line-height: 1.03; letter-spacing: -0.02em;
    margin: 8mm 0 0; max-width: 250mm; text-wrap: balance;
  }}
  h1 .soft {{ color: #5F656E; display: block; font-style: italic; }}
  .lede {{ font-size: 6.8mm; line-height: 1.35; color: #3A4049; margin: 7mm 0 0; max-width: 210mm; }}
  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin: 8mm 0 0; }}
  .card {{
    background: #fff; border: 0.5mm solid #E6E1DA; border-radius: 6mm;
    padding: 5mm 6mm;
  }}
  .card h3 {{ margin: 0; font-size: 6.4mm; font-weight: 800; }}
  .card p {{ margin: 2.5mm 0 0; font-size: 5.4mm; line-height: 1.35; color: #5F656E; }}
  .spacer {{ flex: 1; }}
  /* The screens do the persuading a headline cannot: a poster on a school gate
     is read at two metres, and "what does it look like" is answered faster by
     a picture than by any sentence. Angled slightly so they read as objects
     rather than as a spec sheet. */
  .shots {{ display: flex; justify-content: center; align-items: flex-end;
           gap: 9mm; margin: 8mm 0 0; }}
  /* Cropped, not scaled down. A whole phone screen at this width is 134mm
     tall and pushes the footer onto a second sheet; the top third is the part
     that is recognisable anyway. */
  .device {{
    width: 58mm; height: 86mm; border-radius: 7mm; overflow: hidden;
    border: 1.1mm solid #101318; background: #fff;
    box-shadow: 0 6mm 14mm -6mm rgba(59,38,20,.35);
  }}
  .device img {{
    width: 100%; height: 100%; display: block;
    object-fit: cover; object-position: top center;
  }}
  .device.tilt-l {{ transform: rotate(-3.5deg); }}
  .device.tilt-r {{ transform: rotate(3.5deg); }}
  .foot {{
    display: flex; align-items: center; gap: 9mm;
    background: #fff; border: 0.5mm solid #E6E1DA; border-radius: 8mm; padding: 8mm;
  }}
  .qr {{ flex: none; line-height: 0; }}
  .foot-copy {{ flex: 1; }}
  .scan {{ font-size: 8mm; font-weight: 800; margin: 0; }}
  .url {{ font-size: 9.5mm; font-weight: 800; color: #B8410A; margin: 2mm 0 0; letter-spacing: -0.01em; }}
  .platforms {{ margin: 4mm 0 0; font-size: 5mm; line-height: 1.45; color: #5F656E; }}
  .ios {{
    display: inline-block; margin: 0 0 2.5mm;
    background: #101318; color: #fff; border-radius: 999px;
    padding: 2.2mm 5mm; font-size: 5mm; font-weight: 700; letter-spacing: .02em;
  }}
  .top {{ display: flex; align-items: center; justify-content: space-between; }}
  .brand {{ display: flex; align-items: center; gap: 4mm; }}
  .brand img {{ width: 18mm; height: 18mm; border-radius: 4.5mm; }}
  .brand span {{ font-size: 8mm; font-weight: 800; letter-spacing: -0.01em; }}
</style>
</head>
<body>
  <div class="top">
    <div class="brand">
      <img src="../assets/icon.png" alt="">
      <span>Ahenora</span>
    </div>
    <span class="eyebrow">{eyebrow}</span>
  </div>

  <h1>{headline}<span class="soft">{headline2}</span></h1>
  <p class="lede">{lede}</p>

  <div class="grid">{cards}</div>

  <div class="shots">
    <div class="device tilt-l"><img src="../assets/shot-feed.jpg" alt=""></div>
    <div class="device tilt-r"><img src="../assets/shot-kids.jpg" alt=""></div>
  </div>

  <div class="spacer"></div>

  <div class="foot">
    <div class="qr">{qr}</div>
    <div class="foot-copy">
      <span class="ios">{ios}</span>
      <p class="scan">{scan}</p>
      <p class="url">{foot}</p>
      <p class="platforms">{android}<br>{ios_sub}</p>
    </div>
  </div>
</body>
</html>
"""


def build():
    os.makedirs(OUT, exist_ok=True)
    written = []
    for code, copy in COPY.items():
        cards = "".join(
            f'<div class="card"><h3>{h}</h3><p>{p}</p></div>'
            for h, p in copy["bullets"])
        html = TEMPLATE.format(qr=qr_svg(URL, 62), cards=cards, **copy)
        path = os.path.join(OUT, f"flyer-a3-{code}.html")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(html)
        written.append(path)
    return written


if __name__ == "__main__":
    for p in build():
        print("wrote", os.path.relpath(p, os.path.join(HERE, "..")))
