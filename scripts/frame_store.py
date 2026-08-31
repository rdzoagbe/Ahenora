"""Frame raw app screenshots into polished Play Store marketing images.

Each output: brand gold->orange gradient, a white benefit headline + subhead,
and the phone screenshot with rounded corners and a soft shadow. Sized 1200x2133
(9:16) to satisfy Play's phone-screenshot ratio.

Usage: python3 scripts/frame_store.py <raw_dir> <out_dir> [lang] [store]

`lang` (default "en") selects the marketing copy. Headline/subhead font sizes
auto-fit so the longer French lines never run past the safe margin.

`store` (default "play") picks the canvas:

    play      1200x2133   Play phone screenshot (9:16)
    appstore  1320x2868   App Store 6.9" iPhone (16 Pro Max)

Every dimension below is expressed as a fraction of the canvas rather than a
pixel count, so a second store is a size, not a second copy of this file. The
fractions are the Play numbers divided by the Play canvas, which means the Play
output is byte-for-byte what it was before this was parameterised.

The raw captures are 1170x2532, comfortably above the widest phone image either
canvas asks for, so nothing has to be re-captured for the App Store.
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RAW, OUT = sys.argv[1], sys.argv[2]
LANG = sys.argv[3] if len(sys.argv) > 3 else "en"
STORE = sys.argv[4] if len(sys.argv) > 4 else "play"

# (width, height, phone width as a fraction of the canvas). The App Store
# canvas is proportionally MUCH taller than Play's, so reusing Play's phone
# width left a broad empty band between the headline and the device. The phone
# grows to fill it instead.
# App Store slots differ by device class and App Store Connect only accepts the
# exact pixel sizes for the slot you are filling, so both are generated:
#   appstore   6.9" iPhone (16 Pro Max)   1320x2868
#   appstore65 6.5" iPhone (11 Pro Max)   1284x2778
CANVAS = {"play": (1200, 2133, 0.6333),
          "appstore": (1320, 2868, 0.76),
          "appstore65": (1284, 2778, 0.76)}
if STORE not in CANVAS:
    sys.exit(f"unknown store {STORE!r}; expected one of {sorted(CANVAS)}")
os.makedirs(OUT, exist_ok=True)

W, H, PHONE_W = CANVAS[STORE]
GOLD = (250, 178, 46)
ORANGE = (211, 84, 0)
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# Type scales with the canvas WIDTH; vertical placement with its HEIGHT. The
# App Store canvas is much taller in proportion, so anchoring the phone to the
# bottom margin (as build() does) is what keeps the composition from drifting.
_w = W / 1200
SAFE_W = round(W * 0.90)          # headline/subhead must fit within this width
HEAD_MAX, HEAD_MIN = round(74 * _w), round(52 * _w)
SUB_MAX, SUB_MIN = round(38 * _w), round(28 * _w)

# Per language: (raw file, headline, subhead). Raw filenames are shared across
# languages — the capture step writes the same names into a per-language dir.
SLIDES = {
    "en": [
        ("01-feed.png",     "A better home base\nfor family life",     "Tasks, reminders and the daily plan — sorted"),
        ("02-calendar.png", "One shared\nfamily calendar",            "You each choose exactly what to share"),
        ("03-kids.png",     "Chores kids\nwant to finish",            "Stars they swap for rewards you set"),
        ("04-kitchen.png",  "The week's meals,\nplanned in minutes",  "Snap a recipe, sync it to your shopping list"),
        ("05-quickadd.png", "Capture anything\nin a single tap",      "Type it, scan it, or just say it"),
        ("06-household.png","Everything a\nhousehold needs",          "Vault, calendar, kids and co-parenting"),
    ],
    "fr": [
        ("01-feed.png",     "Un meilleur port d'attache\npour la vie de famille", "Tâches, rappels et le programme du jour — organisés"),
        ("02-calendar.png", "Un seul calendrier\nfamilial partagé",              "Chacun choisit précisément ce qu'il partage"),
        ("03-kids.png",     "Des tâches que les enfants\naiment terminer",       "Des étoiles à échanger contre vos récompenses"),
        ("04-kitchen.png",  "Les repas de la semaine,\nplanifiés en minutes",    "Photographiez une recette, synchronisez la liste de courses"),
        ("05-quickadd.png", "Capturez tout\nen un seul geste",                   "Écrivez-le, scannez-le, ou dites-le simplement"),
        ("06-household.png","Tout ce dont un\nfoyer a besoin",                   "Coffre, calendrier, enfants et coparentalité"),
    ],
}


def gradient(w, h, top, bot):
    base = Image.new("RGB", (w, h), top)
    draw = ImageDraw.Draw(base)
    for y in range(h):
        t = y / (h - 1)
        # ease so gold holds a touch longer up top
        t = t ** 1.15
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (w, y)], fill=c)
    return base


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0], img.size[1]],
                                           radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def fit_font(draw, text, path, size_max, size_min):
    """Largest font (<= size_max) at which every line fits SAFE_W."""
    for size in range(size_max, size_min - 1, -2):
        font = ImageFont.truetype(path, size)
        if all(draw.textbbox((0, 0), line, font=font)[2] <= SAFE_W
               for line in text.split("\n")):
            return font
    return ImageFont.truetype(path, size_min)


def wrap_center(draw, text, font, cx, y, fill, line_gap=12):
    for line in text.split("\n"):
        w = draw.textbbox((0, 0), line, font=font)[2]
        draw.text((cx - w / 2, y), line, font=font, fill=fill)
        y += (draw.textbbox((0, 0), line, font=font)[3]) + line_gap
    return y


def build(raw_name, headline, subhead, out_name):
    canvas = gradient(W, H, GOLD, ORANGE)
    draw = ImageDraw.Draw(canvas)
    hf = fit_font(draw, headline, FONT_B, HEAD_MAX, HEAD_MIN)
    sf = fit_font(draw, subhead, FONT_R, SUB_MAX, SUB_MIN)

    y = round(H * 0.045)
    y = wrap_center(draw, headline, hf, W / 2, y, (255, 255, 255), line_gap=round(8 * _w))
    y += round(14 * _w)
    wrap_center(draw, subhead, sf, W / 2, y, (255, 255, 255, 235), line_gap=round(6 * _w))

    phone = Image.open(os.path.join(RAW, raw_name)).convert("RGB")
    target_w = round(W * PHONE_W)
    target_h = int(phone.height * target_w / phone.width)
    phone = phone.resize((target_w, target_h), Image.LANCZOS)
    radius = round(46 * _w)
    phone = rounded(phone, radius)

    px = (W - target_w) // 2
    # Sit the phone below the header with a comfortable bottom margin so the
    # tab bar never touches the canvas edge.
    py = max(round(H * 0.1838), H - target_h - round(H * 0.0328))
    # soft shadow
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    off_x, off_y = round(8 * _w), round(20 * _w)
    sd.rounded_rectangle([px + off_x, py + off_y,
                          px + target_w + off_x, py + target_h + off_y],
                         radius=radius, fill=(60, 20, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(round(26 * _w)))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)
    canvas.alpha_composite(phone, (px, py))
    canvas.convert("RGB").save(os.path.join(OUT, out_name), "PNG", optimize=True)
    print("framed", out_name)


for i, (raw, hl, sub) in enumerate(SLIDES[LANG], 1):
    build(raw, hl, sub, f"screenshot-{i:02d}.png")
print("ALL FRAMED")
