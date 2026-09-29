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
        "eyebrow": "14 jours offerts · Sans publicité",
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
        "ios": "iPhone et Android",
        "ios_sub": "Ou dans n’importe quel navigateur&nbsp;: ahenora.com/app",
        "android": "Sur l’App Store et Google Play.",
        "foot": "ahenora.com",
    },
    "en": {
        "lang": "en",
        "title": "Ahenora — poster",
        "eyebrow": "14 days free · No ads",
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
        "ios": "iPhone and Android",
        "ios_sub": "Or in any browser: ahenora.com/app",
        "android": "On the App Store and Google Play.",
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


# ---------------------------------------------------------------------------
# The letterbox flyer.
#
# A different reader from the poster's. The poster is read at two metres by a
# parent at a school gate; this is held in the hand at the kitchen table by
# someone who has never heard of Ahenora and owes it nothing. So it is dark
# type on a light ground (the paper stays readable under a kitchen light and
# costs a home printer a fraction of the ink), and it is two-sided: the front
# is complete on its own — what it is, one QR, the address — and the back
# answers the next two questions, "what does it actually do" and "what does
# it cost".
#
# The big QR goes to /get, which sends an iPhone to the App Store, an Android
# phone to Google Play and anything else to the web app — one code that is
# right for whoever scans it. The back carries the two store codes as well,
# for the person who wants to know where they are being sent.

APP_STORE = "https://apps.apple.com/app/id6806811163"
GOOGLE_PLAY = "https://play.google.com/store/apps/details?id=com.householdcoo.app"
GET_URL = "https://ahenora.com/get"

MAILBOX_COPY = {
    "fr": {
        "lang": "fr",
        "title": "Ahenora — dépliant boîte aux lettres",
        "pill": "14 jours offerts",
        "headline": "Toute la maison, au même endroit.",
        "headline2": "Et moins de choses à retenir.",
        "lede": "L’agenda, les tâches, les repas, les courses et les papiers de "
                "l’école&nbsp;— partagés avec toute la maison, sur chaque téléphone.",
        "scan": "Scannez avec l’appareil photo",
        "scan_sub": "iPhone&nbsp;: App Store · Android&nbsp;: Google Play",
        "or_visit": "ou rendez-vous sur",
        "trial": "Toute l’app gratuite pendant 14&nbsp;jours. Sans carte, rien n’est débité à la fin.",
        "back_title": "Ce qu’Ahenora fait pour votre foyer",
        "features": [
            ("Un agenda partagé",
             "La semaine de chacun d’un coup d’œil&nbsp;; les rappels vont à la bonne personne."),
            ("Une photo, et c’est rangé",
             "Un mot de l’école, une recette, une liste de courses&nbsp;: photographiez-le, "
             "Ahenora le met au bon endroit."),
            ("Repas et courses",
             "Planifiez les dîners de la semaine&nbsp;; la liste de courses s’écrit toute seule."),
            ("Corvées et étoiles",
             "Des routines qui tiennent, et des récompenses que les enfants méritent."),
            ("Tâches et messagerie familiale",
             "Confiez une tâche à quelqu’un et voyez-la faite, sans relancer."),
        ],
        "plans_title": "Les formules",
        "per_month": "/ mois",
        "plans": [
            ("Gratuit", "0&nbsp;€", "Deux adultes&nbsp;: agenda, tâches, listes et messagerie"),
            ("Duo", "1,99&nbsp;€", "Pour deux, sans enfants&nbsp;: repas et scans illimités"),
            ("Famille", "4,99&nbsp;€", "Jusqu’à 5 enfants, corvées, étoiles et argent de poche"),
            ("Foyer", "9,99&nbsp;€", "Jusqu’à 10 enfants et 20 personnes, comptes nounou"),
        ],
        "popular": "Pour les familles",
        "yearly": "Aussi à l’année, jusqu’à 33&nbsp;% moins cher.",
        "get_title": "Installez Ahenora",
        "app_store": "App Store",
        "app_store_sub": "iPhone et iPad",
        "google_play": "Google Play",
        "google_play_sub": "Android",
        "web": "Sur ordinateur&nbsp;: ahenora.com/app",
        "promise": "Sans publicité · Les données de votre famille ne sont jamais vendues",
    },
    "en": {
        "lang": "en",
        "title": "Ahenora — letterbox flyer",
        "pill": "14 days free",
        "headline": "The whole household, in one place.",
        "headline2": "And far less to remember.",
        "lede": "The calendar, the tasks, the meals, the shopping and the school "
                "letters&nbsp;— shared with everyone at home, on every phone.",
        "scan": "Scan with your phone camera",
        "scan_sub": "iPhone: App Store · Android: Google Play",
        "or_visit": "or visit",
        "trial": "The whole app free for 14&nbsp;days. No card, nothing charged when it ends.",
        "back_title": "What Ahenora does for your home",
        "features": [
            ("One shared calendar",
             "Everyone’s week at a glance, and reminders reach the right person."),
            ("Snap it, sorted",
             "A school letter, a recipe, a shopping list: take a photo and Ahenora puts it "
             "where it belongs."),
            ("Meals and shopping",
             "Plan the week’s dinners and the shopping list writes itself."),
            ("Chores and stars",
             "Routines that stick for the children, with rewards they earn."),
            ("Tasks and family chat",
             "Hand a task to someone and see it done, without the nagging."),
        ],
        "plans_title": "Plans",
        "per_month": "/ month",
        "plans": [
            ("Free", "€0", "Two adults: calendar, tasks, lists and chat"),
            ("Duo", "€1.99", "For two, no children: meals and unlimited scans"),
            ("Family", "€4.99", "Up to 5 children, chores, stars and pocket money"),
            ("Household", "€9.99", "Up to 10 children and 20 people, nanny accounts"),
        ],
        "popular": "Most families",
        "yearly": "Also yearly, up to 33% cheaper.",
        "get_title": "Get Ahenora",
        "app_store": "App Store",
        "app_store_sub": "iPhone and iPad",
        "google_play": "Google Play",
        "google_play_sub": "Android",
        "web": "On a computer: ahenora.com/app",
        "promise": "No ads · Your family’s data is never sold",
    },
}

MAILBOX_TEMPLATE = """<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&family=Playfair+Display:ital,wght@0,700;0,800;1,700&display=swap" rel="stylesheet">
<style>
  /* Two A5 pages: page 1 is the front, page 2 the back. Print double-sided,
     flip on the long edge. Page 1 alone is a complete flyer. */
  @page {{ size: A5 portrait; margin: 0; }}
  * {{ box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  html, body {{ margin: 0; padding: 0; }}
  body {{ background: #FAF6F1; color: #22201D;
         font-family: Figtree, system-ui, -apple-system, "Segoe UI", sans-serif; }}
  /* Each side is exactly the sheet and clips anything that would spill: an
     overflow of a hundredth of a millimetre is a third, blank page. The 9mm
     inset keeps every word inside what an office printer can reach. */
  .page {{
    width: 148mm; height: 210mm; overflow: hidden; position: relative;
    padding: 9mm; display: flex; flex-direction: column;
    background: #FAF6F1; break-after: page;
  }}
  .page:last-child {{ break-after: auto; }}
  /* The one colour field on the front: a soft peach disc behind the phones.
     Enough warmth that it looks printed on purpose, pale enough that no word
     ever sits on anything darker than the paper. */
  .glow {{
    position: absolute; width: 150mm; height: 150mm; border-radius: 50%;
    right: -52mm; top: 70mm; background: #FCE3D0;
  }}
  .page > :not(.glow) {{ position: relative; }}
  .top {{ display: flex; align-items: center; justify-content: space-between; flex: none; }}
  .brand {{ display: flex; align-items: center; gap: 2.6mm; }}
  .brand img {{ width: 10mm; height: 10mm; border-radius: 2.6mm; }}
  .brand span {{ font-size: 5.6mm; font-weight: 800; letter-spacing: -0.01em; }}
  .pill {{
    background: #CA470A; color: #fff; border-radius: 999px;
    padding: 1.6mm 3.6mm; font-size: 3.4mm; font-weight: 700; letter-spacing: .02em;
  }}
  h1 {{
    font-family: "Playfair Display", Georgia, serif; font-weight: 800;
    font-size: 10.6mm; line-height: 1.06; letter-spacing: -0.015em;
    margin: 8mm 0 0; text-wrap: balance; flex: none;
  }}
  /* #CA470A on #FAF6F1 is 4.9:1 — the brand orange #F26A1B would be 2.9:1,
     too pale for the one line people read second. */
  h1 em {{ display: block; color: #CA470A; font-style: italic; font-weight: 700;
          font-size: 8.2mm; margin-top: 2.4mm; }}
  .lede {{ font-size: 4.3mm; line-height: 1.42; color: #3E3A35; margin: 4.5mm 0 0;
          flex: none; text-wrap: pretty; }}
  .shots {{ flex: 1; min-height: 0; display: flex; justify-content: center;
           align-items: center; gap: 7mm; padding: 5mm 0; }}
  .device {{
    height: 100%; max-height: 74mm; aspect-ratio: 500 / 900;
    border-radius: 5mm; overflow: hidden; background: #fff;
    border: .8mm solid #22201D;
    box-shadow: 0 3mm 7mm -3mm rgba(34,32,29,.35);
  }}
  .device img {{ width: 100%; height: 100%; display: block; object-fit: cover; object-position: top center; }}
  .device.l {{ transform: rotate(-3deg); }}
  .device.r {{ transform: rotate(3deg); }}
  .scanbox {{
    flex: none; display: flex; align-items: center; gap: 5mm;
    background: #fff; border: .45mm solid #E8DDD1; border-radius: 5mm; padding: 4.5mm;
  }}
  .qr {{ flex: none; line-height: 0; }}
  .scan {{ margin: 0; font-size: 5mm; font-weight: 800; line-height: 1.2; }}
  .scan-sub {{ margin: 1.4mm 0 0; font-size: 3.4mm; color: #5B554E; }}
  .visit {{ margin: 3mm 0 0; font-size: 3.4mm; color: #5B554E; }}
  .visit b {{ display: block; font-size: 6.2mm; color: #CA470A; font-weight: 800;
             letter-spacing: -0.01em; margin-top: .4mm; }}
  .trial {{ flex: none; margin: 3.5mm 0 0; font-size: 3.5mm; text-align: center; color: #3E3A35; }}
  .trial b {{ color: #22201D; }}

  /* The back. Answers, in the order a sceptic asks them. */
  h2 {{ font-family: "Playfair Display", Georgia, serif; font-weight: 800;
       font-size: 7.4mm; line-height: 1.1; margin: 5mm 0 0; flex: none; text-wrap: balance; }}
  h2.first {{ margin-top: 1mm; }}
  .features {{ list-style: none; margin: 3.6mm 0 0; padding: 0; display: grid; gap: 2.2mm; flex: none; }}
  .features li {{ display: grid; grid-template-columns: 3.2mm 1fr; column-gap: 3mm; }}
  .features li::before {{ content: ""; width: 3.2mm; height: 3.2mm; border-radius: 1mm;
                         margin-top: .9mm; background: var(--dot); }}
  .features li:nth-child(1) {{ --dot: #F26A1B; }}
  .features li:nth-child(2) {{ --dot: #2E8B6A; }}
  .features li:nth-child(3) {{ --dot: #6A58C4; }}
  .features li:nth-child(4) {{ --dot: #E0A21B; }}
  .features li:nth-child(5) {{ --dot: #2F6FB0; }}
  .features h3 {{ margin: 0; font-size: 4.2mm; font-weight: 800; }}
  .features p {{ grid-column: 2; margin: .4mm 0 0; font-size: 3.4mm; line-height: 1.38; color: #4A453F; }}
  .plans-head {{ display: flex; align-items: baseline; justify-content: space-between;
                margin: 5.5mm 0 0; flex: none; }}
  .plans-head h2 {{ margin: 0; font-size: 6mm; }}
  .plans-head span {{ font-size: 3.2mm; color: #5B554E; }}
  .plans {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 2mm; margin: 2.8mm 0 0; flex: none; }}
  .plan {{ background: #fff; border: .45mm solid #E8DDD1; border-radius: 3.4mm; padding: 2.6mm 2.4mm; }}
  .plan.pop {{ border-color: #CA470A; background: #FFF4EC; }}
  .plan h4 {{ margin: 0; font-size: 3.6mm; font-weight: 800; }}
  .plan .price {{ margin: 1mm 0 0; font-size: 5.2mm; font-weight: 800; color: #CA470A; line-height: 1.1; }}
  .plan .price small {{ font-size: 2.7mm; font-weight: 600; color: #5B554E; }}
  .plan p {{ margin: 1.2mm 0 0; font-size: 2.85mm; line-height: 1.3; color: #4A453F; }}
  .plan .tag {{ display: block; font-size: 2.5mm; font-weight: 700; color: #CA470A;
               text-transform: uppercase; letter-spacing: .04em; margin: 0 0 .8mm; }}
  .trial-back {{ margin: 2.8mm 0 0; font-size: 3.3mm; color: #3E3A35; flex: none; }}
  .spacer {{ flex: 1; }}
  /* Ink to anchor the back, as on the poster. The QRs keep a white quiet
     zone inside it: a code printed dark on dark does not scan. */
  .get {{ flex: none; background: #22201D; color: #fff; border-radius: 5mm; padding: 4.5mm; }}
  .get h2 {{ margin: 0; font-size: 5.4mm; color: #fff; }}
  .stores {{ display: flex; gap: 4mm; margin: 3mm 0 0; }}
  .store {{ flex: 1; display: flex; align-items: center; gap: 3mm; }}
  .store .qr {{ background: #fff; border-radius: 2mm; padding: 1mm; }}
  .store b {{ display: block; font-size: 4.2mm; }}
  .store span {{ display: block; font-size: 3.1mm; color: #CFC7BE; margin-top: .4mm; }}
  .get .web {{ margin: 3mm 0 0; font-size: 3.4mm; color: #FFB27F; font-weight: 700; }}
  .promise {{ flex: none; margin: 3mm 0 0; font-size: 3mm; color: #5B554E; text-align: center; }}
</style>
</head>
<body>
 <section class="page front">
  <div class="glow"></div>
  <div class="top">
    <div class="brand"><img src="../assets/icon.png" alt=""><span>Ahenora</span></div>
    <span class="pill">{pill}</span>
  </div>
  <h1>{headline}<em>{headline2}</em></h1>
  <p class="lede">{lede}</p>
  <div class="shots">
    <div class="device l"><img src="../assets/print-feed-{lang}.jpg" alt=""></div>
    <div class="device r"><img src="../assets/print-kitchen-{lang}.jpg" alt=""></div>
  </div>
  <div class="scanbox">
    <div class="qr">{qr_get}</div>
    <div>
      <p class="scan">{scan}</p>
      <p class="scan-sub">{scan_sub}</p>
      <p class="visit">{or_visit}<b>ahenora.com</b></p>
    </div>
  </div>
  <p class="trial">{trial}</p>
 </section>

 <section class="page back">
  <h2 class="first">{back_title}</h2>
  <ul class="features">{features}</ul>
  <div class="plans-head"><h2>{plans_title}</h2><span>{yearly}</span></div>
  <div class="plans">{plans}</div>
  <p class="trial-back">{trial}</p>
  <div class="spacer"></div>
  <div class="get">
    <h2>{get_title}</h2>
    <div class="stores">
      <div class="store"><div class="qr">{qr_apple}</div><div><b>{app_store}</b><span>{app_store_sub}</span></div></div>
      <div class="store"><div class="qr">{qr_play}</div><div><b>{google_play}</b><span>{google_play_sub}</span></div></div>
    </div>
    <p class="web">{web}</p>
  </div>
  <p class="promise">{promise}</p>
 </section>
</body>
</html>
"""


def mailbox_html(copy):
    """One letterbox flyer, front and back, from its language's copy."""
    features = "".join(
        f"<li><h3>{h}</h3><p>{p}</p></li>" for h, p in copy["features"])
    plans = []
    for i, (name, price, desc) in enumerate(copy["plans"]):
        pop = i == 2  # Family: the plan most homes with children land on
        tag = f'<span class="tag">{copy["popular"]}</span>' if pop else ""
        plans.append(
            f'<div class="plan{" pop" if pop else ""}">{tag}<h4>{name}</h4>'
            f'<p class="price">{price} <small>{copy["per_month"]}</small></p>'
            f'<p>{desc}</p></div>')
    fields = {k: v for k, v in copy.items() if k not in ("features", "plans")}
    return MAILBOX_TEMPLATE.format(
        features=features, plans="".join(plans),
        qr_get=qr_svg(GET_URL, 34),
        qr_apple=qr_svg(APP_STORE, 23),
        qr_play=qr_svg(GOOGLE_PLAY, 23),
        **fields)


def build():
    os.makedirs(OUT, exist_ok=True)
    written = []
    for code, copy in MAILBOX_COPY.items():
        path = os.path.join(OUT, f"mailbox-a5-{code}.html")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(mailbox_html(copy))
        written.append(path)
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
