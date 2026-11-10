"""A photo goes to the model as a JPEG of a sensible size, not a 26 MB PNG.

Reported 2026-11-10: "When I chose the picture or snap it, it takes a long
time before it adds. Especially adding from the gallery."

_gemini_vision handed the SDK a PIL image. google-genai's pil_to_blob keeps
JPEG only for an image opened from a named FILE; ours are opened from memory,
so every photo was re-encoded as PNG: a 2 MB phone photo became ~26 MB, took
seconds to encode, was uploaded to Google whole, and could pass the 20 MB
inline request limit Google documents ("Image understanding" guide). Each
768x768 tile of a picture also costs the model 258 tokens, so a full-size
photo was more to read, not more readable.

These pin: JPEG, within a pixel budget (VISION_MAX_PIXELS, not a longest-side
cap, so a long screenshot stays readable), upright, small pictures left their
size, transparency and 16-bit greyscale flattened the way they looked, and the
work done once per picture — for every vision route, since they all come
through _gemini_vision.
"""
import asyncio
import base64
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import PIL.Image
    import server


def b64(img, fmt="JPEG", **kw):
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return base64.b64encode(buf.getvalue()).decode()


@unittest.skipUnless(HAVE_DEPS and server.genai_types is not None if HAVE_DEPS else False,
                     "backend dependencies (google-genai) not installed")
class APhotoGoesToTheModelSmall(unittest.TestCase):
    def setUp(self):
        server._VISION_CACHE.clear()
        self._generate = server._gemini_generate
        self.sent = []

        async def generate(contents, system="", **kwargs):
            self.sent.append(contents)
            return "{}"
        server._gemini_generate = generate

    def tearDown(self):
        server._gemini_generate = self._generate

    def read(self, image_b64):
        asyncio.run(server._gemini_vision("Read it.", image_b64))
        part = self.sent[-1][1]
        return part, PIL.Image.open(io.BytesIO(part.inline_data.data))

    def test_a_phone_photo_goes_as_a_jpeg_within_the_budget(self):
        part, img = self.read(b64(PIL.Image.new("RGB", (4000, 3000), "white"), quality=55))
        self.assertEqual(part.inline_data.mime_type, "image/jpeg")
        self.assertEqual(img.format, "JPEG")
        self.assertLessEqual(img.size[0] * img.size[1], 3072 * 3072)
        self.assertGreater(img.size[0] * img.size[1], 0.95 * 3072 * 3072)
        self.assertAlmostEqual(img.size[0] / img.size[1], 4 / 3, places=2)   # proportions kept

    def test_a_long_screenshot_of_a_list_stays_readable(self):
        # 1170 x 12000: capped at 3072 tall it would be 300 px wide.
        _, img = self.read(b64(PIL.Image.new("RGB", (1170, 12000), "white"), "PNG"))
        self.assertGreater(img.size[0], 900)
        self.assertLessEqual(img.size[0] * img.size[1], 3072 * 3072)

    def test_sixteen_bit_greyscale_is_not_a_blank_page(self):
        import numpy as np
        grey = np.full((40, 40), 20000, dtype=np.uint16)
        grey[:, :20] = 1000
        _, img = self.read(b64(PIL.Image.fromarray(grey), "PNG"))
        left, right = img.convert("L").getpixel((5, 20)), img.convert("L").getpixel((35, 20))
        self.assertLess(left, right)
        self.assertLess(right, 250)   # not clipped to white

    def test_a_png_transparent_colour_lands_on_white(self):
        pal = PIL.Image.new("L", (40, 40), 0)
        pal.paste(255, (10, 10, 30, 30))
        _, img = self.read(b64(pal, "PNG", transparency=0))
        self.assertGreater(img.convert("L").getpixel((2, 2)), 240)

    def test_the_same_photo_is_prepared_once(self):
        calls = []
        real = server._vision_to_rgb
        server._vision_to_rgb = lambda img: calls.append(1) or real(img)
        try:
            photo = b64(PIL.Image.new("RGB", (900, 700), "white"))
            self.read(photo)
            self.read(photo)
            # The shopping scan's opens-check prepares what its read then sends.
            self.read(b64(PIL.Image.new("RGB", (901, 700), "white")))
        finally:
            server._vision_to_rgb = real
        self.assertEqual(len(calls), 2)

    def test_a_small_picture_keeps_its_size(self):
        _, img = self.read(b64(PIL.Image.new("RGB", (800, 600), "white")))
        self.assertEqual(img.size, (800, 600))

    def test_a_detailed_photo_stays_far_under_googles_20_mb_limit(self):
        import numpy as np
        rng = np.random.default_rng(0)
        noisy = PIL.Image.fromarray(rng.integers(0, 255, (3000, 4000, 3), dtype=np.uint8))
        part, _ = self.read(b64(noisy, quality=55))
        # Pure noise is the worst case a JPEG can meet; real photos are far
        # smaller. Inline bytes travel base64-encoded, a third larger.
        self.assertLess(len(part.inline_data.data) * 4 / 3, 20 * 1024 * 1024)

    def test_upright_and_within_the_budget(self):
        picture = PIL.Image.new("RGB", (6000, 3000), "white")
        exif = picture.getexif()
        exif[0x0112] = 6   # "rotate 90° to view"
        _, img = self.read(b64(picture, exif=exif))
        self.assertLess(img.size[0], img.size[1])   # portrait, as it is viewed
        self.assertLessEqual(img.size[0] * img.size[1], 3072 * 3072)

    def test_a_transparent_screenshot_lands_on_white(self):
        _, img = self.read(b64(PIL.Image.new("RGBA", (50, 50), (0, 0, 0, 0)), "PNG"))
        self.assertEqual(img.convert("RGB").getpixel((25, 25)), (255, 255, 255))

    def test_a_data_url_is_read_too(self):
        part, _ = self.read("data:image/png;base64," + b64(PIL.Image.new("RGB", (10, 10)), "PNG"))
        self.assertEqual(part.inline_data.mime_type, "image/jpeg")


if __name__ == "__main__":
    unittest.main()
