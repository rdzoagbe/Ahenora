"""Web Push — browser notifications that arrive even when the tab is closed.

No third-party push library: the encryption (RFC 8291, aes128gcm content coding)
and the VAPID signature (RFC 8292) are done here with the stdlib + `cryptography`,
which is already a dependency. That keeps the fragile `pywebpush`/`http-ece`
wheels out of the build, and — because the whole thing is pure — lets the
encryption be proven correct by an encrypt→decrypt round-trip in the tests.

Public surface:
  generate_vapid_keys()        -> (private_b64url, public_b64url)   (setup CLI)
  webpush_request(sub, payload, *, vapid_private, vapid_public, subject)
                               -> (url, headers, body)             (what to POST)
  decrypt_payload(...)                                             (tests only)
"""
import os
import time
import json
import hmac
import struct
import base64
import hashlib
from urllib.parse import urlparse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_CURVE = ec.SECP256R1()
_X962 = serialization.Encoding.X962
_UNCOMPRESSED = serialization.PublicFormat.UncompressedPoint


def b64url_decode(s: str) -> bytes:
    if isinstance(s, bytes):
        s = s.decode()
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


def b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    """HKDF with a single expand block — enough for the <=32-byte outputs Web
    Push needs (RFC 5869)."""
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:length]


# ---------------------------------------------------------------------------
# VAPID keys
# ---------------------------------------------------------------------------
def generate_vapid_keys() -> tuple[str, str]:
    """A fresh P-256 keypair for VAPID, as base64url strings. The public key is
    safe to embed in the web app; the private key is a Railway secret."""
    priv = ec.generate_private_key(_CURVE)
    d = priv.private_numbers().private_value
    priv_b = d.to_bytes(32, "big")
    pub_b = priv.public_key().public_bytes(_X962, _UNCOMPRESSED)  # 65 bytes
    return b64url_encode(priv_b), b64url_encode(pub_b)


def _load_vapid_private(vapid_private_b64: str):
    d = int.from_bytes(b64url_decode(vapid_private_b64), "big")
    return ec.derive_private_key(d, _CURVE)


def vapid_authorization(endpoint: str, vapid_private_b64: str, vapid_public_b64: str,
                        subject: str, now: int | None = None) -> str:
    """The `Authorization: vapid t=<JWT>, k=<pubkey>` header value that proves to
    the push service we own the application server key."""
    parsed = urlparse(endpoint)
    aud = f"{parsed.scheme}://{parsed.netloc}"
    exp = int(now if now is not None else time.time()) + 12 * 3600
    header = b64url_encode(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64url_encode(json.dumps({"aud": aud, "exp": exp, "sub": subject}, separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}".encode()
    priv = _load_vapid_private(vapid_private_b64)
    der = priv.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw_sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    jwt = f"{header}.{claims}.{b64url_encode(raw_sig)}"
    return f"vapid t={jwt}, k={vapid_public_b64}"


# ---------------------------------------------------------------------------
# Payload encryption (RFC 8291, aes128gcm)
# ---------------------------------------------------------------------------
def encrypt_payload(payload: bytes, p256dh_b64: str, auth_b64: str) -> bytes:
    """Encrypt `payload` for a browser subscription (its p256dh public key + auth
    secret), producing an aes128gcm body ready to POST as the request content."""
    p256dh = b64url_decode(p256dh_b64)
    auth = b64url_decode(auth_b64)
    ua_pub = ec.EllipticCurvePublicKey.from_encoded_point(_CURVE, p256dh)

    as_priv = ec.generate_private_key(_CURVE)
    as_pub = as_priv.public_key().public_bytes(_X962, _UNCOMPRESSED)  # 65 bytes
    shared = as_priv.exchange(ec.ECDH(), ua_pub)

    salt = os.urandom(16)
    # Combine the auth secret with the ECDH secret (RFC 8291 §3.4).
    key_info = b"WebPush: info\x00" + p256dh + as_pub
    ikm = _hkdf(auth, shared, key_info, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)

    # One record, delimiter 0x02 marks the final record (RFC 8188).
    ciphertext = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    record_size = 4096
    header = salt + struct.pack(">I", record_size) + struct.pack(">B", len(as_pub)) + as_pub
    return header + ciphertext


def decrypt_payload(body: bytes, ua_private, auth_b64: str) -> bytes:
    """Inverse of encrypt_payload, given the browser's private key — used by the
    tests to prove the encryption is correct without a real browser."""
    auth = b64url_decode(auth_b64)
    salt = body[:16]
    idlen = body[20]
    as_pub_bytes = body[21:21 + idlen]
    ciphertext = body[21 + idlen:]

    as_pub = ec.EllipticCurvePublicKey.from_encoded_point(_CURVE, as_pub_bytes)
    shared = ua_private.exchange(ec.ECDH(), as_pub)
    ua_pub_bytes = ua_private.public_key().public_bytes(_X962, _UNCOMPRESSED)

    key_info = b"WebPush: info\x00" + ua_pub_bytes + as_pub_bytes
    ikm = _hkdf(auth, shared, key_info, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, ciphertext, None)
    # Strip trailing zero padding then the 0x02 delimiter.
    return plain.rstrip(b"\x00")[:-1]


def webpush_request(subscription: dict, payload: bytes, *, vapid_private: str,
                    vapid_public: str, subject: str, ttl: int = 2419200,
                    now: int | None = None) -> tuple[str, dict, bytes]:
    """Everything needed to send one Web Push: the endpoint URL, the headers, and
    the encrypted body. `subscription` is what the browser handed us:
    {endpoint, keys: {p256dh, auth}}.
    """
    endpoint = subscription["endpoint"]
    keys = subscription.get("keys") or {}
    body = encrypt_payload(payload, keys["p256dh"], keys["auth"])
    headers = {
        "Authorization": vapid_authorization(endpoint, vapid_private, vapid_public, subject, now=now),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(ttl),
        "Urgency": "high",
    }
    return endpoint, headers, body


if __name__ == "__main__":  # `python3 backend/webpush.py` prints a fresh keypair
    priv, pub = generate_vapid_keys()
    print("VAPID_PRIVATE_KEY=" + priv)
    print("VAPID_PUBLIC_KEY=" + pub)
