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

from PIL import Image

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

# Refuse to crop unless the result is meaningfully smaller AND still large
# enough to be a document. Between them these rule out both "nothing to do"
# and "something has gone wrong".
MAX_KEPT_AREA = 0.92
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


def _bright_band(fractions: list[float]) -> Optional[Tuple[int, int]]:
    """The longest run of rows (or columns) that are mostly page.

    The LONGEST run rather than the first: a bright window behind the table
    produces a second band, and taking the first one found would crop to the
    window.
    """
    if not fractions:
        return None
    peak = max(fractions)
    if peak < MIN_PEAK_FRACTION:
        return None
    cutoff = peak * BAND_OF_PEAK

    best: Optional[Tuple[int, int]] = None
    start: Optional[int] = None
    for i, value in enumerate(fractions):
        if value >= cutoff:
            if start is None:
                start = i
        elif start is not None:
            if best is None or (i - start) > (best[1] - best[0]):
                best = (start, i)
            start = None
    if start is not None:
        end = len(fractions)
        if best is None or (end - start) > (best[1] - best[0]):
            best = (start, end)
    return best


def find_document(image: Image.Image) -> Optional[Tuple[int, int, int, int]]:
    """Where the document is, in the ORIGINAL image's pixels, or None.

    None means "not confident", and every caller treats that as "leave the
    photograph alone".
    """
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

    vertical = _bright_band(rows)
    horizontal = _bright_band(cols)
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

    kept = (bw * bh) / float(width * height)
    if kept > MAX_KEPT_AREA or kept < MIN_KEPT_AREA:
        return None
    if max(bw, bh) / float(min(bw, bh)) > MAX_ASPECT:
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
