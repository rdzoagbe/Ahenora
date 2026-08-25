"""Web Push crypto, proven without a browser.

The whole risk in hand-rolling Web Push is a single wrong byte in the
encryption or the VAPID signature — and you can't tell from the outside, the
push just silently never arrives. So these tests close the loop the only way
that gives real confidence: encrypt a payload the way a push service would
receive it, then decrypt it with the browser's private key and assert it comes
back byte-for-byte; and sign a VAPID token, then verify the signature with the
public key the push service would use.

Run with:  python3 -m unittest discover -s tests -v
"""
import base64
import json
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
    import webpush
    HAVE = True
except ImportError:
    HAVE = False


def _b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _b64url_dec(s):
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


@unittest.skipUnless(HAVE, "cryptography not available")
class WebPushEncryption(unittest.TestCase):
    def _fake_browser_subscription(self):
        # A browser generates its own P-256 keypair and a 16-byte auth secret.
        ua_priv = ec.generate_private_key(ec.SECP256R1())
        p256dh = ua_priv.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        auth = os.urandom(16)
        sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc123",
               "keys": {"p256dh": _b64url(p256dh), "auth": _b64url(auth)}}
        return sub, ua_priv, _b64url(auth)

    def test_encrypt_then_decrypt_round_trips(self):
        sub, ua_priv, auth_b64 = self._fake_browser_subscription()
        payload = json.dumps({"title": "School run", "body": "Roland handed you a task"}).encode()
        body = webpush.encrypt_payload(payload, sub["keys"]["p256dh"], auth_b64)
        # The push service would deliver `body`; the browser decrypts it.
        back = webpush.decrypt_payload(body, ua_priv, auth_b64)
        self.assertEqual(back, payload)

    def test_each_encryption_uses_a_fresh_ephemeral_key(self):
        sub, ua_priv, auth_b64 = self._fake_browser_subscription()
        a = webpush.encrypt_payload(b"hello", sub["keys"]["p256dh"], auth_b64)
        b = webpush.encrypt_payload(b"hello", sub["keys"]["p256dh"], auth_b64)
        self.assertNotEqual(a, b)  # different salt + ephemeral key each time
        self.assertEqual(webpush.decrypt_payload(a, ua_priv, auth_b64), b"hello")
        self.assertEqual(webpush.decrypt_payload(b, ua_priv, auth_b64), b"hello")

    def test_the_aes128gcm_header_is_well_formed(self):
        sub, _, auth_b64 = self._fake_browser_subscription()
        body = webpush.encrypt_payload(b"x", sub["keys"]["p256dh"], auth_b64)
        self.assertEqual(len(body[:16]), 16)          # salt
        idlen = body[20]
        self.assertEqual(idlen, 65)                   # uncompressed P-256 point
        self.assertEqual(body[21], 0x04)              # uncompressed point marker


@unittest.skipUnless(HAVE, "cryptography not available")
class VapidSignature(unittest.TestCase):
    def test_the_token_verifies_against_the_public_key(self):
        priv_b64, pub_b64 = webpush.generate_vapid_keys()
        endpoint = "https://updates.push.services.mozilla.com/wpush/v2/xyz"
        header = webpush.vapid_authorization(endpoint, priv_b64, pub_b64, "mailto:me@ahenora.com")
        self.assertTrue(header.startswith("vapid t="))
        # Pull the JWT and the advertised key out of the header.
        parts = dict(p.strip().split("=", 1) for p in header[len("vapid "):].split(","))
        jwt, k = parts["t"], parts["k"]
        self.assertEqual(k, pub_b64)
        h, c, sig = jwt.split(".")
        # Verify the ES256 signature with the public key.
        pub_bytes = _b64url_dec(pub_b64)
        pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), pub_bytes)
        raw = _b64url_dec(sig)
        r = int.from_bytes(raw[:32], "big")
        s = int.from_bytes(raw[32:], "big")
        pub.verify(encode_dss_signature(r, s), f"{h}.{c}".encode(), ec.ECDSA(hashes.SHA256()))
        # Claims name the right audience + subject.
        claims = json.loads(_b64url_dec(c))
        self.assertEqual(claims["aud"], "https://updates.push.services.mozilla.com")
        self.assertEqual(claims["sub"], "mailto:me@ahenora.com")
        self.assertGreater(claims["exp"], int(time.time()))

    def test_the_request_bundle_has_the_expected_headers(self):
        priv_b64, pub_b64 = webpush.generate_vapid_keys()
        ua_priv = ec.generate_private_key(ec.SECP256R1())
        p256dh = ua_priv.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/abc",
               "keys": {"p256dh": _b64url(p256dh), "auth": _b64url(os.urandom(16))}}
        url, headers, body = webpush.webpush_request(
            sub, b'{"title":"hi"}', vapid_private=priv_b64, vapid_public=pub_b64,
            subject="mailto:me@ahenora.com")
        self.assertEqual(url, sub["endpoint"])
        self.assertEqual(headers["Content-Encoding"], "aes128gcm")
        self.assertIn("TTL", headers)
        self.assertTrue(headers["Authorization"].startswith("vapid t="))
        self.assertIsInstance(body, bytes)


try:
    import fastapi  # noqa: F401
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import server
    from fake_mongo import FakeDatabase
    HAVE_SERVER = HAVE
except ImportError:
    HAVE_SERVER = False


@unittest.skipUnless(HAVE_SERVER, "backend deps not installed")
class WebPushEndpoints(unittest.TestCase):
    def setUp(self):
        import asyncio
        self.asyncio = asyncio
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        priv, pub = webpush.generate_vapid_keys()
        os.environ["VAPID_PRIVATE_KEY"] = priv
        os.environ["VAPID_PUBLIC_KEY"] = pub
        os.environ["VAPID_SUBJECT"] = "mailto:support@ahenora.com"
        self.user = {"user_id": "u1", "family_id": "fam1", "name": "Roland"}
        # A realistic browser subscription.
        ua_priv = ec.generate_private_key(ec.SECP256R1())
        p256dh = ua_priv.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.sub = {"endpoint": "https://fcm.googleapis.com/fcm/send/tok1",
                    "keys": {"p256dh": _b64url(p256dh), "auth": _b64url(os.urandom(16))}}

    def tearDown(self):
        server.get_db = self._get_db
        for k in ("VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY", "VAPID_SUBJECT"):
            os.environ.pop(k, None)

    def test_subscribe_stores_the_browser(self):
        out = self.asyncio.run(server.web_push_subscribe(
            payload={"subscription": self.sub}, user=dict(self.user)))
        self.assertTrue(out["ok"])
        stored = self.asyncio.run(self.db["web_push_subscriptions"].find_one({"endpoint": self.sub["endpoint"]}))
        self.assertEqual(stored["user_id"], "u1")
        self.assertTrue(stored["active"])

    def test_send_posts_to_the_endpoint(self):
        self.asyncio.run(server.web_push_subscribe(payload={"subscription": self.sub}, user=dict(self.user)))
        calls = {}
        real_post = server.requests.post

        class Resp:
            status_code = 201
        server.requests.post = lambda url, data=None, headers=None, timeout=None: (
            calls.update(url=url, headers=headers, data=data) or Resp())
        try:
            self.asyncio.run(server.send_web_push_to_user(self.db, "u1", "School run", "Handed to you", {}))
        finally:
            server.requests.post = real_post
        self.assertEqual(calls["url"], self.sub["endpoint"])
        self.assertEqual(calls["headers"]["Content-Encoding"], "aes128gcm")
        self.assertTrue(calls["headers"]["Authorization"].startswith("vapid t="))

    def test_a_gone_subscription_is_pruned(self):
        self.asyncio.run(server.web_push_subscribe(payload={"subscription": self.sub}, user=dict(self.user)))
        real_post = server.requests.post

        class Gone:
            status_code = 410
            text = "gone"
        server.requests.post = lambda url, data=None, headers=None, timeout=None: Gone()
        try:
            self.asyncio.run(server.send_web_push_to_user(self.db, "u1", "t", "b", {}))
        finally:
            server.requests.post = real_post
        stored = self.asyncio.run(self.db["web_push_subscriptions"].find_one({"endpoint": self.sub["endpoint"]}))
        self.assertFalse(stored["active"])

    def test_send_is_a_noop_when_unconfigured(self):
        for k in ("VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY"):
            os.environ.pop(k, None)
        # Should simply return without error (and without needing requests).
        self.asyncio.run(server.send_web_push_to_user(self.db, "u1", "t", "b", {}))
        self.assertFalse(server.webpush_configured())


if __name__ == "__main__":
    unittest.main()
