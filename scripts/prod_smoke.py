"""Post-deploy smoke test against the real production backend.

Exercises the exact journey that broke in the field: sign in, send an
invitation, discover it from the invitee's account without any link, accept
it, verify the membership — then clean up after itself so runs are
repeatable. Uses only the standard library so it runs anywhere.

Accounts: one fixed inviter (created on first run) and one fresh invitee per
run under the reserved @household-coo.smoke pattern, which the backend allows
to self-delete (POST /api/auth/smoke-cleanup).

Env:
  SMOKE_PASSWORD       required — password for the smoke accounts
  SMOKE_BASE_URL       optional — defaults to production
  EXPECTED_INVITE_FLOW optional — poll /api/health until this deploy marker
                       is live (catches stuck/failed deploys) before testing
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("SMOKE_BASE_URL", "https://household-coo-production.up.railway.app").rstrip("/")
PASSWORD = os.environ.get("SMOKE_PASSWORD", "")
EXPECTED_MARKER = os.environ.get("EXPECTED_INVITE_FLOW", "")

INVITER_EMAIL = "smoke-inviter@household-coo.smoke"


def call(method, path, body=None, token=None, timeout=30):
    req = urllib.request.Request(
        f"{BASE}/api{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"detail": raw[:200]}


def fail(step, detail):
    print(f"FAIL  {step}: {detail}")
    sys.exit(1)


def ok(step, detail=""):
    print(f"ok    {step}{f' — {detail}' if detail else ''}")


def main():
    if not PASSWORD:
        fail("setup", "SMOKE_PASSWORD is not set")

    # 1. Health — and wait for the expected deploy marker if one was given.
    deadline = time.time() + 600
    while True:
        status, health = call("GET", "/health")
        if status == 200 and health.get("status") == "ok":
            marker = health.get("invite_flow", "")
            if not EXPECTED_MARKER or marker == EXPECTED_MARKER:
                ok("health", f"db {health.get('db_latency_ms')}ms, invite_flow {marker or 'n/a'}")
                # Which build is actually serving. The deploy marker above only
                # moves when somebody bumps it by hand, so it cannot tell a
                # current deploy from a nine-day-old one — and "is the backend
                # I just merged actually live?" turned out to be the question
                # standing between a 500 and its diagnosis. This answers it in
                # one line, on every run, for free.
                vstatus, vinfo = call("GET", "/app/version-info")
                if vstatus == 200:
                    ok("deployed build", f"store_version {vinfo.get('store_version')}, "
                                         f"min_runtime {vinfo.get('min_runtime')}")
                else:
                    # A 404 here is itself the answer: the endpoint shipped on
                    # 2026-08-06, so production predates it.
                    ok("deployed build", f"/app/version-info -> {vstatus} "
                                         f"(endpoint missing: production is running older code)")
                break
            if time.time() > deadline:
                fail("health", f"deploy marker still {marker!r}, expected {EXPECTED_MARKER!r} after 10min")
            print(f"...   waiting for deploy: live={marker!r} expected={EXPECTED_MARKER!r}")
        elif time.time() > deadline:
            fail("health", f"{status}: {health}")
        time.sleep(20)

    # 2. Inviter: login, or register on the very first run.
    status, res = call("POST", "/auth/login", {"email": INVITER_EMAIL, "password": PASSWORD})
    if status == 401:
        status, res = call("POST", "/auth/register",
                           {"name": "Smoke Inviter", "email": INVITER_EMAIL, "password": PASSWORD})
    if status != 200:
        fail("inviter auth", f"{status}: {res}")
    token_a = res["session_token"]
    family_a = res["user"]["family_id"]
    ok("inviter signed in", family_a)

    # 3. Fresh invitee account (own family for now).
    invitee_email = f"smoke-{uuid.uuid4().hex[:10]}@household-coo.smoke"
    status, res = call("POST", "/auth/register",
                       {"name": "Smoke Invitee", "email": invitee_email, "password": PASSWORD})
    if status != 200:
        fail("invitee register", f"{status}: {res}")
    token_b = res["session_token"]
    family_b = res["user"]["family_id"]
    if family_b == family_a:
        fail("invitee register", "new account unexpectedly landed in the inviter's family")
    ok("invitee registered", invitee_email)

    # 4. Send the invitation (email delivery to .smoke will fail; irrelevant).
    status, res = call("POST", "/family/invite",
                       {"email": invitee_email, "relationship": "Smoke test"}, token=token_a)
    if status != 200 or not res.get("invite", {}).get("token"):
        fail("send invite", f"{status}: {res}")
    invite_token = res["invite"]["token"]
    ok("invite created")

    # 5. The field bug: the invitee must discover the invite with NO link.
    status, res = call("GET", "/family/invites/for-me", token=token_b)
    if status != 200:
        fail("discover invite", f"{status}: {res}")
    tokens = [i.get("token") for i in res]
    if invite_token not in tokens:
        fail("discover invite", f"pending invite not surfaced: {res}")
    ok("invite discovered without a link")

    # 6. Accept while signed in.
    status, res = call("POST", "/family/invite/accept", {"token": invite_token}, token=token_b)
    if status != 200 or not res.get("joined"):
        fail("accept invite", f"{status}: {res}")
    if res["user"]["family_id"] != family_a:
        fail("accept invite", f"joined wrong family: {res['user']['family_id']}")
    ok("invite accepted, families united")

    # 7. The inviter sees the new member, carrying the typed relationship.
    status, res = call("GET", "/family/members", token=token_a)
    if status != 200:
        fail("member list", f"{status}: {res}")
    match = [m for m in res if m.get("name") == "Smoke Invitee"]
    if not match:
        fail("member list", "invitee missing from the inviter's family")
    if match[0].get("role") != "Smoke test":
        fail("member list", f"role should be the typed relationship, got {match[0].get('role')!r}")
    ok("membership + relationship verified")

    # 8. Leave no residue.
    status, res = call("POST", "/auth/smoke-cleanup", {"family_ids": [family_b]}, token=token_b)
    if status != 200:
        fail("cleanup", f"{status}: {res}")
    status, res = call("GET", "/family/members", token=token_a)
    if any(m.get("name") == "Smoke Invitee" for m in res):
        fail("cleanup", "invitee member row survived cleanup")
    ok("cleanup complete")

    print("PASS  production invite loop is healthy")


if __name__ == "__main__":
    main()
