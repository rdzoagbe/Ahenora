"""Crop a photograph down to the document in it.

Roland, twice: "there is no autoframe with the scan... just take the exact
dimension of the document scanned". He photographs a letter lying on a table
and the whole table goes up — three to five megabytes of wood grain, with the
page occupying a third of the frame. That is slow to upload and it is why
extraction was mediocre: the model was reading a photo of a TABLE.

A phone-side document scanner is the other way to do this and it needs a
native module, a new build and two store reviews (see docs/RUNBOOK-ota.md).
This does the part that actually matters — the document arriving at its own
size — from the server, where it can be tested.

THE RULE THIS IS BUILT AROUND

A wrong crop cuts the bottom off somebody's vaccination certificate, and
nothing on screen says so. That is worse than no crop at all. So every
decision here is biased toward DOING NOTHING:

  * the page must be clearly brighter than what surrounds it;
  * the detected region must be a plausible document — not almost the whole
    frame (nothing to crop), not a stamp-sized sliver (something went wrong),
    not a shape no sheet of paper has;
  * anything unreadable, any exception, any doubt, returns the original
    bytes unchanged.

It is a BOUNDING BOX, not perspective correction. Deskewing a tilted page
needs a homography and OpenCV is not a dependency here; a bounding box still
removes the table, which is the whole complaint. A page photographed at an
angle keeps its angle and loses its surroundings.
"""
from __future__ import annotations

import base64
import io
from typing import Optional, Tuple

from PIL import Image, ImageChops, ImageFilter, ImageOps

# Work at this width when looking. The decision is about where the page sits,
# not about detail, and a 4000px photograph costs a second to scan row by row.
ANALYSIS_WIDTH = 600

# A pixel counts as "page" when it is this much brighter than the image's
# median. Paper under any normal light is well clear of a table, a desk or a
# carpet; the margin is what keeps a beige tablecloth from qualifying.
BRIGHTNESS_MARGIN = 28

# A row or column is "inside the page" when its bright fraction reaches this
# much of the BEST row's.
#
# Relative, not absolute, and the first version got this wrong in a way that
# made the whole thing useless. It asked for 55% of a row to be bright — but a
# letter lying on a table occupies about a third of the frame, so no row ever
# reaches 55% and nothing is ever detected. The only photographs it could have
# cropped were ones already filled by the page, where there is nothing to
# crop. Caught by running it on a synthetic page-on-a-table, not by reading.
BAND_OF_PEAK = 0.6

# ...and if even the best row is barely bright, there is no page here at all.
# This is what stops the relative threshold from finding a "document" in a
# photograph of a wall.
MIN_PEAK_FRACTION = 0.15

# Too small to be the page somebody photographed: a label, a sticker, a
# reflection off a phone screen.
#
# There was a MAX_KEPT_AREA beside this, refusing a crop that kept almost the
# whole frame. It is gone because it could never fire. When the page dominates
# the frame it also dominates the MEDIAN, so the brightness threshold lands
# above white, nothing qualifies as page, and the refusal happens several
# steps earlier — every time, for every image that could be built. A guard
# that cannot fire is worse than no guard: it reads as coverage that is not
# there, which is the mistake that took the Android app down on 2026-09-15.
# The page-fills-the-frame case is still refused and still tested; what
# changed is honesty about which line does it.
MIN_KEPT_AREA = 0.12

# Inside a real document's box almost every pixel is page. Inside a false
# positive — carpet, grass, a bookshelf, JPEG noise — about half are, because
# the "brightness" is texture rather than paper.
#
# This is the guard that matters most, and it was missing from the first
# version: raw random noise was correctly refused, but the same noise passed
# through JPEG compression was CROPPED, because 8x8 block artefacts give the
# scatter enough structure to form bands. Phones send JPEG, so that was the
# realistic case and the one that was broken.
MIN_FILL = 0.70

# No sheet of paper is eight times longer than it is wide. A detection that
# shaped is a shadow, a window frame, or a strip of tablecloth.
MAX_ASPECT = 6.0

# Breathing room, so a hairline of page edge is never shaved off.
MARGIN_FRACTION = 0.015

# ── The second detector: printed detail ───────────────────────────────────
#
# Brightness alone fails on the case Roland actually has. He photographs onto
# a PALE counter, where paper and worktop are within twenty levels of each
# other, so nothing is "clearly brighter than its surroundings" and the crop
# correctly refuses — correct, and useless. Brightness is the wrong signal
# when both things are white.
#
# What a document has that a worktop does not is PRINT. Subtracting a blurred
# copy of the image from itself leaves the text and removes flat surfaces,
# whatever their tone, so the page is found on a white counter and on a dark
# table alike.
#
# It locates the PRINTED area, which sits inside the paper — margins carry no
# ink — so this path pads outward further than the brightness one, or it
# would crop the page's own borders off.
DETAIL_BLUR = 3
DETAIL_THRESHOLD = 18
DETAIL_BAND_OF_PEAK = 0.35
DETAIL_MIN_PEAK = 0.06
DETAIL_MARGIN_FRACTION = 0.055

# Texture — carpet, gravel, a bookshelf — is detail EVERYWHERE, so a band that
# spans nearly the whole frame is not a document. Unlike the brightness path,
# where a page-filled frame is refused several steps earlier by the median,
# this bound is genuinely reachable, and there is a test that reaches it.
DETAIL_MAX_KEPT = 0.90

# How much of the detected region may be ink.
#
# A page is mostly blank paper with lines of print on it; texture is busy
# everywhere. Measured rather than guessed: a printed form comes out at 0.30
# on a pale counter and 0.32 on a dark table, and a coarse block pattern —
# tiles, a bookshelf, gravel — at 0.72. The ceiling sits between them with
# room on both sides.
#
# The floor is the other half: a band carrying almost no ink was not print,
# it was a gradient or a shadow, and there is no document there to find.
DETAIL_MAX_INK = 0.45
DETAIL_MIN_INK = 0.02


def _smooth(fractions: list[float]) -> list[float]:
    """Average each row with its neighbours.

    THE FIX FOR REAL DOCUMENTS, and the bug that made the first version
    dangerous rather than merely useless.

    Both detectors look for a contiguous run of rows that are "page". Every
    image they were tested against was a BLANK rectangle, where that run is
    the page. A real document has TEXT: rows carrying print are darker, so the
    bright run breaks at every line, and the longest unbroken one turns out to
    be the blank margin under the last paragraph. On a dark table that
    produced a 710x430 box for a portrait page — a confident, silent, wrong
    crop, which is exactly the failure this module is written to avoid.

    Text lines are a few pixels apart; a page is hundreds. Averaging over a
    window far wider than a line and far narrower than a page makes print
    disappear into the page it sits on, and leaves the page/background edge
    where it was.
    """
    if not fractions:
        return fractions
    window = max(3, int(len(fractions) * 0.04))
    half = window // 2
    out = []
    for i in range(len(fractions)):
        lo, hi = max(0, i - half), min(len(fractions), i + half + 1)
        out.append(sum(fractions[lo:hi]) / float(hi - lo))
    return out


def _band(fractions: list[float], min_peak: float,
          of_peak: float) -> Optional[Tuple[int, int]]:
    """The FULL extent of the rows (or columns) that are mostly page.

    First qualifying index to last, gaps included — not the longest
    contiguous run, which is what this used to take and which silently
    destroyed documents.

    A page is not uniform. A school letter has a dark masthead, a bill has a
    black table header, an ID card has a photograph, a certificate has a
    seal. Any of those drops a stripe of rows below the cutoff and splits the
    page into two runs, and the longest-run rule then kept ONE of them. A
    2000x2400 page with a banner across the middle came back as its lower
    half: 854px of 1600 gone, every downstream guard passing, nothing logged.

    Taking the full extent cannot lose part of a page. It can be too GENEROUS
    — a bright window behind the table joins the band, which is the case the
    longest-run rule was written for — and that is deliberately the direction
    to err in, because the callers reject a too-generous band rather than
    trust it: _by_brightness requires MIN_FILL of the region to be page, and
    _by_detail requires the ink density to stay above DETAIL_MIN_INK. A band
    stretched across the table fails both and the photograph is returned
    untouched, which is the pre-crop behaviour. A band stretched across half
    a medical letter failed neither.
    """
    if not fractions:
        return None
    fractions = _smooth(fractions)
    peak = max(fractions)
    if peak < min_peak:
        return None
    cutoff = peak * of_peak

    first: Optional[int] = None
    last: Optional[int] = None
    for i, value in enumerate(fractions):
        if value >= cutoff:
            if first is None:
                first = i
            last = i
    if first is None or last is None:
        return None
    return (first, last + 1)


def find_document(image: Image.Image) -> Optional[Tuple[int, int, int, int]]:
    """Where the document is, in the ORIGINAL image's pixels, or None.

    Two detectors, tried in order. Brightness first because it is the more
    precise of the two when it applies — it finds the paper's own edge rather
    than the ink inside it. Printed detail second, for the pale-counter case
    where nothing is brighter than anything else.

    None means "not confident", and every caller treats that as "leave the
    photograph alone".
    """
    return _by_brightness(image) or _by_detail(image)


def _by_brightness(image: Image.Image) -> Optional[Tuple[int, int, int, int]]:
    """The page as the bright thing on a darker surface."""
    grey = image.convert("L")
    width, height = grey.size
    if width < 80 or height < 80:
        return None

    scale = min(1.0, ANALYSIS_WIDTH / float(width))
    small = grey.resize((max(1, int(width * scale)), max(1, int(height * scale))))
    sw, sh = small.size
    # tobytes() rather than getdata(): the latter is deprecated in Pillow 12
    # and removed in 14, and requirements.txt floors at >=12.3.0 — so a
    # routine version bump would have taken this out with a DeprecationWarning
    # nobody reads. Mode "L" means one byte per pixel, so these ARE the values.
    pixels = small.tobytes()

    ordered = sorted(pixels)
    median = ordered[len(ordered) // 2]
    threshold = median + BRIGHTNESS_MARGIN
    # A photograph of a page filling the frame has a HIGH median, so the
    # threshold lands above white and nothing qualifies — which is correct,
    # there is nothing to crop.
    if threshold >= 255:
        return None

    rows = []
    for y in range(sh):
        row = pixels[y * sw:(y + 1) * sw]
        rows.append(sum(1 for p in row if p >= threshold) / float(sw))
    cols = []
    for x in range(sw):
        column = pixels[x::sw]
        cols.append(sum(1 for p in column if p >= threshold) / float(sh))

    vertical = _band(rows, MIN_PEAK_FRACTION, BAND_OF_PEAK)
    horizontal = _band(cols, MIN_PEAK_FRACTION, BAND_OF_PEAK)
    if not vertical or not horizontal:
        return None

    top, bottom = vertical
    left, right = horizontal
    if bottom <= top or right <= left:
        return None

    # Is the detected region actually a page, or just where the texture was?
    inside = 0
    total = (bottom - top) * (right - left)
    for y in range(top, bottom):
        row = pixels[y * sw + left:y * sw + right]
        inside += sum(1 for p in row if p >= threshold)
    if total <= 0 or (inside / float(total)) < MIN_FILL:
        return None

    # Back to the original's pixels, with a margin.
    inv = 1.0 / scale
    mx = int(sw * MARGIN_FRACTION * inv)
    my = int(sh * MARGIN_FRACTION * inv)
    box = (
        max(0, int(left * inv) - mx),
        max(0, int(top * inv) - my),
        min(width, int(right * inv) + mx),
        min(height, int(bottom * inv) + my),
    )

    bw, bh = box[2] - box[0], box[3] - box[1]
    if bw <= 0 or bh <= 0:
        return None

    # The guards measure the DETECTED band, not the padded box. The margin is
    # there to avoid shaving the paper's edge; letting it count toward the
    # area and the aspect ratio means the margin can rescue something the
    # guard exists to refuse — a 1120x140 radiator is 8:1 and refused, but
    # padded to 1200x238 it is 5:1 and kept.
    dw, dh = (right - left) * inv, (bottom - top) * inv
    if dw <= 0 or dh <= 0:
        return None
    if (dw * dh) / float(width * height) < MIN_KEPT_AREA:
        return None
    if max(dw, dh) / float(min(dw, dh)) > MAX_ASPECT:
        return None
    return box


def _by_detail(image: Image.Image) -> Optional[Tuple[int, int, int, int]]:
    """The page as the printed thing on a blank surface.

    Finds where the INK is. A worktop has none; a letter, a form, a bill and a
    prescription are covered in it.
    """
    grey = image.convert("L")
    width, height = grey.size
    if width < 80 or height < 80:
        return None

    scale = min(1.0, ANALYSIS_WIDTH / float(width))
    small = grey.resize((max(1, int(width * scale)), max(1, int(height * scale))))
    sw, sh = small.size

    # What is left when a blurred copy is subtracted: edges and text, with
    # every flat surface — pale or dark — reduced to nothing.
    detail = ImageChops.difference(small, small.filter(
        ImageFilter.GaussianBlur(DETAIL_BLUR))).tobytes()

    rows = []
    for y in range(sh):
        row = detail[y * sw:(y + 1) * sw]
        rows.append(sum(1 for p in row if p >= DETAIL_THRESHOLD) / float(sw))
    cols = []
    for x in range(sw):
        column = detail[x::sw]
        cols.append(sum(1 for p in column if p >= DETAIL_THRESHOLD) / float(sh))

    vertical = _band(rows, DETAIL_MIN_PEAK, DETAIL_BAND_OF_PEAK)
    horizontal = _band(cols, DETAIL_MIN_PEAK, DETAIL_BAND_OF_PEAK)
    if not vertical or not horizontal:
        return None

    top, bottom = vertical
    left, right = horizontal
    if bottom <= top or right <= left:
        return None

    # Print, or texture? A page is mostly blank between the lines.
    ink = 0
    total = (bottom - top) * (right - left)
    for y in range(top, bottom):
        row = detail[y * sw + left:y * sw + right]
        ink += sum(1 for p in row if p >= DETAIL_THRESHOLD)
    if total <= 0:
        return None
    density = ink / float(total)
    if density > DETAIL_MAX_INK or density < DETAIL_MIN_INK:
        return None

    inv = 1.0 / scale
    mx = int(sw * DETAIL_MARGIN_FRACTION * inv)
    my = int(sh * DETAIL_MARGIN_FRACTION * inv)
    box = (
        max(0, int(left * inv) - mx),
        max(0, int(top * inv) - my),
        min(width, int(right * inv) + mx),
        min(height, int(bottom * inv) + my),
    )
    bw, bh = box[2] - box[0], box[3] - box[1]
    if bw <= 0 or bh <= 0:
        return None

    # The guards measure the DETECTED band, not the padded box. The margin is
    # there to avoid shaving the paper's edge; letting it count toward the
    # area and the aspect ratio means the margin can rescue something the
    # guard exists to refuse — a 1120x140 radiator is 8:1 and refused, but
    # padded to 1200x238 it is 5:1 and kept.
    dw, dh = (right - left) * inv, (bottom - top) * inv
    if dw <= 0 or dh <= 0:
        return None
    kept = (dw * dh) / float(width * height)
    if kept < MIN_KEPT_AREA or kept > DETAIL_MAX_KEPT:
        return None
    if max(dw, dh) / float(min(dw, dh)) > MAX_ASPECT:
        return None
    return box


def crop_to_document(image_base64: str) -> Tuple[str, bool]:
    """Return (image, cropped). The image is unchanged when cropped is False.

    Takes and returns the data-URI form the client sends, so callers can pass
    the payload straight through.
    """
    try:
        _header, _, encoded = image_base64.rpartition(",")
        raw = base64.b64decode(encoded or image_base64, validate=False)
        image = Image.open(io.BytesIO(raw))
        image.load()
        # A phone JPEG is almost always stored in the sensor's orientation
        # with an EXIF Orientation tag saying how to turn it. Pillow ignores
        # that tag, so find_document analysed a sideways page — and worse,
        # the re-encoded crop was saved WITHOUT the tag, so the viewer had
        # nothing left to correct by and the image arrived in the vault
        # rotated 90 degrees. Baking the rotation into the pixels here fixes
        # both: the analysis sees the page the right way up, and the JPEG
        # that comes out needs no tag to be displayed correctly.
        image = ImageOps.exif_transpose(image) or image
        box = find_document(image)
        if not box:
            return image_base64, False

        cropped = image.crop(box)
        if cropped.mode not in ("RGB", "L"):
            cropped = cropped.convert("RGB")
        out = io.BytesIO()
        cropped.save(out, format="JPEG", quality=88, optimize=True)
        payload = base64.b64encode(out.getvalue()).decode("ascii")
        # The header is rewritten rather than reused: the crop is re-encoded
        # as JPEG whatever went in, so carrying a PNG's header through would
        # be a lie about the bytes behind it.
        return "data:image/jpeg;base64," + payload, True
    except Exception:
        # Every failure is the same answer: the photograph, untouched. A
        # scan that works slightly worse beats one that loses the bottom of
        # a medical letter.
        return image_base64, False
