"""Kid mode: a child gets their own app, and the household stays shut.

Two halves, and the second matters more:

  1. Ama picks herself out of the "Who's using this?" sheet, enters her PIN,
     and lands in her own app — her stars, her jobs, her rewards. She ticks a
     job off and spends stars on a reward, and both reach the server.
  2. The wall. The token her device is now holding is fired directly at the
     endpoints that matter — the vault, the feed, the household search — to
     prove the server refuses it. Not "the screen isn't shown": refused.

Usage:  python3 scripts/e2e_kid.py <web_port> <api_port>
"""
import asyncio, json, sys, urllib.error, urllib.request, uuid
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


def status_of(m, p, t):
    """The HTTP code alone — used to prove a door is shut."""
    try:
        api(m, p, None, t)
        return 200
    except urllib.error.HTTPError as e:
        return e.code


async def main():
    r = {}
    run = uuid.uuid4().hex[:6]
    u = api("POST", "/auth/register", {"name": "Roland K", "email": f"rk-{run}@sim.test",
                                       "password": "password123"})
    tok = u["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok)

    # Deliberately NO parent PIN yet: the sheet has to be able to create one
    # itself. Telling a parent to go and find a setting on another screen is
    # the app failing to do its job, and this proves it does not.
    ama = api("POST", "/family/members", {"name": "Ama", "role": "Child",
                                          "starting_stars": 30, "pin": "1234"}, tok)
    api("POST", "/rewards", {"title": "Ice cream", "cost_stars": 10, "icon": "🍦"}, tok)
    api("POST", "/cards", {"type": "TASK", "title": "Tidy your room",
                           "assignee": "Ama", "shared": True}, tok)
    api("POST", "/cards", {"type": "TASK", "title": "Pay the mortgage",
                           "assignee": "Roland K", "shared": True}, tok)
    api("POST", "/vault", {"title": "Passports", "category": "Legal",
                           "image_base64": "x", "mime_type": "image/jpeg"}, tok)

    async with async_playwright() as pw:
        br = await launch_chromium(pw)
        ctx = await br.new_context(viewport={"width": 390, "height": 844})
        p = await ctx.new_page()
        errs = []
        p.on("pageerror", lambda e: errs.append(str(e)))

        async def route(ro):
            path = ro.request.url.split("/api/", 1)[1]
            resp = await ctx.request.fetch(
                f"{API}/{path}", method=ro.request.method,
                headers={k: v for k, v in ro.request.headers.items()
                         if k.lower() not in ("host", "content-length", "origin", "referer")},
                data=ro.request.post_data)
            await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())

        await p.route("**/api/**", route)
        await p.add_init_script(f"localStorage.setItem('coo_session_token','{tok}');")

        # --- handing the device over ---------------------------------------
        await p.goto(f"{WEB}/feed", wait_until="domcontentloaded")
        await p.wait_for_timeout(3500)
        await p.click('[data-testid="feed-household-menu"]')
        await p.wait_for_timeout(1200)
        r["more_offers_hand_over"] = await p.locator('[data-testid="more-kid"]').count() == 1
        await p.click('[data-testid="more-kid"]')
        await p.wait_for_timeout(1800)

        # --- the way out has to exist before the way in ----------------------
        r["asks_for_a_parent_pin_first"] = await p.locator(
            '[data-testid="pin-1"]').count() == 1
        # Two digits only: incomplete, so the pad must not submit anything.
        for d in "12":
            await p.click(f'[data-testid="pin-{d}"]')
        await p.wait_for_timeout(900)
        # Still on the parent-PIN step: two digits is not a PIN, and nothing
        # should have been saved or unlocked.
        r["rejects_a_short_pin"] = await p.locator(
            f'[data-testid="handover-{ama["member_id"]}"]').count() == 0
        # Clear the two stray digits, then enter a whole PIN. The fourth
        # keypress saves it; there is no button to press, which is the point —
        # the confirm button was the thing Android's keyboard kept covering.
        for _ in range(2):
            await p.click('[data-testid="pin-back"]')
        for d in "9999":
            await p.click(f'[data-testid="pin-{d}"]')
        await p.wait_for_timeout(2500)
        r["setting_it_here_unlocks_the_picker"] = await p.locator(
            f'[data-testid="handover-{ama["member_id"]}"]').count() == 1
        await p.screenshot(path="kid_picker.png")

        sheet = await p.inner_text("body")
        r["picker_lists_the_child"] = "Ama" in sheet

        # A wrong PIN is refused before anything is handed over.
        await p.click(f'[data-testid="handover-{ama["member_id"]}"]')
        await p.wait_for_timeout(900)
        for d in "0000":
            await p.click('[data-testid="pin-0"]')
        await p.wait_for_timeout(1800)
        r["wrong_pin_refused"] = "not right" in (await p.inner_text("body"))

        # Same here: the fourth digit hands the device over on its own.
        # (`go` clears the field after a refusal, so these four land clean.)
        for d in "1234":
            await p.click(f'[data-testid="pin-{d}"]')
        await p.wait_for_timeout(4000)
        body = await p.inner_text("body")
        r["lands_in_her_own_app"] = "Hi Ama" in body
        r["shows_her_stars"] = "30" in (await p.inner_text('[data-testid="kid-stars"]'))
        r["shows_her_job"] = "Tidy your room" in body
        r["hides_the_parents_job"] = "Pay the mortgage" not in body
        r["shows_the_reward"] = "Ice cream" in body
        await p.screenshot(path="kid_home.png")

        # --- the wall -------------------------------------------------------
        kid_token = await p.evaluate("localStorage.getItem('coo_session_token')")
        r["device_swapped_tokens"] = bool(kid_token) and kid_token != tok
        parent_kept = await p.evaluate("localStorage.getItem('coo_parent_token')")
        r["parents_token_set_aside"] = parent_kept == tok

        shut = {path: status_of("GET", path, kid_token)
                for path in ("/vault", "/cards", "/family/members", "/activity",
                             "/shopping", "/auth/me", "/search?q=passport")}
        print("kid token against the household:", shut)
        r["household_refuses_the_kid_token"] = all(code == 403 for code in shut.values())

        # --- what she can do -------------------------------------------------
        await p.click('text=Tidy your room')
        await p.wait_for_timeout(3500)
        cards = api("GET", "/cards", None, tok)
        tidy = [c for c in cards if c["title"] == "Tidy your room"][0]
        r["her_tick_off_reached_the_server"] = tidy["status"] == "DONE"
        r["it_is_recorded_as_hers"] = tidy.get("completed_by_name") == "Ama"
        # Finishing her own job pays 5 stars (30 -> 35). Kid-mode
        # self-completion earns, the same as a parent marking it done — it used
        # to award nothing, leaving the whole earning loop dead.
        earned = [m for m in api("GET", "/family/members", None, tok)
                  if m["member_id"] == ama["member_id"]][0]
        r["finishing_her_job_earned_stars"] = earned["stars"] == 35

        await p.click('text=Ice cream')
        await p.wait_for_timeout(3500)
        fresh = [m for m in api("GET", "/family/members", None, tok)
                 if m["member_id"] == ama["member_id"]][0]
        # 35 earned minus the 10-star Ice cream.
        r["spending_stars_worked"] = fresh["stars"] == 25
        body = await p.inner_text("body")
        # Case-folded: the section label is uppercased in CSS, and inner_text
        # returns what is rendered, not what the source says.
        r["she_can_see_what_she_is_owed"] = "waiting for you" in body.lower()
        await p.screenshot(path="kid_after.png")

        # --- handing it back -------------------------------------------------
        await p.click('[data-testid="kid-exit"]')
        await p.wait_for_timeout(1200)
        await p.fill('[data-testid="kid-exit-pin"]', "1234")     # her own PIN
        await p.click('[data-testid="kid-exit-confirm"]')
        await p.wait_for_timeout(2500)
        r["she_cannot_let_herself_out"] = "Hi Ama" in (await p.inner_text("body"))

        await p.fill('[data-testid="kid-exit-pin"]', "9999")     # a grown-up's
        await p.click('[data-testid="kid-exit-confirm"]')
        await p.wait_for_timeout(4500)
        body = await p.inner_text("body")
        r["a_grown_up_gets_it_back"] = "AHENORA" in body
        back = await p.evaluate("localStorage.getItem('coo_session_token')")
        r["parents_session_restored"] = back == tok
        r["set_aside_copy_cleared"] = await p.evaluate(
            "localStorage.getItem('coo_parent_token')") is None
        await p.screenshot(path="kid_back.png")

        r["no_js_errors"] = not errs
        if errs:
            print("page errors:", errs[:3])
        await br.close()

    for k, v in r.items():
        print(f"{k}: {v}")
    ok = all(r.values())
    print("ALL PASS" if ok else "FAILURES PRESENT")
    sys.exit(0 if ok else 1)


asyncio.run(main())
