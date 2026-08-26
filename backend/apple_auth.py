"""Sign in with Apple — verifying the identity token Apple hands the app.

Apple requires this button in any app that offers another social login (App
Store rule 4.8), so it is a condition of shipping on iOS at all, not a nicety.

The token is a JWT signed by Apple with RS256. Verifying it means: fetch
Apple's public keys, pick the one the token names, check the signature, then
check the claims (issuer, audience, expiry). Done here with `cryptography` +
the stdlib — the same choice as webpush.py, so there is no new dependency and
the whole thing is testable offline by signing a token with a throwaway key.
"""
import json
import time
import base64
import threading
import urllib.request

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"

_keys_cache: dict = {"fetched_at": 0.0, "keys": []}
_keys_lock = threading.Lock()
# Apple rotates signing keys; an hour is well inside their cadence and keeps a
# burst of sign-ins from hammering their endpoint.
_KEYS_TTL = 3600


def _b64url_decode(segment: str) -> bytes:
    segment += "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment)


def _b64url_uint(value: str) -> int:
    return int.from_bytes(_b64url_decode(value), "big")


def fetch_apple_keys(force: bool = False) -> list:
    """Apple's current public signing keys (JWKS), cached."""
    with _keys_lock:
        fresh = (time.time() - _keys_cache["fetched_at"]) < _KEYS_TTL
        if _keys_cache["keys"] and fresh and not force:
            return _keys_cache["keys"]
    req = urllib.request.Request(APPLE_KEYS_URL, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        keys = json.loads(resp.read().decode("utf-8")).get("keys", [])
    with _keys_lock:
        _keys_cache["keys"] = keys
        _keys_cache["fetched_at"] = time.time()
    return keys


def _public_key_from_jwk(jwk: dict):
    n = _b64url_uint(jwk["n"])
    e = _b64url_uint(jwk["e"])
    return rsa.RSAPublicNumbers(e, n).public_key()


def decode_segments(token: str) -> tuple[dict, dict, bytes, bytes]:
    """(header, claims, signing_input, signature) — no verification yet."""
    try:
        h_b64, c_b64, s_b64 = token.split(".")
    except ValueError:
        raise ValueError("Malformed identity token")
    header = json.loads(_b64url_decode(h_b64))
    claims = json.loads(_b64url_decode(c_b64))
    return header, claims, f"{h_b64}.{c_b64}".encode(), _b64url_decode(s_b64)


def verify_apple_identity_token(token: str, audiences: list[str], *,
                                keys: list | None = None,
                                now: float | None = None,
                                leeway: int = 60) -> dict:
    """Verify an Apple identity token and return its claims.

    `audiences` is every client id we accept (the iOS bundle id, plus a Services
    ID if the web flow is ever added). Raises ValueError on anything that does
    not check out — the caller turns that into a 401.
    """
    header, claims, signing_input, signature = decode_segments(token)
    if header.get("alg") != "RS256":
        raise ValueError("Unexpected token algorithm")

    jwks = keys if keys is not None else fetch_apple_keys()
    kid = header.get("kid")
    jwk = next((k for k in jwks if k.get("kid") == kid), None)
    if jwk is None and keys is None:
        # A rotated key we have not seen: refetch once before giving up.
        jwks = fetch_apple_keys(force=True)
        jwk = next((k for k in jwks if k.get("kid") == kid), None)
    if jwk is None:
        raise ValueError("Unknown Apple signing key")

    try:
        _public_key_from_jwk(jwk).verify(
            signature, signing_input, padding.PKCS1v15(), hashes.SHA256())
    except Exception:
        raise ValueError("Bad token signature")

    if claims.get("iss") != APPLE_ISSUER:
        raise ValueError("Unexpected token issuer")

    aud = claims.get("aud")
    aud_list = aud if isinstance(aud, list) else [aud]
    if not any(a in audiences for a in aud_list):
        raise ValueError("Token was not issued for this app")

    current = time.time() if now is None else now
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)) or current > exp + leeway:
        raise ValueError("Token has expired")
    iat = claims.get("iat")
    if isinstance(iat, (int, float)) and iat > current + leeway:
        raise ValueError("Token is not valid yet")
    if not claims.get("sub"):
        raise ValueError("Token has no subject")
    return claims
