"""Sign in with Apple: the token check has to actually check.

Apple requires this button in any app offering another social login, so it
gates the iOS release. A verifier that accepts a forged token would let anyone
sign in as anyone, so these tests mint real RS256 tokens with a throwaway key
and assert each way a bad one is refused.

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
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding, rsa
    import apple_auth
    HAVE = True
except ImportError:
    HAVE = False

BUNDLE = "com.householdcoo.app"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _uint_b64(n: int) -> str:
    return _b64(n.to_bytes((n.bit_length() + 7) // 8, "big"))


@unittest.skipUnless(HAVE, "cryptography not installed")
class AppleTokenVerification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pub = cls.key.public_key().public_numbers()
        cls.jwk = {"kid": "testkey", "kty": "RSA", "alg": "RS256",
                   "n": _uint_b64(pub.n), "e": _uint_b64(pub.e)}

    def _token(self, *, kid="testkey", alg="RS256", key=None, **claim_overrides):
        now = int(time.time())
        claims = {"iss": apple_auth.APPLE_ISSUER, "aud": BUNDLE, "sub": "001234.apple.uid",
                  "email": "parent@icloud.com", "email_verified": "true",
                  "iat": now, "exp": now + 600}
        claims.update(claim_overrides)
        header = {"alg": alg, "kid": kid}
        h = _b64(json.dumps(header).encode())
        c = _b64(json.dumps(claims).encode())
        signing_input = f"{h}.{c}".encode()
        sig = (key or self.key).sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
        return f"{h}.{c}.{_b64(sig)}"

    def _verify(self, token, **kw):
        return apple_auth.verify_apple_identity_token(
            token, [BUNDLE], keys=[self.jwk], **kw)

    # --- the happy path -------------------------------------------------
    def test_a_genuine_token_verifies_and_returns_its_claims(self):
        claims = self._verify(self._token())
        self.assertEqual(claims["sub"], "001234.apple.uid")
        self.assertEqual(claims["email"], "parent@icloud.com")

    def test_an_audience_list_is_accepted_when_it_contains_our_app(self):
        claims = self._verify(self._token(aud=["someone.else", BUNDLE]))
        self.assertEqual(claims["sub"], "001234.apple.uid")

    # --- the refusals ---------------------------------------------------
    def test_a_token_signed_by_someone_else_is_refused(self):
        attacker = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        with self.assertRaises(ValueError):
            self._verify(self._token(key=attacker))

    def test_a_tampered_payload_is_refused(self):
        token = self._token()
        h, c, s = token.split(".")
        forged = json.loads(apple_auth._b64url_decode(c))
        forged["sub"] = "somebody.elses.uid"
        token = f"{h}.{_b64(json.dumps(forged).encode())}.{s}"
        with self.assertRaises(ValueError):
            self._verify(token)

    def test_a_token_for_another_app_is_refused(self):
        with self.assertRaises(ValueError):
            self._verify(self._token(aud="com.someone.else"))

    def test_a_token_from_another_issuer_is_refused(self):
        with self.assertRaises(ValueError):
            self._verify(self._token(iss="https://evil.example.com"))

    def test_an_expired_token_is_refused(self):
        past = int(time.time()) - 5000
        with self.assertRaises(ValueError):
            self._verify(self._token(iat=past, exp=past + 600))

    def test_an_unknown_signing_key_is_refused(self):
        with self.assertRaises(ValueError):
            self._verify(self._token(kid="not-a-key-we-know"))

    def test_the_none_algorithm_is_refused(self):
        with self.assertRaises(ValueError):
            self._verify(self._token(alg="none"))

    def test_a_malformed_token_is_refused(self):
        with self.assertRaises(ValueError):
            self._verify("not-a-jwt")


if __name__ == "__main__":
    unittest.main()


try:
    import fastapi  # noqa: F401
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
    import asyncio
    import server
    from fake_mongo import FakeDatabase
    HAVE_SERVER = HAVE
except ImportError:
    HAVE_SERVER = False


@unittest.skipUnless(HAVE_SERVER, "backend deps not installed")
class AppleSignInEndpoint(unittest.TestCase):
    """The endpoint itself: a first sign-in creates a household, a returning one
    finds it, and an Apple sign-in over an existing email joins that account
    rather than shadowing it with a second."""

    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pub = cls.key.public_key().public_numbers()
        cls.jwk = {"kid": "testkey", "kty": "RSA", "alg": "RS256",
                   "n": _uint_b64(pub.n), "e": _uint_b64(pub.e)}

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        os.environ["APPLE_BUNDLE_ID"] = BUNDLE
        # Serve our throwaway key instead of reaching out to Apple.
        self._real_fetch = server.apple_auth.fetch_apple_keys
        server.apple_auth.fetch_apple_keys = lambda force=False: [self.jwk]

    def tearDown(self):
        server.get_db = self._get_db
        server.apple_auth.fetch_apple_keys = self._real_fetch
        os.environ.pop("APPLE_BUNDLE_ID", None)

    def _token(self, sub="001234.apple.uid", email="parent@icloud.com", verified="true"):
        now = int(time.time())
        claims = {"iss": apple_auth.APPLE_ISSUER, "aud": BUNDLE, "sub": sub,
                  "email": email, "email_verified": verified,
                  "iat": now, "exp": now + 600}
        h = _b64(json.dumps({"alg": "RS256", "kid": "testkey"}).encode())
        c = _b64(json.dumps(claims).encode())
        sig = self.key.sign(f"{h}.{c}".encode(), padding.PKCS1v15(), hashes.SHA256())
        return f"{h}.{c}.{_b64(sig)}"

    def _signin(self, **kw):
        payload = server.AppleSessionIn(identity_token=self._token(**{
            k: v for k, v in kw.items() if k in ("sub", "email", "verified")}),
            full_name=kw.get("full_name"))
        return asyncio.run(server.exchange_apple_session(payload))

    def test_a_first_sign_in_creates_the_person_and_their_household(self):
        out = self._signin(full_name="Roland H")
        self.assertTrue(out["session_token"])
        self.assertEqual(out["user"]["name"], "Roland H")
        member = asyncio.run(self.db["family_members"].find_one({"name": "Roland H"}))
        self.assertEqual(member["role"], "Parent")

    def test_signing_in_again_returns_the_same_account(self):
        first = self._signin(full_name="Roland H")
        # Apple sends no name on later sign-ins — the stored one must survive.
        second = self._signin()
        self.assertEqual(first["user"]["user_id"], second["user"]["user_id"])
        self.assertEqual(second["user"]["name"], "Roland H")

    def test_apple_links_into_an_existing_email_account_instead_of_duplicating(self):
        asyncio.run(self.db["users"].insert_one({
            "user_id": "u_existing", "email": "parent@icloud.com", "name": "Roland",
            "family_id": "fam_existing", "onboarding_completed": True}))
        out = self._signin()
        self.assertEqual(out["user"]["user_id"], "u_existing")
        count = asyncio.run(self.db["users"].count_documents({"email": "parent@icloud.com"}))
        self.assertEqual(count, 1)          # linked, not duplicated

    def test_hide_my_email_relay_addresses_work(self):
        out = self._signin(email="abc123@privaterelay.appleid.com", full_name="Keigh H")
        self.assertEqual(out["user"]["email"], "abc123@privaterelay.appleid.com")

    def test_a_forged_token_is_refused_by_the_endpoint(self):
        attacker = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = int(time.time())
        claims = {"iss": apple_auth.APPLE_ISSUER, "aud": BUNDLE, "sub": "evil",
                  "email": "victim@icloud.com", "email_verified": "true",
                  "iat": now, "exp": now + 600}
        h = _b64(json.dumps({"alg": "RS256", "kid": "testkey"}).encode())
        c = _b64(json.dumps(claims).encode())
        sig = attacker.sign(f"{h}.{c}".encode(), padding.PKCS1v15(), hashes.SHA256())
        payload = server.AppleSessionIn(identity_token=f"{h}.{c}.{_b64(sig)}")
        with self.assertRaises(server.HTTPException) as e:
            asyncio.run(server.exchange_apple_session(payload))
        self.assertEqual(e.exception.status_code, 401)
