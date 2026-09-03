# -*- coding: utf-8 -*-
"""Generate the A3 posters and the A5 handouts.

Two languages from one template, because a poster that says something slightly
different in French than in English is a poster nobody proofread. Run:

    python3 scripts/build_flyers.py

The QR is emitted as inline SVG rather than a PNG. A QR is pure geometry: as
vector it stays sharp at any size a printer chooses, and a flyer that gets
scaled on a copier is the normal case, not the exception. Error correction is
set to H (30% recoverable) so the code still reads with a drawing pin through
a corner or rain on a school gate.

Both sizes are the SAME composition, scaled. The sheet is authored once at A3
and the A5 draws it through a transform, so the two can never drift into two
designs that say the same thing differently — which is what happens the first
time somebody edits one and forgets the other.

On colour: the first version was a cream barely off white, white cards and
black text, with orange only in hairlines. On screen that reads as restraint;
printed, it reads as a photocopy — which is exactly what came back from the
first print run. There is a solid orange field at the top now and tinted
cards below it, so the sheet puts real ink on real paper.
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
        "title": "Ahenora — affiche",
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
        "title": "Ahenora — poster",
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
  /* One composition, two sheets. Authored at A3 and scaled for A5, so the
     handout and the poster can never drift apart. The 12mm margin is because
     most office printers cannot go nearer than 10mm, and a headline clipped
     by the printer is a wasted ream. */
  @page {{ size: {page} portrait; margin: 0; }}
  * {{ box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  /* Both boxes clipped to the sheet. The scaled A5 measured 210.08mm against a
     210mm page — eight hundredths of a millimetre, and Chrome duly emitted a
     second, blank page. Nothing here may overflow by any amount. */
  html, body {{ margin: 0; padding: 0; overflow: hidden; }}
  html {{ width: {pw}mm; height: {ph}mm; }}
  body {{
    width: {pw}mm; height: {ph}mm;
    background: #EFE4D8;
    font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    overflow: hidden; position: relative;
  }}
  /* The sheet is always A3-sized; the A5 scales it. transform-origin top-left
     with no margins means the scaled sheet lands exactly on the page corner. */
  /* Absolute, not in flow. A transform scales what is painted but NOT the
     space the element takes, so an in-flow sheet still claimed 420mm on an
     A5 page and the printer duly started a second one. Out of flow, the page
     is sized by body alone. */
  .sheet {{
    position: absolute; top: 0; left: 0;
    width: 297mm; height: 420mm;
    transform: scale({k}); transform-origin: top left;
    color: #101318; background: #EFE4D8;
    display: flex; flex-direction: column;
  }}
  /* The orange field. Full bleed, no margin — a band of actual ink is what
     makes this readable across a playground and what the pale version had
     none of. White type on #D2540E measures 4.9:1, so the headline clears AA
     rather than merely looking bold. */
  .banner {{
    background: #D2540E; color: #fff;
    padding: 12mm 12mm 9mm; flex: none;
  }}
  .body {{ padding: 0 12mm 12mm; display: flex; flex-direction: column; flex: 1; }}
  .eyebrow {{
    display: inline-block; flex: none;
    font-size: 5.4mm; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: #D2540E;
    background: #fff; padding: 2.6mm 5mm; border-radius: 999px;
  }}
  h1 {{
    font-family: "Playfair Display", Georgia, serif; font-weight: 800;
    font-size: 18mm; line-height: 1.03; letter-spacing: -0.02em;
    margin: 8mm 0 0; max-width: 250mm; text-wrap: balance;
  }}
  h1 {{ color: #fff; }}
  /* Was mid-grey on cream, which is the first thing to vanish on a laser
     printer. On the orange it is a warm tint of the same white. */
  h1 .soft {{ color: #FFE2CE; display: block; font-style: italic; }}
  .lede {{ font-size: 6.8mm; line-height: 1.35; color: #FFEADC; margin: 7mm 0 0; max-width: 210mm; }}
  .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; margin: 8mm 0 0; }}
  /* Four tints from the app's own palette rather than four white boxes. The
     colour goes where the eye actually lands, and each card is legible on its
     own ground — the headings are the deep inks, not the fills. */
  .card {{ border-radius: 6mm; padding: 5mm 6mm; border: none; }}
  .card:nth-child(1) {{ background: #FFE3D2; }}
  .card:nth-child(2) {{ background: #D6EFE4; }}
  .card:nth-child(3) {{ background: #E4E0F6; }}
  .card:nth-child(4) {{ background: #D9E8F7; }}
  .card:nth-child(1) h3 {{ color: #9C3806; }}
  .card:nth-child(2) h3 {{ color: #14624A; }}
  .card:nth-child(3) h3 {{ color: #453591; }}
  .card:nth-child(4) h3 {{ color: #14497C; }}
  .card h3 {{ margin: 0; font-size: 6.4mm; font-weight: 800; }}
  .card p {{ margin: 2.5mm 0 0; font-size: 5.4mm; line-height: 1.35; color: #2A2F36; }}
  .spacer {{ flex: 1; }}
  /* The screens do the persuading a headline cannot: a poster on a school gate
     is read at two metres, and "what does it look like" is answered faster by
     a picture than by any sentence. Angled slightly so they read as objects
     rather than as a spec sheet. */
  .shots {{ display: flex; justify-content: center; align-items: flex-end;
           gap: 9mm; margin: 7mm 0 0; flex: none; }}
  /* Cropped, not scaled down. A whole phone screen at this width is 134mm
     tall and pushes the footer onto a second sheet; the top third is the part
     that is recognisable anyway. 76mm, not 86: the orange banner is taller
     than the old cream header, and at 86 the phones ran under the footer. */
  .device {{
    width: 58mm; height: 76mm; border-radius: 7mm; overflow: hidden;
    border: 1.1mm solid #101318; background: #fff;
    box-shadow: 0 6mm 14mm -6mm rgba(59,38,20,.35);
  }}
  .device img {{
    width: 100%; height: 100%; display: block;
    object-fit: cover; object-position: top center;
  }}
  .device.tilt-l {{ transform: rotate(-3.5deg); }}
  .device.tilt-r {{ transform: rotate(3.5deg); }}
  /* Ink, to anchor the bottom of the sheet against the orange at the top. The
     QR keeps its white quiet zone inside the dark panel — a code printed dark
     on dark does not scan, whatever the error correction. */
  .foot {{
    display: flex; align-items: center; gap: 9mm;
    background: #16181D; border-radius: 8mm; padding: 8mm;
  }}
  .qr {{ flex: none; line-height: 0; background: #fff; padding: 4mm; border-radius: 4mm; }}
  .foot-copy {{ flex: 1; }}
  .scan {{ font-size: 8mm; font-weight: 800; margin: 0; color: #fff; }}
  /* #FF8A45 on #16181D is 6.4:1; the brand orange itself is 3.4:1 there and
     would be the one line on the sheet nobody could read. */
  .url {{ font-size: 9.5mm; font-weight: 800; color: #FF8A45; margin: 2mm 0 0; letter-spacing: -0.01em; }}
  .platforms {{ margin: 4mm 0 0; font-size: 5mm; line-height: 1.45; color: #C9CDD4; }}
  .ios {{
    display: inline-block; margin: 0 0 2.5mm;
    background: #fff; color: #16181D; border-radius: 999px;
    padding: 2.2mm 5mm; font-size: 5mm; font-weight: 700; letter-spacing: .02em;
  }}
  .top {{ display: flex; align-items: center; justify-content: space-between; }}
  .brand {{ display: flex; align-items: center; gap: 4mm; }}
  .brand img {{ width: 18mm; height: 18mm; border-radius: 4.5mm; }}
  .brand span {{ font-size: 8mm; font-weight: 800; letter-spacing: -0.01em; color: #fff; }}
</style>
</head>
<body>
 <div class="sheet">
  <div class="banner">
  <div class="top">
    <div class="brand">
      <img src="../assets/icon.png" alt="">
      <span>Ahenora</span>
    </div>
    <span class="eyebrow">{eyebrow}</span>
  </div>

  <h1>{headline}<span class="soft">{headline2}</span></h1>
  <p class="lede">{lede}</p>
  </div>

  <div class="body">
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
  </div>
 </div>
</body>
</html>
"""


# A5 is exactly half of A3 in each direction, which is why one composition can
# serve both with nothing reflowing.
# A5 is nominally half of A3, but only nominally: 297/2 is 148.5 and the ISO
# sheet is 148. Scaling by a flat 0.5 left the sheet half a millimetre wider
# than the paper, and half a millimetre is enough for the printer to start a
# second page. Scale by the real width ratio and the composition lands inside
# the sheet in both directions.
SIZES = {
    "a3": {"page": "A3", "pw": 297, "ph": 420, "k": 1},
    "a5": {"page": "A5", "pw": 148, "ph": 210, "k": round(148 / 297, 5)},
}


def build():
    os.makedirs(OUT, exist_ok=True)
    written = []
    for code, copy in COPY.items():
        cards = "".join(
            f'<div class="card"><h3>{h}</h3><p>{p}</p></div>'
            for h, p in copy["bullets"])
        for size, dims in SIZES.items():
            html = TEMPLATE.format(qr=qr_svg(URL, 62), cards=cards, **dims, **copy)
            path = os.path.join(OUT, f"flyer-{size}-{code}.html")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(html)
            written.append(path)
    return written


if __name__ == "__main__":
    for p in build():
        print("wrote", os.path.relpath(p, os.path.join(HERE, "..")))
