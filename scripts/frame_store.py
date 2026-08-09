"""Frame raw app screenshots into polished Play Store marketing images.

Each output: brand gold->orange gradient, a white benefit headline + subhead,
and the phone screenshot with rounded corners and a soft shadow. Sized 1200x2133
(9:16) to satisfy Play's phone-screenshot ratio.

Usage: python3 scripts/frame_store.py <raw_dir> <out_dir>
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RAW, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)

W, H = 1200, 2133
GOLD = (250, 178, 46)
ORANGE = (211, 84, 0)
FONT_B = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_R = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# (raw file, headline, subhead)
SLIDES = [
    ("01-feed.png",     "Your whole family,\nall in one place",   "Tasks, reminders and the daily plan — sorted"),
    ("02-calendar.png", "One shared\nfamily calendar",            "You each choose exactly what to share"),
    ("03-kids.png",     "Chores kids\nwant to finish",            "Stars they swap for rewards you set"),
    ("04-kitchen.png",  "The week's meals,\nplanned in minutes",  "Snap a recipe, sync it to your shopping list"),
    ("05-quickadd.png", "Capture anything\nin a single tap",      "Type it, scan it, or just say it"),
    ("06-household.png","Everything a\nhousehold needs",          "Vault, calendar, kids and co-parenting"),
]


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


def wrap_center(draw, text, font, cx, y, fill, line_gap=12):
    for line in text.split("\n"):
        w = draw.textbbox((0, 0), line, font=font)[2]
        draw.text((cx - w / 2, y), line, font=font, fill=fill)
        y += (draw.textbbox((0, 0), line, font=font)[3]) + line_gap
    return y


def build(raw_name, headline, subhead, out_name):
    canvas = gradient(W, H, GOLD, ORANGE)
    draw = ImageDraw.Draw(canvas)
    hf = ImageFont.truetype(FONT_B, 74)
    sf = ImageFont.truetype(FONT_R, 38)

    y = 96
    y = wrap_center(draw, headline, hf, W / 2, y, (255, 255, 255), line_gap=8)
    y += 14
    wrap_center(draw, subhead, sf, W / 2, y, (255, 255, 255, 235), line_gap=6)

    phone = Image.open(os.path.join(RAW, raw_name)).convert("RGB")
    target_w = 760
    target_h = int(phone.height * target_w / phone.width)
    phone = phone.resize((target_w, target_h), Image.LANCZOS)
    phone = rounded(phone, 46)

    px = (W - target_w) // 2
    # Sit the phone below the header with a comfortable bottom margin so the
    # tab bar never touches the canvas edge.
    py = max(392, H - target_h - 70)
    # soft shadow
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle([px + 8, py + 20, px + target_w + 8, py + target_h + 20],
                         radius=46, fill=(60, 20, 0, 120))
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)
    canvas.alpha_composite(phone, (px, py))
    canvas.convert("RGB").save(os.path.join(OUT, out_name), "PNG", optimize=True)
    print("framed", out_name)


for i, (raw, hl, sub) in enumerate(SLIDES, 1):
    build(raw, hl, sub, f"screenshot-{i:02d}.png")
print("ALL FRAMED")
