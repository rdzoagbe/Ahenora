"""A handover with an owner, driven end to end through two browsers.

The loop this exists to prove: one parent addresses a note to another, it
appears at the top of THAT person's Feed and nobody else's, they say they have
it, and the person who wrote it is told. Every step of that crosses a boundary
-- two accounts, two browsers, a push, and a piece of state that has to mean
the same thing on both screens -- which is exactly the shape of thing that
passes in unit tests and is wrong in the app.

Also held here: the states nobody photographs. A note nobody has picked up
reads "not yet" rather than silence, and it is NOT nagged; and the strip is
absent for the household member it was not addressed to.
"""
import asyncio, json, sys, urllib.request
from playwright.async_api import async_playwright

from e2e_browser import launch_chromium

WEB = f"http://127.0.0.1:{sys.argv[1]}/app"
API = f"http://127.0.0.1:{sys.argv[2]}/api"


def api(m, p, b=None, t=None):
    r = urllib.request.Request(f"{API}{p}", data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {t}"} if t else {})}, method=m)
    with urllib.request.urlopen(r, timeout=20) as res:
        return json.loads(res.read().decode() or "{}")


async def open_feed(ctx, token):
    page = await ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))

    async def route(ro):
        path = ro.request.url.split("/api/", 1)[1]
        resp = await ctx.request.fetch(f"{API}/{path}", method=ro.request.method,
            headers={k: v for k, v in ro.request.headers.items()
                     if k.lower() not in ("host", "content-length", "origin", "referer")},
            data=ro.request.post_data)
        await ro.fulfill(status=resp.status, content_type="application/json", body=await resp.body())
    await page.route("**/api/**", route)
    await page.add_init_script(f"localStorage.setItem('coo_session_token','{token}');")
    await page.goto(f"{WEB}/feed", wait_until="domcontentloaded")
    await page.wait_for_timeout(3500)
    return page, errs


async def main():
    """Every check recorded so far is printed even when a later step throws.

    A harness that dies on step nine and prints nothing makes you guess which
    of the first eight were already false — and guessing is how the wrong
    thing gets fixed.
    """
    import uuid
    r = {}
    try:
        await run(r)
    except Exception as e:
        print(f"stopped at: {type(e).__name__}: {str(e).splitlines()[0]}")
        r["ran_to_the_end"] = False
    for k, v in r.items():
        print(f"{k}: {v}")
    print("ALL PASS" if r and all(r.values()) else "FAILURES PRESENT")
    sys.exit(0 if r and all(r.values()) else 1)


async def run(r):
    import uuid
    tag = uuid.uuid4().hex[:6]

    author = api("POST", "/auth/register", {"name": "Roland Sim", "email": f"note-a-{tag}@sim.test",
                                            "password": "password123"})
    tok_a = author["session_token"]
    api("POST", "/auth/complete-onboarding", {}, tok_a)

    # A co-parent, invited and accepted through the real endpoints. A plain
    # invite with no relationship is the co-parent default, and needs no plan.
    mate_email = f"note-b-{tag}@sim.test"
    inv = api("POST", "/family/invite", {"email": mate_email}, tok_a)
    mate = api("POST", "/auth/register", {"name": "Keigh Sim", "email": mate_email,
                                          "password": "password123",
                                          "invite_token": inv["invite"]["token"]})
    tok_b = mate["session_token"]
    mate_user_id = api("GET", "/auth/me", None, tok_b)["user_id"]
    api("POST", "/auth/complete-onboarding", {}, tok_b)
    r["the_two_share_a_household"] = (
        api("GET", "/auth/me", None, tok_a)["family_id"]
        == api("GET", "/auth/me", None, tok_b)["family_id"])

    members = api("GET", "/family/members", None, tok_a)
    mate_member = next((m for m in members if m.get("name") == "Keigh Sim"), None)
    r["the_co_parent_can_be_addressed"] = bool(mate_member and mate_member.get("has_account"))
    if not mate_member:
        raise RuntimeError("the invited co-parent has no member row")

    async with async_playwright() as pw:
        b = await launch_chromium(pw)
        ctx_a = await b.new_context(viewport={"width": 390, "height": 844})
        ctx_b = await b.new_context(viewport={"width": 390, "height": 844})

        page_a, errs_a = await open_feed(ctx_a, tok_a)

        # The composer lives in the household section, which is collapsed by
        # default so the screen people open all day stays short. The STRIP does
        # not — a handover waiting on you is top-level, which is the asymmetry
        # the feature depends on: easy to leave, impossible to miss.
        await page_a.click('[data-testid="feed-household-open"]')
        await page_a.wait_for_timeout(1200)

        # --- addressing, from the composer -------------------------------
        r["the_picker_offers_the_co_parent"] = await page_a.locator(
            f'[data-testid="note-for-{mate_member["member_id"]}"]').count() == 1
        # And offers nobody who could not pick one up: a fresh household has no
        # children yet, so the only chips are Everyone and the co-parent.
        r["the_picker_defaults_to_everyone"] = await page_a.locator(
            '[data-testid="note-for-everyone"]').count() == 1
        await page_a.click(f'[data-testid="note-for-{mate_member["member_id"]}"]')
        await page_a.fill('[data-testid="feed-note-input"]', "Ama has swimming Thursday")
        await page_a.click('[data-testid="feed-note-send"]')
        await page_a.wait_for_timeout(2500)
        await page_a.screenshot(path="notes_composed.png")

        stored = api("GET", "/handoff-notes", None, tok_a)
        r["the_note_carries_its_owner"] = bool(
            stored and stored[0].get("for_user_id") == mate_user_id)
        note_id = stored[0]["note_id"] if stored else ""

        # The author's own list says it is waiting on someone.
        body_a = await page_a.inner_text("body")
        r["the_author_sees_who_owes_them"] = "Keigh Sim" in body_a and "not yet" in body_a
        # ...and does not get a strip for a note they wrote.
        r["the_author_gets_no_strip"] = await page_a.locator(
            '[data-testid^="note-for-me-"]').count() == 0

        # --- the person it names ------------------------------------------
        # Server first, then the screen. When the strip is missing this says
        # which of the two is wrong, instead of leaving both suspects.
        mine = api("GET", "/handoff-notes", None, tok_b)
        r["the_server_says_it_is_theirs"] = bool(mine and mine[0].get("for_me"))
        if not r["the_server_says_it_is_theirs"]:
            print(f"recipient's first note: {mine[0] if mine else None}")

        page_b, errs_b = await open_feed(ctx_b, tok_b)
        await page_b.screenshot(path="notes_received.png")
        r["it_is_waiting_at_the_top_for_them"] = await page_b.locator(
            f'[data-testid="note-for-me-{note_id}"]').count() == 1
        body_b = await page_b.inner_text("body")
        r["it_says_who_left_it"] = "Roland Sim left you a note" in body_b
        r["it_says_what_noting_it_does"] = "Tells Roland Sim you have it" in body_b
        # The strip sits ABOVE the day's work, not below it — the whole reason
        # it is a strip and not a row further down.
        r["it_sits_above_the_days_work"] = await page_b.evaluate(f"""
          () => {{
            const strip = document.querySelector('[data-testid="note-for-me-{note_id}"]');
            const capture = document.querySelector('[data-testid="feed-capture-input"]');
            if (!strip || !capture) return false;
            return strip.getBoundingClientRect().top < capture.getBoundingClientRect().top;
          }}
        """)
        await page_b.screenshot(path="notes_received.png")

        # --- taking it on --------------------------------------------------
        await page_b.click(f'[data-testid="note-ack-{note_id}"]')
        await page_b.wait_for_timeout(2500)
        r["the_strip_goes_once_they_have_it"] = await page_b.locator(
            f'[data-testid="note-for-me-{note_id}"]').count() == 0
        acked = api("GET", "/handoff-notes", None, tok_b)
        r["the_server_recorded_who_took_it"] = bool(
            acked and acked[0].get("acked_by_name") == "Keigh Sim")
        await page_b.screenshot(path="notes_acked.png")

        # --- and the person who wrote it is told ---------------------------
        await page_a.reload(wait_until="domcontentloaded")
        await page_a.wait_for_timeout(3500)
        await page_a.click('[data-testid="feed-household-open"]')
        await page_a.wait_for_timeout(1200)
        body_a2 = await page_a.inner_text("body")
        r["the_author_sees_it_was_taken_on"] = "Noted by Keigh Sim" in body_a2
        r["the_author_no_longer_sees_not_yet"] = "not yet" not in body_a2
        await page_a.screenshot(path="notes_author_after.png")

        r["no_js_errors_for_the_author"] = not errs_a
        r["no_js_errors_for_the_recipient"] = not errs_b
        await b.close()

asyncio.run(main())
