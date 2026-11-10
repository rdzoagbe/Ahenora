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

These pin: JPEG, at most VISION_MAX_SIDE on the longest side, upright, small
pictures left their size, transparency on white — for every vision route,
since they all come through _gemini_vision.
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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class APhotoGoesToTheModelSmall(unittest.TestCase):
    def setUp(self):
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

    def test_a_phone_photo_goes_as_a_jpeg_no_bigger_than_the_cap(self):
        part, img = self.read(b64(PIL.Image.new("RGB", (4000, 3000), "white"), quality=55))
        self.assertEqual(part.inline_data.mime_type, "image/jpeg")
        self.assertEqual(img.format, "JPEG")
        self.assertEqual(max(img.size), server.VISION_MAX_SIDE)
        self.assertEqual(img.size, (3072, 2304))   # the proportions kept

    def test_the_cap_is_googles_own_page_size(self):
        self.assertEqual(server.VISION_MAX_SIDE, 3072)

    def test_a_small_picture_keeps_its_size(self):
        _, img = self.read(b64(PIL.Image.new("RGB", (800, 600), "white")))
        self.assertEqual(img.size, (800, 600))

    def test_a_detailed_photo_stays_far_under_googles_20_mb_limit(self):
        import numpy as np
        rng = np.random.default_rng(0)
        noisy = PIL.Image.fromarray(rng.integers(0, 255, (3000, 4000, 3), dtype=np.uint8))
        part, _ = self.read(b64(noisy, quality=55))
        self.assertLess(len(part.inline_data.data), 5 * 1024 * 1024)

    def test_upright_before_it_is_made_smaller(self):
        picture = PIL.Image.new("RGB", (4000, 2000), "white")
        exif = picture.getexif()
        exif[0x0112] = 6   # "rotate 90° to view"
        _, img = self.read(b64(picture, exif=exif))
        self.assertEqual(img.size, (1536, 3072))

    def test_a_transparent_screenshot_lands_on_white(self):
        _, img = self.read(b64(PIL.Image.new("RGBA", (50, 50), (0, 0, 0, 0)), "PNG"))
        self.assertEqual(img.convert("RGB").getpixel((25, 25)), (255, 255, 255))

    def test_a_data_url_is_read_too(self):
        part, _ = self.read("data:image/png;base64," + b64(PIL.Image.new("RGB", (10, 10)), "PNG"))
        self.assertEqual(part.inline_data.mime_type, "image/jpeg")


if __name__ == "__main__":
    unittest.main()
