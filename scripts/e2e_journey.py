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

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1] if len(sys.argv) > 1 else '8945'}/Ahenora/app"
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
        # The real device's telemetry showed keyword filtering: every URL
        # containing "invite" or "membership" dies, GET and POST alike,
        # plus suspicious query strings. Only bland URLs survive.
        if blocker and ("membership" in base or "accept" in base or "invite" in base
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
    import uuid
    run = uuid.uuid4().hex[:6]
    mail_a, mail_b = f"a-{run}@sim.test", f"b-{run}@sim.test"
    a = api("POST", "/auth/register",
            {"name": "Roland Sim", "email": mail_a, "password": "password123"})
    b = api("POST", "/auth/register",
            {"name": "Keigh Sim", "email": mail_b, "password": "password123"})
    tok_a, tok_b = a["session_token"], b["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_a)
    api("POST", "/auth/complete-onboarding", {}, tok_b)
    # The invitee set up a child in her own family before joining.
    api("POST", "/family/members", {"name": "Jonael Sim", "role": "Child"}, tok_b)

    async with async_playwright() as pw:
        browser = await launch_chromium(pw)
        _, android = await make_persona(browser, 412, 915, tok_a)
        _, iphone = await make_persona(browser, 390, 844, tok_b, blocker=True)

        # ---- Android/inviter: add a shopping item through the UI ----
        await android.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await android.wait_for_timeout(2500)
        shop = android.get_by_placeholder("Add items — commas for several")
        await shop.fill("Plantain x6, Rice 1kg, Tomatoes x4, Chicken 600g")
        await shop.press("Enter")
        await android.wait_for_timeout(1500)
        r["A_shopping_item_added"] = "Plantain x6" in await android.inner_text("body")

        # ---- Android/inviter: send the invitation via the real form ----
        await android.goto(f"{WEB}/settings", wait_until="domcontentloaded")
        await android.wait_for_timeout(2000)
        # Settings groups are collapsed by default; open Household to reach the
        # invite rows inside it.
        await android.click('[data-testid="settings-group-household"]')
        await android.wait_for_timeout(400)
        await android.click("text=Invite a family member")
        await android.wait_for_timeout(800)
        await android.fill('[data-testid="invite-email"]', mail_b)
        await android.fill('[data-testid="invite-role"]', "Co-parent")
        await android.click('[data-testid="send-invite"]')
        await android.wait_for_timeout(2000)
        # No RESEND key locally: email delivery fails but the invite exists —
        # exactly the production junk-folder scenario the app must survive.
        await android.click('[data-testid="close-invite"]')
        await android.wait_for_timeout(500)
        # Household group is already open from the invite step above; just
        # expand Manage members to see the pending co-parent invite.
        await android.click('[data-testid="settings-household-toggle"]')
        await android.wait_for_timeout(800)
        body = await android.inner_text("body")
        r["A_pending_invite_with_role"] = mail_b in body and "Co-parent ·" in body

        # ---- Gating, FREE state (billing live: no testing window). By
        # design the suggestions sheet OPENS as a free peek; the gate fires
        # on ADDING the week to the planner. ----
        async def open_meal_suggest(page):
            await page.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)
            await page.click('[data-testid="kitchen-switch"]')
            await page.wait_for_timeout(500)
            await page.click('[data-testid="kitchen-pick-meal"]')
            await page.wait_for_timeout(1200)
            await page.click('[data-testid="meal-suggest"]')
            await page.wait_for_timeout(6000)
            return await page.inner_text("body")

        await open_meal_suggest(android)
        r["A_free_peek_shows_dinners"] = await android.locator(
            '[data-testid="suggest-add-all"]').count() == 1
        await android.click('[data-testid="suggest-add-all"]')
        await android.wait_for_timeout(2500)
        body = await android.inner_text("body")
        r["A_free_add_is_gated"] = "Upgrade needed" in body
        await android.click('[data-testid="upgrade-close"]')
        await android.wait_for_timeout(500)

        # ---- iPhone/invitee, content blocker active: no link, just opens ----
        await iphone.goto(f"{WEB}/feed", wait_until="domcontentloaded")
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
        await iphone.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await iphone.wait_for_timeout(2500)
        r["B_sees_shared_shopping"] = "Plantain x6" in await iphone.inner_text("body")

        # ---- Vault privacy: a shared household is not a shared filing
        # cabinet. Uploads happen over the API (a file picker cannot be
        # driven headlessly); the UI controls and the visibility rules are
        # what this asserts. ----
        api("POST", "/vault", {"title": "Payslip private", "category": "Legal",
                               "image_base64": "data:image/jpeg;base64,AAAA"}, tok_a)
        api("POST", "/vault", {"title": "Shared insurance", "category": "Legal",
                               "image_base64": "data:image/jpeg;base64,AAAA",
                               "visibility": "shared"}, tok_a)
        await android.goto(f"{WEB}/vault", wait_until="domcontentloaded")
        await android.wait_for_timeout(2500)
        await android.click('[data-testid="vault-add"]')
        await android.wait_for_timeout(900)
        r["A_vault_visibility_picker"] = await android.locator(
            '[data-testid="vault-visibility-private"]').count() == 1
        await android.keyboard.press("Escape")
        await android.wait_for_timeout(600)

        await iphone.goto(f"{WEB}/vault", wait_until="domcontentloaded")
        await iphone.wait_for_timeout(2500)
        body = await iphone.inner_text("body")
        r["B_vault_private_hidden"] = "Payslip private" not in body
        r["B_vault_shared_visible"] = "Shared insurance" in body

        # The owner un-shares from the preview; it vanishes for the other.
        await android.goto(f"{WEB}/vault", wait_until="domcontentloaded")
        await android.wait_for_timeout(2500)
        await android.click("text=Shared insurance")
        await android.wait_for_timeout(1200)
        r["A_vault_toggle_present"] = await android.locator(
            '[data-testid="preview-visibility"]').count() == 1
        await android.click('[data-testid="preview-visibility"]')
        await android.wait_for_timeout(1800)
        await iphone.reload(wait_until="domcontentloaded")
        await iphone.wait_for_timeout(2500)
        r["B_vault_unshared_now_hidden"] = "Shared insurance" not in await iphone.inner_text("body")

        # ---- Shopping: multi-select deletes only what was picked ----
        await iphone.goto(f"{WEB}/kitchen", wait_until="domcontentloaded")
        await iphone.wait_for_timeout(2500)
        if await iphone.get_by_placeholder("Add items — commas for several").count() == 0:
            await iphone.click('[data-testid="kitchen-switch"]')
            await iphone.wait_for_timeout(600)
            await iphone.click('[data-testid="kitchen-pick-shop"]')
            await iphone.wait_for_timeout(1500)
        shop_b = iphone.get_by_placeholder("Add items — commas for several")
        await shop_b.fill("Okra, Palm oil")
        await shop_b.press("Enter")
        await iphone.wait_for_timeout(2000)
        await iphone.click('[data-testid="shop-select-mode"]')
        await iphone.wait_for_timeout(600)
        await iphone.click("text=Okra")
        await iphone.wait_for_timeout(400)
        await iphone.click('[data-testid="shop-delete-selected"]')
        await iphone.wait_for_timeout(2500)
        body = await iphone.inner_text("body")
        r["B_selected_item_deleted"] = "Okra" not in body
        r["B_unselected_items_kept"] = "Palm oil" in body and "Plantain x6" in body

        # ---- Clear all: one undo point, older archives swept ----
        api("DELETE", "/shopping/all", None, tok_a)  # clears + archives
        await iphone.reload(wait_until="domcontentloaded")
        await iphone.wait_for_timeout(2500)
        r["B_restore_banner_after_clear"] = "Restore" in await iphone.inner_text("body")
        hist = api("GET", "/shopping/history", token=tok_a)
        r["one_archive_only"] = len(hist) == 1
        # Dismissing the banner deletes that archive for good.
        await iphone.click('[data-testid="restore-dismiss"]')
        await iphone.wait_for_timeout(2000)
        r["dismiss_removes_archive"] = len(api("GET", "/shopping/history", token=tok_a)) == 0

        # ---- Android/inviter: co-parents, moved child, accepted invite ----
        await android.goto(f"{WEB}/settings", wait_until="domcontentloaded")
        await android.wait_for_timeout(2500)
        await android.click('[data-testid="settings-group-household"]')
        await android.wait_for_timeout(400)
        await android.click('[data-testid="settings-household-toggle"]')
        await android.wait_for_timeout(1000)
        body = await android.inner_text("body")
        r["A_coparents_line"] = "Co-parents: Roland Sim & Keigh Sim" in body
        r["A_child_moved_over"] = "Jonael Sim" in body
        r["A_no_more_pending"] = "pending" not in body
        await android.screenshot(path="journey_android_family.png")

        # ---- Household turns tester/premium: an admin account joins ----
        inv = api("POST", "/family/invite",
                  {"email": "e2e-admin@sim.test", "relationship": "Admin"}, tok_a)
        admin_token_val = inv["invite"]["token"]
        try:
            api("POST", "/auth/register",
                {"name": "Admin Sim", "email": "e2e-admin@sim.test",
                 "password": "password123", "invite_token": admin_token_val})
        except urllib.error.HTTPError:
            api("POST", "/auth/login",
                {"email": "e2e-admin@sim.test", "password": "password123",
                 "invite_token": admin_token_val})
        # The admin-household check is cached for 60s — wait it out.
        await asyncio.sleep(61)

        # The shopping phases above emptied the list, and meal ideas are
        # built FROM the list — re-stock it before the premium phase.
        api("POST", "/shopping/bulk",
            {"names": ["Rice 1kg", "Chicken 600g", "Tomatoes x4", "Onion x2"]}, tok_a)

        # ---- Gating, PREMIUM state: the same Add-all must now WORK on
        # both personas, blocker included ----
        for name, page in (("A_android", android), ("B_iphone", iphone)):
            await open_meal_suggest(page)
            # Without an AI key the suggest endpoint 503s and the client
            # retries with backoff before falling back to the offline
            # engine — wait out the loading state before adding.
            await page.wait_for_timeout(10000)
            if await page.locator('[data-testid="suggest-add-all"]').count():
                await page.click('[data-testid="suggest-add-all"]')
            await page.wait_for_timeout(5000)
            body = await page.inner_text("body")
            r[f"{name}_premium_add_not_gated"] = "Upgrade needed" not in body
            # Meals in the planner make "Sync to list" appear — proof the
            # week actually landed, not just that no dialog showed.
            r[f"{name}_premium_week_added"] = "Sync to list" in body
        await iphone.goto(f"{WEB}/settings", wait_until="domcontentloaded")
        await iphone.wait_for_timeout(2500)
        r["B_sees_family_office"] = "Family Office" in await iphone.inner_text("body")
        await iphone.screenshot(path="journey_iphone_premium.png")
        await browser.close()

    # ---- Backend truth: family unification and role ----
    members = api("GET", "/family/members", token=tok_a)
    roles = {m["name"]: m["role"] for m in members}
    r["server_keigh_is_coparent"] = roles.get("Keigh Sim") == "Co-parent"
    r["server_child_in_family"] = roles.get("Jonael Sim") == "Child"
    sub = api("GET", "/subscription", token=tok_b)
    r["server_household_shares_top_plan"] = sub.get("plan") == "family_office"

    for k, v in r.items():
        print(f"{k}: {v}")
    print("ALL PASS" if all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if all(r.values()) else 1)


asyncio.run(main())
