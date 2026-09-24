"""A share link opens what it shares, for a guest with no account.

The gift pot's invite link (/app/pot/<code>) and a Secret Santa reveal link
(/app/santa-match/<code>) are for people OUTSIDE the household — a grandparent
chipping in, an aunt in the draw. Neither address has a file on the host, so
both fall through to docs/404.html, which forwarded every unknown address to
/app/ and threw the path away. Every guest landed on a sign-in screen instead
of the pot or the match, and nothing in the suite could see it: the local
server answered unknown addresses with Python's own error page, not the host's.

This opens both links the way a guest does — a fresh browser, no session —
and checks each lands on its own page, at its own address. And checks the
forwarding carries nothing else: a mistyped address still reaches the front
page, and the query parameter that carries the path cannot send anyone to an
arbitrary one.

Usage:  python3 scripts/e2e_sharelink.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.request, uuid
from urllib.parse import urlparse

from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(
        f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})},
        method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


def seed():
    """An organiser with a shared gift pot and a sent Santa draw."""
    # The e2e backend treats this address as a tester, so the paid gift pot
    # is available without a purchase.
    u = api("POST", "/auth/register", {"name": "Roland Link", "email": "e2e-admin@sim.test",
                                       "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    pot = api("POST", "/gift-pots", {"title": "Ama", "occasion": "birthday", "per_head": 10,
                                     "target_total": 80, "note": "A bike for the big day"}, tok)
    pot_id = pot.get("pot_id") or (pot.get("pot") or {}).get("pot_id")
    shared = api("POST", f"/gift-pots/{pot_id}/share", {}, tok)
    pot_code = shared.get("share_token") or (shared.get("pot") or {}).get("share_token")

    draw = api("POST", "/santa", {"title": "Family Christmas", "budget": 25, "draw_by": "24 Dec",
                                  "participants": [{"name": "Roland"}, {"name": "Efua"},
                                                   {"name": "Kofi"}, {"name": "Abena"}]}, tok)
    did = draw.get("draw_id") or (draw.get("draw") or {}).get("draw_id")
    api("POST", f"/santa/{did}/shuffle", {}, tok)
    sent = api("POST", f"/santa/{did}/send", {}, tok)
    parts = sent.get("participants") or (sent.get("draw") or {}).get("participants") or []
    santa_code = next((p["token"] for p in parts if p.get("token")), None)
    return pot_code, santa_code


async def main():
    r = {}
    pot_code, santa_code = seed()
    r["seed_made_a_pot_link"] = bool(pot_code)
    r["seed_made_a_santa_link"] = bool(santa_code)

    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        # A guest: a fresh context, no session token anywhere.
        ctx = await br.new_context(viewport={"width": 390, "height": 844})
        p = await ctx.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)[:200]))

        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
        await p.route("**/api/**", route)

        async def land(url):
            await p.goto(url, wait_until="domcontentloaded")
            # The catch-all page redirects once; give the app time to start.
            await p.wait_for_timeout(4500)
            return urlparse(p.url).path, (await p.inner_text("body"))

        # --- the gift pot link ---------------------------------------------
        if pot_code:
            path, body = await land(f"{WEB}/pot/{pot_code}")
            r["pot_link_keeps_its_address"] = path == f"/app/pot/{pot_code}"
            r["pot_link_shows_the_pot"] = "gift pot for Ama" in body
            r["pot_link_offers_to_join"] = "Join in" in body
            r["pot_link_is_not_the_sign_in_screen"] = "Continue with Google" not in body
            await p.screenshot(path="sharelink_pot.png")

        # --- the Secret Santa reveal link ----------------------------------
        if santa_code:
            path, body = await land(f"{WEB}/santa-match/{santa_code}")
            r["santa_link_keeps_its_address"] = path == f"/app/santa-match/{santa_code}"
            r["santa_link_shows_the_match"] = "keep it secret" in body.lower()
            r["santa_link_is_not_the_sign_in_screen"] = "Continue with Google" not in body
            await p.screenshot(path="sharelink_santa.png")

        # --- nothing else changed ------------------------------------------
        # A mistyped address still reaches the front page, as before.
        path, _ = await land(f"{WEB}/this-page-does-not-exist")
        r["a_mistyped_address_still_reaches_the_front_page"] = path in ("/app", "/app/")

        # The carrier parameter honours only the two share shapes. Anything
        # else leaves the visitor on the front page, never where it points.
        for label, value in (("an_outside_address", "https://example.com"),
                             ("a_path_climb", "pot/..%2F..%2Fsettings"),
                             ("another_screen", "settings")):
            path, _ = await land(f"{WEB}/?__share={value}")
            r[f"the_parameter_ignores_{label}"] = path in ("/app", "/app/")

        r["no_js_errors"] = not errors
        if errors:
            print("page errors:", errors[:3])
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    ok = bool(r) and all(r.values())
    print("ALL PASS" if ok else "FAILURES PRESENT")
    sys.exit(0 if ok else 1)


asyncio.run(main())
