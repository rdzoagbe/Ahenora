"""The photograph of a table, with a letter on it.

Roland, twice: "there is no autoframe with the scan... just take the exact
dimension of the document scanned". A phone-side scanner does that, and needs
a native module, a new build and two store reviews. This does the part that
matters — the document arriving at its own size — from the server, where it
can actually be tested.

WHAT THESE HOLD, and the balance between them is the whole design:

  * a page on a table IS cropped, or the feature does nothing;
  * everything uncertain is LEFT ALONE, because a wrong crop takes the bottom
    off a vaccination certificate and nothing on screen says so.

The refusals are the more important half and there are more of them.

Two bugs found by running it rather than reading it, both recorded in the
module and both pinned below:

  1. The band threshold was absolute — 55% of a row had to be bright. A
     letter on a table fills about a third of the frame, so no row ever
     reached it and NOTHING was ever cropped except photographs already
     filled by the page, where there is nothing to crop.

  2. Raw random noise was correctly refused, but the same noise through JPEG
     was CROPPED: 8x8 block artefacts give scatter enough structure to form
     bands. Phones send JPEG, so that was the realistic case.

Run with:  python3 -m unittest discover -s tests -v
"""
import base64
import io
import os
import random
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))

try:
    from PIL import Image, ImageFilter
    HAVE_PIL = True
except ImportError:
    HAVE_PIL = False

if HAVE_PIL:
    from document_crop import (
        MIN_FILL, MIN_KEPT_AREA, crop_to_document, find_document)


def jpeg(image):
    """As a phone sends it: JPEG, base64, data URI.

    Through the encoder on purpose. A test on raw pixels would have passed
    while the shipped behaviour was wrong — see bug 2 above.
    """
    buffer = io.BytesIO()
    image.convert("RGB").save(buffer, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def size_of(data_uri):
    raw = base64.b64decode(data_uri.split(",", 1)[1])
    return Image.open(io.BytesIO(raw)).size


def page_on(background, page_size, at, page=(246, 244, 239), frame=(1200, 900)):
    img = Image.new("RGB", frame, background)
    img.paste(Image.new("RGB", page_size, page), at)
    return img


def textured(size, lo, hi, seed=1):
    random.seed(seed)
    img = Image.new("RGB", size)
    img.putdata([tuple([random.randint(lo, hi)] * 3) for _ in range(size[0] * size[1])])
    return img


@unittest.skipUnless(HAVE_PIL, "Pillow not installed")
class ADocumentIsCroppedToItself(unittest.TestCase):

    def test_a_page_on_a_dark_table(self):
        out, cropped = crop_to_document(jpeg(page_on((70, 55, 40), (520, 700), (340, 100))))
        self.assertTrue(cropped)
        width, height = size_of(out)
        # The page plus the deliberate margin, not the 1200x900 frame.
        self.assertLess(width, 700)
        self.assertLess(height, 850)
        self.assertGreater(width, 500)

    def test_a_page_that_is_not_centred(self):
        out, cropped = crop_to_document(jpeg(page_on((90, 80, 70), (400, 550), (120, 120),
                                                     frame=(1000, 800))))
        self.assertTrue(cropped)
        self.assertLess(size_of(out)[0], 600)

    def test_the_result_is_smaller_to_upload(self):
        """Half the point: three to five megabytes of table went up before the
        model saw anything."""
        original = jpeg(page_on((70, 55, 40), (520, 700), (340, 100)))
        out, cropped = crop_to_document(original)
        self.assertTrue(cropped)
        self.assertLess(len(out), len(original))

    def test_a_page_on_a_light_wooden_table_still_works(self):
        # Not every table is dark. Paper is still clearly brighter than pine.
        out, cropped = crop_to_document(jpeg(page_on((168, 140, 104), (500, 660), (350, 120))))
        self.assertTrue(cropped)


@unittest.skipUnless(HAVE_PIL, "Pillow not installed")
class EverythingUncertainIsLeftAlone(unittest.TestCase):
    """The half that matters. Each of these returns the original bytes, and
    the caller cannot tell a refusal from an image that needed no crop."""

    def assertUntouched(self, image):
        original = jpeg(image)
        out, cropped = crop_to_document(original)
        self.assertFalse(cropped)
        self.assertEqual(out, original)

    def test_a_page_already_filling_the_frame(self):
        # Nothing to crop, so nothing is done — and re-encoding it would cost
        # a generation of JPEG quality for no gain.
        self.assertUntouched(Image.new("RGB", (900, 1200), (246, 244, 240)))

    def test_a_blank_wall(self):
        self.assertUntouched(Image.new("RGB", (1000, 800), (150, 148, 145)))

    def test_a_dark_photograph(self):
        self.assertUntouched(Image.new("RGB", (900, 700), (30, 28, 26)))

    def test_jpeg_noise(self):
        """Bug 2. Raw noise was refused; the same noise through JPEG was
        cropped, and JPEG is what phones send."""
        self.assertUntouched(textured((800, 600), 0, 255))

    def test_carpet_or_grass(self):
        self.assertUntouched(textured((900, 700), 90, 190, seed=7))

    def test_a_thin_bright_strip(self):
        # A window frame, a radiator, a strip of tablecloth. No sheet of paper
        # is that shape.
        img = Image.new("RGB", (1200, 900), (60, 50, 45))
        img.paste(Image.new("RGB", (1100, 60), (250, 250, 250)), (50, 400))
        self.assertUntouched(img)

    def test_a_speck_too_small_to_be_a_document(self):
        img = Image.new("RGB", (1200, 900), (60, 50, 45))
        img.paste(Image.new("RGB", (80, 60), (250, 250, 250)), (500, 400))
        self.assertUntouched(img)

    def test_something_that_is_not_an_image_at_all(self):
        out, cropped = crop_to_document("data:image/jpeg;base64,bm90IGFuIGltYWdl")
        self.assertFalse(cropped)
        self.assertEqual(out, "data:image/jpeg;base64,bm90IGFuIGltYWdl")

    def test_an_empty_string(self):
        out, cropped = crop_to_document("")
        self.assertFalse(cropped)
        self.assertEqual(out, "")

    def test_a_tiny_image(self):
        self.assertUntouched(Image.new("RGB", (40, 30), (200, 200, 200)))


@unittest.skipUnless(HAVE_PIL, "Pillow not installed")
class TheThresholdIsRelativeNotAbsolute(unittest.TestCase):
    """Bug 1, pinned as behaviour rather than described in a comment.

    A document occupying a THIRD of the frame must be found. An absolute
    fraction-of-the-row threshold cannot do that, and the first version could
    only ever crop images that needed no cropping.
    """

    def test_a_page_covering_a_third_of_the_frame_is_found(self):
        img = page_on((70, 55, 40), (520, 700), (340, 100))
        fraction = (520 * 700) / float(1200 * 900)
        self.assertLess(fraction, 0.40, "this test is meaningless if the page is large")
        self.assertIsNotNone(find_document(img))

    def test_a_page_covering_a_fifth_is_found_too(self):
        img = page_on((60, 50, 45), (380, 560), (400, 170))
        self.assertLess((380 * 560) / float(1200 * 900), 0.21)
        self.assertIsNotNone(find_document(img))


@unittest.skipUnless(HAVE_PIL, "Pillow not installed")
class TheFillGuardIsWhatRulesOutTexture(unittest.TestCase):
    """A page is MOSTLY page. Texture is about half bright, wherever you draw
    the box — which is what tells the two apart."""

    def test_the_guard_demands_most_of_the_box(self):
        self.assertGreaterEqual(MIN_FILL, 0.6)

    def test_a_solid_page_passes_it_comfortably(self):
        self.assertIsNotNone(find_document(page_on((70, 55, 40), (520, 700), (340, 100))))


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(HAVE_PIL, "Pillow not installed")
class TheScanEndpointUsesIt(unittest.TestCase):
    """A cropper nothing calls crops nothing."""

    def server(self):
        with open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8") as handle:
            return handle.read()

    def code(self):
        return "\n".join(line for line in self.server().splitlines()
                         if not line.lstrip().startswith("#"))

    def test_the_document_pass_reads_the_cropped_image(self):
        self.assertIn("image_base64, was_cropped = crop_to_document(payload.image_base64)",
                      self.code())

    def test_the_recipe_second_pass_reads_it_too(self):
        """Both passes, or a photographed recipe is read from the table while
        the document pass is read from the page."""
        src = self.code()
        recipe = src[src.index("Read the recipe in this photo."):]
        self.assertIn("image_base64,", recipe[:200])
        self.assertNotIn("payload.image_base64", recipe[:200])

    def test_the_crop_is_handed_back_so_the_family_keeps_it(self):
        self.assertIn('result["cropped_image_base64"] = image_base64', self.code())

    def test_it_is_only_sent_when_it_actually_changed(self):
        """Returning the original unchanged would be megabytes of response
        for nothing."""
        src = self.code()
        block = src[src.index('result["cropped_image_base64"]') - 120:]
        self.assertIn("if was_cropped:", block[:200])


class TheAppKeepsTheCroppedDocument(unittest.TestCase):
    """The server cropping and the app ignoring it would leave the table on
    the card and in the vault."""

    def modal(self):
        with open(os.path.join(ROOT, "frontend", "src", "components",
                               "CameraCaptureModal.tsx"), encoding="utf-8") as handle:
            return handle.read()

    def test_the_preview_becomes_the_crop(self):
        self.assertIn("if (result.cropped_image_base64) setPreview(", self.modal())

    def test_the_original_is_shown_first_so_the_sheet_is_never_blank(self):
        """The crop arrives with the scan result, seconds later. Waiting for
        it would leave an empty sheet while the server thinks."""
        text = self.modal()
        self.assertLess(text.index("setPreview(imageBase64)"),
                        text.index("result.cropped_image_base64"))

    def test_an_absent_crop_changes_nothing(self):
        # A server that declined to crop, or one that predates this, leaves
        # the photograph exactly as it was.
        self.assertIn("if (result.cropped_image_base64)", self.modal())


@unittest.skipUnless(HAVE_PIL, "Pillow not installed")
class EachGuardIsExercisedBySomethingOnlyItRefuses(unittest.TestCase):
    """Two guards had no test of their own, and a mutation run said so.

    Every refusal above is caught by whichever guard fires FIRST, so removing
    the fill check or the aspect check left all of them passing. Each image
    here is built so that every other guard is satisfied and only the one
    named can say no. They protect against cropping away part of somebody's
    document, so "probably fine" is not good enough.

    Finding these also settled that MAX_KEPT_AREA could never fire, and it is
    gone — see document_crop.py.
    """

    def refused(self, image):
        return not crop_to_document(jpeg(image))[1]

    def test_the_fill_guard_refuses_a_large_patterned_region(self):
        """A bookshelf, tiles, gravel: bands form across it, it is document
        sized and document shaped, and it is half background — which is what a
        page never is.

        Large and coarse ON PURPOSE. A small or finely dithered patch is
        refused by the area bound or smoothed into a solid rectangle by JPEG,
        and in both cases the fill guard is never reached. This one measures
        fill 0.51 against a 0.19 area, so nothing else can refuse it.
        """
        random.seed(3)
        block = 10
        img = Image.new("RGB", (1200, 900), (38, 34, 30))
        patch = Image.new("RGB", (900, 700), (42, 38, 34))
        for by in range(0, 700, block):
            for bx in range(0, 900, block):
                if random.random() < 0.5:
                    patch.paste(Image.new("RGB", (block, block), (250, 248, 245)), (bx, by))
        img.paste(patch, (150, 100))
        self.assertTrue(self.refused(img))

    def test_the_aspect_guard_refuses_a_long_bright_band(self):
        """A radiator, a window frame, a skirting board: big enough to clear
        the area bound, solid enough to clear the fill guard, and eight times
        longer than it is wide."""
        img = Image.new("RGB", (1200, 900), (55, 48, 42))
        img.paste(Image.new("RGB", (1120, 140), (248, 246, 242)), (40, 380))
        self.assertGreater((1120 * 140) / float(1200 * 900), MIN_KEPT_AREA,
                           "the area bound must not be what refuses this")
        self.assertTrue(self.refused(img))

    def test_the_area_bound_refuses_something_document_shaped_but_tiny(self):
        """Solid, plausibly shaped, and far too small to be the page somebody
        photographed. A label, a sticker, a reflection."""
        img = Image.new("RGB", (1200, 900), (50, 45, 40))
        img.paste(Image.new("RGB", (400, 210), (250, 248, 244)), (400, 340))
        self.assertTrue(self.refused(img))


def printed_page(surface, paper, frame=(1000, 1300), page=(680, 940),
                 at=(160, 180), seed=4):
    """A document WITH PRINT ON IT, which is what people photograph.

    Every image in this file until 2026-09-16 was a blank rectangle, and that
    is why the shipped version mis-cropped: text breaks the contiguous band
    both detectors look for, so the longest unbroken run of "page" turned out
    to be the blank margin below the last line. On a dark table that produced
    a 710x430 box for a portrait page — confident, silent and wrong.

    Lines of ink with gaps between them, because the gaps are the problem.
    """
    random.seed(seed)
    img = Image.new("RGB", frame, surface)
    sheet = Image.new("RGB", page, paper)
    for row in range(40, page[1] - 40, 22):
        for x in range(40, page[0] - 40):
            if random.random() < 0.72:
                for dy in range(3):
                    sheet.putpixel((x, row + dy), (60, 60, 62))
    img.paste(sheet, at)
    return img.filter(ImageFilter.GaussianBlur(0.6))


@unittest.skipUnless(HAVE_PIL, "Pillow not installed")
class ADocumentWithTextOnIt(unittest.TestCase):
    """The realistic case, and the one that was missing entirely.

    The page sits at x160..840, y180..1120 in a 1000x1300 frame. A correct box
    is close to that; the bug produced boxes covering a fraction of it.
    """

    PAGE = (160, 180, 840, 1120)

    def assertCoversThePage(self, box):
        self.assertIsNotNone(box, "the page was not found at all")
        left, top, right, bottom = box
        pl, pt, pr, pb = self.PAGE
        # Generous on the outside, strict on the inside: a box slightly larger
        # than the page keeps the whole document, one slightly smaller loses
        # part of it, and only the second matters.
        self.assertLessEqual(left, pl + 40, "cuts into the left of the page")
        self.assertLessEqual(top, pt + 40, "cuts into the top of the page")
        self.assertGreaterEqual(right, pr - 40, "cuts into the right of the page")
        self.assertGreaterEqual(bottom, pb - 40, "cuts into the bottom of the page")

    def test_a_printed_form_on_a_dark_table(self):
        self.assertCoversThePage(find_document(printed_page((70, 58, 44), (244, 242, 238))))

    def test_a_printed_form_on_a_PALE_counter(self):
        """Roland's case. Paper and worktop are within twenty levels of each
        other, so brightness finds nothing — the print detector does."""
        self.assertCoversThePage(find_document(printed_page((228, 226, 222), (246, 245, 242))))

    def test_a_printed_form_on_a_white_counter(self):
        self.assertCoversThePage(find_document(printed_page((240, 239, 236), (250, 249, 247))))

    def test_it_does_not_crop_to_the_margin_below_the_last_line(self):
        """The shipped bug, named. The box must be taller than half the page,
        not the blank strip under the text."""
        box = find_document(printed_page((70, 58, 44), (244, 242, 238)))
        self.assertIsNotNone(box)
        self.assertGreater(box[3] - box[1], (1120 - 180) * 0.75)

    def test_a_blank_pale_counter_with_no_document_is_left_alone(self):
        # The print detector must not invent a page where there is no ink.
        out, cropped = crop_to_document(jpeg(Image.new("RGB", (1000, 1300), (230, 228, 224))))
        self.assertFalse(cropped)

    def test_texture_is_still_refused_now_that_print_is_detected(self):
        """The regression this guard exists for: teaching the cropper to see
        ink made it see gravel too, until ink DENSITY told them apart. A page
        measures about 0.30; a block pattern about 0.72."""
        random.seed(3)
        img = Image.new("RGB", (1200, 900), (38, 34, 30))
        patch = Image.new("RGB", (900, 700), (42, 38, 34))
        for by in range(0, 700, 10):
            for bx in range(0, 900, 10):
                if random.random() < 0.5:
                    patch.paste(Image.new("RGB", (10, 10), (250, 248, 245)), (bx, by))
        img.paste(patch, (150, 100))
        self.assertIsNone(find_document(img))

    def test_brightness_runs_first_because_it_is_the_tighter_answer(self):
        """Both detectors find the page on a dark table, but not equally well.

        Brightness finds the PAPER'S OWN EDGE: within about 14px of the page.
        The print detector finds the INK, which sits inside the margins, so it
        pads outward and lands about 95px out — still safe, still containing
        the whole document, and carrying a band of table with it.

        Removing the whole point of the crop. So the order is asserted rather
        than left as a comment: a mutation swapping it passed everything until
        this existed.
        """
        box = find_document(printed_page((70, 58, 44), (244, 242, 238)))
        self.assertIsNotNone(box)
        left, top, right, bottom = box
        pl, pt, pr, pb = self.PAGE
        for got, want, edge in ((left, pl, "left"), (top, pt, "top"),
                                (right, pr, "right"), (bottom, pb, "bottom")):
            self.assertLess(abs(got - want), 40,
                            f"{edge} edge is {abs(got - want)}px out — too much table")
