"""Two-persona, full-stack family journey simulation.

REAL exported web bundle + REAL backend code (scripts/e2e_backend.py, only
the database is in-memory) + two emulated devices in Chromium:

  - "Android" (Pixel-class viewport): the inviter. Adds a shopping item,
    sends the invitation with a relationship through the actual Settings UI.
  - "iPhone" (iPhone-class viewport) WITH A SIMULATED CONTENT BLOCKER that
    kills every request whose URL contains 'membership' or 'accept': the
    invitee. Must still discover the invite with no link and join.

Asserted end state: the join succeeded through the blocker, the shared
shopping list is visible on the iPhone, the child seeded in the invitee's
old family moved across, and the inviter's Settings shows co-parents and
the accepted invite.

Usage:
  python3 scripts/e2e_backend.py 8991 &        # real backend, fake DB
  python3 <static server> <root-with-bundle> 8945 &
  python3 scripts/e2e_journey.py [web_port] [api_port]
"""

import asyncio
import json
import sys
import urllib.request

from playwright.async_api import async_playwright

WEB = f"http://127.0.0.1:{sys.argv[1] if len(sys.argv) > 1 else '8945'}/Household-COO/app"
API = f"http://127.0.0.1:{sys.argv[2] if len(sys.argv) > 2 else '8991'}/api"


def api(method, path, body=None, token=None):
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def make_persona(browser, width, height, token, blocker=False):
    ctx = await browser.new_context(viewport={"width": width, "height": height})
    page = await ctx.new_page()

    async def route(ro):
        url = ro.request.url
        path = url.split("/api/", 1)[1]
        base, _, query = path.partition("?")
        # The field blocker matched path words AND query strings — kill both,
        # so only a request byte-identical in URL to a proven one survives.
        if blocker and ("membership" in base or "accept" in base
                        or "redeem" in query or "token=" in query):
            await ro.abort("failed")  # the content blocker at work
            return
        # Proxy the real bundle's API calls to the local real backend.
        resp = await ctx.request.fetch(
            f"{API}/{path}",
            method=ro.request.method,
            headers={k: v for k, v in ro.request.headers.items()
                     if k.lower() not in ("host", "content-length", "origin", "referer")},
            data=ro.request.post_data,
        )
        await ro.fulfill(status=resp.status, content_type="application/json",
                         body=await resp.body())

    await page.route("**/api/**", route)
    await page.add_init_script(f"localStorage.setItem('coo_session_token','{token}');")
    return ctx, page


async def main():
    r = {}

    # ---- Real-backend account setup (registration itself is covered by 194
    # unit tests and the production smoke test; UI drives the journey) ----
    a = api("POST", "/auth/register",
            {"name": "Roland Sim", "email": "a@sim.test", "password": "password123"})
    b = api("POST", "/auth/register",
            {"name": "Keigh Sim", "email": "b@sim.test", "password": "password123"})
    tok_a, tok_b = a["session_token"], b["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_a)
    api("POST", "/auth/complete-onboarding", {}, tok_b)
    # The invitee set up a child in her own family before joining.
    api("POST", "/family/members", {"name": "Jonael Sim", "role": "Child"}, tok_b)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
        _, android = await make_persona(browser, 412, 915, tok_a)
        _, iphone = await make_persona(browser, 390, 844, tok_b, blocker=True)

        # ---- Android/inviter: add a shopping item through the UI ----
        await android.goto(f"{WEB}/kitchen", wait_until="networkidle")
        await android.wait_for_timeout(2500)
        shop = android.get_by_placeholder("Add items — commas for several")
        await shop.fill("Plantain x6")
        await shop.press("Enter")
        await android.wait_for_timeout(1500)
        r["A_shopping_item_added"] = "Plantain x6" in await android.inner_text("body")

        # ---- Android/inviter: send the invitation via the real form ----
        await android.goto(f"{WEB}/settings", wait_until="networkidle")
        await android.wait_for_timeout(2000)
        await android.click("text=Invite a family member")
        await android.wait_for_timeout(800)
        await android.fill('[data-testid="invite-email"]', "b@sim.test")
        await android.fill('[data-testid="invite-role"]', "Co-parent")
        await android.click('[data-testid="send-invite"]')
        await android.wait_for_timeout(2000)
        # No RESEND key locally: email delivery fails but the invite exists —
        # exactly the production junk-folder scenario the app must survive.
        await android.click('[data-testid="close-invite"]')
        await android.wait_for_timeout(500)
        await android.click('[data-testid="settings-household-toggle"]')
        await android.wait_for_timeout(800)
        body = await android.inner_text("body")
        r["A_pending_invite_with_role"] = "b@sim.test" in body and "Co-parent ·" in body

        # ---- iPhone/invitee, content blocker active: no link, just opens ----
        await iphone.goto(f"{WEB}/feed", wait_until="networkidle")
        await iphone.wait_for_timeout(3000)
        body = await iphone.inner_text("body")
        r["B_join_card_appeared_without_link"] = "Roland Sim" in body
        await iphone.click('[data-testid="invite-join-accept"]')
        await iphone.wait_for_timeout(26000)  # rides retries down to discovery
        body = await iphone.inner_text("body")
        r["B_joined_through_blocker"] = ("joined the household" in body or
            await iphone.locator('[data-testid="invite-join-accept"]').count() == 0)
        r["B_no_error_shown"] = "Try again" not in body
        await iphone.screenshot(path="journey_iphone_joined.png")

        # ---- iPhone/invitee: the shared household is really shared ----
        await iphone.goto(f"{WEB}/kitchen", wait_until="networkidle")
        await iphone.wait_for_timeout(2500)
        r["B_sees_shared_shopping"] = "Plantain x6" in await iphone.inner_text("body")

        # ---- Android/inviter: co-parents, moved child, accepted invite ----
        await android.goto(f"{WEB}/settings", wait_until="networkidle")
        await android.wait_for_timeout(2500)
        await android.click('[data-testid="settings-household-toggle"]')
        await android.wait_for_timeout(1000)
        body = await android.inner_text("body")
        r["A_coparents_line"] = "Co-parents: Roland Sim & Keigh Sim" in body
        r["A_child_moved_over"] = "Jonael Sim" in body
        r["A_no_more_pending"] = "pending" not in body
        await android.screenshot(path="journey_android_family.png")
        await browser.close()

    # ---- Backend truth: family unification and role ----
    members = api("GET", "/family/members", token=tok_a)
    roles = {m["name"]: m["role"] for m in members}
    r["server_keigh_is_coparent"] = roles.get("Keigh Sim") == "Co-parent"
    r["server_child_in_family"] = roles.get("Jonael Sim") == "Child"

    for k, v in r.items():
        print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)


asyncio.run(main())
