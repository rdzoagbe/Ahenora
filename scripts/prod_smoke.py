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


# Railway replaces the container on every deploy, and a merge to main
# redeploys the backend even for a frontend-only change. For a few seconds
# during that swap the edge answers 502/503/504, or refuses the connection
# outright, on whichever call happens to land in the gap.
#
# That is not production being broken, it is production being replaced — and
# it is exactly what this check kept reporting: every step of the journey
# green, then a bare 502 on the last call. No amount of waiting BEFORE the
# journey can fix it, because the cutover can land in the middle of one.
#
# So gateway-level answers are retried briefly. Anything the APPLICATION
# itself returns — a 4xx, or a 500 from our own code — is passed straight
# through untouched: swallowing those is precisely how this check would start
# lying, and a check that lies is worse than no check.
#
# One more distinction, which the first version of this missed. Retrying is
# only free when the call can be made twice without changing anything. A GET
# can. So can a login, and so can the cleanup, whose whole job is deletion.
# /auth/register, /family/invite and /family/invite/accept cannot: if the first
# attempt DID reach the app and the answer was lost on the way back, the retry
# registers a second account or accepts an invitation twice.
#
# For those, only the answers that prove the request never arrived are retried:
# a 503, which is the edge with nothing behind it to talk to, and a refused
# connection, which never opened. A 502 or a 504 means the edge did reach a
# container — it may well have done the work before dying — and a reset
# mid-flight says the same. Those are reported, not repeated.
GATEWAY_STATUSES = {502, 503, 504}
NEVER_DELIVERED = {503}
GATEWAY_BACKOFF = (3, 6, 9, 12)


def _never_opened(err):
    """True when the connection was refused outright, so nothing was sent.

    A refusal is the edge with no container behind it — the safe case. A reset
    or a timeout happens on a connection that WAS open, and the request may
    have been served before it broke.
    """
    reason = getattr(err, "reason", None)
    if isinstance(reason, ConnectionRefusedError):
        return True
    return "refused" in str(reason).lower()


def call(method, path, body=None, token=None, timeout=30, retry_safe=None):
    """One API call. `retry_safe` says whether repeating it is harmless;
    GETs are, and anything else has to say so for itself."""
    if retry_safe is None:
        retry_safe = method == "GET"
    retriable = GATEWAY_STATUSES if retry_safe else NEVER_DELIVERED
    req = urllib.request.Request(
        f"{BASE}/api{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Content-Type": "application/json",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
        method=method,
    )
    for attempt, pause in enumerate((*GATEWAY_BACKOFF, None)):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.status, json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            if e.code in retriable and pause is not None:
                print(f"...   {e.code} from the edge on {method} {path}; "
                      f"retrying in {pause}s (deploy cutover?)")
                time.sleep(pause)
                continue
            if e.code in GATEWAY_STATUSES and not retry_safe:
                print(f"...   {e.code} from the edge on {method} {path}; "
                      f"not retried — the call may already have gone through")
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {"detail": raw[:200]}
        except urllib.error.URLError as e:
            # Connection refused or reset: the old container is going away.
            # Previously uncaught, so a restart mid-journey ended the run in a
            # traceback rather than a readable line.
            if not retry_safe and not _never_opened(e):
                print(f"...   connection lost on {method} {path}: {e.reason}; "
                      f"not retried — the call may already have gone through")
                return 0, {"detail": f"connection lost mid-call: {e.reason}"}
            if pause is not None:
                print(f"...   no connection on {method} {path}: {e.reason}; "
                      f"retrying in {pause}s (deploy cutover?)")
                time.sleep(pause)
                continue
            return 0, {"detail": f"connection failed after retries: {e.reason}"}
    return 0, {"detail": "unreachable"}


def fail(step, detail):
    print(f"FAIL  {step}: {detail}")
    sys.exit(1)


def ok(step, detail=""):
    print(f"ok    {step}{f' — {detail}' if detail else ''}")


def main():
    if not PASSWORD:
        fail("setup", "SMOKE_PASSWORD is not set")

    # 1. Health — and wait for the expected deploy marker if one was given.
    #
    # Two healthy answers in a row, not one. A single OK is satisfied by the
    # instance that is on its way out during a deploy, which is how the journey
    # kept starting seconds before the swap. The marker cannot help here: it
    # only moves when somebody bumps it by hand, so it reads the same before
    # and after a deploy.
    deadline = time.time() + 600
    healthy_streak = 0
    while True:
        status, health = call("GET", "/health")
        if status != 200 or health.get("status") != "ok":
            healthy_streak = 0
        if status == 200 and health.get("status") == "ok":
            marker = health.get("invite_flow", "")
            healthy_streak += 1
            if (not EXPECTED_MARKER or marker == EXPECTED_MARKER) and healthy_streak < 2:
                time.sleep(5)
                continue
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
    status, res = call("POST", "/auth/login", {"email": INVITER_EMAIL, "password": PASSWORD},
                       retry_safe=True)
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
    status, res = call("POST", "/auth/smoke-cleanup", {"family_ids": [family_b]}, token=token_b,
                       retry_safe=True)
    if status != 200:
        fail("cleanup", f"{status}: {res}")
    status, res = call("GET", "/family/members", token=token_a)
    if any(m.get("name") == "Smoke Invitee" for m in res):
        fail("cleanup", "invitee member row survived cleanup")
    ok("cleanup complete")

    print("PASS  production invite loop is healthy")


if __name__ == "__main__":
    main()
