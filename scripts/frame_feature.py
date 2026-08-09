"""Play Store feature graphic — 1024x500, brand gradient, icon + name + tagline.
Usage: python3 scripts/frame_feature.py <icon_png> <out_png>
"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ICON, OUT = sys.argv[1], sys.argv[2]
W, H = 1024, 500
GOLD = (250, 178, 46)
ORANGE = (205, 80, 0)
FB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def gradient(w, h, a, b):
    img = Image.new("RGB", (w, h), a)
    d = ImageDraw.Draw(img)
    for x in range(w):
        t = (x / (w - 1)) ** 1.05
        d.line([(x, 0), (x, h)], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    return img


def rounded(img, r):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, *img.size], radius=r, fill=255)
    o = img.convert("RGBA"); o.putalpha(m); return o


c = gradient(W, H, GOLD, ORANGE).convert("RGBA")

# icon, left, with soft shadow
icon = Image.open(ICON).convert("RGB").resize((300, 300), Image.LANCZOS)
icon = rounded(icon, 66)
ix, iy = 96, (H - 300) // 2
sh = Image.new("RGBA", c.size, (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle([ix + 6, iy + 12, ix + 306, iy + 312], radius=66, fill=(60, 20, 0, 130))
c = Image.alpha_composite(c, sh.filter(ImageFilter.GaussianBlur(20)))
c.alpha_composite(icon, (ix, iy))

d = ImageDraw.Draw(c)
tx = 452
right_margin = 40
# Fit the title within the panel so nothing clips off the right edge.
title = "Household COO"
tsize = 64
while tsize > 30:
    tf = ImageFont.truetype(FB, tsize)
    if d.textbbox((0, 0), title, font=tf)[2] <= (W - tx - right_margin):
        break
    tsize -= 2
d.text((tx, 172), title, font=tf, fill=(255, 255, 255))
d.text((tx, 258), "Your whole family,", font=ImageFont.truetype(FR, 37), fill=(255, 255, 255))
d.text((tx, 304), "all in one place", font=ImageFont.truetype(FR, 37), fill=(255, 255, 255))

c.convert("RGB").save(OUT, "PNG", optimize=True)
print("saved", OUT, c.size)
